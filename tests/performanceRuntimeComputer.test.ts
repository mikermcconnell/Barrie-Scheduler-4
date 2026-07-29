import { describe, it, expect } from 'vitest';
import type {
    DailySummary,
    DailySegmentRuntimeEntry,
    DailyStopSegmentRuntimeEntry,
    DailyTripStopSegmentRuntimeEntry,
    DayType,
} from '../utils/performanceDataTypes';
import {
    PERFORMANCE_RUNTIME_LOGIC_VERSION,
    PERFORMANCE_SCHEMA_VERSION,
} from '../utils/performanceDataTypes';
import {
    computeRuntimesFromPerformance,
    getAvailableRuntimeRoutes,
    getStep2CleanHistoryWindow,
    inspectPerformanceRuntimeAvailability,
} from '../utils/performanceRuntimeComputer';
import { calculateBands, calculateTotalTripTimes } from '../utils/ai/runtimeAnalysis';
import {
    buildCanonicalSegmentColumnsFromMasterStops,
    getUsableCanonicalDirectionStops,
} from '../components/NewSchedule/utils/wizardState';
import {
    buildNormalizedSegmentNameLookup,
    resolveCanonicalSegmentName,
} from '../utils/runtimeSegmentMatching';

function makeSummary(params: {
    date: string;
    dayType: DayType;
    entries?: DailySegmentRuntimeEntry[];
    stopEntries?: DailyStopSegmentRuntimeEntry[];
    tripEntries?: DailyTripStopSegmentRuntimeEntry[];
    routeNames?: Record<string, string>;
    schemaVersion?: number;
}): DailySummary {
    const entries = params.entries || [];
    const stopEntries = params.stopEntries || [];
    const tripEntries = params.tripEntries || [];
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
        tripStopSegmentRuntimes: {
            entries: tripEntries,
            totalObservations: tripEntries.reduce((sum, entry) => sum + entry.segments.length, 0),
            tripsWithData: tripEntries.length,
        },
        schemaVersion: params.schemaVersion ?? PERFORMANCE_SCHEMA_VERSION,
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

    it('preserves per-day bucket contributions for performance-derived runtimes', () => {
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
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 10 }],
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
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 20 }],
                }],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '10',
            dayType: 'weekday',
        });

        const runtime = result[0].segments[0].timeBuckets['06:00'];
        expect(runtime.contributions).toEqual([
            { date: '2026-01-06', runtime: 10 },
            { date: '2026-01-07', runtime: 20 },
        ]);
        expect(runtime.n).toBe(2);
    });

    it('counts distinct contributing days for performance-derived runtime buckets', () => {
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
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '10',
            dayType: 'weekday',
        });

        expect(result).toHaveLength(1);
        expect(result[0].sampleCountMode).toBe('days');
        expect(result[0].segments[0].timeBuckets['06:00'].n).toBe(2);
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

    it('falls back to route variant direction when 12A/12B entries have blank raw direction fields', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                entries: [
                    {
                        routeId: '12A',
                        direction: '',
                        segmentName: 'A to B',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '12B',
                        direction: '',
                        segmentName: 'B to A',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 12 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
        });

        expect(result).toHaveLength(2);
        expect(result.find(item => item.detectedDirection === 'North')?.segments.map(segment => segment.segmentName)).toEqual(['A to B']);
        expect(result.find(item => item.detectedDirection === 'South')?.segments.map(segment => segment.segmentName)).toEqual(['B to A']);
    });

    it('falls back to trip-name direction when Route 7 base-route trip legs have blank raw direction fields', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '7': 'Route Seven' },
                tripEntries: [
                    {
                        tripId: 'north-1',
                        tripName: '7A - 15:00',
                        routeId: '7',
                        direction: '',
                        terminalDepartureTime: '15:00',
                        segments: [
                            { fromStopId: 'park', toStopId: 'rose', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 50, timeBucket: '15:00' },
                        ],
                    },
                    {
                        tripId: 'south-1',
                        tripName: '7B - 15:35',
                        routeId: '7',
                        direction: '',
                        terminalDepartureTime: '15:35',
                        segments: [
                            { fromStopId: 'rose', toStopId: 'park', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 48, timeBucket: '15:30' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '7',
            dayType: 'weekday',
        });

        expect(result).toHaveLength(2);
        expect(result.find(item => item.detectedDirection === 'North')?.allTimeBuckets).toEqual(['15:00']);
        expect(result.find(item => item.detectedDirection === 'South')?.allTimeBuckets).toEqual(['15:00']);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].timeBucket).toBe('15:00');
        expect(analysis[0].totalP50).toBe(98);
        expect(analysis[0].observedSegmentCount).toBe(2);
        expect(analysis[0].expectedSegmentCount).toBe(2);
    });

    it('uses a representative trip runtime instead of summing duplicate trips in the same Route 7 bucket', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '7A': 'Route Seven A', '7B': 'Route Seven B' },
                tripEntries: [
                    {
                        tripId: 'north-0632',
                        tripName: '7A 06:32',
                        routeId: '7A',
                        direction: 'N',
                        terminalDepartureTime: '06:32',
                        segments: [
                            { fromStopId: 'park', toStopId: 'rose', fromRouteStopIndex: 0, toRouteStopIndex: 1, runtimeMinutes: 50, timeBucket: '06:30' },
                        ],
                    },
                    {
                        tripId: 'north-0657',
                        tripName: '7A 06:57',
                        routeId: '7A',
                        direction: 'N',
                        terminalDepartureTime: '06:57',
                        segments: [
                            { fromStopId: 'park', toStopId: 'rose', fromRouteStopIndex: 0, toRouteStopIndex: 1, runtimeMinutes: 60, timeBucket: '06:30' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '7A',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Park Place', 'Rose Street'],
            },
        });
        const analysis = calculateTotalTripTimes(result);

        expect(analysis).toHaveLength(1);
        expect(analysis[0].timeBucket).toBe('06:30');
        expect(analysis[0].totalP50).toBe(55);
        expect(analysis[0].observedCycleP50).toBe(55);
        expect(analysis[0].contributingDays).toEqual([
            { date: '2026-01-06', runtime: 55 },
        ]);
    });

    it('keeps only the longest full trip pattern when full-pattern-only mode is enabled', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '2A': 'Route 2A' },
                tripEntries: [
                    {
                        tripId: 'full-1',
                        tripName: '2A - full',
                        routeId: '2A',
                        direction: 'N',
                        terminalDepartureTime: '06:00',
                        segments: [
                            { fromStopId: 'park', toStopId: 'south', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 3, timeBucket: '06:00' },
                            { fromStopId: 'south', toStopId: 'maple', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 4, timeBucket: '06:00' },
                            { fromStopId: 'maple', toStopId: 'pringle', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 5, timeBucket: '06:00' },
                        ],
                    },
                    {
                        tripId: 'partial-1',
                        tripName: '2A - partial',
                        routeId: '2A',
                        direction: 'N',
                        terminalDepartureTime: '06:30',
                        segments: [
                            { fromStopId: 'sproule', toStopId: 'pringle', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 1, timeBucket: '06:30' },
                            { fromStopId: 'pringle', toStopId: 'loop', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 1, timeBucket: '06:30' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '2',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Park Place', 'South Village Way', 'Mapleview', 'Pringle at Sproule'],
            },
            fullPatternOnly: true,
        });

        expect(result).toHaveLength(1);
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual([
            'Park Place to South Village Way',
            'South Village Way to Mapleview',
            'Mapleview to Pringle at Sproule',
        ]);
        expect(result[0].allTimeBuckets).toEqual(['06:00']);
    });

    it('keeps exact direction variants isolated when a specific variant is selected', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                entries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        segmentName: 'A to B',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        segmentName: 'B to A',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 12 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12A',
            dayType: 'weekday',
        });

        expect(result).toHaveLength(1);
        expect(result[0].detectedRouteNumber).toBe('12');
        expect(result[0].detectedDirection).toBe('North');
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual(['A to B']);
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

    it('canonicalizes Route 7 stop-level aliases onto the master stop chain', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '7': 'Route Seven' },
                stopEntries: [
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
                    {
                        routeId: '7',
                        direction: 'N',
                        fromStopId: 'allandale',
                        toStopId: 'rose',
                        fromStopName: 'Allandale GO',
                        toStopName: 'Rose Street',
                        fromRouteStopIndex: 3,
                        toRouteStopIndex: 4,
                        segmentName: 'Allandale GO to Rose Street',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 6 }],
                    },
                    {
                        routeId: '7',
                        direction: 'N',
                        fromStopId: 'rose',
                        toStopId: 'gc',
                        fromStopName: 'Rose Street',
                        toStopName: 'Georgian Coll.',
                        fromRouteStopIndex: 4,
                        toRouteStopIndex: 5,
                        segmentName: 'Rose Street to Georgian Coll.',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 4 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '7',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: [
                    'Park Place',
                    'Peggy Hill Community Centre (3)',
                    'Allandale GO Station (3)',
                    'Rose Street',
                    'Georgian College',
                ],
            },
        });

        expect(result).toHaveLength(1);
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual([
            'Park Place to Peggy Hill Community Centre (3)',
            'Peggy Hill Community Centre (3) to Allandale GO Station (3)',
            'Allandale GO Station (3) to Rose Street',
            'Rose Street to Georgian College',
        ]);
    });

    it('canonicalizes shared Barrie hub aliases onto master-stop chains across routes', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '8': 'Route Eight' },
                stopEntries: [
                    {
                        routeId: '8',
                        direction: 'N',
                        fromStopId: 'dt',
                        toStopId: 'park',
                        fromStopName: 'Downtown Hub (Platform 2)',
                        toStopName: 'Park Place Terminal',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Downtown Hub (Platform 2) to Park Place Terminal',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '8',
                        direction: 'N',
                        fromStopId: 'park',
                        toStopId: 'allandale',
                        fromStopName: 'Park Place Terminal',
                        toStopName: 'Allandale Waterfront GO Station',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Park Place Terminal to Allandale Waterfront GO Station',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 11 }],
                    },
                    {
                        routeId: '8',
                        direction: 'N',
                        fromStopId: 'allandale',
                        toStopId: 'southgo',
                        fromStopName: 'Barrie Allandale Transit Terminal Platform 13',
                        toStopName: 'Barrie South GO Station',
                        fromRouteStopIndex: 3,
                        toRouteStopIndex: 4,
                        segmentName: 'Barrie Allandale Transit Terminal Platform 13 to Barrie South GO Station',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 12 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '8',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: [
                    'Downtown (3)',
                    'Park Place (3)',
                    'Allandale GO Station (3)',
                    'Barrie South GO (2)',
                ],
            },
        });

        expect(result).toHaveLength(1);
        expect(result[0].segments.map(segment => ({
            name: segment.segmentName,
            p50: segment.timeBuckets['06:00']?.p50,
        }))).toEqual([
            { name: 'Downtown (3) to Park Place (3)', p50: 10 },
            { name: 'Park Place (3) to Allandale GO Station (3)', p50: 11 },
            { name: 'Allandale GO Station (3) to Barrie South GO (2)', p50: 12 },
        ]);
    });

    it('uses cycle-start buckets for paired direction routes when stop-level observations are available', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                entries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        segmentName: 'A to C',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 55 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        segmentName: 'C to E',
                        observations: [{ timeBucket: '08:00', runtimeMinutes: 58 }],
                    },
                ],
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'a',
                        toStopId: 'b',
                        fromStopName: 'A',
                        toStopName: 'B',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'A to B',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 30 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'b',
                        toStopId: 'c',
                        fromStopName: 'B',
                        toStopName: 'C',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'B to C',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 25 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'c',
                        toStopId: 'd',
                        fromStopName: 'C',
                        toStopName: 'D',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'C to D',
                        observations: [{ timeBucket: '08:00', runtimeMinutes: 28 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'd',
                        toStopId: 'e',
                        fromStopName: 'D',
                        toStopName: 'E',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'D to E',
                        observations: [{ timeBucket: '08:00', runtimeMinutes: 30 }],
                    },
                ],
                tripEntries: [
                    {
                        tripId: 'north-1',
                        tripName: '12A 07:05',
                        routeId: '12A',
                        direction: 'N',
                        terminalDepartureTime: '07:05',
                        segments: [
                            { fromStopId: 'a', toStopId: 'b', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 30, timeBucket: '07:00' },
                            { fromStopId: 'b', toStopId: 'c', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 25, timeBucket: '07:00' },
                        ],
                    },
                    {
                        tripId: 'south-1',
                        tripName: '12B 08:05',
                        routeId: '12B',
                        direction: 'S',
                        terminalDepartureTime: '08:05',
                        segments: [
                            { fromStopId: 'c', toStopId: 'd', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 28, timeBucket: '08:00' },
                            { fromStopId: 'd', toStopId: 'e', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 30, timeBucket: '08:00' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
        });

        expect(result).toHaveLength(2);
        expect(result[0].allTimeBuckets).toEqual(['07:00']);
        expect(result[1].allTimeBuckets).toEqual(['07:00']);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].timeBucket).toBe('07:00');
        expect(analysis[0].totalP50).toBe(113);
        expect(analysis[0].details.map(detail => detail.segmentName)).toEqual([
            'A to B',
            'B to C',
            'C to D',
            'D to E',
        ]);
    });

    it('can also preserve each direction on its own trip-start bucket for schedule generation', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                entries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        segmentName: 'A to C',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 55 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        segmentName: 'C to E',
                        observations: [{ timeBucket: '08:00', runtimeMinutes: 58 }],
                    },
                ],
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'a',
                        toStopId: 'b',
                        fromStopName: 'A',
                        toStopName: 'B',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'A to B',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 30 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'b',
                        toStopId: 'c',
                        fromStopName: 'B',
                        toStopName: 'C',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'B to C',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 25 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'c',
                        toStopId: 'd',
                        fromStopName: 'C',
                        toStopName: 'D',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'C to D',
                        observations: [{ timeBucket: '08:00', runtimeMinutes: 28 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'd',
                        toStopId: 'e',
                        fromStopName: 'D',
                        toStopName: 'E',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'D to E',
                        observations: [{ timeBucket: '08:00', runtimeMinutes: 30 }],
                    },
                ],
                tripEntries: [
                    {
                        tripId: 'north-1',
                        tripName: '12A 07:05',
                        routeId: '12A',
                        direction: 'N',
                        terminalDepartureTime: '07:05',
                        segments: [
                            { fromStopId: 'a', toStopId: 'b', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 30, timeBucket: '07:00' },
                            { fromStopId: 'b', toStopId: 'c', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 25, timeBucket: '07:00' },
                        ],
                    },
                    {
                        tripId: 'south-1',
                        tripName: '12B 08:05',
                        routeId: '12B',
                        direction: 'S',
                        terminalDepartureTime: '08:05',
                        segments: [
                            { fromStopId: 'c', toStopId: 'd', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 28, timeBucket: '08:00' },
                            { fromStopId: 'd', toStopId: 'e', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 30, timeBucket: '08:00' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            bucketMode: 'tripStart',
        });

        expect(result).toHaveLength(2);
        expect(result.find(item => item.detectedDirection === 'North')?.allTimeBuckets).toEqual(['07:00']);
        expect(result.find(item => item.detectedDirection === 'South')?.allTimeBuckets).toEqual(['08:00']);
    });

    it('prefers stop-level segments over timepoint segments when both are available', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'a',
                        toStopId: 'b',
                        fromStopName: 'A',
                        toStopName: 'B',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'A to B',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 30 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'b',
                        toStopId: 'c',
                        fromStopName: 'B',
                        toStopName: 'C',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'B to C',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 25 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'c',
                        toStopId: 'd',
                        fromStopName: 'C',
                        toStopName: 'D',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'C to D',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 28 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'd',
                        toStopId: 'e',
                        fromStopName: 'D',
                        toStopName: 'E',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'D to E',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 30 }],
                    },
                ],
                entries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        segmentName: 'A to C',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 55 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        segmentName: 'C to E',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 58 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
        });

        expect(result).toHaveLength(2);
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual(['A to B', 'B to C']);
        expect(result[1].segments.map(segment => segment.segmentName)).toEqual(['C to D', 'D to E']);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].totalP50).toBe(113);
        expect(analysis[0].details.map(detail => detail.segmentName)).toEqual([
            'A to B',
            'B to C',
            'C to D',
            'D to E',
        ]);
    });

    it('prefers the anchored full trip pattern over a more common partial pattern for troubleshooting views', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '2A': 'Route Two A' },
                stopEntries: [
                    {
                        routeId: '2A',
                        direction: 'N',
                        fromStopId: 'pp',
                        toStopId: 'vet',
                        fromStopName: 'Park Place',
                        toStopName: 'Veteran',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Park Place to Veteran',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 5 }],
                    },
                    {
                        routeId: '2A',
                        direction: 'N',
                        fromStopId: 'vet',
                        toStopId: 'dt',
                        fromStopName: 'Veteran',
                        toStopName: 'Downtown',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Veteran to Downtown',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 6 }],
                    },
                    {
                        routeId: '2A',
                        direction: 'N',
                        fromStopId: 'kraus',
                        toStopId: 'pringle',
                        fromStopName: 'Sproule at Kraus',
                        toStopName: 'Pringle at Sproule',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Sproule at Kraus to Pringle at Sproule',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 4 }],
                    },
                    {
                        routeId: '2A',
                        direction: 'N',
                        fromStopId: 'pringle',
                        toStopId: 'dt',
                        fromStopName: 'Pringle at Sproule',
                        toStopName: 'Downtown',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Pringle at Sproule to Downtown',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 6 }],
                    },
                ],
                tripEntries: [
                    {
                        tripId: 'full-1',
                        tripName: '2A 06:05',
                        routeId: '2A',
                        direction: 'N',
                        terminalDepartureTime: '06:05',
                        segments: [
                            { fromStopId: 'pp', toStopId: 'vet', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 5, timeBucket: '06:00' },
                            { fromStopId: 'vet', toStopId: 'dt', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 6, timeBucket: '06:00' },
                        ],
                    },
                    {
                        tripId: 'partial-1',
                        tripName: '2A 06:15',
                        routeId: '2A',
                        direction: 'N',
                        terminalDepartureTime: '06:15',
                        segments: [
                            { fromStopId: 'kraus', toStopId: 'pringle', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 4, timeBucket: '06:00' },
                            { fromStopId: 'pringle', toStopId: 'dt', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 6, timeBucket: '06:00' },
                        ],
                    },
                    {
                        tripId: 'partial-2',
                        tripName: '2A 06:45',
                        routeId: '2A',
                        direction: 'N',
                        terminalDepartureTime: '06:45',
                        segments: [
                            { fromStopId: 'kraus', toStopId: 'pringle', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 4, timeBucket: '06:30' },
                            { fromStopId: 'pringle', toStopId: 'dt', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 6, timeBucket: '06:30' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '2',
            dayType: 'weekday',
            bucketMode: 'tripStart',
            fullPatternOnly: true,
            patternAnchorStops: {
                North: ['Park Place', 'Downtown'],
            },
        });

        expect(result).toHaveLength(1);
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual([
            'Park Place to Veteran',
            'Veteran to Downtown',
        ]);
        expect(result[0].troubleshootingPatternStatus).toBe('anchored');
    });

    it('marks troubleshooting output as fallback when no anchored full trip pattern is available', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '2A': 'Route Two A' },
                stopEntries: [
                    {
                        routeId: '2A',
                        direction: 'N',
                        fromStopId: 'kraus',
                        toStopId: 'pringle',
                        fromStopName: 'Sproule at Kraus',
                        toStopName: 'Pringle at Sproule',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Sproule at Kraus to Pringle at Sproule',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 4 }],
                    },
                    {
                        routeId: '2A',
                        direction: 'N',
                        fromStopId: 'pringle',
                        toStopId: 'dt',
                        fromStopName: 'Pringle at Sproule',
                        toStopName: 'Downtown',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Pringle at Sproule to Downtown',
                        observations: [{ timeBucket: '06:00', runtimeMinutes: 6 }],
                    },
                ],
                tripEntries: [
                    {
                        tripId: 'partial-1',
                        tripName: '2A 06:15',
                        routeId: '2A',
                        direction: 'N',
                        terminalDepartureTime: '06:15',
                        segments: [
                            { fromStopId: 'kraus', toStopId: 'pringle', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 4, timeBucket: '06:00' },
                            { fromStopId: 'pringle', toStopId: 'dt', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 6, timeBucket: '06:00' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '2',
            dayType: 'weekday',
            bucketMode: 'tripStart',
            fullPatternOnly: true,
            patternAnchorStops: {
                North: ['Park Place', 'Downtown'],
            },
        });

        expect(result).toHaveLength(1);
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual([
            'Sproule at Kraus to Pringle at Sproule',
            'Pringle at Sproule to Downtown',
        ]);
        expect(result[0].troubleshootingPatternStatus).toBe('fallback');
    });

    it('rejects non-adjacent trip legs from planning results when canonical stops prove an intermediate stop is missing', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall' },
                tripEntries: [
                    {
                        tripId: 'north-1',
                        tripName: '12A 13:35',
                        routeId: '12A',
                        direction: 'N',
                        terminalDepartureTime: '13:35',
                        segments: [
                            { fromStopId: 'gm', toStopId: 'park', fromRouteStopIndex: 1, toRouteStopIndex: 3, runtimeMinutes: 20, timeBucket: '13:30' },
                            { fromStopId: 'park', toStopId: 'south', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 12, timeBucket: '14:00' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown (3)', 'Park Place (3)', 'Barrie South GO (2)'],
            },
            patternAnchorStops: {
                North: ['Georgian Mall', 'Barrie South GO (2)'],
            },
            fullPatternOnly: true,
        });

        expect(result).toEqual([]);
    });

    it('drops canonicalized stop-level jumps that skip intermediate master stops in planning mode', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall' },
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'gm',
                        toStopId: 'hub-mid',
                        fromStopName: 'Georgian Mall',
                        toStopName: 'Downtown Hub (Platform 2)',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Georgian Mall to Downtown Hub (Platform 2)',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 9 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'hub-mid',
                        toStopId: 'south',
                        fromStopName: 'Downtown Hub (Platform 2)',
                        toStopName: 'Barrie South GO Station',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 4,
                        segmentName: 'Downtown Hub (Platform 2) to Barrie South GO Station',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 14 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown (3)', 'Park Place (3)', 'Barrie South GO (2)'],
            },
            patternAnchorStops: {
                North: ['Georgian Mall', 'Barrie South GO (2)'],
            },
            fullPatternOnly: true,
        });

        expect(result).toHaveLength(1);
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual([
            'Georgian Mall to Downtown (3)',
        ]);
    });

    it('uses canonical stop names for trip-leg runtimes when only trip-stop data is available', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                tripEntries: [
                    {
                        tripId: 'north-1',
                        tripName: '12A 13:35',
                        routeId: '12A',
                        direction: 'N',
                        terminalDepartureTime: '13:35',
                        segments: [
                            { fromStopId: 'gm', toStopId: 'dt', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 16, timeBucket: '13:30' },
                            { fromStopId: 'dt', toStopId: 'pp', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 17, timeBucket: '13:30' },
                        ],
                    },
                    {
                        tripId: 'south-1',
                        tripName: '12B 14:05',
                        routeId: '12B',
                        direction: 'S',
                        terminalDepartureTime: '14:05',
                        segments: [
                            { fromStopId: 'pp', toStopId: 'dt', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 10, timeBucket: '14:00' },
                            { fromStopId: 'dt', toStopId: 'gm', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 12, timeBucket: '14:00' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown (3)', 'Park Place (3)'],
                South: ['Park Place', 'Downtown', 'Georgian Mall'],
            },
        });

        expect(result).toHaveLength(2);
        expect(result.find(item => item.detectedDirection === 'North')?.segments.map(segment => segment.segmentName)).toEqual([
            'Georgian Mall to Downtown (3)',
            'Downtown (3) to Park Place (3)',
        ]);
        expect(result.find(item => item.detectedDirection === 'South')?.segments.map(segment => segment.segmentName)).toEqual([
            'Park Place to Downtown',
            'Downtown to Georgian Mall',
        ]);
    });

    it('rolls full trip stop legs up to canonical timepoint segments before bucket coverage checks', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '7A': 'Route Seven A', '7B': 'Route Seven B' },
                stopEntries: [
                    {
                        routeId: '7A',
                        direction: 'N',
                        fromStopId: 'park',
                        toStopId: 'local1',
                        fromStopName: 'Park Place',
                        toStopName: 'Local 1',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 9,
                        segmentName: 'Park Place to Local 1',
                        observations: [{ timeBucket: '10:00', runtimeMinutes: 5 }],
                    },
                    {
                        routeId: '7A',
                        direction: 'N',
                        fromStopId: 'local1',
                        toStopId: 'peggy',
                        fromStopName: 'Local 1',
                        toStopName: 'Peggy Hill Community Centre',
                        fromRouteStopIndex: 9,
                        toRouteStopIndex: 56,
                        segmentName: 'Local 1 to Peggy Hill Community Centre',
                        observations: [{ timeBucket: '10:00', runtimeMinutes: 7 }],
                    },
                    {
                        routeId: '7A',
                        direction: 'N',
                        fromStopId: 'peggy',
                        toStopId: 'hub',
                        fromStopName: 'Peggy Hill Community Centre',
                        toStopName: 'Downtown Hub',
                        fromRouteStopIndex: 56,
                        toRouteStopIndex: 123,
                        segmentName: 'Peggy Hill Community Centre to Downtown Hub',
                        observations: [{ timeBucket: '10:00', runtimeMinutes: 18 }],
                    },
                    {
                        routeId: '7B',
                        direction: 'S',
                        fromStopId: 'hub',
                        toStopId: 'peggy',
                        fromStopName: 'Downtown Hub',
                        toStopName: 'Peggy Hill Community Centre',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 50,
                        segmentName: 'Downtown Hub to Peggy Hill Community Centre',
                        observations: [{ timeBucket: '10:30', runtimeMinutes: 17 }],
                    },
                    {
                        routeId: '7B',
                        direction: 'S',
                        fromStopId: 'peggy',
                        toStopId: 'park',
                        fromStopName: 'Peggy Hill Community Centre',
                        toStopName: 'Park Place',
                        fromRouteStopIndex: 50,
                        toRouteStopIndex: 99,
                        segmentName: 'Peggy Hill Community Centre to Park Place',
                        observations: [{ timeBucket: '10:30', runtimeMinutes: 14 }],
                    },
                ],
                tripEntries: [
                    {
                        tripId: 'north-1',
                        tripName: '7A 10:00',
                        routeId: '7A',
                        direction: 'N',
                        terminalDepartureTime: '10:00',
                        segments: [
                            { fromStopId: 'park', toStopId: 'local1', fromRouteStopIndex: 0, toRouteStopIndex: 9, runtimeMinutes: 5, timeBucket: '10:00' },
                            { fromStopId: 'local1', toStopId: 'peggy', fromRouteStopIndex: 9, toRouteStopIndex: 56, runtimeMinutes: 7, timeBucket: '10:00' },
                            { fromStopId: 'peggy', toStopId: 'hub', fromRouteStopIndex: 56, toRouteStopIndex: 123, runtimeMinutes: 18, timeBucket: '10:00' },
                        ],
                    },
                    {
                        tripId: 'south-1',
                        tripName: '7B 10:35',
                        routeId: '7B',
                        direction: 'S',
                        terminalDepartureTime: '10:35',
                        segments: [
                            { fromStopId: 'hub', toStopId: 'peggy', fromRouteStopIndex: 0, toRouteStopIndex: 50, runtimeMinutes: 17, timeBucket: '10:30' },
                            { fromStopId: 'peggy', toStopId: 'park', fromRouteStopIndex: 50, toRouteStopIndex: 99, runtimeMinutes: 14, timeBucket: '11:00' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '7',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Park Place', 'Peggy Hill Community Centre', 'Downtown Hub'],
                South: ['Downtown Hub', 'Peggy Hill Community Centre', 'Park Place'],
            },
            patternAnchorStops: {
                North: ['Park Place', 'Downtown Hub'],
                South: ['Downtown Hub', 'Park Place'],
            },
            fullPatternOnly: true,
        });

        expect(result.find(item => item.detectedDirection === 'North')?.segments.map(segment => segment.segmentName)).toEqual([
            'Park Place to Peggy Hill Community Centre',
            'Peggy Hill Community Centre to Downtown Hub',
        ]);
        expect(result.find(item => item.detectedDirection === 'South')?.segments.map(segment => segment.segmentName)).toEqual([
            'Downtown Hub to Peggy Hill Community Centre',
            'Peggy Hill Community Centre to Park Place',
        ]);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].timeBucket).toBe('10:00');
        expect(analysis[0].observedSegmentCount).toBe(4);
        expect(analysis[0].expectedSegmentCount).toBe(4);
    });

    it('builds South-start paired-cycle evidence independently across five complete days', () => {
        const summaries = Array.from({ length: 5 }, (_, index) => makeSummary({
            date: `2026-02-${String(index + 2).padStart(2, '0')}`,
            dayType: 'weekday',
            routeNames: { '7A': 'North', '7B': 'South' },
            tripEntries: [
                {
                    tripId: `south-${index}`,
                    tripName: '7B 05:00',
                    routeId: '7B',
                    direction: 'S',
                    terminalDepartureTime: '05:00',
                    segments: [{
                        fromStopId: 'b', toStopId: 'a', fromRouteStopIndex: 0, toRouteStopIndex: 1,
                        runtimeMinutes: 20, timeBucket: '05:00',
                    }],
                },
                {
                    tripId: `north-${index}`,
                    tripName: '7A 05:25',
                    routeId: '7A',
                    direction: 'N',
                    terminalDepartureTime: '05:25',
                    segments: [{
                        fromStopId: 'a', toStopId: 'b', fromRouteStopIndex: 0, toRouteStopIndex: 1,
                        runtimeMinutes: 22, timeBucket: '05:00',
                    }],
                },
            ],
        }));

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '7',
            dayType: 'weekday',
            canonicalDirectionStops: { North: ['A', 'B'], South: ['B', 'A'] },
            fullPatternOnly: true,
        });
        const southStartResults = result.filter(runtime => runtime.cycleStartDirection === 'South');

        expect(southStartResults).toHaveLength(2);
        expect(southStartResults.map(runtime => runtime.detectedDirection).sort()).toEqual(['North', 'South']);
        expect(southStartResults.every(runtime => runtime.allTimeBuckets.includes('05:00'))).toBe(true);
        expect(southStartResults[0].segments[0].timeBuckets['05:00'].n).toBe(5);
        expect(calculateTotalTripTimes(southStartResults)[0].contributingDays).toHaveLength(5);

        const fourDayResults = computeRuntimesFromPerformance(summaries.slice(0, 4), {
            routeId: '7',
            dayType: 'weekday',
            canonicalDirectionStops: { North: ['A', 'B'], South: ['B', 'A'] },
            fullPatternOnly: true,
        }).filter(runtime => runtime.cycleStartDirection === 'South');
        expect(calculateTotalTripTimes(fourDayResults)[0].evidence?.planningEligible).toBe(false);
    });

    it('keeps a canonical cycle stable when history adds a harmless raw stop variation', () => {
        const makeDay = (date: string, withExtraStop: boolean) => makeSummary({
            date, dayType: 'weekday', routeNames: { '12A': '12A', '12B': '12B' },
            stopEntries: [
                { routeId: '12A', direction: 'N', fromStopId: 'a', toStopId: 'b', fromStopName: 'A', toStopName: 'B', fromRouteStopIndex: 1, toRouteStopIndex: 2, segmentName: 'A to B', observations: [] },
                { routeId: '12A', direction: 'N', fromStopId: 'x', toStopId: 'b', fromStopName: 'Extra', toStopName: 'B', fromRouteStopIndex: 2, toRouteStopIndex: 3, segmentName: 'Extra to B', observations: [] },
                { routeId: '12B', direction: 'S', fromStopId: 'c', toStopId: 'd', fromStopName: 'C', toStopName: 'D', fromRouteStopIndex: 1, toRouteStopIndex: 2, segmentName: 'C to D', observations: [] },
            ],
            tripEntries: [
                {
                    tripId: `${date}-n`, tripName: '12A 10:25', routeId: '12A', direction: 'N', terminalDepartureTime: '10:25',
                    segments: withExtraStop
                        ? [
                            { fromStopId: 'a', toStopId: 'x', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 25, timeBucket: '10:00' },
                            { fromStopId: 'x', toStopId: 'b', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 30, timeBucket: '10:30' },
                        ]
                        : [{ fromStopId: 'a', toStopId: 'b', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 55, timeBucket: '10:00' }],
                },
                {
                    tripId: `${date}-s`, tripName: '12B 10:52', routeId: '12B', direction: 'S', terminalDepartureTime: '10:52',
                    segments: [{ fromStopId: 'c', toStopId: 'd', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 60.93, timeBucket: '10:30' }],
                },
            ],
        });
        const options = {
            routeId: '12', dayType: 'weekday' as const, fullPatternOnly: true,
            canonicalDirectionStops: { North: ['A', 'B'], South: ['C', 'D'] },
        };
        const day = makeDay('2026-04-01', true);
        const alone = calculateTotalTripTimes(computeRuntimesFromPerformance([day], options));
        const withHistory = calculateTotalTripTimes(computeRuntimesFromPerformance([day, makeDay('2026-04-02', false)], options));

        expect(alone.map(bucket => bucket.timeBucket)).toEqual(['10:00']);
        expect(alone[0].observedCycleP50).toBe(115.93);
        expect(withHistory.map(bucket => bucket.timeBucket)).toEqual(['10:00']);
        expect(withHistory[0].observedCycleP50).toBe(115.93);

        const northOnly = makeDay('2026-04-03', false);
        northOnly.tripStopSegmentRuntimes!.entries = northOnly.tripStopSegmentRuntimes!.entries.filter(entry => entry.routeId === '12A');
        expect(computeRuntimesFromPerformance([northOnly], options)).toEqual([]);
    });

    it('keeps Route 7 handoff segments on the outbound chain so Step 2 does not lose one return segment', () => {
        const canonicalDirectionStops = getUsableCanonicalDirectionStops('7', {
            North: ['Park Place', 'Peggy Hill Community Centre', 'Allandale GO Station', 'Downtown', 'Georgian College'],
            South: ['Rose Street', 'Downtown (3)', 'Allandale GO Station (3)', 'Peggy Hill Community Centre (3)', 'Park Place (2)'],
        });

        expect(canonicalDirectionStops).toEqual({
            North: ['Park Place', 'Peggy Hill Community Centre', 'Allandale GO Station', 'Downtown', 'Georgian College', 'Rose Street'],
            South: ['Rose Street', 'Downtown (3)', 'Allandale GO Station (3)', 'Peggy Hill Community Centre (3)', 'Park Place (2)'],
        });

        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '7A': 'Route Seven A', '7B': 'Route Seven B' },
                tripEntries: [
                    {
                        tripId: 'north-1',
                        tripName: '7A 15:00',
                        routeId: '7A',
                        direction: 'N',
                        terminalDepartureTime: '15:00',
                        segments: [
                            { fromStopId: 'park', toStopId: 'peggy', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 8, timeBucket: '15:00' },
                            { fromStopId: 'peggy', toStopId: 'allandale', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 7, timeBucket: '15:00' },
                            { fromStopId: 'allandale', toStopId: 'downtown', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 8, timeBucket: '15:00' },
                            { fromStopId: 'downtown', toStopId: 'georgian', fromRouteStopIndex: 4, toRouteStopIndex: 5, runtimeMinutes: 12, timeBucket: '15:00' },
                            { fromStopId: 'georgian', toStopId: 'rose', fromRouteStopIndex: 5, toRouteStopIndex: 6, runtimeMinutes: 4, timeBucket: '15:00' },
                        ],
                    },
                    {
                        tripId: 'south-1',
                        tripName: '7B 15:35',
                        routeId: '7B',
                        direction: 'S',
                        terminalDepartureTime: '15:35',
                        segments: [
                            { fromStopId: 'rose', toStopId: 'downtown3', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 10, timeBucket: '15:30' },
                            { fromStopId: 'downtown3', toStopId: 'allandale3', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 8, timeBucket: '15:30' },
                            { fromStopId: 'allandale3', toStopId: 'peggy3', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 7, timeBucket: '15:30' },
                            { fromStopId: 'peggy3', toStopId: 'park2', fromRouteStopIndex: 4, toRouteStopIndex: 5, runtimeMinutes: 9, timeBucket: '15:30' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '7',
            dayType: 'weekday',
            canonicalDirectionStops: canonicalDirectionStops!,
        });

        expect(result.find(item => item.detectedDirection === 'North')?.segments.map(segment => segment.segmentName)).toEqual([
            'Park Place to Peggy Hill Community Centre',
            'Peggy Hill Community Centre to Allandale GO Station',
            'Allandale GO Station to Downtown',
            'Downtown to Georgian College',
            'Georgian College to Rose Street',
        ]);
        expect(result.find(item => item.detectedDirection === 'South')?.segments.map(segment => segment.segmentName)).toEqual([
            'Rose Street to Downtown (3)',
            'Downtown (3) to Allandale GO Station (3)',
            'Allandale GO Station (3) to Peggy Hill Community Centre (3)',
            'Peggy Hill Community Centre (3) to Park Place (2)',
        ]);

        const canonicalColumns = buildCanonicalSegmentColumnsFromMasterStops(
            '7',
            canonicalDirectionStops!.North,
            canonicalDirectionStops!.South,
        );
        const canonicalLookup = buildNormalizedSegmentNameLookup(
            canonicalColumns.map(column => column.segmentName)
        );
        const analysis = calculateTotalTripTimes(result);
        const matchedSegments = new Set<string>();

        analysis[0].details.forEach(detail => {
            const resolved = resolveCanonicalSegmentName(detail.segmentName, canonicalLookup);
            if (resolved) matchedSegments.add(resolved);
        });

        expect(canonicalColumns.map(column => column.segmentName)).toEqual([
            'Park Place to Peggy Hill Community Centre',
            'Peggy Hill Community Centre to Allandale GO Station',
            'Allandale GO Station to Downtown',
            'Downtown to Georgian College',
            'Georgian College to Rose Street',
            'Rose Street to Downtown (3)',
            'Downtown (3) to Allandale GO Station (3)',
            'Allandale GO Station (3) to Peggy Hill Community Centre (3)',
            'Peggy Hill Community Centre (3) to Park Place (2)',
        ]);
        expect(analysis[0].observedSegmentCount).toBe(9);
        expect(analysis[0].expectedSegmentCount).toBe(9);
        expect(matchedSegments.size).toBe(9);
    });

    it('uses the Loop canonical direction for one-sided Route 10 master stop chains', () => {
        const canonicalDirectionStops = getUsableCanonicalDirectionStops('10', {
            North: ['Downtown', 'Georgian College', 'RVH', 'Downtown'],
            South: [],
        });

        expect(canonicalDirectionStops).toEqual({
            Loop: ['Downtown', 'Georgian College', 'RVH', 'Downtown'],
        });

        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '10': 'Route Ten' },
                tripEntries: [
                    {
                        tripId: 'loop-1',
                        tripName: '10 06:00',
                        routeId: '10',
                        direction: 'CW',
                        terminalDepartureTime: '06:00',
                        segments: [
                            { fromStopId: 'Downtown', toStopId: 'Georgian College', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 8, timeBucket: '06:00' },
                            { fromStopId: 'Georgian College', toStopId: 'RVH', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 7, timeBucket: '06:00' },
                            { fromStopId: 'RVH', toStopId: 'Downtown', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 9, timeBucket: '06:00' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '10',
            dayType: 'weekday',
            canonicalDirectionStops: canonicalDirectionStops!,
            patternAnchorStops: canonicalDirectionStops!,
            fullPatternOnly: true,
        });

        expect(result).toHaveLength(1);
        expect(result[0].detectedDirection).toBe('Loop');
        expect(result[0].segments.map(segment => segment.segmentName)).toEqual([
            'Downtown to Georgian College',
            'Georgian College to RVH',
            'RVH to Downtown',
        ]);

        const canonicalColumns = buildCanonicalSegmentColumnsFromMasterStops(
            '10',
            canonicalDirectionStops!.Loop,
            []
        );
        expect(canonicalColumns.map(column => column.direction)).toEqual(['Loop', 'Loop', 'Loop']);
        expect(canonicalColumns.map(column => column.groupLabel)).toEqual(['10', '10', '10']);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis[0].observedSegmentCount).toBe(3);
        expect(analysis[0].expectedSegmentCount).toBe(3);
    });

    it('keeps detour pattern runtimes separate and only uses them as fallback', () => {
        const detourSummary = makeSummary({
            date: '2026-01-06',
            dayType: 'weekday',
            routeNames: { '12A': 'Georgian Mall' },
            tripEntries: [
                {
                    tripId: 'detour-1',
                    tripName: '12A 06:00',
                    routeId: '12A',
                    direction: 'N',
                    patternKind: 'detour',
                    terminalDepartureTime: '06:00',
                    segments: [
                        { fromStopId: 'Georgian Mall', toStopId: 'Downtown', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 12, timeBucket: '06:00' },
                        { fromStopId: 'Downtown', toStopId: 'Barrie South GO', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 18, timeBucket: '06:00' },
                    ],
                },
            ],
        });

        const normalOnly = computeRuntimesFromPerformance([detourSummary], {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown', 'Barrie South GO'],
            },
            fullPatternOnly: true,
        });
        expect(normalOnly).toEqual([]);

        const detourFallback = computeRuntimesFromPerformance([detourSummary], {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown', 'Barrie South GO'],
            },
            fullPatternOnly: true,
            runtimePatternStrategy: 'detour-fallback',
        });

        expect(detourFallback).toHaveLength(1);
        expect(detourFallback[0].runtimePatternKind).toBe('detour');
        expect(detourFallback[0].runtimePatternSummary).toContain('normal-pattern evidence was unavailable');
        expect(detourFallback[0].segments.map(segment => segment.segmentName)).toEqual([
            'Georgian Mall to Downtown',
            'Downtown to Barrie South GO',
        ]);
        expect(calculateTotalTripTimes(detourFallback)[0].evidence).toMatchObject({
            planningEligible: false,
            exclusionReasons: expect.arrayContaining(['Detour evidence is troubleshooting-only']),
        });
    });

    it('prefers normal pattern runtimes when normal and detour evidence both exist', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall' },
                tripEntries: [
                    {
                        tripId: 'normal-1',
                        tripName: '12A 06:00',
                        routeId: '12A',
                        direction: 'N',
                        patternKind: 'normal',
                        terminalDepartureTime: '06:00',
                        segments: [
                            { fromStopId: 'Georgian Mall', toStopId: 'Downtown', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 10, timeBucket: '06:00' },
                            { fromStopId: 'Downtown', toStopId: 'Barrie South GO', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 20, timeBucket: '06:00' },
                        ],
                    },
                    {
                        tripId: 'detour-1',
                        tripName: '12A 06:30',
                        routeId: '12A',
                        direction: 'N',
                        patternKind: 'detour',
                        terminalDepartureTime: '06:30',
                        segments: [
                            { fromStopId: 'Georgian Mall', toStopId: 'Downtown', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 50, timeBucket: '06:30' },
                            { fromStopId: 'Downtown', toStopId: 'Barrie South GO', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 60, timeBucket: '06:30' },
                        ],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown', 'Barrie South GO'],
            },
            fullPatternOnly: true,
            runtimePatternStrategy: 'detour-fallback',
        });

        expect(result).toHaveLength(1);
        expect(result[0].runtimePatternKind).toBe('normal');
        expect(result[0].allTimeBuckets).toEqual(['06:00']);
        expect(result[0].segments[0].timeBuckets['06:00'].p50).toBe(10);
    });

    it('uses canonical stop names for stop-level runtimes before Step 2 coverage matching', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'gm',
                        toStopId: 'dt',
                        fromStopName: 'Georgian Mall North Entrance',
                        toStopName: 'Downtown Barrie Terminal',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Georgian Mall North Entrance to Downtown Barrie Terminal',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 16 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'dt',
                        toStopId: 'pp',
                        fromStopName: 'Downtown Barrie Terminal',
                        toStopName: 'Park Place',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Downtown Barrie Terminal to Park Place',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 17 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'pp',
                        toStopId: 'dt',
                        fromStopName: 'Park Place',
                        toStopName: 'Downtown Barrie Terminal',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Park Place to Downtown Barrie Terminal',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'dt',
                        toStopId: 'gm',
                        fromStopName: 'Downtown Barrie Terminal',
                        toStopName: 'Georgian Mall North Entrance',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Downtown Barrie Terminal to Georgian Mall North Entrance',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 12 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown (3)', 'Park Place (3)'],
                South: ['Park Place', 'Downtown (3)', 'Georgian Mall'],
            },
        });

        expect(result.find(item => item.detectedDirection === 'North')?.segments.map(segment => segment.segmentName)).toEqual([
            'Georgian Mall to Downtown (3)',
            'Downtown (3) to Park Place (3)',
        ]);
        expect(result.find(item => item.detectedDirection === 'South')?.segments.map(segment => segment.segmentName)).toEqual([
            'Park Place to Downtown (3)',
            'Downtown (3) to Georgian Mall',
        ]);

        const canonicalSegmentNames = [
            'Georgian Mall to Downtown (3)',
            'Downtown (3) to Park Place (3)',
            'Park Place to Downtown (3)',
            'Downtown (3) to Georgian Mall',
        ];
        const canonicalLookup = buildNormalizedSegmentNameLookup(canonicalSegmentNames);
        const analysis = calculateTotalTripTimes(result);
        const matchedSegments = new Set<string>();

        analysis[0].details.forEach(detail => {
            const resolved = resolveCanonicalSegmentName(detail.segmentName, canonicalLookup);
            if (resolved) matchedSegments.add(resolved);
        });

        expect(matchedSegments.size).toBe(4);
    });

    it('aggregates fine stop-level rows into canonical master-stop legs when trip legs are unavailable', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'gm',
                        toStopId: 'bs',
                        fromStopName: 'Georgian Mall North Entrance',
                        toStopName: 'Brock Street',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Georgian Mall North Entrance to Brock Street',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 6 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'bs',
                        toStopId: 'dt',
                        fromStopName: 'Brock Street',
                        toStopName: 'Downtown Barrie Terminal',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Brock Street to Downtown Barrie Terminal',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'dt',
                        toStopId: 'an',
                        fromStopName: 'Downtown Barrie Terminal',
                        toStopName: 'Anne Street',
                        fromRouteStopIndex: 3,
                        toRouteStopIndex: 4,
                        segmentName: 'Downtown Barrie Terminal to Anne Street',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 8 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'an',
                        toStopId: 'pp',
                        fromStopName: 'Anne Street',
                        toStopName: 'Park Place',
                        fromRouteStopIndex: 4,
                        toRouteStopIndex: 5,
                        segmentName: 'Anne Street to Park Place',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 9 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'pp',
                        toStopId: 'an',
                        fromStopName: 'Park Place',
                        toStopName: 'Anne Street',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Park Place to Anne Street',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 7 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'an',
                        toStopId: 'dt',
                        fromStopName: 'Anne Street',
                        toStopName: 'Downtown Barrie Terminal',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Anne Street to Downtown Barrie Terminal',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 9 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'dt',
                        toStopId: 'bs',
                        fromStopName: 'Downtown Barrie Terminal',
                        toStopName: 'Brock Street',
                        fromRouteStopIndex: 3,
                        toRouteStopIndex: 4,
                        segmentName: 'Downtown Barrie Terminal to Brock Street',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 6 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'bs',
                        toStopId: 'gm',
                        fromStopName: 'Brock Street',
                        toStopName: 'Georgian Mall North Entrance',
                        fromRouteStopIndex: 4,
                        toRouteStopIndex: 5,
                        segmentName: 'Brock Street to Georgian Mall North Entrance',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 8 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown (3)', 'Park Place (3)'],
                South: ['Park Place', 'Downtown (3)', 'Georgian Mall'],
            },
        });

        expect(result.find(item => item.detectedDirection === 'North')?.segments.map(segment => ({
            name: segment.segmentName,
            p50: segment.timeBuckets['13:30']?.p50,
        }))).toEqual([
            { name: 'Georgian Mall to Downtown (3)', p50: 16 },
            { name: 'Downtown (3) to Park Place (3)', p50: 17 },
        ]);

        expect(result.find(item => item.detectedDirection === 'South')?.segments.map(segment => ({
            name: segment.segmentName,
            p50: segment.timeBuckets['13:30']?.p50,
        }))).toEqual([
            { name: 'Park Place to Downtown (3)', p50: 16 },
            { name: 'Downtown (3) to Georgian Mall', p50: 14 },
        ]);
    });

    it('pairs stop-level-only canonical legs into complete cycle buckets when trip legs are unavailable', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'gm',
                        toStopId: 'dt',
                        fromStopName: 'Georgian Mall',
                        toStopName: 'Downtown (3)',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Georgian Mall to Downtown (3)',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 16 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'dt',
                        toStopId: 'pp',
                        fromStopName: 'Downtown (3)',
                        toStopName: 'Park Place (3)',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Downtown (3) to Park Place (3)',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 17 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'pp',
                        toStopId: 'dt',
                        fromStopName: 'Park Place',
                        toStopName: 'Downtown (3)',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Park Place to Downtown (3)',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 16 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'dt',
                        toStopId: 'gm',
                        fromStopName: 'Downtown (3)',
                        toStopName: 'Georgian Mall',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Downtown (3) to Georgian Mall',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 14 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown (3)', 'Park Place (3)'],
                South: ['Park Place', 'Downtown (3)', 'Georgian Mall'],
            },
        });

        expect(result).toHaveLength(2);
        expect(result.every(item => item.allTimeBuckets.includes('13:30'))).toBe(true);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].timeBucket).toBe('13:30');
        expect(analysis[0].observedSegmentCount).toBe(4);
        expect(analysis[0].expectedSegmentCount).toBe(4);
        expect(analysis[0].totalP50).toBe(63);

        const { buckets, bands } = calculateBands(analysis);
        expect(buckets[0].assignedBand).toBeUndefined();
        expect(buckets[0].evidence).toMatchObject({ qualifyingCount: 1, requiredCount: 5, planningEligible: false });
        expect(bands.find(band => band.id === 'A')?.count).toBe(0);
    });

    it('treats stop-level bucket windows as half-hour ranges when pairing stop-only cycles', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'gm',
                        toStopId: 'dt',
                        fromStopName: 'Georgian Mall',
                        toStopName: 'Downtown (3)',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Georgian Mall to Downtown (3)',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 28 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'dt',
                        toStopId: 'pp',
                        fromStopName: 'Downtown (3)',
                        toStopName: 'Park Place (3)',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Downtown (3) to Park Place (3)',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 27 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'pp',
                        toStopId: 'dt',
                        fromStopName: 'Park Place',
                        toStopName: 'Downtown (3)',
                        fromRouteStopIndex: 1,
                        toRouteStopIndex: 2,
                        segmentName: 'Park Place to Downtown (3)',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 30 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'dt',
                        toStopId: 'gm',
                        fromStopName: 'Downtown (3)',
                        toStopName: 'Georgian Mall',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 3,
                        segmentName: 'Downtown (3) to Georgian Mall',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 25 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Georgian Mall', 'Downtown (3)', 'Park Place (3)'],
                South: ['Park Place', 'Downtown (3)', 'Georgian Mall'],
            },
        });

        expect(result.find(item => item.detectedDirection === 'North')?.allTimeBuckets).toEqual(['13:30']);
        expect(result.find(item => item.detectedDirection === 'South')?.allTimeBuckets).toEqual(['13:30']);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].observedSegmentCount).toBe(4);
        expect(analysis[0].expectedSegmentCount).toBe(4);
        expect(analysis[0].totalP50).toBe(110);
    });

    it('rebuilds canonical segments from stop-level graphs even when route stop indexes skip and branch', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'dt',
                        toStopId: 'maple',
                        fromStopName: 'Downtown Hub',
                        toStopName: 'Maple at Ross',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 2,
                        segmentName: 'Downtown Hub to Maple at Ross',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 3 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'go',
                        toStopId: 'chef',
                        fromStopName: 'Barrie South GO Station',
                        toStopName: 'Mapleview at Chef',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 16,
                        segmentName: 'Barrie South GO Station to Mapleview at Chef',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'chef',
                        toStopId: 'bigbay',
                        fromStopName: 'Mapleview at Chef',
                        toStopName: 'Big Bay Point at Dodson',
                        fromRouteStopIndex: 16,
                        toRouteStopIndex: 46,
                        segmentName: 'Mapleview at Chef to Big Bay Point at Dodson',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 12 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'bigbay',
                        toStopId: 'park',
                        fromStopName: 'Big Bay Point at Dodson',
                        toStopName: 'Park Place',
                        fromRouteStopIndex: 46,
                        toRouteStopIndex: 80,
                        segmentName: 'Big Bay Point at Dodson to Park Place',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 9 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'park',
                        toStopId: 'allandale',
                        fromStopName: 'Park Place',
                        toStopName: 'Barrie Allandale Transit Terminal Platform 13',
                        fromRouteStopIndex: 80,
                        toRouteStopIndex: 110,
                        segmentName: 'Park Place to Barrie Allandale Transit Terminal Platform 13',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 8 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'allandale',
                        toStopId: 'dt',
                        fromStopName: 'Barrie Allandale Transit Terminal Platform 13',
                        toStopName: 'Downtown Hub',
                        fromRouteStopIndex: 110,
                        toRouteStopIndex: 135,
                        segmentName: 'Barrie Allandale Transit Terminal Platform 13 to Downtown Hub',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 7 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'maple',
                        toStopId: 'gm',
                        fromStopName: 'Maple at Ross',
                        toStopName: 'Georgian Mall',
                        fromRouteStopIndex: 2,
                        toRouteStopIndex: 21,
                        segmentName: 'Maple at Ross to Georgian Mall',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 11 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'gm',
                        toStopId: 'dt',
                        fromStopName: 'Georgian Mall',
                        toStopName: 'Downtown Hub',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 30,
                        segmentName: 'Georgian Mall to Downtown Hub',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 13 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'dt',
                        toStopId: 'essa',
                        fromStopName: 'Downtown Hub',
                        toStopName: 'Essa at Gowan',
                        fromRouteStopIndex: 30,
                        toRouteStopIndex: 56,
                        segmentName: 'Downtown Hub to Essa at Gowan',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 7 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'essa',
                        toStopId: 'park',
                        fromStopName: 'Essa at Gowan',
                        toStopName: 'Park Place',
                        fromRouteStopIndex: 56,
                        toRouteStopIndex: 105,
                        segmentName: 'Essa at Gowan to Park Place',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 9 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'park',
                        toStopId: 'ashford',
                        fromStopName: 'Park Place',
                        toStopName: 'Ashford Drive',
                        fromRouteStopIndex: 105,
                        toRouteStopIndex: 154,
                        segmentName: 'Park Place to Ashford Drive',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 8 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'ashford',
                        toStopId: 'go',
                        fromStopName: 'Ashford Drive',
                        toStopName: 'Barrie South GO Station',
                        fromRouteStopIndex: 154,
                        toRouteStopIndex: 199,
                        segmentName: 'Ashford Drive to Barrie South GO Station',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 10 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: [
                    'Barrie South GO Station',
                    'Big Bay Point at Dodson',
                    'Park Place',
                    'Barrie Allandale Transit Terminal Platform 13',
                    'Downtown Hub',
                    'Georgian Mall',
                ],
                South: [
                    'Georgian Mall',
                    'Downtown Hub',
                    'Essa at Gowan',
                    'Park Place',
                    'Ashford Drive',
                    'Barrie South GO Station',
                ],
            },
        });

        expect(result.find(item => item.detectedDirection === 'North')?.segments.map(segment => segment.segmentName)).toEqual([
            'Barrie South GO Station to Big Bay Point at Dodson',
            'Big Bay Point at Dodson to Park Place',
            'Park Place to Barrie Allandale Transit Terminal Platform 13',
            'Barrie Allandale Transit Terminal Platform 13 to Downtown Hub',
            'Downtown Hub to Georgian Mall',
        ]);
        expect(result.find(item => item.detectedDirection === 'South')?.segments.map(segment => segment.segmentName)).toEqual([
            'Georgian Mall to Downtown Hub',
            'Downtown Hub to Essa at Gowan',
            'Essa at Gowan to Park Place',
            'Park Place to Ashford Drive',
            'Ashford Drive to Barrie South GO Station',
        ]);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis).toHaveLength(2);
        expect(analysis.map(bucket => bucket.timeBucket)).toEqual(['13:30', '14:00']);
        expect(Math.max(...analysis.map(bucket => bucket.observedSegmentCount || 0))).toBe(5);
        expect(analysis.every(bucket => bucket.expectedSegmentCount === 10)).toBe(true);
    });

    it('reconstructs stop-only trip candidates by walking later segment buckets within the same direction', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                stopEntries: [
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'go',
                        toStopId: 'mid1',
                        fromStopName: 'Barrie South GO Station',
                        toStopName: 'Middle 1',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 10,
                        segmentName: 'Barrie South GO Station to Middle 1',
                        observations: [{ timeBucket: '13:30', runtimeMinutes: 20 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'mid1',
                        toStopId: 'park',
                        fromStopName: 'Middle 1',
                        toStopName: 'Park Place',
                        fromRouteStopIndex: 10,
                        toRouteStopIndex: 20,
                        segmentName: 'Middle 1 to Park Place',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 15 }],
                    },
                    {
                        routeId: '12A',
                        direction: 'N',
                        fromStopId: 'park',
                        toStopId: 'gm',
                        fromStopName: 'Park Place',
                        toStopName: 'Georgian Mall',
                        fromRouteStopIndex: 20,
                        toRouteStopIndex: 30,
                        segmentName: 'Park Place to Georgian Mall',
                        observations: [{ timeBucket: '14:30', runtimeMinutes: 10 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'gm',
                        toStopId: 'mid2',
                        fromStopName: 'Georgian Mall',
                        toStopName: 'Middle 2',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 10,
                        segmentName: 'Georgian Mall to Middle 2',
                        observations: [{ timeBucket: '14:00', runtimeMinutes: 18 }],
                    },
                    {
                        routeId: '12B',
                        direction: 'S',
                        fromStopId: 'mid2',
                        toStopId: 'go',
                        fromStopName: 'Middle 2',
                        toStopName: 'Barrie South GO Station',
                        fromRouteStopIndex: 10,
                        toRouteStopIndex: 20,
                        segmentName: 'Middle 2 to Barrie South GO Station',
                        observations: [{ timeBucket: '14:30', runtimeMinutes: 12 }],
                    },
                ],
            }),
        ];

        const result = computeRuntimesFromPerformance(summaries, {
            routeId: '12',
            dayType: 'weekday',
            canonicalDirectionStops: {
                North: ['Barrie South GO Station', 'Park Place', 'Georgian Mall'],
                South: ['Georgian Mall', 'Barrie South GO Station'],
            },
        });

        expect(result.find(item => item.detectedDirection === 'North')?.allTimeBuckets).toEqual(['13:30']);
        expect(result.find(item => item.detectedDirection === 'South')?.allTimeBuckets).toEqual(['13:30']);

        const analysis = calculateTotalTripTimes(result);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].timeBucket).toBe('13:30');
        expect(analysis[0].observedSegmentCount).toBe(3);
        expect(analysis[0].expectedSegmentCount).toBe(3);
        expect(analysis[0].totalP50).toBe(75);
    });

    it('diagnoses the Route 12 0/10 mismatch when only coarse route-level segment labels are available', () => {
        const canonicalSegmentNames = [
            'Georgian Mall to Downtown (3)',
            'Downtown (3) to Park Place (3)',
            'Park Place (3) to Ashford Drive',
            'Ashford Drive to Allandale GO (3)',
            'Allandale GO (3) to Barrie South GO (2)',
            'Barrie South GO (2) to Allandale GO (3)',
            'Allandale GO (3) to Ashford Drive',
            'Ashford Drive to Park Place (3)',
            'Park Place (3) to Downtown (3)',
            'Downtown (3) to Georgian Mall',
        ];
        const canonicalLookup = buildNormalizedSegmentNameLookup(canonicalSegmentNames);

        const runtimeData = [{
            detectedRouteNumber: '12',
            detectedDirection: 'North' as const,
            allTimeBuckets: ['13:30'],
            segments: [
                {
                    segmentName: 'Georgian Mall to Barrie South GO (2)',
                    timeBuckets: {
                        '13:30': { p50: 55, p80: 60, n: 4 },
                    },
                },
                {
                    segmentName: 'Barrie South GO (2) to Georgian Mall',
                    timeBuckets: {
                        '13:30': { p50: 58, p80: 62, n: 4 },
                    },
                },
            ],
        }];

        const analysis = calculateTotalTripTimes(runtimeData);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].totalP50).toBe(113);

        const matchedSegments = new Set<string>();
        analysis[0].details.forEach(detail => {
            const resolved = resolveCanonicalSegmentName(detail.segmentName, canonicalLookup);
            if (resolved) matchedSegments.add(resolved);
        });

        expect(matchedSegments.size).toBe(0);
        expect(canonicalSegmentNames).toHaveLength(10);
        expect(analysis[0].details).toHaveLength(2);
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
        expect(routes[0].segmentDayCount).toBe(2);
        expect(routes[0].stopLevelDayCount).toBe(0);
        expect(routes[0].totalObs).toBe(3);
        expect(routes[0].memberRouteIds).toEqual(['10']);
    });

    it('reports stop-level coverage days separately from coarse segment days', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                entries: [{
                    routeId: '12A',
                    direction: 'N',
                    segmentName: 'Georgian Mall to Barrie South GO (2)',
                    observations: [{ timeBucket: '13:30', runtimeMinutes: 55 }],
                }],
                stopEntries: [{
                    routeId: '12A',
                    direction: 'N',
                    fromStopId: 'gm',
                    toStopId: 'dt',
                    fromStopName: 'Georgian Mall',
                    toStopName: 'Downtown (3)',
                    fromRouteStopIndex: 1,
                    toRouteStopIndex: 2,
                    segmentName: 'Georgian Mall to Downtown (3)',
                    observations: [{ timeBucket: '13:30', runtimeMinutes: 16 }],
                }],
            }),
            makeSummary({
                date: '2026-01-07',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall' },
                entries: [{
                    routeId: '12A',
                    direction: 'N',
                    segmentName: 'Georgian Mall to Barrie South GO (2)',
                    observations: [{ timeBucket: '13:30', runtimeMinutes: 56 }],
                }],
            }),
        ];

        const routes = getAvailableRuntimeRoutes(summaries, 'weekday');
        expect(routes).toHaveLength(1);
        expect(routes[0].routeId).toBe('12');
        expect(routes[0].segmentDayCount).toBe(2);
        expect(routes[0].stopLevelDayCount).toBe(1);
    });

    it('infers North/South route directions from Route 7 trip names when raw trip directions are blank', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '7': 'Route Seven' },
                tripEntries: [
                    {
                        tripId: 'north-1',
                        tripName: '7A - 15:00',
                        routeId: '7',
                        direction: '',
                        terminalDepartureTime: '15:00',
                        segments: [
                            { fromStopId: 'a', toStopId: 'b', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 50, timeBucket: '15:00' },
                        ],
                    },
                    {
                        tripId: 'south-1',
                        tripName: '7B - 15:35',
                        routeId: '7',
                        direction: '',
                        terminalDepartureTime: '15:35',
                        segments: [
                            { fromStopId: 'b', toStopId: 'a', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 48, timeBucket: '15:30' },
                        ],
                    },
                ],
            }),
        ];

        const routes = getAvailableRuntimeRoutes(summaries, 'weekday');

        expect(routes).toHaveLength(1);
        expect(routes[0].routeId).toBe('7');
        expect(routes[0].directions).toEqual(['North', 'South']);
    });

    it('respects the selected date range when listing available routes', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                stopEntries: [{
                    routeId: '12A',
                    direction: 'N',
                    fromStopId: 'gm',
                    toStopId: 'dt',
                    fromStopName: 'Georgian Mall',
                    toStopName: 'Downtown',
                    fromRouteStopIndex: 1,
                    toRouteStopIndex: 2,
                    segmentName: 'Georgian Mall to Downtown',
                    observations: [{ timeBucket: '13:30', runtimeMinutes: 16 }],
                }],
            }),
            makeSummary({
                date: '2026-01-13',
                dayType: 'weekday',
                routeNames: { '8A': 'RVH / Yonge' },
                stopEntries: [{
                    routeId: '8A',
                    direction: 'N',
                    fromStopId: 'a',
                    toStopId: 'b',
                    fromStopName: 'Stop A',
                    toStopName: 'Stop B',
                    fromRouteStopIndex: 1,
                    toRouteStopIndex: 2,
                    segmentName: 'Stop A to Stop B',
                    observations: [{ timeBucket: '13:30', runtimeMinutes: 12 }],
                }],
            }),
        ];

        const onlyLaterWeek = getAvailableRuntimeRoutes(summaries, 'weekday', {
            start: '2026-01-10',
            end: '2026-01-15',
        });
        expect(onlyLaterWeek.map(route => route.routeId)).toEqual(['8A']);

        const onlyEarlierWeek = getAvailableRuntimeRoutes(summaries, 'weekday', {
            start: '2026-01-01',
            end: '2026-01-09',
        });
        expect(onlyEarlierWeek.map(route => route.routeId)).toEqual(['12']);
        expect(onlyEarlierWeek[0].stopLevelDayCount).toBe(1);
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

