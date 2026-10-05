/** Local-only passenger correction. No Firebase, network, publication or email writes. */
import { createHash } from 'node:crypto';
import { aggregateDailySummaries } from '../../functions/src/aggregator';
import { parseSTREETSCSV } from '../../functions/src/parser';
import type { DailySummary, PerformanceLoadCapacityConfig, STREETSRecord } from '../../functions/src/types';

export const CORRECTION_VERSION = 'inbetween-passengers-v1';
type Row = Record<string, unknown>;
type Key<T> = (value: T) => string;
const key = (...parts: unknown[]) => JSON.stringify(parts);
const routeKey = (r: { routeId: string }) => key(r.routeId);
const directionKey = (r: { routeId: string; direction: string }) => key(r.routeId, r.direction);
const stopKey = (r: { stopId: string; stopName: string }) => key(r.stopId, r.stopName);
const occurrenceKey = (r: { stopId: string; occurrenceIndex?: number }) => key(r.stopId, r.occurrenceIndex ?? 0);
const tripKey = (r: { tripId?: string }) => {
    if (!r.tripId) throw new Error('Stable heatmap trip identity is missing; a separate legacy repair is required.');
    return key(r.tripId);
};
const observedTripKey = (r: DailySummary['byTrip'][number]) =>
    key(r.tripId, r.routeId, r.direction, r.block, r.terminalDepartureTime);

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    }
    return value;
}

