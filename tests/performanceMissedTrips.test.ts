import { describe, expect, it } from 'vitest';
import type { DailySummary } from '../utils/performanceDataTypes';
import {
    aggregateStoredMissedTrips,
    computeAggregatedMissedTrips,
    getLatestStoredMissedTrips,
} from '../utils/performanceMissedTrips';

function buildDay(overrides: Partial<DailySummary>): DailySummary {
    return {
        date: '2026-03-01',
        dayType: 'weekday',
        system: {} as DailySummary['system'],
        byRoute: [],
        byHour: [],
        byStop: [],
        byTrip: [],
        loadProfiles: [],
        dataQuality: {} as DailySummary['dataQuality'],
        schemaVersion: 8,
        ...overrides,
    };
}

describe('performanceMissedTrips', () => {
    it('aggregates stored missed-trip totals and by-route counts across days', () => {
        const summary = aggregateStoredMissedTrips([
            buildDay({
                date: '2026-03-01',
                missedTrips: {
                    totalScheduled: 100,
                    totalMatched: 96,
                    totalMissed: 4,
                    missedPct: 4,
                    notPerformedCount: 3,
                    lateOver15Count: 1,
                    byRoute: [
                        { routeId: '1', count: 3, earliestDep: '06:30' },
                        { routeId: '2', count: 1, earliestDep: '07:00' },
                    ],
                    trips: [],
                },
            }),
            buildDay({
                date: '2026-03-02',
                missedTrips: {
                    totalScheduled: 90,
                    totalMatched: 88,
                    totalMissed: 2,
                    missedPct: 2.2,
                    notPerformedCount: 1,
                    lateOver15Count: 1,
                    byRoute: [
                        { routeId: '2', count: 2, earliestDep: '06:45' },
                    ],
                    trips: [],
                },
            }),
            buildDay({ date: '2026-03-03' }),
        ]);

        expect(summary.hasCoverage).toBe(true);
        expect(summary.skippedDays).toBe(1);
        expect(summary.missingStoredDays).toBe(1);
        expect(summary.totalScheduled).toBe(190);
        expect(summary.totalObserved).toBe(184);
        expect(summary.totalMissed).toBe(6);
        expect(summary.missedPct).toBeCloseTo(6 / 190 * 100, 5);
        expect(summary.routesMissed).toEqual([
            { routeId: '1', count: 3, earliestDep: '06:30' },
            { routeId: '2', count: 3, earliestDep: '06:45' },
        ]);
    });

    it('returns latest stored missed-trip rows for OTP detail tables', () => {
        const latest = getLatestStoredMissedTrips([
            buildDay({
                date: '2026-03-01',
                missedTrips: {
                    totalScheduled: 100,
                    totalMatched: 98,
                    totalMissed: 2,
                    missedPct: 2,
                    notPerformedCount: 1,
                    lateOver15Count: 1,
                    byRoute: [{ routeId: '1', count: 2, earliestDep: '06:30' }],
                    trips: [
                        {
                            tripId: 'trip-1',
                            routeId: '1',
                            departure: '06:30',
                            headsign: 'Downtown',
                            blockId: 'B1',
                            serviceId: 'WKD',
                            missType: 'not_performed',
                        },
                    ],
                },
            }),
            buildDay({
                date: '2026-03-02',
                missedTrips: {
                    totalScheduled: 80,
                    totalMatched: 78,
                    totalMissed: 2,
                    missedPct: 2.5,
                    notPerformedCount: 1,
                    lateOver15Count: 1,
                    byRoute: [{ routeId: '2', count: 2, earliestDep: '07:10' }],
                    trips: [
                        {
                            tripId: 'trip-3',
                            routeId: '2',
                            departure: '07:10',
                            headsign: 'Terminal',
                            blockId: 'B3',
                            serviceId: 'WKD',
                            missType: 'late_over_15',
                            lateByMinutes: 19,
                        },
                        {
                            tripId: 'trip-2',
                            routeId: '2',
                            departure: '06:50',
                            headsign: 'Terminal',
                            blockId: 'B2',
                            serviceId: 'WKD',
                            missType: 'not_performed',
                        },
                    ],
                },
            }),
        ]);

        expect(latest).toEqual({
            date: '2026-03-02',
            trips: [
                {
                    date: '2026-03-02',
                    routeId: '2',
                    departure: '06:50',
                    headsign: 'Terminal',
                    blockId: 'B2',
                    missType: 'not_performed',
                },
                {
                    date: '2026-03-02',
                    routeId: '2',
                    departure: '07:10',
                    headsign: 'Terminal',
                    blockId: 'B3',
                    missType: 'late_over_15',
                    lateByMinutes: 19,
                },
            ],
        });
    });

    it('can fall back to GTFS-based aggregation when older imports are missing stored missed-trip results', () => {
        const dayWithTrips = buildDay({
            date: '2026-03-04',
            dayType: 'weekday',
            byTrip: [
                {
                    tripId: 'trip-1',
                    tripName: 'Trip 1',
                    block: 'B1',
                    routeId: '1',
                    routeName: 'Route 1',
                    direction: 'North',
                    terminalDepartureTime: '06:30',
                    otp: {
                        total: 0,
                        onTime: 0,
                        early: 0,
                        late: 0,
                        onTimePercent: 0,
                        earlyPercent: 0,
                        latePercent: 0,
                        avgDeviationSeconds: 0,
                    },
                    boardings: 0,
                    maxLoad: 0,
                },
            ],
        });

        const summary = computeAggregatedMissedTrips([dayWithTrips], {
            hasGtfsCoverage: (date) => date === '2026-03-04',
            computeMissedTripsForDay: () => ({
                totalScheduled: 10,
                totalMatched: 9,
                totalMissed: 1,
                missedPct: 10,
                notPerformedCount: 1,
                lateOver15Count: 0,
                byRoute: [{ routeId: '1', count: 1, earliestDep: '06:30' }],
                trips: [],
            }),
        });

        expect(summary.hasCoverage).toBe(true);
        expect(summary.skippedDays).toBe(0);
        expect(summary.missingStoredDays).toBe(0);
        expect(summary.totalScheduled).toBe(10);
        expect(summary.totalObserved).toBe(9);
        expect(summary.totalMissed).toBe(1);
        expect(summary.routesMissed).toEqual([{ routeId: '1', count: 1, earliestDep: '06:30' }]);
    });
});
