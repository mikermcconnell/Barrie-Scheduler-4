import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aggregateDailySummaries } from '../functions/src/aggregator';
import { parseSTREETSCSV } from '../functions/src/parser';
import { STREETS_REQUIRED_COLUMNS } from '../functions/src/types';
import { assertOperationalPreservation, hashSource, hashValue, passengerProjection,
    prepareCorrection, replacePreparedDays, rollbackPreparedDays } from '../scripts/lib/ridershipCorrection';

const columns = [...STREETS_REQUIRED_COLUMNS, 'APCSource', 'VehicleLocationTPKey', 'OperatorID', 'InternalTripID', 'IsDetour'];
function sourceRow(overrides: Record<string, string | number | boolean> = {}) {
    return { VehicleID: '2302', InBetween: false, Date: '2026-10-01', Day: 'DAY_OF_WEEK',
        ArrivalTime: '12:00', ObservedArrivalTime: '12:00:10', StopTime: '12:00', ObservedDepartureTime: '12:00:30',
        DepartureLoad: 7, Boardings: 2, Alightings: 1, Block: '400-01', TripName: '400 - 12:00',
        StopName: 'Georgian College', RouteName: 'Route 400', RouteID: '400', RouteStopIndex: 0,
        StopID: '330', Direction: 'S', StopLat: 44.41, StopLon: -79.67, TimePoint: true,
        TripID: 'observed-trip', TerminalDepartureTime: '12:00', WheelchairUsageCount: 0,
        APCSource: 1, VehicleLocationTPKey: 1, OperatorID: 'operator-1', InternalTripID: 1, IsDetour: false, ...overrides };
}
function fixture(extra: ReturnType<typeof sourceRow>[] = []) {
    const rows = [sourceRow(), sourceRow({ StopID: 'end', StopName: 'End', RouteStopIndex: 1,
        ArrivalTime: '12:20', StopTime: '12:20', ObservedArrivalTime: '12:20:10', ObservedDepartureTime: '12:20:30',
        Boardings: 0, Alightings: 2 }), sourceRow({ InBetween: true, Boardings: 9, Alightings: 2 }), ...extra];
    const csv = [columns.join(','), ...rows.map(row => columns.map(c => JSON.stringify(String(row[c as keyof typeof row]))).join(','))].join('\n');
    const { records } = parseSTREETSCSV(csv);
    const stored = aggregateDailySummaries(records.map(r => ({ ...r, ...(r.inBetween ? { boardings: 0, alightings: 0 } : {}) })))[0];
    stored.schemaVersion = 14;
    // Historical operational values deliberately differ from today's replay and must survive exactly.
    stored.system.otp.onTimePercent = 42;
    stored.byRoute[0].serviceHours = 17.25;
    stored.dataQuality.loadCapped = 999;
    stored.missedTrips = { totalScheduled: 10, totalMatched: 8, totalMissed: 2, missedPct: 20,
        notPerformedCount: 2, lateOver15Count: 0, byRoute: [] };
    return { stored, source: { date: stored.date, csv, sha256: hashSource(csv), archiveId: 'approved-original.csv', recordCount: rows.length }, records };
}