export function hashValue(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function hashSource(csv: string): string {
    return createHash('sha256').update(csv, 'utf8').digest('hex');
}

function select<T>(row: T, fields: readonly string[]): Row {
    const value = row as Row;
    return Object.fromEntries(fields.filter(f => value[f] !== undefined).map(f => [f, value[f]]));
}

function indexed<T>(rows: T[] | undefined, identify: Key<NoInfer<T>>): Map<string, T> {
    if (!Array.isArray(rows)) throw new Error('A full historical daily payload is required, not an overview/report projection.');
    const result = new Map<string, T>();
    for (const row of rows) {
        const id = identify(row);
        if (result.has(id)) throw new Error(`Ambiguous duplicate summary identity: ${id}`);
        result.set(id, row);
    }
    return result;
}

function projectRows<T>(rows: T[] | undefined, identify: Key<NoInfer<T>>, fields: readonly string[]): unknown[] {
    return [...indexed(rows, identify)].sort(([a], [b]) => a.localeCompare(b))
        .map(([id, row]) => [id, select(row, fields)]);
}

const SYSTEM_FIELDS = ['totalRidership', 'totalBoardings', 'totalAlightings'];
const MOVEMENT_FIELDS = ['boardings', 'alightings'];
const STOP_FIELDS = [...MOVEMENT_FIELDS, 'hourlyBoardings', 'hourlyAlightings', 'routes', 'routeCount'];

/** Only passenger values and the identities needed to attribute them. Not an operational replay. */
export function passengerProjection(day: DailySummary): unknown {
    return {
        system: select(day.system, SYSTEM_FIELDS),
        byRoute: projectRows(day.byRoute, routeKey, ['ridership', 'alightings']),
        byHour: projectRows(day.byHour, r => key(r.hour), MOVEMENT_FIELDS),
        byStop: [...indexed(day.byStop, stopKey)].sort(([a], [b]) => a.localeCompare(b)).map(([id, row]) => [
            id, select(row, STOP_FIELDS),
            projectRows(row.routeBreakdown, routeKey, [...MOVEMENT_FIELDS, 'hourlyBoardings', 'hourlyAlightings']),
        ]),
        byTrip: projectRows(day.byTrip, observedTripKey, ['boardings']),
        byRouteHour: projectRows(day.byRouteHour, r => key(r.routeId, r.hour), MOVEMENT_FIELDS),
        loadProfiles: [...indexed(day.loadProfiles, directionKey)].sort(([a], [b]) => a.localeCompare(b)).map(([id, row]) => [
            id, row.tripCount, projectRows(row.stops, occurrenceKey, ['avgBoardings', 'avgAlightings']),
        ]),
        heatmaps: [...indexed(day.ridershipHeatmaps, directionKey)].sort(([a], [b]) => a.localeCompare(b)).map(([id, heatmap]) => {
            indexed(heatmap.trips, tripKey);
            indexed(heatmap.stops, occurrenceKey);
            if (heatmap.cells.length !== heatmap.stops.length
                || heatmap.cells.some(row => row.length !== heatmap.trips.length)) throw new Error('Invalid heatmap dimensions.');
            return [id, heatmap.stops.flatMap((stop, s) => heatmap.trips.map((trip, t) => [
                key(occurrenceKey(stop), tripKey(trip)), heatmap.cells[s][t],
            ])).sort((a, b) => String(a[0]).localeCompare(String(b[0])))];
        }),
    };
}

function mergeRows<T>(old: T[], corrected: T[], identify: Key<NoInfer<T>>, fields: readonly string[],
    allowNew: (row: T) => boolean = () => false): T[] {
    const before = indexed(old, identify);
    const after = indexed(corrected, identify);
    for (const id of before.keys()) if (!after.has(id)) throw new Error(`Correction would remove existing evidence: ${id}`);
    return corrected.map(row => {
        const prior = before.get(identify(row));
        if (!prior) {
            if (!allowNew(row)) throw new Error(`Correction would introduce operational evidence: ${identify(row)}`);
            return structuredClone(row);
        }
        return { ...structuredClone(prior), ...structuredClone(select(row, fields)) } as T;
    });
}

function capacityFor(day: DailySummary): PerformanceLoadCapacityConfig {
    const capacities: Record<string, number> = {};
    for (const heatmap of day.ridershipHeatmaps ?? []) for (const trip of heatmap.trips) {
        if (!trip.vehicleId || trip.capacity === undefined) continue;
        if (capacities[trip.vehicleId] !== undefined && capacities[trip.vehicleId] !== trip.capacity) {
            throw new Error('Historical vehicle capacity is ambiguous.');
        }
        capacities[trip.vehicleId] = trip.capacity;
    }
    const defaultCapacity = day.defaultLoadCapacity;
    if (!defaultCapacity || !Number.isInteger(defaultCapacity) || defaultCapacity < 20 || defaultCapacity > 150
        || Object.values(capacities).some(c => !Number.isInteger(c) || c < 20 || c > 150)) {
        throw new Error('Historical capacity evidence is missing or invalid.');
    }
    return { defaultCapacity, vehicleCapacities: capacities, version: day.loadCapacityConfigVersion ?? 0,
        updatedAt: '', updatedBy: 'local-historical-passenger-preview' };
}

function overlayPassengers(stored: DailySummary, corrected: DailySummary): DailySummary {
    const next = structuredClone(stored);
    Object.assign(next.system, select(corrected.system, SYSTEM_FIELDS));
    next.byRoute = mergeRows(stored.byRoute, corrected.byRoute, routeKey, ['ridership', 'alightings'],
        r => r.tripCount === 0 && r.serviceHours === 0 && r.otp.total === 0 && r.avgLoad === 0 && r.maxLoad === 0 && r.wheelchairTrips === 0);
    next.byHour = mergeRows(stored.byHour, corrected.byHour, r => key(r.hour), MOVEMENT_FIELDS,
        r => r.otp.total === 0 && r.avgLoad === 0);
    next.byRouteHour = mergeRows(stored.byRouteHour!, corrected.byRouteHour!, r => key(r.routeId, r.hour), MOVEMENT_FIELDS,
        r => (r.otp?.total ?? 0) === 0 && r.avgLoad === 0);
    next.byTrip = mergeRows(stored.byTrip, corrected.byTrip, observedTripKey, ['boardings']);
    next.byStop = mergeRows(stored.byStop, corrected.byStop, stopKey, [...STOP_FIELDS, 'routeBreakdown'],
        r => r.otp.total === 0 && r.avgLoad === 0 && !r.isTimepoint);
    const profiles = indexed(corrected.loadProfiles, directionKey);
    next.loadProfiles = mergeRows(stored.loadProfiles, corrected.loadProfiles, directionKey, []);
    for (const profile of next.loadProfiles) {
        const source = profiles.get(directionKey(profile))!;
        if (profile.tripCount !== source.tripCount) throw new Error('Observed load-profile denominator differs from the source.');
        profile.stops = mergeRows(profile.stops, source.stops, occurrenceKey, ['avgBoardings', 'avgAlightings']);
    }
    const oldHeatmaps = indexed(stored.ridershipHeatmaps, directionKey);
    const newHeatmaps = indexed(corrected.ridershipHeatmaps, directionKey);
    for (const id of oldHeatmaps.keys()) if (!newHeatmaps.has(id)) throw new Error('Correction would remove a heatmap.');
    next.ridershipHeatmaps = corrected.ridershipHeatmaps!.map(source => {
        const old = oldHeatmaps.get(directionKey(source));
        if (!old) return structuredClone(source); // Passenger-only route/direction; not observed-trip evidence.
        const trips = mergeRows(old.trips, source.trips, tripKey, [], () => true);
        const stops = mergeRows(old.stops, source.stops, occurrenceKey, [], s => !s.isTimepoint);
        return { ...structuredClone(old), trips, stops, cells: structuredClone(source.cells),
            multipleStopPatterns: source.multipleStopPatterns };
    });
    // Do not relabel legacy operational/identity schemas as a fully rebuilt schema-v15 day.
    // Correction provenance is an external ledger, not a blanket schema upgrade.
    return next;
}

/** Fail if any existing operational evidence was changed, removed or replaced. */
export function assertOperationalPreservation(before: DailySummary, after: DailySummary): void {
    const same = (a: unknown, b: unknown, label: string) => {
        if (hashValue(a) !== hashValue(b)) throw new Error(`Operational evidence changed: ${label}`);
    };
    const strip = <T>(row: T, fields: readonly string[]) => Object.fromEntries(
        Object.entries(row as Row).filter(([field]) => !fields.includes(field)));
    const compareExisting = <T>(a: T[], b: T[], identify: Key<NoInfer<T>>, fields: readonly string[]) => {
        const afterRows = indexed(b, identify);
        for (const [id, row] of indexed(a, identify)) {
            const updated = afterRows.get(id);
            if (!updated) throw new Error(`Existing evidence disappeared: ${id}`);
            same(strip(row, fields), strip(updated, fields), id);
        }
    };
    same(strip(before.system, SYSTEM_FIELDS), strip(after.system, SYSTEM_FIELDS), 'system');
    const topLevel = ['system', 'byRoute', 'byHour', 'byStop', 'byTrip', 'byRouteHour', 'loadProfiles', 'ridershipHeatmaps'];
    same(strip(before, topLevel), strip(after, topLevel), 'daily operational fields');
    compareExisting(before.byRoute, after.byRoute, routeKey, ['ridership', 'alightings']);
    compareExisting(before.byHour, after.byHour, r => key(r.hour), MOVEMENT_FIELDS);
    compareExisting(before.byRouteHour!, after.byRouteHour!, r => key(r.routeId, r.hour), MOVEMENT_FIELDS);
    compareExisting(before.byStop, after.byStop, stopKey, [...STOP_FIELDS, 'routeBreakdown']);
    compareExisting(before.byTrip, after.byTrip, observedTripKey, ['boardings']);
    if (before.byTrip.length !== after.byTrip.length || before.loadProfiles.length !== after.loadProfiles.length) {
        throw new Error('Correction introduced observed-trip or load-profile evidence.');
    }
    const checkNew = <T>(a: T[], b: T[], identify: Key<NoInfer<T>>, neutral: (row: T) => boolean) => {
        const existing = indexed(a, identify);
        for (const row of b) if (!existing.has(identify(row)) && !neutral(row)) {
            throw new Error('New passenger row contains operational evidence.');
        }
    };
    checkNew(before.byRoute, after.byRoute, routeKey,
        r => r.tripCount === 0 && r.serviceHours === 0 && r.otp.total === 0 && r.avgLoad === 0 && r.maxLoad === 0 && r.wheelchairTrips === 0);
    checkNew(before.byHour, after.byHour, r => key(r.hour), r => r.otp.total === 0 && r.avgLoad === 0);
    checkNew(before.byRouteHour!, after.byRouteHour!, r => key(r.routeId, r.hour), r => (r.otp?.total ?? 0) === 0 && r.avgLoad === 0);
    checkNew(before.byStop, after.byStop, stopKey, r => r.otp.total === 0 && r.avgLoad === 0 && !r.isTimepoint);
    compareExisting(before.loadProfiles, after.loadProfiles, directionKey, ['stops']);
    const afterProfiles = indexed(after.loadProfiles, directionKey);
    for (const profile of before.loadProfiles) {
        const updated = afterProfiles.get(directionKey(profile))!;
        if (profile.stops.length !== updated.stops.length) throw new Error('Correction introduced observed load-profile stops.');
        compareExisting(profile.stops, updated.stops, occurrenceKey, ['avgBoardings', 'avgAlightings']);
    }
    compareExisting(before.ridershipHeatmaps!, after.ridershipHeatmaps!, directionKey, ['trips', 'stops', 'cells', 'multipleStopPatterns']);
    const afterMaps = indexed(after.ridershipHeatmaps, directionKey);
    for (const heatmap of before.ridershipHeatmaps!) {
        const updated = afterMaps.get(directionKey(heatmap))!;
        compareExisting(heatmap.trips, updated.trips, tripKey, []);
        compareExisting(heatmap.stops, updated.stops, occurrenceKey, []);
    }
}

export interface CorrectionSource {
    date: string;
    csv: string;
    sha256: string;
    archiveId: string;
    recordCount: number;
}

export interface CorrectionResult {
    date: string;
    status: 'ready' | 'already-corrected' | 'skipped';
    reason?: string;
    sourceHash?: string;
    archiveId?: string;
    hourlyConvention?: 'clock-hour' | 'legacy-service-hour';
    /** Existing missing normal-source evidence, not confirmed zeros or recovered passengers. */
    missingNormalPassengerRows?: number;
    beforeHash: string;
    afterHash: string;
    beforeBoardings: number;
    afterBoardings: number;
    beforeAlightings: number;
    afterAlightings: number;
    routes?: { routeId: string; beforeBoardings: number; afterBoardings: number; beforeAlightings: number; afterAlightings: number }[];
    corrected: DailySummary;
}

function validateMovements(records: STREETSRecord[]): void {
    for (const record of records) {
        if (![record.boardings, record.alightings].every(n => Number.isSafeInteger(n) && n >= 0)) {
            throw new Error('Invalid, negative or fractional passenger movements require source review.');
        }
    }
}

/** The import parser tolerates bad numeric fields; a historical correction must fail closed instead. */
function validateSourceCSV(csv: string): number {
    const parseLine = (line: string): string[] => {
        const fields: string[] = [];
        let value = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (quoted && line[i + 1] === '"') { value += '"'; i++; }
                else quoted = !quoted;
            } else if (c === ',' && !quoted) { fields.push(value); value = ''; }
            else value += c;
        }
        if (quoted) throw new Error('Malformed or multiline CSV requires source review.');
        return [...fields, value];
    };
    const lines = csv.split(/\r?\n/).filter(line => line.trim());
    const headers = parseLine(lines[0] ?? '').map(h => h.trim());
    if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV columns require source review.');
    const indexes = ['Boardings', 'Alightings'].map(name => headers.indexOf(name));
    if (indexes.some(i => i < 0)) throw new Error('Passenger columns are missing.');
    const inBetweenIndex = headers.indexOf('InBetween');
    if (inBetweenIndex < 0) throw new Error('InBetween source flag is missing.');
    const trueFlags = new Set(['1', 'true', 'yes', 'y', 't']);
    const falseFlags = new Set(['0', 'false', 'no', 'n', 'f']);
    let missingNormalRows = 0;
    const identities = ['TripID', 'RouteID', 'StopID', 'VehicleID'].map(name => headers.indexOf(name));
    for (const line of lines.slice(1)) {
        const fields = parseLine(line);
        if (fields.length !== headers.length) throw new Error('Malformed CSV column count requires source review.');
        if (identities.some(i => i < 0 || !fields[i]?.trim())) throw new Error('Source passenger attribution identity is missing.');
        const flag = fields[inBetweenIndex].trim().toLowerCase();
        if (!trueFlags.has(flag) && !falseFlags.has(flag)) throw new Error('Missing or unknown InBetween flag requires source review.');
        // Source exports can contain normal stop observations with no APC movement fields.
        // Keep their existing missing-data treatment only after full baseline reconciliation.
        // Never recover/assume passenger movements from blank intermediate or partially missing fields.
        if (falseFlags.has(flag) && indexes.every(i => !fields[i].trim())) { missingNormalRows++; continue; }
        if (indexes.some(i => !fields[i].trim() || !Number.isSafeInteger(Number(fields[i].trim())) || Number(fields[i].trim()) < 0)) {
            throw new Error('Invalid source passenger number requires review.');
        }
    }
    return missingNormalRows;
}

