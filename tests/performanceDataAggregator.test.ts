import { describe, it, expect } from 'vitest';
import { aggregateDailySummaries } from '../utils/performanceDataAggregator';
import { classifyOTP, parseDayType, DEFAULT_LOAD_CAP } from '../utils/performanceDataTypes';
import type { STREETSRecord } from '../utils/performanceDataTypes';
import { buildRidershipStopProfiles } from '../utils/performanceRidershipStopProfile';

// ─── Helper: make a minimal valid STREETS record ────────────────────
function makeRecord(overrides: Partial<STREETSRecord> = {}): STREETSRecord {
    return {
        vehicleLocationTPKey: 1,
        vehicleId: '2302',
        inBetween: false,
        isTripper: false,
        date: '2026-01-07',
        month: '2026-01',
        day: 'DAY_OF_WEEK',
        arrivalTime: '12:00',
        observedArrivalTime: '12:01:30',
        stopTime: '12:00',
        observedDepartureTime: '12:02:00',
        wheelchairUsageCount: 0,
        departureLoad: 10,
        boardings: 3,
        alightings: 1,
        apcSource: 1,
        block: '10-17',
        operatorId: '4486',
        tripName: '10 - 10FD - 12:00',
        stopName: 'Downtown Hub',
        routeName: 'NORTH LOOP',
        branch: '10 FULL',
        routeId: '10',
        routeStopIndex: 0,
        stopId: '2',
        direction: 'CW',
        isDetour: false,
        stopLat: 44.387753,
        stopLon: -79.690237,
        timePoint: true,
        distance: 0,
        previousStopName: null,
        tripId: 'trip-001',
        internalTripId: 547105,
        terminalDepartureTime: '12:00',
        ...overrides,
    };
}

// ─── classifyOTP unit tests ─────────────────────────────────────────

describe('classifyOTP', () => {
    it('classifies on-time within window', () => {
        expect(classifyOTP(0)).toBe('on-time');
        expect(classifyOTP(90)).toBe('on-time');       // +1.5 min
        expect(classifyOTP(-90)).toBe('on-time');      // -1.5 min
        expect(classifyOTP(300)).toBe('on-time');      // exactly +5 min (boundary)
        expect(classifyOTP(-180)).toBe('on-time');     // exactly -3 min (boundary)
    });

    it('classifies early', () => {
        expect(classifyOTP(-181)).toBe('early');       // 3 min 1 sec early
        expect(classifyOTP(-300)).toBe('early');       // 5 min early
    });

    it('classifies late', () => {
        expect(classifyOTP(301)).toBe('late');         // 5 min 1 sec late
        expect(classifyOTP(600)).toBe('late');         // 10 min late
    });
});

// ─── parseDayType unit tests ────────────────────────────────────────

describe('parseDayType', () => {
    it('parses day types correctly', () => {
        expect(parseDayType('DAY_OF_WEEK')).toBe('weekday');
        expect(parseDayType('SATURDAY')).toBe('saturday');
        expect(parseDayType('SUNDAY')).toBe('sunday');
    });

    it('defaults unknown to weekday', () => {
        expect(parseDayType('HOLIDAY')).toBe('weekday');
    });
});

// ─── aggregateDailySummaries integration tests ──────────────────────