describe('performanceRuntimeComputer.inspectPerformanceRuntimeAvailability', () => {
    it('derives a clean-history cutoff from the current-schema tail', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-03-20',
                dayType: 'weekday',
                schemaVersion: 7,
                routeNames: { '2A': 'Route 2A' },
            }),
            makeSummary({
                date: '2026-03-21',
                dayType: 'weekday',
                schemaVersion: 7,
                routeNames: { '2A': 'Route 2A' },
            }),
            makeSummary({
                date: '2026-03-22',
                dayType: 'weekday',
                schemaVersion: PERFORMANCE_SCHEMA_VERSION,
                routeNames: { '2A': 'Route 2A' },
            }),
            makeSummary({
                date: '2026-03-23',
                dayType: 'weekday',
                schemaVersion: PERFORMANCE_SCHEMA_VERSION,
                routeNames: { '2A': 'Route 2A' },
            }),
        ];

        const cleanWindow = getStep2CleanHistoryWindow(summaries, {
            runtimeLogicVersion: PERFORMANCE_RUNTIME_LOGIC_VERSION,
        });

        expect(cleanWindow.cleanHistoryStartDate).toBe('2026-03-22');
        expect(cleanWindow.excludedLegacyDayCount).toBe(2);
        expect(cleanWindow.dailySummaries.map(day => day.date)).toEqual(['2026-03-22', '2026-03-23']);
        expect(cleanWindow.usesCleanHistoryCutoff).toBe(true);
    });

    it('reports route availability counts for the selected day type and date range', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-01-06',
                dayType: 'weekday',
                routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
                entries: [{
                    routeId: '12A',
                    direction: 'N',
                    segmentName: 'A to B',
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 10 }],
                }],
                stopEntries: [{
                    routeId: '12B',
                    direction: 'S',
                    fromStopId: 'b',
                    toStopId: 'a',
                    fromStopName: 'B',
                    toStopName: 'A',
                    fromRouteStopIndex: 1,
                    toRouteStopIndex: 2,
                    segmentName: 'B to A',
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 12 }],
                }],
            }),
            makeSummary({
                date: '2026-01-13',
                dayType: 'weekday',
                routeNames: { '8A': 'Route Eight' },
                entries: [{
                    routeId: '8A',
                    direction: 'N',
                    segmentName: 'X to Y',
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 8 }],
                }],
            }),
        ];

        const diagnostics = inspectPerformanceRuntimeAvailability(summaries, {
            routeId: '12',
            dayType: 'weekday',
            dateRange: { start: '2026-01-01', end: '2026-01-09' },
            metadata: {
                importedAt: '2026-03-24T12:00:00.000Z',
                runtimeLogicVersion: PERFORMANCE_RUNTIME_LOGIC_VERSION,
            },
        });

        expect(diagnostics.filteredDayCount).toBe(1);
        expect(diagnostics.matchedRouteDayCount).toBe(1);
        expect(diagnostics.coarseEntryCount).toBe(1);
        expect(diagnostics.stopEntryCount).toBe(1);
        expect(diagnostics.tripEntryCount).toBe(0);
        expect(diagnostics.matchedRouteIds).toEqual(['12A', '12B']);
        expect(diagnostics.directions).toEqual(['North', 'South']);
        expect(diagnostics.importedAt).toBe('2026-03-24T12:00:00.000Z');
        expect(diagnostics.runtimeLogicVersion).toBe(PERFORMANCE_RUNTIME_LOGIC_VERSION);
        expect(diagnostics.usesLegacyRuntimeLogic).toBe(false);
        expect(diagnostics.isCurrentRuntimeLogic).toBe(true);
        expect(diagnostics.excludedLegacyDayCount).toBe(0);
        expect(diagnostics.cleanHistoryStartDate).toBe('2026-01-06');
    });

    it('treats missing runtime logic metadata as legacy performance data', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-03-20',
                dayType: 'weekday',
                routeNames: { '2A': 'Route 2A' },
                stopEntries: [{
                    routeId: '2A',
                    direction: 'N',
                    fromStopId: 'park',
                    toStopId: 'essa',
                    fromStopName: 'Park Place',
                    toStopName: "Veteran's at Essa",
                    fromRouteStopIndex: 0,
                    toRouteStopIndex: 1,
                    segmentName: "Park Place to Veteran's at Essa",
                    observations: [{ timeBucket: '06:30', runtimeMinutes: 5 }],
                }],
            }),
        ];

        const diagnostics = inspectPerformanceRuntimeAvailability(summaries, {
            routeId: '2',
            dayType: 'weekday',
            metadata: {
                importedAt: '2026-03-24T12:00:00.000Z',
            },
        });

        expect(diagnostics.filteredDayCount).toBe(0);
        expect(diagnostics.matchedRouteDayCount).toBe(0);
        expect(diagnostics.runtimeLogicVersion).toBeUndefined();
        expect(diagnostics.isCurrentRuntimeLogic).toBe(false);
        expect(diagnostics.usesLegacyRuntimeLogic).toBe(true);
        expect(diagnostics.excludedLegacyDayCount).toBe(1);
    });

    it('ignores older days before the clean-history cutoff when inspecting Step 2 availability', () => {
        const summaries: DailySummary[] = [
            makeSummary({
                date: '2026-03-20',
                dayType: 'weekday',
                schemaVersion: 7,
                routeNames: { '2A': 'Route 2A' },
                stopEntries: [{
                    routeId: '2A',
                    direction: 'N',
                    fromStopId: 'legacy-a',
                    toStopId: 'legacy-b',
                    fromStopName: 'Legacy A',
                    toStopName: 'Legacy B',
                    fromRouteStopIndex: 1,
                    toRouteStopIndex: 2,
                    segmentName: 'Legacy A to Legacy B',
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 10 }],
                }],
            }),
            makeSummary({
                date: '2026-03-22',
                dayType: 'weekday',
                schemaVersion: PERFORMANCE_SCHEMA_VERSION,
                routeNames: { '2A': 'Route 2A' },
                stopEntries: [{
                    routeId: '2A',
                    direction: 'N',
                    fromStopId: 'clean-a',
                    toStopId: 'clean-b',
                    fromStopName: 'Clean A',
                    toStopName: 'Clean B',
                    fromRouteStopIndex: 1,
                    toRouteStopIndex: 2,
                    segmentName: 'Clean A to Clean B',
                    observations: [{ timeBucket: '06:00', runtimeMinutes: 12 }],
                }],
            }),
        ];

        const diagnostics = inspectPerformanceRuntimeAvailability(summaries, {
            routeId: '2',
            dayType: 'weekday',
            metadata: {
                importedAt: '2026-03-30T12:00:00.000Z',
                runtimeLogicVersion: PERFORMANCE_RUNTIME_LOGIC_VERSION,
            },
        });

        expect(diagnostics.filteredDayCount).toBe(1);
        expect(diagnostics.matchedRouteDayCount).toBe(1);
        expect(diagnostics.stopEntryCount).toBe(1);
        expect(diagnostics.cleanHistoryStartDate).toBe('2026-03-22');
        expect(diagnostics.excludedLegacyDayCount).toBe(1);
        expect(diagnostics.usesCleanHistoryCutoff).toBe(true);
    });
});
