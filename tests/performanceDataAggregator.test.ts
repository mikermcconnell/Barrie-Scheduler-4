import { describe, it, expect } from 'vitest';
import { aggregateDailySummaries } from '../utils/performanceDataAggregator';
import { classifyOTP, parseDayType, OTP_THRESHOLDS, DEFAULT_LOAD_CAP } from '../utils/performanceDataTypes';
import type { STREETSRecord } from '../utils/performanceDataTypes';

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
            makeRecord({ routeId: '10', direction: 'CW', routeStopIndex: 0, stopName: 'Stop A', tripId: 'T1', departureLoad: 5, boardings: 5, alightings: 0 }),
            makeRecord({ routeId: '10', direction: 'CW', routeStopIndex: 1, stopName: 'Stop B', tripId: 'T1', departureLoad: 8, boardings: 3, alightings: 0 }),
            makeRecord({ routeId: '10', direction: 'CW', routeStopIndex: 2, stopName: 'Stop C', tripId: 'T1', departureLoad: 4, boardings: 0, alightings: 4 }),
        ];
        const summaries = aggregateDailySummaries(records);
        const profile = summaries[0].loadProfiles.find(p => p.routeId === '10' && p.direction === 'CW');
        expect(profile).toBeDefined();
        expect(profile!.stops).toHaveLength(3);
        expect(profile!.stops[0].stopName).toBe('Stop A');
        expect(profile!.stops[0].avgLoad).toBe(5);
        expect(profile!.stops[1].avgLoad).toBe(8);
        expect(profile!.stops[2].avgLoad).toBe(4);
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
            runtimeMinutes: 5,
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
                runtimeMinutes: 5,
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

    it('excludes apcSource === 0 records from load calculations', () => {
        const records = [
            makeRecord({ departureLoad: 50, apcSource: 1, boardings: 5 }),
            makeRecord({ departureLoad: 30, apcSource: 0, boardings: 3 }),  // no APC
        ];
        const summaries = aggregateDailySummaries(records);
        // Only the apcSource=1 record contributes to load
        expect(summaries[0].system.avgSystemLoad).toBe(50);
        expect(summaries[0].system.peakLoad).toBe(50);
        // But boardings still count for ridership
        expect(summaries[0].system.totalRidership).toBe(8);
        expect(summaries[0].system.totalBoardings).toBe(8);
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

    it('only counts apcSource === 0 toward apcExcludedFromLoad', () => {
        const records = [
            makeRecord({ apcSource: 1, departureLoad: 0 }),
            makeRecord({ apcSource: 0, departureLoad: 25 }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].dataQuality.apcExcludedFromLoad).toBe(1);
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
});
