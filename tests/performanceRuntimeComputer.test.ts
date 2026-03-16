import { describe, it, expect } from 'vitest';
import type {
    DailySummary,
    DailySegmentRuntimeEntry,
    DailyStopSegmentRuntimeEntry,
    DayType,
} from '../utils/performanceDataTypes';
import { computeRuntimesFromPerformance, getAvailableRuntimeRoutes } from '../utils/performanceRuntimeComputer';

function makeSummary(params: {
    date: string;
    dayType: DayType;
    entries?: DailySegmentRuntimeEntry[];
    stopEntries?: DailyStopSegmentRuntimeEntry[];
    routeNames?: Record<string, string>;
}): DailySummary {
    const entries = params.entries || [];
    const stopEntries = params.stopEntries || [];
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
        stopSegmentRuntimes: {
            entries: stopEntries,
            totalObservations: stopEntries.reduce((sum, entry) => sum + entry.observations.length, 0),
            tripsWithData: stopEntries.length > 0 ? 1 : 0,
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

    it('treats directional A/B variants as a single base route during computation', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '7A': 'Grove A', '7B': 'Grove B' },
                entries: [
                    {
                        routeId: '7A',
                        direction: 'N',
                        segmentName: 'A to B',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '7B',
                        direction: 'S',
                        segmentName: 'B to A',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 12 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '7',
            dayType: 'weekday',
        });

        expect(result).toHaveLength(2);
        expect(new Set(result.map(r => r.detectedDirection))).toEqual(new Set(['North', 'South']));
        expect(new Set(result.map(r => r.detectedRouteNumber))).toEqual(new Set(['7']));
    });

    it('preserves ordered stop segments when stop-level runtime entries are available', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '7': 'Route Seven' },
                stopEntries: [
                    {
                        routeId: '7',
                        direction: 'N',
                        fromStopId: 'gc',
                        toStopId: 'rose',
                        fromStopName: 'Georgian College',
                        toStopName: 'Rose Street',
                        fromRouteStopIndex: 4,
                        toRouteStopIndex: 5,
                        segmentName: 'Georgian College to Rose Street',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 4 }],
                    },
                    {
                        routeId: '7',
                        direction: 'N',
                        fromStopId: 'park',
                        toStopId: 'peggy',
                        fromStopName: 'Park Place',
                        toStopName: 'Peggy Hill',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Park Place to Peggy Hill',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 8 }],
                    },
                    {
                        routeId: '7',
                        direction: 'N',
                        fromStopId: 'peggy',
                        toStopId: 'allandale',
                        fromStopName: 'Peggy Hill',
                        toStopName: 'Allandale Terminal',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Peggy Hill to Allandale Terminal',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 7 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '7',
            dayType: 'weekday',
        });

        expect(result).toHaveLength(1);
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual([
            'Park Place to Peggy Hill',
            'Peggy Hill to Allandale Terminal',
            'Georgian College to Rose Street',
        ]);
        expect(result[0].segments.map(segment => segment.fromRouteStopIndex)).toEqual([1, 2, 4]);
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
        expect(routes[0].memberRouteIds).toEqual(['10']);
    });

    it('merges directional variants and keeps non-direction variants separate', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: {
                    '2A': '2A Downtown',
                    '2B': '2B Park Place',
                    '8A': '8A Georgian',
                    '8B': '8B Park Place',
                },
                entries: [
                    {
                        routeId: '2A',
                        direction: 'N',
                        segmentName: 'A to B',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '2B',
                        direction: 'S',
                        segmentName: 'B to A',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 11 }],
                    },
                    {
                        routeId: '8A',
                        direction: 'N',
                        segmentName: 'X to Y',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 20 }],
                    },
                    {
                        routeId: '8B',
                        direction: 'S',
                        segmentName: 'Y to X',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 21 }],
                    },
                ],
            }),
        ];

        const routes = getAvailableRuntimeRoutes(summaries, 'weekday');
        expect(routes.map(r => r.routeId)).toEqual(['2', '8A', '8B']);

        const route2 = routes.find(r => r.routeId === '2');
        expect(route2).toBeDefined();
        expect(route2!.memberRouteIds).toEqual(['2A', '2B']);
        expect(route2!.directions).toEqual(['N', 'S']);

        const route8A = routes.find(r => r.routeId === '8A');
        const route8B = routes.find(r => r.routeId === '8B');
        expect(route8A?.memberRouteIds).toEqual(['8A']);
        expect(route8B?.memberRouteIds).toEqual(['8B']);
    });
});