function assertPassengerTotals(day: DailySummary): void {
    const boardings = day.system.totalBoardings;
    const alightings = day.system.totalAlightings;
    const totals = [
        [day.system.totalRidership, alightings],
        [day.byRoute.reduce((s, r) => s + r.ridership, 0), day.byRoute.reduce((s, r) => s + r.alightings, 0)],
        [day.byStop.reduce((s, r) => s + r.boardings, 0), day.byStop.reduce((s, r) => s + r.alightings, 0)],
        [day.byHour.reduce((s, r) => s + r.boardings, 0), day.byHour.reduce((s, r) => s + r.alightings, 0)],
        [day.byRouteHour!.reduce((s, r) => s + r.boardings, 0), day.byRouteHour!.reduce((s, r) => s + (r.alightings ?? 0), 0)],
        (day.ridershipHeatmaps ?? []).flatMap(h => h.cells.flat()).reduce<[number, number]>((s, c) => [s[0] + (c?.[0] ?? 0), s[1] + (c?.[1] ?? 0)], [0, 0]),
    ];
    if (totals.some(([b, a]) => b !== boardings || a !== alightings)) {
        throw new Error('Source passenger totals do not reconcile across routes, stops, hours and heatmaps.');
    }
}

/** Older persisted exports used service hour 24+, and omitted those values from 24-slot stop arrays.
 * Adapt passenger buckets only. Do not recalculate or move historical OTP/load evidence. */
