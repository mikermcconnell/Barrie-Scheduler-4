import { describe, it, expect } from 'vitest';
import type { DailySummary, DailySegmentRuntimeEntry, DayType } from '../utils/performanceDataTypes';
import { computeRuntimesFromPerformance, getAvailableRuntimeRoutes } from '../utils/performanceRuntimeComputer';

function makeSummary(params: {
    date: string;
    dayType: DayType;
    entries?: DailySegmentRuntimeEntry[];
    routeNames?: Record<string, string>;
}): DailySummary {
    const entries = params.entries || [];
    const routeNames = params.routeNames || {};

    return {
        date: params.date,
        dayType: params.dayType,
        byRoute: Object.keys(routeNames).map(routeId => ({
            routeId,
            routeName: routeNames[routeId],
        })) as DailySummary['byRoute'],
        segmentRuntimes: {
            entries,
            totalObservations: entries.reduce((sum, entry) => sum + entry.observations.length, 0),
            tripsWithData: entries.length > 0 ? 1 : 0,
        },
    } as DailySummary;
}

describe('performanceRuntimeComputer.computeRuntimesFromPerformance', () => {
    it('computes p50/p80 from dayType + dateRange filtered segment observations', () => {
        const segment = 'A Stop to B Stop';
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '10': 'Route Ten' },
                entries: [{
                    routeId: '10',
                    direction: 'N',
                    segmentName: segment,
                    observations: [
                        { timeBucket: '06:00', runtimeMinutes: 10 },
                        { timeBucket: '06:00', runtimeMinutes: 20 },
                    ],
                }],
            }),
            makeSummary({
                date: '2026-01-07',
                dayType: 'weekday',
                routeNames: { '10': 'Route Ten' },
                entries: [{
                    routeId: '10',
                    direction: 'N',
                    segmentName: segment,
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 30 }],
                }],
            }),
            makeSummary({
                date: '2026-01-08',
                dayType: 'weekday',
                routeNames: { '12': 'Route Twelve' },
                entries: [{
                    routeId: '12',
                    direction: 'N',
                    segmentName: segment,
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 99 }],
                }],
            }),
            makeSummary({
                date: '2026-01-11',
                dayType: 'sunday',
                routeNames: { '10': 'Route Ten' },
                entries: [{
                    routeId: '10',
                    direction: 'N',
                    segmentName: segment,
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 999 }],
                }],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '10',
            dayType: 'weekday',
            dateRange: { start: '2026-01-06', end: '2026-01-07' },
        });

        expect(result).toHaveLength(1);
        expect(result[0].detectedDirection).toBe('North');
        expect(result[0].detectedRouteNumber).toBe('10');
        expect(result[0].allTimeBuckets).toEqual(['06:00']);

        const runtime = result[0].segments[0].timeBuckets['06:00'];
        expect(runtime.p50).toBe(20);
        expect(runtime.p80).toBe(26);
    });

    it('returns no rows when the selected date range excludes all matching summaries', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '10': 'Route Ten' },
                entries: [{
                    routeId: '10',
                    direction: 'N',
                    segmentName: 'A Stop to B Stop',
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 15 }],
                }],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '10',
            dayType: 'weekday',
            dateRange: { start: '2026-01-07', end: '2026-01-08' },
        });

        expect(result).toEqual([]);
    });
});

describe('performanceRuntimeComputer.getAvailableRuntimeRoutes', () => {
    it('returns route metadata scoped to day type', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '10': 'Route Ten' },
                entries: [{
                    routeId: '10',
                    direction: 'N',
                    segmentName: 'A to B',
                    observations: [
                        { timeBucket: '06:00', runtimeMinutes: 10 },
                        { timeBucket: '06:30', runtimeMinutes: 11 },
                    ],
                }],
            }),
            makeSummary({
                date: '2026-01-07',
                dayType: 'weekday',
                routeNames: { '10': 'Route Ten' },
                entries: [{
                    routeId: '10',
                    direction: 'S',
                    segmentName: 'B to A',
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 12 }],
                }],
            }),
            makeSummary({
                date: '2026-01-11',
                dayType: 'sunday',
                routeNames: { '10': 'Route Ten' },
                entries: [{
                    routeId: '10',
                    direction: 'N',
                    segmentName: 'A to B',
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 99 }],
                }],
            }),
        ];

        const routes = getAvailableRuntimeRoutes(summaries, 'weekday');
        expect(routes).toHaveLength(1);
        expect(routes[0].routeId).toBe('10');
        expect(routes[0].routeName).toBe('Route Ten');
        expect(routes[0].directions).toEqual(['N', 'S']);
        expect(routes[0].dayCount).toBe(2);
        expect(routes[0].totalObs).toBe(3);
    });
});
