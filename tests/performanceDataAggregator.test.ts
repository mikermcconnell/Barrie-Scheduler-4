import { describe, it, expect } from 'vitest';
import { aggregateDailySummaries } from '../utils/performanceDataAggregator';
import { classifyOTP, parseDayType, OTP_THRESHOLDS } from '../utils/performanceDataTypes';
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
        const records = [
            makeRecord({ timePoint: true, inBetween: false, observedArrivalTime: '12:01:00' }),
            makeRecord({ timePoint: true, inBetween: true, observedArrivalTime: '12:10:00' }),  // late but inBetween
            makeRecord({ timePoint: true, inBetween: false, observedArrivalTime: '12:02:00' }),
        ];
        const summaries = aggregateDailySummaries(records);
        // Only 2 records should be OTP-eligible (both on-time: +60s and +120s)
        expect(summaries[0].system.otp.total).toBe(2);
        expect(summaries[0].system.otp.onTime).toBe(2);
        expect(summaries[0].system.otp.onTimePercent).toBe(100);
    });

    it('excludes null ObservedArrivalTime from OTP', () => {
        const records = [
            makeRecord({ timePoint: true, observedArrivalTime: '12:01:00' }),
            makeRecord({ timePoint: true, observedArrivalTime: null }),  // missing AVL
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.total).toBe(1);
        expect(summaries[0].dataQuality.missingAVL).toBe(1);
    });

    it('only counts timepoint stops for OTP', () => {
        const records = [
            makeRecord({ timePoint: true, observedArrivalTime: '12:01:00' }),
            makeRecord({ timePoint: false, observedArrivalTime: '12:10:00' }),  // late but not a timepoint
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.total).toBe(1);
        expect(summaries[0].system.otp.onTime).toBe(1);
    });

    it('calculates OTP deviation correctly', () => {
        // Scheduled 12:00, arrived 12:06:00 = +360s = LATE
        const records = [
            makeRecord({ arrivalTime: '12:00', observedArrivalTime: '12:06:00', timePoint: true }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.late).toBe(1);
        expect(summaries[0].system.otp.avgDeviationSeconds).toBe(360);
    });

    it('classifies early arrivals correctly', () => {
        // Scheduled 12:00, arrived 11:55:00 = -300s = EARLY
        const records = [
            makeRecord({ arrivalTime: '12:00', observedArrivalTime: '11:55:00', timePoint: true }),
        ];
        const summaries = aggregateDailySummaries(records);
        expect(summaries[0].system.otp.early).toBe(1);
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
});