function legacyPassengerHours(replay: DailySummary, stored: DailySummary, records: STREETSRecord[]): DailySummary {
    const day = structuredClone(replay);
    const hours = new Map<number, [number, number]>();
    const routeHours = new Map<string, { routeId: string; hour: number; boardings: number; alightings: number }>();
    const stopHours = new Map<string, { boardings: number[]; alightings: number[] }>();
    const stopRouteHours = new Map<string, { boardings: number[]; alightings: number[] }>();
    const add = (map: Map<string, { boardings: number[]; alightings: number[] }>, id: string, hour: number, r: STREETSRecord) => {
        const value = map.get(id) ?? { boardings: Array(24).fill(0), alightings: Array(24).fill(0) };
        value.boardings[hour] += r.boardings;
        value.alightings[hour] += r.alightings;
        map.set(id, value);
    };
    for (const r of records.filter(r => !r.inBetween || r.boardings !== 0 || r.alightings !== 0)) {
        // Exact supported legacy source representation; never guess decimal or malformed historical times.
        const match = r.arrivalTime.match(/^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/);
        if (!match) throw new Error('Legacy hourly attribution requires a reviewed source-time mapping.');
        const hour = Number(match[1]);
        const count = hours.get(hour) ?? [0, 0];
        hours.set(hour, [count[0] + r.boardings, count[1] + r.alightings]);
        const routeHour = routeHours.get(key(r.routeId, hour)) ?? { routeId: r.routeId, hour, boardings: 0, alightings: 0 };
        routeHour.boardings += r.boardings;
        routeHour.alightings += r.alightings;
        routeHours.set(key(r.routeId, hour), routeHour);
        if (hour < 24) {
            add(stopHours, stopKey(r), hour, r);
            add(stopRouteHours, key(stopKey(r), r.routeId), hour, r);
        }
    }
    const emptyOTP = { total: 0, onTime: 0, early: 0, late: 0, onTimePercent: 0, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 };
    const oldHours = indexed(stored.byHour, r => key(r.hour));
    const oldRouteHours = indexed(stored.byRouteHour, r => key(r.routeId, r.hour));
    day.byHour = [...hours].sort(([a], [b]) => a - b).map(([hour, [boardings, alightings]]) => ({
        ...(oldHours.get(key(hour)) ?? { hour, otp: emptyOTP, avgLoad: 0 }), boardings, alightings,
    }));
    day.byRouteHour = [...routeHours.values()].map(value => ({
        ...(oldRouteHours.get(key(value.routeId, value.hour)) ?? { otp: emptyOTP, avgLoad: 0 }), ...value,
    }));
    for (const stop of day.byStop) {
        const value = stopHours.get(stopKey(stop)) ?? { boardings: Array(24).fill(0), alightings: Array(24).fill(0) };
        stop.hourlyBoardings = value.boardings;
        stop.hourlyAlightings = value.alightings;
        for (const route of stop.routeBreakdown ?? []) {
            const routeValue = stopRouteHours.get(key(stopKey(stop), route.routeId)) ?? { boardings: Array(24).fill(0), alightings: Array(24).fill(0) };
            route.hourlyBoardings = routeValue.boardings;
            route.hourlyAlightings = routeValue.alightings;
        }
    }
    return day;
}