describe('aggregateDailySummaries', () => {
    it('produces one summary per date', () => {
        const records = [
            makeRecord({ date: '2026-01-07' }),
            makeRecord({ date: '2026-01-07' }),
            makeRecord({ date: '2026-01-08' }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries).toHaveLength(2);
        expect(summaries[0].date).toBe('2026-01-07');
        expect(summaries[1].date).toBe('2026-01-08');
    });

    it('correctly assigns day type', () => {
        const records = [
            makeRecord({ date: '2026-01-07', day: 'DAY_OF_WEEK' }),
            makeRecord({ date: '2026-01-11', day: 'SATURDAY' }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].dayType).toBe('weekday');
        expect(summaries[1].dayType).toBe('saturday');
    });

    it('filters inBetween records from OTP calculation', () => {
        // Need routeStopIndex < max per trip so records aren't excluded as "last timepoint"
        const records = [
            makeRecord({ timePoint: true, inBetween: false, routeStopIndex: 0, stopId: 'stop-a', observedDepartureTime: '12:01:00' }),
            makeRecord({ timePoint: true, inBetween: true, routeStopIndex: 1, stopId: 'stop-b', observedDepartureTime: '12:10:00' }),  // late but inBetween
            makeRecord({ timePoint: true, inBetween: false, routeStopIndex: 2, stopId: 'stop-c', observedDepartureTime: '12:02:00' }),
            makeRecord({ timePoint: true, routeStopIndex: 3, stopId: 'last' }),  // last timepoint (excluded)
        ];
        const summaries = aggregateDailySummaries(records);
        // Records at idx 0 and 2 are eligible (on-time: +60s and +120s). idx 1 excluded (inBetween), idx 3 excluded (last TP)
        expect(summaries[0].system.otp.total).toBe(2);
        expect(summaries[0].system.otp.onTime).toBe(2);
        expect(summaries[0].system.otp.onTimePercent).toBe(100);
    });

    it('excludes null ObservedDepartureTime from OTP', () => {
        const records = [
            makeRecord({ timePoint: true, routeStopIndex: 0, observedDepartureTime: '12:01:00' }),
            makeRecord({ timePoint: true, routeStopIndex: 1, stopId: 'stop-b', observedDepartureTime: null }),  // missing departure
            makeRecord({ timePoint: true, routeStopIndex: 2, stopId: 'last' }),  // last timepoint (excluded)
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.total).toBe(1);
    });

    it('only counts timepoint stops for OTP', () => {
        const records = [
            makeRecord({ timePoint: true, routeStopIndex: 0, observedDepartureTime: '12:01:00' }),
            makeRecord({ timePoint: false, routeStopIndex: 1, stopId: 'stop-b', observedDepartureTime: '12:10:00' }),  // late but not a timepoint
            makeRecord({ timePoint: true, routeStopIndex: 2, stopId: 'last' }),  // last timepoint (excluded)
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.total).toBe(1);
        expect(summaries[0].system.otp.onTime).toBe(1);
    });

    it('calculates OTP deviation correctly', () => {
        // Scheduled stopTime 12:00, departed 12:06:00 = +360s = LATE
        const records = [
            makeRecord({ stopTime: '12:00', observedDepartureTime: '12:06:00', timePoint: true, routeStopIndex: 0 }),
            makeRecord({ timePoint: true, routeStopIndex: 1, stopId: 'last' }),  // last timepoint (excluded)
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.late).toBe(1);
        expect(summaries[0].system.otp.avgDeviationSeconds).toBe(360);
    });

    it('classifies early departures correctly', () => {
        // Scheduled stopTime 12:00, departed 11:55:00 = -300s = EARLY (> 3 min early)
        const records = [
            makeRecord({ stopTime: '12:00', observedDepartureTime: '11:55:00', timePoint: true, routeStopIndex: 0 }),
            makeRecord({ timePoint: true, routeStopIndex: 1, stopId: 'last' }),  // last timepoint (excluded)
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.early).toBe(1);
    });

    it('normalizes OTP deviations across midnight', () => {
        const records = [
            makeRecord({
                tripId: 'overnight-otp',
                routeStopIndex: 0,
                stopId: 'before-midnight',
                arrivalTime: '23:58',
                stopTime: '23:58',
                observedDepartureTime: '00:02:00',
            }),
            makeRecord({
                tripId: 'overnight-otp',
                routeStopIndex: 1,
                stopId: 'terminal',
                arrivalTime: '00:10',
                stopTime: '00:10',
                observedDepartureTime: '00:11:00',
            }),
        ];

        const summary = aggregateDailySummaries(records)[0];
        expect(summary.system.otp).toMatchObject({ total: 1, onTime: 1, early: 0, late: 0 });
        expect(summary.system.otp.avgDeviationSeconds).toBe(240);
    });

    it('uses full-trip terminal context for stop and hourly OTP rollups', () => {
        const records = [
            makeRecord({
                tripId: 'cross-hour-trip', routeStopIndex: 0, stopId: 'stop-0', stopName: 'Stop 0',
                arrivalTime: '07:10', stopTime: '07:10', observedDepartureTime: '07:11:00',
            }),
            makeRecord({
                tripId: 'cross-hour-trip', routeStopIndex: 1, stopId: 'stop-1', stopName: 'Stop 1',
                arrivalTime: '07:55', stopTime: '07:55', observedDepartureTime: '07:57:00',
            }),
            makeRecord({
                tripId: 'cross-hour-trip', routeStopIndex: 2, stopId: 'terminal', stopName: 'Terminal',
                arrivalTime: '08:05', stopTime: '08:05', observedDepartureTime: '08:06:00',
            }),
        ];

        const summary = aggregateDailySummaries(records)[0];
        expect(summary.byStop.find(stop => stop.stopId === 'stop-0')?.otp.total).toBe(1);
        expect(summary.byStop.find(stop => stop.stopId === 'stop-1')?.otp.total).toBe(1);
        expect(summary.byStop.find(stop => stop.stopId === 'terminal')?.otp.total).toBe(0);
        expect(summary.byHour.find(hour => hour.hour === 7)?.otp.total).toBe(2);
        expect(summary.byHour.find(hour => hour.hour === 8)?.otp.total).toBe(0);
        expect(summary.byRouteHour?.find(hour => hour.routeId === '10' && hour.hour === 7)?.otp?.total).toBe(2);
    });

    it('excludes tripper records from OTP', () => {
        const records = [
            makeRecord({ timePoint: true, routeStopIndex: 0, isTripper: false, observedDepartureTime: '12:01:00' }),
            makeRecord({ timePoint: true, routeStopIndex: 1, stopId: 'stop-b', isTripper: true, observedDepartureTime: '12:10:00' }),  // late but tripper
            makeRecord({ timePoint: true, routeStopIndex: 2, stopId: 'last' }),  // last timepoint (excluded)
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.total).toBe(1);
        expect(summaries[0].system.otp.onTime).toBe(1);
    });

    it('counts ridership from boardings', () => {
        const records = [
            makeRecord({ boardings: 5, alightings: 2 }),
            makeRecord({ boardings: 3, alightings: 4 }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.totalRidership).toBe(8);
        expect(summaries[0].system.totalBoardings).toBe(8);
        expect(summaries[0].system.totalAlightings).toBe(6);
    });

    it('excludes in-between records from operational metrics but retains raw quality counts', () => {
        const records = [
            makeRecord({
                tripId: 'normal-trip', stopId: 'normal-stop', routeStopIndex: 0,
                boardings: 5, alightings: 2, departureLoad: 8,
            }),
            makeRecord({
                tripId: 'in-between-trip', stopId: 'in-between-stop', routeStopIndex: 0,
                inBetween: true, boardings: 50, alightings: 20, departureLoad: 60,
            }),
        ];

        const summary = aggregateDailySummaries(records)[0];
        expect(summary.system.totalRidership).toBe(5);
        expect(summary.system.totalAlightings).toBe(2);
        expect(summary.system.avgSystemLoad).toBe(8);
        expect(summary.system.tripCount).toBe(1);
        expect(summary.byStop.map(stop => stop.stopId)).toEqual(['normal-stop']);
        expect(summary.dataQuality.totalRecords).toBe(2);
        expect(summary.dataQuality.inBetweenFiltered).toBe(1);
    });

    it('counts unique vehicles and trips', () => {
        const records = [
            makeRecord({ vehicleId: 'V1', tripId: 'T1' }),
            makeRecord({ vehicleId: 'V1', tripId: 'T1' }),  // same vehicle, same trip
            makeRecord({ vehicleId: 'V2', tripId: 'T2' }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.vehicleCount).toBe(2);
        expect(summaries[0].system.tripCount).toBe(2);
    });

    it('aggregates by route', () => {
        const records = [
            makeRecord({ routeId: '10', routeName: 'NORTH LOOP', boardings: 5 }),
            makeRecord({ routeId: '10', routeName: 'NORTH LOOP', boardings: 3 }),
            makeRecord({ routeId: '12A', routeName: 'GEORGIAN MALL', boardings: 7 }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].byRoute).toHaveLength(2);
        const route10 = summaries[0].byRoute.find(r => r.routeId === '10');
        const route12A = summaries[0].byRoute.find(r => r.routeId === '12A');
        expect(route10?.ridership).toBe(8);
        expect(route12A?.ridership).toBe(7);
    });

    it('flags route APC discrepancy for review at 25% gap', () => {
        const records = [
            makeRecord({ routeId: '10', tripId: 'T1', routeStopIndex: 0, stopId: 'A', boardings: 100, alightings: 75 }),
            makeRecord({ routeId: '10', tripId: 'T1', routeStopIndex: 1, stopId: 'B', boardings: 0, alightings: 0 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const route10 = summaries[0].byRoute.find(r => r.routeId === '10');
        expect(route10?.apcDiscrepancyPct).toBe(25);
        expect(route10?.apcStatus).toBe('review');
    });

    it('flags route APC discrepancy as suspect at 50% gap', () => {
        const records = [
            makeRecord({ routeId: '10', tripId: 'T1', routeStopIndex: 0, stopId: 'A', boardings: 100, alightings: 50 }),
            makeRecord({ routeId: '10', tripId: 'T1', routeStopIndex: 1, stopId: 'B', boardings: 0, alightings: 0 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const route10 = summaries[0].byRoute.find(r => r.routeId === '10');
        expect(route10?.apcDiscrepancyPct).toBe(50);
        expect(route10?.apcStatus).toBe('suspect');
    });

    it('calculates route service hours correctly across midnight', () => {
        const records = [
            makeRecord({ tripId: 'overnight-trip', routeId: '10', routeStopIndex: 0, arrivalTime: '23:45', stopId: 'A' }),
            makeRecord({ tripId: 'overnight-trip', routeId: '10', routeStopIndex: 1, arrivalTime: '23:55', stopId: 'B' }),
            makeRecord({ tripId: 'overnight-trip', routeId: '10', routeStopIndex: 2, arrivalTime: '00:10', stopId: 'C' }),
        ];
        const summaries = aggregateDailySummaries(records);
        const route10 = summaries[0].byRoute.find(r => r.routeId === '10');
        expect(route10?.serviceHours).toBeCloseTo(25 / 60, 3);
    });

    it('sorts decimal terminal departures with next-day values correctly', () => {
        const records = [
            makeRecord({ tripId: 'trip-A', routeId: '10', routeStopIndex: 0, terminalDepartureTime: '0.99', stopId: 'A' }),
            makeRecord({ tripId: 'trip-B', routeId: '10', routeStopIndex: 0, terminalDepartureTime: '1.01', stopId: 'B' }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].byTrip.map(t => t.tripId)).toEqual(['trip-A', 'trip-B']);
    });

    it('aggregates by hour', () => {
        const records = [
            makeRecord({ arrivalTime: '07:30', boardings: 5 }),
            makeRecord({ arrivalTime: '07:45', boardings: 3 }),
            makeRecord({ arrivalTime: '12:00', boardings: 2 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const hour7 = summaries[0].byHour.find(h => h.hour === 7);
        const hour12 = summaries[0].byHour.find(h => h.hour === 12);
        expect(hour7?.boardings).toBe(8);
        expect(hour12?.boardings).toBe(2);
    });

    it('builds load profiles by route+direction', () => {
        const records = [
            makeRecord({ routeId: '10', direction: 'CW', routeStopIndex: 0, stopId: 'A', stopName: 'Stop A', tripId: 'T1', departureLoad: 5, boardings: 5, alightings: 0 }),
            makeRecord({ routeId: '10', direction: 'CW', routeStopIndex: 1, stopId: 'B', stopName: 'Stop B', tripId: 'T1', departureLoad: 8, boardings: 3, alightings: 0 }),
            makeRecord({ routeId: '10', direction: 'CW', routeStopIndex: 2, stopId: 'C', stopName: 'Stop C', tripId: 'T1', departureLoad: 4, boardings: 0, alightings: 4 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const profile = summaries[0].loadProfiles.find(p => p.routeId === '10' && p.direction === 'CW');
        expect(profile).toBeDefined();
        expect(profile!.stops).toHaveLength(3);
        expect(profile!.stops[0].stopName).toBe('Stop A');
        expect(profile!.stops[0].avgLoad).toBe(5);
        expect(profile!.stops[0].loadObservationCount).toBe(1);
        expect(profile!.stops[1].avgLoad).toBe(8);
        expect(profile!.stops[2].avgLoad).toBe(4);
    });

    it('counts reliable load observations once per trip and excludes missing APC data', () => {
        const records = [
            makeRecord({ tripId: 'T1', routeStopIndex: 0, stopId: 'A', departureLoad: 15, apcSource: 1 }),
            makeRecord({ tripId: 'T1', routeStopIndex: 0, stopId: 'A', departureLoad: 20, apcSource: 1 }),
            makeRecord({ tripId: 'T2', routeStopIndex: 0, stopId: 'A', departureLoad: 99, apcSource: 0 }),
            makeRecord({ tripId: 'T3', routeStopIndex: 0, stopId: 'A', departureLoad: 0, apcSource: 1 }),
        ];

        const stop = aggregateDailySummaries(records)[0].loadProfiles[0].stops[0];

        expect(stop.loadObservationCount).toBe(2);
        expect(stop.avgLoad).toBe(10);
        expect(stop.maxLoad).toBe(20);
    });

    it('preserves repeated loop visits and aligns them across shifted stop indexes', () => {
        const records = [
            makeRecord({ tripId: 'T1', terminalDepartureTime: '08:00', stopId: 'A', stopName: 'Stop A', routeStopIndex: 0, boardings: 2, alightings: 0, departureLoad: 5 }),
            makeRecord({ tripId: 'T1', terminalDepartureTime: '08:00', stopId: 'B', stopName: 'Stop B', routeStopIndex: 1, boardings: 1, alightings: 1, departureLoad: 7 }),
            makeRecord({ tripId: 'T1', terminalDepartureTime: '08:00', stopId: 'A', stopName: 'Stop A', routeStopIndex: 2, boardings: 0, alightings: 3, departureLoad: 4 }),
            // Same displayed departure time as T1 verifies pattern detection remains keyed by trip ID.
            makeRecord({ tripId: 'T2', terminalDepartureTime: '08:00', stopId: 'X', stopName: 'Stop X', routeStopIndex: 0, boardings: 1, alightings: 0, departureLoad: 1 }),
            makeRecord({ tripId: 'T2', terminalDepartureTime: '08:00', stopId: 'A', stopName: 'Stop A', routeStopIndex: 1, boardings: 4, alightings: 0, departureLoad: 8 }),
            makeRecord({ tripId: 'T2', terminalDepartureTime: '08:00', stopId: 'B', stopName: 'Stop B', routeStopIndex: 2, boardings: 1, alightings: 1, departureLoad: 9 }),
            makeRecord({ tripId: 'T2', terminalDepartureTime: '08:00', stopId: 'A', stopName: 'Stop A', routeStopIndex: 3, boardings: 0, alightings: 5, departureLoad: 2 }),
        ];

        const summary = aggregateDailySummaries(records)[0];
        const heatmap = summary.ridershipHeatmaps![0];
        const profile = summary.loadProfiles[0];

        expect(heatmap.multipleStopPatterns).toBe(true);
        expect(heatmap.stops.filter(stop => stop.stopId === 'A')).toEqual([
            expect.objectContaining({ occurrenceIndex: 0, routeStopIndex: 1 }),
            expect.objectContaining({ occurrenceIndex: 1, routeStopIndex: 3 }),
        ]);
        expect(profile.stops.filter(stop => stop.stopId === 'A')).toEqual([
            expect.objectContaining({ occurrenceIndex: 0, loadObservationCount: 2, avgLoad: 6.5 }),
            expect.objectContaining({ occurrenceIndex: 1, loadObservationCount: 2, avgLoad: 3 }),
        ]);
        const chartProfile = buildRidershipStopProfiles([summary]).options[0];
        expect(chartProfile.multipleStopPatterns).toBe(true);
        expect(chartProfile.rows.filter(stop => stop.stopId === 'A')).toEqual([
            expect.objectContaining({ occurrenceIndex: 0, boardings: 6, alightings: 0, averageLoad: 6.5 }),
            expect.objectContaining({ occurrenceIndex: 1, boardings: 0, alightings: 8, averageLoad: 3 }),
        ]);
    });

    it('tracks data quality metrics', () => {
        const records = [
            makeRecord({ inBetween: false, observedArrivalTime: '12:01:00', apcSource: 1, isDetour: false, isTripper: false }),
            makeRecord({ inBetween: true, observedArrivalTime: '12:01:00', apcSource: 1, isDetour: false, isTripper: false }),
            makeRecord({ inBetween: false, observedArrivalTime: null, apcSource: 0, isDetour: true, isTripper: true }),
        ];
        const summaries = aggregateDailySummaries(records);
        const dq = summaries[0].dataQuality;
        expect(dq.totalRecords).toBe(3);
        expect(dq.inBetweenFiltered).toBe(1);
        expect(dq.missingAVL).toBe(1);
        expect(dq.missingAPC).toBe(1);
        expect(dq.detourRecords).toBe(1);
        expect(dq.tripperRecords).toBe(1);
    });

    it('handles empty input', () => {
        const summaries = aggregateDailySummaries([]);
        expect(summaries).toHaveLength(0);
    });

    it('builds exact stop-to-stop runtime entries with stop ids', () => {
        const records = [
            makeRecord({
                tripId: 'seg-trip',
                routeId: '8A',
                direction: 'S',
                routeStopIndex: 0,
                stopId: 'stop-a',
                stopName: 'Stop A',
                stopTime: '07:00',
                observedDepartureTime: '07:01:00',
            }),
            makeRecord({
                tripId: 'seg-trip',
                routeId: '8A',
                direction: 'S',
                routeStopIndex: 1,
                stopId: 'stop-b',
                stopName: 'Stop B',
                arrivalTime: '07:05',
                observedArrivalTime: '07:06:00',
                stopTime: '07:05',
                observedDepartureTime: '07:06:30',
                timePoint: false,
            }),
            makeRecord({
                tripId: 'seg-trip',
                routeId: '8A',
                direction: 'S',
                routeStopIndex: 2,
                stopId: 'stop-c',
                stopName: 'Stop C',
                arrivalTime: '07:10',
                observedArrivalTime: '07:11:00',
                stopTime: '07:10',
            }),
        ];

        const summaries = aggregateDailySummaries(records);
        const entry = summaries[0].stopSegmentRuntimes?.entries.find(value =>
            value.routeId === '8A'
            && value.direction === 'S'
            && value.fromStopId === 'stop-a'
            && value.toStopId === 'stop-b'
        );

        expect(entry).toBeDefined();
        expect(entry?.segmentName).toBe('Stop A to Stop B');
        expect(entry?.fromRouteStopIndex).toBe(0);
        expect(entry?.toRouteStopIndex).toBe(1);
        expect(entry?.observations[0]).toEqual({
            runtimeMinutes: 5.5,
            timeBucket: '07:00',
        });
    });

    it('handles stop-to-stop runtime midnight rollover', () => {
        const records = [
            makeRecord({
                tripId: 'overnight-seg',
                routeId: '10',
                direction: 'N',
                routeStopIndex: 0,
                stopId: 'stop-a',
                stopName: 'Stop A',
                stopTime: '23:55',
                observedDepartureTime: '23:58:00',
            }),
            makeRecord({
                tripId: 'overnight-seg',
                routeId: '10',
                direction: 'N',
                routeStopIndex: 1,
                stopId: 'stop-b',
                stopName: 'Stop B',
                arrivalTime: '00:05',
                observedArrivalTime: '00:08:00',
                stopTime: '00:05',
                timePoint: false,
            }),
        ];

        const summaries = aggregateDailySummaries(records);
        const entry = summaries[0].stopSegmentRuntimes?.entries[0];

        expect(entry?.fromStopId).toBe('stop-a');
        expect(entry?.toStopId).toBe('stop-b');
        expect(entry?.observations[0].runtimeMinutes).toBe(10);
    });

    it('preserves trip-linked stop segments for exact corridor traversal matching', () => {
        const records = [
            makeRecord({
                tripId: 'trip-linked',
                tripName: '8A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '8A',
                direction: 'S',
                routeStopIndex: 0,
                stopId: 'stop-a',
                stopName: 'Stop A',
                stopTime: '07:00',
                observedDepartureTime: '07:01:00',
            }),
            makeRecord({
                tripId: 'trip-linked',
                tripName: '8A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '8A',
                direction: 'S',
                routeStopIndex: 1,
                stopId: 'stop-b',
                stopName: 'Stop B',
                arrivalTime: '07:05',
                observedArrivalTime: '07:06:00',
                stopTime: '07:05',
                observedDepartureTime: '07:06:30',
                timePoint: false,
            }),
            makeRecord({
                tripId: 'trip-linked',
                tripName: '8A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '8A',
                direction: 'S',
                routeStopIndex: 2,
                stopId: 'stop-c',
                stopName: 'Stop C',
                arrivalTime: '07:10',
                observedArrivalTime: '07:11:00',
                stopTime: '07:10',
            }),
        ];

        const summaries = aggregateDailySummaries(records);
        const entry = summaries[0].tripStopSegmentRuntimes?.entries[0];

        expect(entry).toBeDefined();
        expect(entry?.tripId).toBe('trip-linked');
        expect(entry?.routeId).toBe('8A');
        expect(entry?.direction).toBe('S');
        expect(entry?.segments).toEqual([
            {
                fromStopId: 'stop-a',
                toStopId: 'stop-b',
                fromRouteStopIndex: 0,
                toRouteStopIndex: 1,
                runtimeMinutes: 5.5,
                timeBucket: '07:00',
            },
            {
                fromStopId: 'stop-b',
                toStopId: 'stop-c',
                fromRouteStopIndex: 1,
                toRouteStopIndex: 2,
                runtimeMinutes: 4.5,
                timeBucket: '07:00',
            },
        ]);
    });

    it('stores detour runtime evidence as a separate observed pattern', () => {
        const records = [
            makeRecord({
                tripId: 'detour-runtime',
                tripName: '12A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '12A',
                direction: 'N',
                routeStopIndex: 0,
                stopId: 'mall',
                stopName: 'Georgian Mall',
                stopTime: '07:00',
                observedDepartureTime: '07:01:00',
                isDetour: true,
            }),
            makeRecord({
                tripId: 'detour-runtime',
                tripName: '12A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '12A',
                direction: 'N',
                routeStopIndex: 1,
                stopId: 'temp',
                stopName: 'Temporary Stop',
                arrivalTime: '07:08',
                observedArrivalTime: '07:09:00',
                stopTime: '07:08',
                observedDepartureTime: '07:10:00',
                timePoint: false,
                isDetour: true,
            }),
            makeRecord({
                tripId: 'detour-runtime',
                tripName: '12A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '12A',
                direction: 'N',
                routeStopIndex: 2,
                stopId: 'downtown',
                stopName: 'Downtown',
                arrivalTime: '07:20',
                observedArrivalTime: '07:21:00',
                stopTime: '07:20',
                isDetour: true,
            }),
        ];

        const summary = aggregateDailySummaries(records)[0];
        expect(summary.segmentRuntimes?.entries).toEqual([]);
        expect(summary.runtimePatterns).toHaveLength(1);
        expect(summary.runtimePatterns?.[0]).toMatchObject({
            patternKind: 'detour',
            routeId: '12A',
            direction: 'N',
            tripCount: 1,
            stopIds: ['mall', 'temp', 'downtown'],
        });
        expect(summary.stopSegmentRuntimes?.entries.every(entry => entry.patternKind === 'detour')).toBe(true);
        expect(summary.tripStopSegmentRuntimes?.entries[0]).toMatchObject({
            routeId: '12A',
            direction: 'N',
            patternKind: 'detour',
        });
    });

    it('includes intermediate stop dwell in chained stop-to-stop runtime while still excluding terminal layover', () => {
        const records = [
            makeRecord({
                tripId: 'route-7-like',
                tripName: '7A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '7',
                direction: 'N',
                routeStopIndex: 0,
                stopId: 'park',
                stopName: 'Park Place',
                stopTime: '07:00',
                observedDepartureTime: '07:01:00',
            }),
            makeRecord({
                tripId: 'route-7-like',
                tripName: '7A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '7',
                direction: 'N',
                routeStopIndex: 1,
                stopId: 'mid',
                stopName: 'Intermediate Stop',
                arrivalTime: '07:05',
                observedArrivalTime: '07:06:00',
                stopTime: '07:05',
                observedDepartureTime: '07:09:00',
                timePoint: false,
            }),
            makeRecord({
                tripId: 'route-7-like',
                tripName: '7A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '7',
                direction: 'N',
                routeStopIndex: 2,
                stopId: 'peggy',
                stopName: 'Peggy Hill',
                arrivalTime: '07:12',
                observedArrivalTime: '07:14:00',
                stopTime: '07:12',
            }),
        ];

        const summaries = aggregateDailySummaries(records);
        const tripEntry = summaries[0].tripStopSegmentRuntimes?.entries[0];

        expect(tripEntry?.segments).toEqual([
            {
                fromStopId: 'park',
                toStopId: 'mid',
                fromRouteStopIndex: 0,
                toRouteStopIndex: 1,
                runtimeMinutes: 8,
                timeBucket: '07:00',
            },
            {
                fromStopId: 'mid',
                toStopId: 'peggy',
                fromRouteStopIndex: 1,
                toRouteStopIndex: 2,
                runtimeMinutes: 5,
                timeBucket: '07:00',
            },
        ]);
    });

    it('subtracts planned control-point hold from non-terminal runtime legs while keeping travel time', () => {
        const records = [
            makeRecord({
                tripId: 'route-7-control-hold',
                tripName: '7A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '7',
                direction: 'N',
                routeStopIndex: 0,
                stopId: 'park',
                stopName: 'Park Place',
                arrivalTime: '07:00',
                stopTime: '07:00',
                observedArrivalTime: '07:00:30',
                observedDepartureTime: '07:01:00',
            }),
            makeRecord({
                tripId: 'route-7-control-hold',
                tripName: '7A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '7',
                direction: 'N',
                routeStopIndex: 1,
                stopId: 'dt',
                stopName: 'Downtown Hub',
                arrivalTime: '07:10',
                observedArrivalTime: '07:11:00',
                stopTime: '07:15',
                observedDepartureTime: '07:16:00',
                timePoint: true,
            }),
            makeRecord({
                tripId: 'route-7-control-hold',
                tripName: '7A - 07:00',
                terminalDepartureTime: '07:00',
                routeId: '7',
                direction: 'N',
                routeStopIndex: 2,
                stopId: 'rose',
                stopName: 'Rose Street',
                arrivalTime: '07:27',
                observedArrivalTime: '07:28:00',
                stopTime: '07:27',
                timePoint: true,
            }),
        ];

        const summaries = aggregateDailySummaries(records);
        const segmentEntries = summaries[0].segmentRuntimes?.entries ?? [];
        const stopEntries = summaries[0].stopSegmentRuntimes?.entries ?? [];
        const tripEntry = summaries[0].tripStopSegmentRuntimes?.entries[0];

        expect(segmentEntries).toEqual([
            {
                routeId: '7',
                direction: 'N',
                segmentName: 'Park Place to Downtown Hub',
                observations: [{ runtimeMinutes: 10, timeBucket: '07:00' }],
            },
            {
                routeId: '7',
                direction: 'N',
                segmentName: 'Downtown Hub to Rose Street',
                observations: [{ runtimeMinutes: 12, timeBucket: '07:00' }],
            },
        ]);
        expect(stopEntries).toEqual([
            {
                routeId: '7',
                direction: 'N',
                patternId: expect.any(String),
                patternKind: 'normal',
                fromStopId: 'park',
                toStopId: 'dt',
                fromStopName: 'Park Place',
                toStopName: 'Downtown Hub',
                fromRouteStopIndex: 0,
                toRouteStopIndex: 1,
                segmentName: 'Park Place to Downtown Hub',
                observations: [{ runtimeMinutes: 10, timeBucket: '07:00' }],
            },
            {
                routeId: '7',
                direction: 'N',
                patternId: expect.any(String),
                patternKind: 'normal',
                fromStopId: 'dt',
                toStopId: 'rose',
                fromStopName: 'Downtown Hub',
                toStopName: 'Rose Street',
                fromRouteStopIndex: 1,
                toRouteStopIndex: 2,
                segmentName: 'Downtown Hub to Rose Street',
                observations: [{ runtimeMinutes: 12, timeBucket: '07:00' }],
            },
        ]);
        expect(tripEntry?.segments).toEqual([
            {
                fromStopId: 'park',
                toStopId: 'dt',
                fromRouteStopIndex: 0,
                toRouteStopIndex: 1,
                runtimeMinutes: 10,
                timeBucket: '07:00',
            },
            {
                fromStopId: 'dt',
                toStopId: 'rose',
                fromRouteStopIndex: 1,
                toRouteStopIndex: 2,
                runtimeMinutes: 12,
                timeBucket: '07:00',
            },
        ]);
    });
});

// ─── APC Load Sanitization Tests ────────────────────────────────────

describe('APC load sanitization', () => {
    it('caps departureLoad values above DEFAULT_LOAD_CAP', () => {
        const records = [
            makeRecord({ departureLoad: 130, apcSource: 1 }),  // absurd value
            makeRecord({ departureLoad: 40, apcSource: 1 }),   // normal
            makeRecord({ departureLoad: 65, apcSource: 1 }),   // at cap — no change
        ];
        const summaries = aggregateDailySummaries(records);
        // 130 capped to 65, 40 stays, 65 stays → avg = (65+40+65)/3
        expect(summaries[0].system.avgSystemLoad).toBeCloseTo((65 + 40 + 65) / 3, 1);
        expect(summaries[0].system.peakLoad).toBe(DEFAULT_LOAD_CAP);
    });

    it('tracks loadCapped count in dataQuality', () => {
        const records = [
            makeRecord({ departureLoad: 130, apcSource: 1 }),
            makeRecord({ departureLoad: 200, apcSource: 1 }),
            makeRecord({ departureLoad: 40, apcSource: 1 }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].dataQuality.loadCapped).toBe(2);
    });

    it('excludes records without a positive APC source from load calculations', () => {
        const records = [
            makeRecord({ departureLoad: 50, apcSource: 1, boardings: 5 }),
            makeRecord({ departureLoad: 30, apcSource: 0, boardings: 3 }),  // no APC
            makeRecord({ departureLoad: 60, apcSource: -1, boardings: 2 }), // missing APCSource column value
        ];
        const summaries = aggregateDailySummaries(records);
        // Only the apcSource=1 record contributes to load
        expect(summaries[0].system.avgSystemLoad).toBe(50);
        expect(summaries[0].system.peakLoad).toBe(50);
        // But boardings still count for ridership
        expect(summaries[0].system.totalRidership).toBe(10);
        expect(summaries[0].system.totalBoardings).toBe(10);
        expect(summaries[0].dataQuality.missingAPC).toBe(2);
        expect(summaries[0].dataQuality.apcExcludedFromLoad).toBe(2);
    });

    it('includes APC-backed zero loads in averages', () => {
        const records = [
            makeRecord({ routeId: '10', tripId: 'T1', routeStopIndex: 0, stopId: 'A', departureLoad: 0, apcSource: 1 }),
            makeRecord({ routeId: '10', tripId: 'T2', routeStopIndex: 0, stopId: 'A', departureLoad: 10, apcSource: 1 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const route10 = summaries[0].byRoute.find(r => r.routeId === '10');
        const profile = summaries[0].loadProfiles.find(p => p.routeId === '10');

        expect(summaries[0].system.avgSystemLoad).toBe(5);
        expect(route10?.avgLoad).toBe(5);
        expect(profile?.stops[0].avgLoad).toBe(5);
    });

    it('tracks apcExcludedFromLoad count in dataQuality', () => {
        const records = [
            makeRecord({ apcSource: 1 }),
            makeRecord({ apcSource: 0 }),
            makeRecord({ apcSource: 0 }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].dataQuality.apcExcludedFromLoad).toBe(2);
    });

    it('counts every non-positive APC source toward apcExcludedFromLoad', () => {
        const records = [
            makeRecord({ apcSource: 1, departureLoad: 0 }),
            makeRecord({ apcSource: 0, departureLoad: 25 }),
            makeRecord({ apcSource: -1, departureLoad: 50 }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].dataQuality.apcExcludedFromLoad).toBe(2);
    });

    it('excludes apcSource === 0 from route-level load metrics', () => {
        const records = [
            makeRecord({ routeId: '10', departureLoad: 50, apcSource: 1 }),
            makeRecord({ routeId: '10', departureLoad: 30, apcSource: 0 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const route10 = summaries[0].byRoute.find(r => r.routeId === '10');
        expect(route10?.avgLoad).toBe(50);
        expect(route10?.maxLoad).toBe(50);
    });

    it('excludes apcSource === 0 from hour-level load metrics', () => {
        const records = [
            makeRecord({ arrivalTime: '12:00', departureLoad: 40, apcSource: 1 }),
            makeRecord({ arrivalTime: '12:30', departureLoad: 20, apcSource: 0 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const hour12 = summaries[0].byHour.find(h => h.hour === 12);
        expect(hour12?.avgLoad).toBe(40);
    });

    it('excludes apcSource === 0 from trip-level maxLoad', () => {
        const records = [
            makeRecord({ tripId: 'T1', departureLoad: 30, apcSource: 1 }),
            makeRecord({ tripId: 'T1', departureLoad: 99, apcSource: 0 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const trip = summaries[0].byTrip.find(t => t.tripId === 'T1');
        expect(trip?.maxLoad).toBe(30);
    });

    it('keeps distinct same-time trips in separate heatmap columns', () => {
        const summaries = aggregateDailySummaries([
            makeRecord({ tripId: 'same-time-a', internalTripId: 101, terminalDepartureTime: '08:00', block: 'A', boardings: 3, alightings: 0 }),
            makeRecord({ tripId: 'same-time-b', internalTripId: 102, terminalDepartureTime: '08:00', block: 'B', boardings: 7, alightings: 1 }),
        ]);
        const heatmap = summaries[0].ridershipHeatmaps![0];

        expect(heatmap.trips).toHaveLength(2);
        expect(heatmap.trips.map(trip => trip.tripId)).toEqual(['same-time-a', 'same-time-b']);
        expect(heatmap.trips.map(trip => trip.block)).toEqual(['A', 'B']);
        expect(heatmap.cells[0]).toEqual([[3, 0], [7, 1]]);
    });

    it('uses internal trip identity when source TripID is blank', () => {
        const summaries = aggregateDailySummaries([
            makeRecord({ tripId: '', internalTripId: 101, terminalDepartureTime: '08:00', boardings: 2 }),
            makeRecord({ tripId: '', internalTripId: 102, terminalDepartureTime: '08:00', boardings: 4 }),
        ]);

        expect(summaries[0].ridershipHeatmaps![0].trips.map(trip => trip.tripId))
            .toEqual(['internal:101', 'internal:102']);
    });

    it('applies default and vehicle-specific capacity and stores the applied policy', () => {
        const summaries = aggregateDailySummaries([
            makeRecord({ tripId: 'default-cap', vehicleId: '2301', departureLoad: 90 }),
            makeRecord({ tripId: 'override-cap', vehicleId: '2401', terminalDepartureTime: '09:00', departureLoad: 90 }),
        ], undefined, {
            defaultCapacity: 70,
            vehicleCapacities: { '2401': 45 },
            version: 3,
            updatedAt: '',
            updatedBy: 'manager',
        });
        const heatmapTrips = summaries[0].ridershipHeatmaps![0].trips;

        expect(summaries[0].system.peakLoad).toBe(70);
        expect(summaries[0].dataQuality.loadCapped).toBe(2);
        expect(summaries[0]).toMatchObject({ defaultLoadCapacity: 70, loadCapacityConfigVersion: 3 });
        expect(heatmapTrips).toEqual(expect.arrayContaining([
            expect.objectContaining({ tripId: 'default-cap', vehicleId: '2301', capacity: 70 }),
            expect.objectContaining({ tripId: 'override-cap', vehicleId: '2401', capacity: 45 }),
        ]));
    });
});