describe('passenger-only historical correction', () => {
    it('corrects all passenger views while preserving exact historical operations and schema', () => {
        const { stored, source, records } = fixture();
        const original = structuredClone(stored);
        const result = prepareCorrection(stored, source);
        expect(result.status, result.reason).toBe('ready');
        expect(result.corrected.system).toMatchObject({ totalRidership: 11, totalBoardings: 11, totalAlightings: 5 });
        expect(result.corrected.byRoute[0]).toMatchObject({ ridership: 11, alightings: 5, serviceHours: 17.25 });
        expect(passengerProjection(result.corrected)).toEqual(passengerProjection(aggregateDailySummaries(structuredClone(records))[0]));
        expect(result.corrected.schemaVersion).toBe(14);
        expect(result.corrected.missedTrips).toEqual(stored.missedTrips);
        expect(result.corrected.byOperatorDwell).toEqual(stored.byOperatorDwell);
        expect(result.corrected.byCascade).toEqual(stored.byCascade);
        expect(result.corrected.dataQuality).toEqual(stored.dataQuality);
        expect(result.corrected.segmentRuntimes).toEqual(stored.segmentRuntimes);
        expect(result.corrected.byTrip.map(r => r.tripId)).toEqual(stored.byTrip.map(r => r.tripId));
        expect(result.corrected.loadProfiles[0].stops[0].avgLoad).toBe(stored.loadProfiles[0].stops[0].avgLoad);
        expect(() => assertOperationalPreservation(stored, result.corrected)).not.toThrow();
        expect(stored).toEqual(original);
    });

    it('is repeat-safe without relying on a blanket schema upgrade', () => {
        const { stored, source } = fixture();
        const result = prepareCorrection(stored, source);
        const first = replacePreparedDays([stored], [result]);
        expect(replacePreparedDays(first, [result])).toEqual(first);
        const repeated = prepareCorrection(first[0], source);
        expect(repeated.status, repeated.reason).toBe('already-corrected');
        expect(repeated.corrected).toEqual(first[0]);
    });

    it('restores exact originals and refuses rollback over a later import', () => {
        const { stored, source } = fixture();
        const result = prepareCorrection(stored, source);
        const corrected = replacePreparedDays([stored], [result]);
        expect(rollbackPreparedDays(corrected, [stored], [result])).toEqual([stored]);
        expect(rollbackPreparedDays([stored], [stored], [result])).toEqual([stored]);
        corrected[0].system.otp.late += 1;
        expect(() => rollbackPreparedDays(corrected, [stored], [result])).toThrow('rollback refused');
    });

    it('refuses stale previews and corrupt replacements or backups', () => {
        const { stored, source } = fixture();
        const result = prepareCorrection(stored, source);
        const changed = structuredClone(stored);
        changed.byRoute[0].serviceHours += 1;
        expect(() => replacePreparedDays([changed], [result])).toThrow('re-preview');
        const corrupt = structuredClone(result);
        corrupt.corrected.system.totalBoardings += 1;
        expect(() => replacePreparedDays([stored], [corrupt])).toThrow('checksum');
        expect(() => rollbackPreparedDays([result.corrected], [changed], [result])).toThrow('backup checksum');
    });

    it('preserves missing-source and unrequested dates; never removes a date window', () => {
        const { stored, source } = fixture();
        const missing = { ...structuredClone(stored), date: '2026-09-30' };
        const untouched = { ...structuredClone(stored), date: '2026-09-29' };
        const skipped = prepareCorrection(missing);
        expect(skipped.status).toBe('skipped');
        const days = replacePreparedDays([untouched, missing, stored], [skipped, prepareCorrection(stored, source)]);
        expect(days).toHaveLength(3);
        expect(days[0]).toEqual(untouched);
        expect(days[1]).toEqual(missing);
    });

    it.each(['system', 'route', 'stop', 'hour', 'trip', 'heatmap', 'loadProfile'])('skips mismatched %s passenger evidence', field => {
        const { stored, source } = fixture();
        if (field === 'system') stored.system.totalBoardings++;
        if (field === 'route') stored.byRoute[0].ridership++;
        if (field === 'stop') stored.byStop[0].hourlyBoardings![12]++;
        if (field === 'hour') stored.byHour[0].boardings++;
        if (field === 'trip') stored.byTrip[0].boardings++;
        if (field === 'heatmap') stored.ridershipHeatmaps![0].cells[0][0]![0]++;
        if (field === 'loadProfile') stored.loadProfiles[0].stops[0].avgBoardings++;
        const result = prepareCorrection(stored, source);
        expect(result.status).toBe('skipped');
        expect(result.corrected).toEqual(stored);
    });

    it('skips ambiguous legacy identities and compact report projections', () => {
        const { stored, source } = fixture();
        const legacy = { ...stored, schemaVersion: 13 };
        expect(prepareCorrection(legacy, source).status).toBe('skipped');
        stored.ridershipHeatmaps = undefined;
        expect(prepareCorrection(stored, source).status).toBe('skipped');
    });

    it('skips wrong dates, checksums, row counts, parse errors and invalid movements', () => {
        const { stored, source } = fixture();
        for (const invalid of [{ ...source, sha256: 'wrong' }, { ...source, date: '2026-09-30' },
            { ...source, archiveId: '' }, { ...source, recordCount: 200 }]) {
            expect(prepareCorrection(stored, invalid).status).toBe('skipped');
        }
        const wrongDate = source.csv.replaceAll('2026-10-01', '2026-09-30');
        expect(prepareCorrection(stored, { ...source, csv: wrongDate, sha256: hashSource(wrongDate) }).status).toBe('skipped');
        const broken = 'Date,Boardings\n2026-10-01,1';
        expect(prepareCorrection(stored, { ...source, csv: broken, sha256: hashSource(broken) }).status).toBe('skipped');
        const negative = fixture([sourceRow({ InBetween: true, Boardings: -1 })]);
        expect(prepareCorrection(negative.stored, negative.source).reason).toContain('Invalid');
    });

    it('does not turn passenger-only routes, stops or trips into observed operations', () => {
        const { stored, source } = fixture([sourceRow({ InBetween: true, RouteID: '99', RouteName: 'Extra',
            TripID: 'passenger-only', StopID: 'extra', StopName: 'Extra', Direction: 'N', Boardings: 5, Alightings: 2,
            ArrivalTime: '15:00', StopTime: '15:00', TerminalDepartureTime: '15:00', VehicleID: 'new-bus', TimePoint: true })]);
        const result = prepareCorrection(stored, source);
        expect(result.status, result.reason).toBe('ready');
        expect(result.corrected.byTrip).toHaveLength(stored.byTrip.length);
        expect(result.corrected.system.tripCount).toBe(stored.system.tripCount);
        expect(result.corrected.byRoute.find(r => r.routeId === '99')).toMatchObject({ ridership: 5, tripCount: 0, serviceHours: 0 });
        expect(result.corrected.byStop.find(r => r.stopId === 'extra')).toMatchObject({ boardings: 5, avgLoad: 0, isTimepoint: false });
        expect(rollbackPreparedDays([result.corrected], [stored], [result])).toEqual([stored]);
    });

    it('retains repeated-stop occurrence identity and existing trip capacity', () => {
        const { stored, source } = fixture([sourceRow({ StopID: '330', RouteStopIndex: 2, Boardings: 3,
            ArrivalTime: '12:30', StopTime: '12:30' }), sourceRow({ InBetween: true, StopID: '330', RouteStopIndex: 2, Boardings: 4 })]);
        const result = prepareCorrection(stored, source);
        expect(result.status, result.reason).toBe('ready');
        const map = result.corrected.ridershipHeatmaps![0];
        expect(map.stops.filter(s => s.stopId === '330').map(s => s.occurrenceIndex)).toEqual([0, 1]);
        expect(map.trips).toEqual(stored.ridershipHeatmaps![0].trips);
    });

    it('rejects duplicate identities, requested dates removed since preview, and changed observed counts', () => {
        const { stored, source } = fixture();
        const result = prepareCorrection(stored, source);
        expect(() => replacePreparedDays([], [result])).toThrow('no longer exists');
        expect(() => replacePreparedDays([stored], [result, result])).toThrow('duplicate');
        stored.byRoute.push(structuredClone(stored.byRoute[0]));
        expect(prepareCorrection(stored, source).status).toBe('skipped');
        const other = fixture();
        other.stored.system.tripCount++;
        expect(prepareCorrection(other.stored, other.source).reason).toContain('observed-trip');
    });

    it('independently detects changed operational fields', () => {
        const { stored, source } = fixture();
        const corrected = prepareCorrection(stored, source).corrected;
        corrected.byTrip[0].maxLoad++;
        expect(() => assertOperationalPreservation(stored, corrected)).toThrow('Operational evidence changed');
        expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    });

    it('preserves legacy hour-24 buckets and the historical 24-slot stop-array convention', () => {
        const { stored, source } = fixture([
            sourceRow({ StopID: 'night', StopName: 'Night', RouteStopIndex: 2, ArrivalTime: '24:10', Boardings: 4 }),
            sourceRow({ InBetween: true, StopID: 'night', StopName: 'Night', RouteStopIndex: 2,
                ArrivalTime: '24:10', Boardings: 5 }),
        ]);
        stored.byHour.find(r => r.hour === 0)!.hour = 24;
        stored.byRouteHour!.find(r => r.hour === 0)!.hour = 24;
        for (const stop of stored.byStop) {
            stop.hourlyBoardings![0] = 0;
            stop.hourlyAlightings![0] = 0;
            for (const route of stop.routeBreakdown!) {
                route.hourlyBoardings![0] = 0;
                route.hourlyAlightings![0] = 0;
            }
        }
        const result = prepareCorrection(stored, source);
        expect(result.status, result.reason).toBe('ready');
        expect(result.hourlyConvention).toBe('legacy-service-hour');
        expect(result.corrected.byHour.find(r => r.hour === 24)!.boardings).toBe(9);
        expect(result.corrected.byHour.some(r => r.hour === 0)).toBe(false);
        expect(result.corrected.byStop.find(s => s.stopId === 'night')!.hourlyBoardings![0]).toBe(0);
        expect(result.corrected.byStop.find(s => s.stopId === 'night')!.boardings).toBe(9);
        expect(prepareCorrection(result.corrected, source).status).toBe('already-corrected');
        expect(() => assertOperationalPreservation(stored, result.corrected)).not.toThrow();
    });

    it('rejects malformed numeric source values instead of silently treating them as zero', () => {
        for (const value of ['not-a-number', '', '   ']) {
            const { stored, source } = fixture([sourceRow({ InBetween: true, Boardings: value })]);
            expect(prepareCorrection(stored, source).reason).toContain('Invalid source passenger');
        }
    });

    it('retains missing normal-source fields as missing evidence only after baseline reconciliation', () => {
        const { stored, source } = fixture([sourceRow({ InBetween: false, Boardings: '', Alightings: '',
            StopID: 'missing-apc', StopName: 'Missing APC', RouteStopIndex: 2 })]);
        const result = prepareCorrection(stored, source);
        expect(result.status, result.reason).toBe('ready');
        expect(result.missingNormalPassengerRows).toBe(1);
        expect(result.corrected.system.totalBoardings).toBe(11);
        expect(result.corrected.dataQuality).toEqual(stored.dataQuality);
        stored.byStop[0].boardings++;
        expect(prepareCorrection(stored, source).status).toBe('skipped');
    });

    it.each([
        { InBetween: true, Boardings: '', Alightings: '' },
        { InBetween: false, Boardings: '', Alightings: 1 },
        { InBetween: false, Boardings: 1, Alightings: '' },
        { InBetween: '', Boardings: '', Alightings: '' },
        { InBetween: 'unknown', Boardings: '', Alightings: '' },
    ])('refuses missing counts with ambiguous/partial/intermediate evidence: %j', overrides => {
        const { stored, source } = fixture([sourceRow(overrides)]);
        const result = prepareCorrection(stored, source);
        expect(result.status).toBe('skipped');
        expect(result.corrected).toEqual(stored);
    });

    it('rejects added observed-trip evidence even if a replacement checksum is recomputed', () => {
        const { stored, source } = fixture();
        const result = prepareCorrection(stored, source);
        result.corrected.byTrip.push({ ...result.corrected.byTrip[0], tripId: 'not-observed' });
        result.afterHash = hashValue(result.corrected);
        expect(() => replacePreparedDays([stored], [result])).toThrow('introduced observed-trip');
    });

    it('stages an offline CLI correction with backups, projections, exceptions and no input overwrite', () => {
        const temp = mkdtempSync(path.join(tmpdir(), 'ridership-correction-test-'));
        const { stored, source } = fixture();
        const missing = { ...structuredClone(stored), date: '2026-09-30' };
        const summary = { dailySummaries: [missing, stored], metadata: { importedAt: 'historical', importedBy: 'original',
            dateRange: { start: missing.date, end: stored.date }, dayCount: 2, totalRecords: 6 }, schemaVersion: 14 };
        const input = path.join(temp, 'stored.json');
        const inputText = JSON.stringify(summary, null, 2);
        writeFileSync(input, inputText);
        writeFileSync(path.join(temp, 'source.csv'), source.csv);
        const manifest = { version: 1, storedFiles: ['stored.json'], dates: [missing.date, stored.date], sources: [
            { ...source, csv: undefined as string | undefined, csvPath: 'source.csv' },
            { ...source, csv: undefined as string | undefined, csvPath: 'missing-original.csv', date: missing.date },
        ] };
        const manifestPath = path.join(temp, 'manifest.json');
        writeFileSync(manifestPath, JSON.stringify(manifest));
        const out = path.join(temp, 'staged');
        const invoke = (...args: string[]) => spawnSync(process.execPath, ['scripts/prepareRidershipCorrection.mjs', ...args],
            { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 });
        const staged = invoke('--manifest', manifestPath, '--out', out);
        expect(staged.status, staged.stderr).toBe(0);
        expect(readFileSync(input, 'utf8')).toBe(inputText);
        expect(readFileSync(path.join(out, 'original-0.json'), 'utf8')).toBe(inputText);
        const corrected = JSON.parse(readFileSync(path.join(out, 'corrected-0.json'), 'utf8'));
        expect(corrected.dailySummaries[0]).toEqual(missing);
        expect(corrected.dailySummaries[1].system.totalRidership).toBe(11);
        expect(corrected.metadata).toEqual(summary.metadata);
        expect(JSON.parse(readFileSync(path.join(out, 'COMPLETE.json'), 'utf8'))).toMatchObject({ localOnly: true, ready: 1, skipped: 1 });
        expect(JSON.parse(readFileSync(path.join(out, 'ledger.json'), 'utf8'))).toMatchObject({ localOnly: true,
            verified: { repeatRun: true, rollback: true, operationalPreservation: true, inputDayCount: 2, outputDayCount: 2 } });
        const impact = JSON.parse(readFileSync(path.join(out, 'impact.json'), 'utf8'));
        expect(impact.selectedPeriod.addedBoardings).toBe(9);
        expect(impact.exceptions[0].reason).toContain('could not be read');
        expect(existsSync(path.join(out, 'overview.json'))).toBe(true);
        expect(existsSync(path.join(out, 'report.json'))).toBe(true);
        expect(existsSync(path.join(out, 'load-profiles-0-2026-10.json'))).toBe(true);
        expect(existsSync(path.join(out, 'route-0-2026-10-400.json'))).toBe(true);
        expect(readFileSync(path.join(out, 'email-preview.html'), 'utf8')).toContain('11');
        // Existing folders, live flags and duplicate exports are refused before any overwrite.
        const repeated = invoke('--manifest', manifestPath, '--out', out);
        expect(repeated.status).not.toBe(0);
        expect(readFileSync(path.join(out, 'original-0.json'), 'utf8')).toBe(inputText);
        expect(invoke('--apply').status).not.toBe(0);
        writeFileSync(manifestPath, JSON.stringify({ ...manifest, sources: [manifest.sources[0], manifest.sources[0]] }));
        const duplicateOut = path.join(temp, 'duplicates');
        const duplicate = invoke('--manifest', manifestPath, '--out', duplicateOut);
        expect(duplicate.status).not.toBe(0);
        expect(duplicate.stderr).toContain('Multiple exports');
        expect(existsSync(duplicateOut)).toBe(false);
        // Unrequested bad dates must not be allowed to generate filenames outside the output folder.
        writeFileSync(manifestPath, JSON.stringify({ ...manifest, dates: [stored.date], sources: [manifest.sources[0]] }));
        writeFileSync(input, JSON.stringify({ ...summary, dailySummaries: [{ ...missing, date: '/../../' }, stored] }));
        const escapedOut = path.join(temp, 'escaped');
        expect(invoke('--manifest', manifestPath, '--out', escapedOut).stderr).toContain('Invalid stored service date');
        expect(existsSync(escapedOut)).toBe(false);
        // CSV exceptions must use doubled quotes, not JSON backslash escapes.
        const ambiguous = structuredClone(stored);
        ambiguous.byRoute.push(structuredClone(ambiguous.byRoute[0]));
        writeFileSync(input, JSON.stringify({ ...summary, dailySummaries: [ambiguous] }));
        const quotedOut = path.join(temp, 'quoted-exception');
        const quoted = invoke('--manifest', manifestPath, '--out', quotedOut);
        expect(quoted.status, quoted.stderr).toBe(0);
        const exceptionCSV = readFileSync(path.join(quotedOut, 'preview.csv'), 'utf8');
        expect(exceptionCSV).toContain('identity: [""400""]');
        expect(exceptionCSV).not.toContain('\\"400\\"');
    }, 30000);
});