export function prepareCorrection(stored: DailySummary, source?: CorrectionSource): CorrectionResult {
    const initial: CorrectionResult = { date: stored.date, status: 'skipped', beforeHash: hashValue(stored),
        afterHash: hashValue(stored), beforeBoardings: stored.system.totalBoardings, afterBoardings: stored.system.totalBoardings,
        beforeAlightings: stored.system.totalAlightings, afterAlightings: stored.system.totalAlightings,
        corrected: structuredClone(stored) };
    try {
        if (!source) throw new Error('Original export unavailable; existing history preserved.');
        if (source.date !== stored.date || !source.archiveId || hashSource(source.csv) !== source.sha256) {
            throw new Error('Source date, provenance or checksum does not match the manifest.');
        }
        initial.sourceHash = source.sha256;
        initial.archiveId = source.archiveId;
        if (stored.schemaVersion < 14) throw new Error('Legacy heatmap identity requires a separate reviewed repair; no partial correction.');
        initial.missingNormalPassengerRows = validateSourceCSV(source.csv);
        const { records, warnings } = parseSTREETSCSV(source.csv);
        if (warnings.length || records.length === 0) throw new Error(`Source parsing requires review: ${warnings.join('; ') || 'no rows'}`);
        if (records.some(r => r.date !== stored.date)) throw new Error('Export contains a different service date.');
        if (records.length !== source.recordCount || records.length !== stored.dataQuality.totalRecords) {
            throw new Error('Source record count does not match stored history.');
        }
        validateMovements(records);
        const config = capacityFor(stored);
        const normalOnly = records.map(r => ({ ...r, ...(r.inBetween ? { boardings: 0, alightings: 0 } : {}) }));
        let baseline = aggregateDailySummaries(structuredClone(normalOnly), config)[0];
        let corrected = aggregateDailySummaries(structuredClone(records), config)[0];
        if (stored.system.tripCount !== baseline.system.tripCount || stored.system.vehicleCount !== baseline.system.vehicleCount) {
            throw new Error('Source observed-trip/vehicle evidence differs from stored history.');
        }
        const currentProjection = hashValue(passengerProjection(stored));
        initial.hourlyConvention = 'clock-hour';
        if (currentProjection !== hashValue(passengerProjection(baseline))
            && currentProjection !== hashValue(passengerProjection(corrected))) {
            const legacyBase = legacyPassengerHours(baseline, stored, normalOnly);
            const legacyCorrected = legacyPassengerHours(corrected, stored, records);
            if ([hashValue(passengerProjection(legacyBase)), hashValue(passengerProjection(legacyCorrected))].includes(currentProjection)) {
                baseline = legacyBase;
                corrected = legacyCorrected;
                initial.hourlyConvention = 'legacy-service-hour';
            }
        }
        assertPassengerTotals(corrected);
        if (currentProjection === hashValue(passengerProjection(corrected))) {
            return { ...initial, status: 'already-corrected' };
        }
        if (currentProjection !== hashValue(passengerProjection(baseline))) {
            throw new Error('Stored passenger counts or attribution do not match this original export; no changes staged.');
        }
        const next = overlayPassengers(stored, corrected);
        assertOperationalPreservation(stored, next);
        if (hashValue(passengerProjection(next)) !== hashValue(passengerProjection(corrected))) {
            throw new Error('Corrected passenger views do not reconcile.');
        }
        const oldRoutes = indexed(stored.byRoute, routeKey);
        return { ...initial, status: 'ready', corrected: next, afterHash: hashValue(next),
            afterBoardings: next.system.totalBoardings, afterAlightings: next.system.totalAlightings,
            routes: next.byRoute.map(r => ({ routeId: r.routeId,
                beforeBoardings: oldRoutes.get(routeKey(r))?.ridership ?? 0, afterBoardings: r.ridership,
                beforeAlightings: oldRoutes.get(routeKey(r))?.alightings ?? 0, afterAlightings: r.alightings })) };
    } catch (error) {
        return { ...initial, reason: error instanceof Error ? error.message : String(error) };
    }
}

/** Exact-date replacement, with a preview fingerprint. Never date-window deletion or retention. */
export function replacePreparedDays(current: DailySummary[], results: CorrectionResult[]): DailySummary[] {
    const days = indexed(current, r => r.date);
    const corrections = indexed(results, r => r.date);
    for (const result of corrections.values()) {
        const day = days.get(result.date);
        if (!day) throw new Error(`Prepared date no longer exists: ${result.date}`);
        const actual = hashValue(day);
        if (actual === result.afterHash) continue;
        if (actual !== result.beforeHash) throw new Error(`History changed after preview: ${result.date}; re-preview required.`);
        if (result.status === 'ready') {
            if (hashValue(result.corrected) !== result.afterHash) throw new Error('Prepared replacement checksum failed.');
            assertOperationalPreservation(day, result.corrected);
            days.set(result.date, structuredClone(result.corrected));
        }
    }
    // Unchanged days retain their references; cloning an entire archive per batch would exhaust memory.
    // Prepared replacements are cloned above, and this function never mutates current input days.
    return current.map(day => days.get(day.date)!);
}

/** Rollback refuses to overwrite any later import/correction. */
export function rollbackPreparedDays(current: DailySummary[], originals: DailySummary[], results: CorrectionResult[]): DailySummary[] {
    const before = indexed(originals, r => r.date);
    const updates: CorrectionResult[] = results.filter(r => r.status === 'ready').map(result => {
        const original = before.get(result.date);
        if (!original || hashValue(original) !== result.beforeHash) throw new Error('Original backup checksum failed.');
        return { ...result, beforeHash: result.afterHash, afterHash: result.beforeHash, corrected: original };
    });
    // Preservation check is symmetric except for passenger-only additions; use exact verified originals.
    const updateMap = indexed(updates, r => r.date);
    const currentMap = indexed(current, r => r.date);
    for (const result of updates) {
        const day = currentMap.get(result.date);
        if (!day || ![result.beforeHash, result.afterHash].includes(hashValue(day))) {
            throw new Error(`History changed after correction: ${result.date}; rollback refused.`);
        }
    }
    return current.map(day => updateMap.has(day.date) ? structuredClone(updateMap.get(day.date)!.corrected) : day);
}
