import { describe, expect, it } from 'vitest';
import type { DailySummary } from '../utils/performanceDataTypes';
import {
    buildCorridorSpeedMapIndex,
    buildCorridorSpeedIndexFromData,
    buildCorridorSpeedIndexFromTraversalData,
    buildCorridorSpeedMapIndexFromData,
    calculateCorridorLengthMeters,
    getStatsForPeriod,
    normalizeStopName,
    resolveGtfsDirectionLabel,
    resolveObservedDirectionLabel,
    scopeStatsToRoute,
    type CorridorTraversalSample,
    type CorridorSpeedSegment,
    type ScheduledStopSegmentSample,
} from '../utils/gtfs/corridorSpeed';
import type { CorridorSegment as GtfsCorridorSegment } from '../utils/gtfs/corridorBuilder';

function makeDailySummary(overrides: Partial<DailySummary>): DailySummary {
    return {
        date: '2026-03-10',
        dayType: 'weekday',
        system: {
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
            totalRidership: 0,
            totalBoardings: 0,
            totalAlightings: 0,
            vehicleCount: 0,
            tripCount: 0,
            wheelchairTrips: 0,
            avgSystemLoad: 0,
            peakLoad: 0,
        },
        byRoute: [],
        byHour: [],
        byStop: [],
        byTrip: [],
        loadProfiles: [],
        dataQuality: {
            totalRecords: 0,
            inBetweenFiltered: 0,
            missingAVL: 0,
            missingAPC: 0,
            detourRecords: 0,
            tripperRecords: 0,
            loadCapped: 0,
            apcExcludedFromLoad: 0,
        },
        schemaVersion: 6,
        ...overrides,
    };
}

describe('corridorSpeed helpers', () => {
    it('normalizes stop names consistently', () => {
        expect(normalizeStopName("Veteran's & Essa")).toBe('VETERAN S AND ESSA');
    });

    it('calculates segment length from geometry', () => {
        const length = calculateCorridorLengthMeters([
            [44.38, -79.69],
            [44.381, -79.685],
        ]);

        expect(length).toBeGreaterThan(0);
    });

    it('resolves GTFS directions from route variants and headsigns', () => {
        expect(resolveGtfsDirectionLabel('12A', 'Barrie South GO to Georgian Mall', '0')).toBe('North');
        expect(resolveGtfsDirectionLabel('8A', 'RVH/YONGE to Park Place', '1')).toBe('South');
        expect(resolveGtfsDirectionLabel('100', 'Red Express to Downtown Barrie Terminal', '0')).toBe('Clockwise');
    });

    it('resolves observed STREETS directions', () => {
        expect(resolveObservedDirectionLabel('8A', 'S')).toBe('South');
        expect(resolveObservedDirectionLabel('100', 'CW')).toBe('Clockwise');
        expect(resolveObservedDirectionLabel('12A', '')).toBe('North');
    });
});

describe('buildCorridorSpeedIndexFromTraversalData', () => {
    const corridorSegment: CorridorSpeedSegment = {
        id: 'corridor|South',
        fromStopId: 'stop-a',
        toStopId: 'stop-c',
        fromStopName: 'Stop A',
        toStopName: 'Stop C',
        directionId: 'South',
        routes: ['8A', '8B'],
        geometry: [
            [44.38, -79.69],
            [44.382, -79.68],
        ],
        lengthMeters: 1000,
        stopIds: ['stop-a', 'stop-b', 'stop-c'],
    };

    it('uses true corridor traversals instead of synthetic summed stop-pair medians', () => {
        const scheduledSamples: CorridorTraversalSample[] = [
            {
                segmentId: corridorSegment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 10,
            },
            {
                segmentId: corridorSegment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 450,
                runtimeMinutes: 12,
            },
        ];

        const observedSamples: CorridorTraversalSample[] = [
            {
                segmentId: corridorSegment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 9,
            },
            {
                segmentId: corridorSegment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 450,
                runtimeMinutes: 11,
            },
        ];

        const index = buildCorridorSpeedIndexFromTraversalData([corridorSegment], scheduledSamples, observedSamples);
        const stats = getStatsForPeriod(index, 'weekday', 'am-peak').get(corridorSegment.id);

        expect(stats?.scheduledRuntimeMin).toBe(11);
        expect(stats?.observedRuntimeMin).toBe(10);
        expect(stats?.sampleCount).toBe(2);
        expect(stats?.runtimeDeltaMin).toBe(-1);
        expect(stats?.scheduledSpeedKmh).toBe(5.5);
        expect(stats?.observedSpeedKmh).toBe(6);
    });

    it('keeps shared-route corridor traversals route-specific in the breakdown while combining the corridor headline', () => {
        const scheduledSamples: CorridorTraversalSample[] = [
            {
                segmentId: corridorSegment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 10,
            },
            {
                segmentId: corridorSegment.id,
                route: '8B',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 14,
            },
        ];

        const observedSamples: CorridorTraversalSample[] = [
            {
                segmentId: corridorSegment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 8,
            },
            {
                segmentId: corridorSegment.id,
                route: '8B',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 16,
            },
        ];

        const index = buildCorridorSpeedIndexFromTraversalData([corridorSegment], scheduledSamples, observedSamples);
        const stats = getStatsForPeriod(index, 'weekday', 'am-peak').get(corridorSegment.id);

        expect(stats?.sampleCount).toBe(2);
        expect(stats?.observedRuntimeMin).toBe(12);
        expect(stats?.routeBreakdown).toMatchObject([
            {
                route: '8A',
                sampleCount: 1,
                scheduledRuntimeMin: 10,
                observedRuntimeMin: 8,
                runtimeDeltaMin: -2,
                scheduledSpeedKmh: 6,
                observedSpeedKmh: 7.5,
            },
            {
                route: '8B',
                sampleCount: 1,
                scheduledRuntimeMin: 14,
                observedRuntimeMin: 16,
                runtimeDeltaMin: 2,
                scheduledSpeedKmh: 4.3,
                observedSpeedKmh: 3.8,
            },
        ]);
    });

    it('scopes shared-corridor stats down to a selected route', () => {
        const scheduledSamples: CorridorTraversalSample[] = [
            {
                segmentId: corridorSegment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 10,
            },
            {
                segmentId: corridorSegment.id,
                route: '8B',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 14,
            },
        ];

        const observedSamples: CorridorTraversalSample[] = [
            {
                segmentId: corridorSegment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 8,
            },
            {
                segmentId: corridorSegment.id,
                route: '8B',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 420,
                runtimeMinutes: 16,
            },
        ];

        const index = buildCorridorSpeedIndexFromTraversalData([corridorSegment], scheduledSamples, observedSamples);
        const stats = getStatsForPeriod(index, 'weekday', 'am-peak').get(corridorSegment.id) ?? null;
        const routeScoped = scopeStatsToRoute(stats, '8A');

        expect(routeScoped?.sampleCount).toBe(1);
        expect(routeScoped?.scheduledRuntimeMin).toBe(10);
        expect(routeScoped?.observedRuntimeMin).toBe(8);
        expect(routeScoped?.runtimeDeltaMin).toBe(-2);
        expect(routeScoped?.scheduledSpeedKmh).toBe(6);
        expect(routeScoped?.observedSpeedKmh).toBe(7.5);
        expect(routeScoped?.routeBreakdown).toHaveLength(1);
        expect(routeScoped?.routeBreakdown[0]?.route).toBe('8A');
    });
});

describe('buildCorridorSpeedIndexFromData', () => {
    const segment: CorridorSpeedSegment = {
        id: 'South|stop-a|stop-b',
        fromStopId: 'stop-a',
        toStopId: 'stop-b',
        fromStopName: 'Stop A',
        toStopName: 'Stop B',
        directionId: 'South',
        routes: ['8A'],
        geometry: [
            [44.38, -79.69],
            [44.381, -79.685],
        ],
        lengthMeters: 450,
    };

    it('builds scheduled and observed stop-segment stats from exact stop ids', () => {
        const scheduledSamples: ScheduledStopSegmentSample[] = [
            {
                segmentId: segment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 450,
                runtimeMinutes: 5,
            },
            {
                segmentId: segment.id,
                route: '8A',
                dayType: 'weekday',
                directionId: 'South',
                departureMinutes: 455,
                runtimeMinutes: 6,
            },
        ];

        const dailySummaries: DailySummary[] = [
            makeDailySummary({
                stopSegmentRuntimes: {
                    entries: [{
                        routeId: '8A',
                        direction: 'S',
                        fromStopId: 'stop-a',
                        toStopId: 'stop-b',
                        fromStopName: 'Stop A',
                        toStopName: 'Stop B',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 1,
                        segmentName: 'Stop A to Stop B',
                        observations: [
                            { timeBucket: '07:00', runtimeMinutes: 4 },
                            { timeBucket: '07:00', runtimeMinutes: 5 },
                        ],
                    }],
                    totalObservations: 2,
                    tripsWithData: 1,
                },
            }),
        ];

        const index = buildCorridorSpeedIndexFromData([segment], scheduledSamples, dailySummaries);
        const stats = getStatsForPeriod(index, 'weekday', 'am-peak').get(segment.id);

        expect(stats).toBeDefined();
        expect(stats?.directionId).toBe('South');
        expect(stats?.scheduledRuntimeMin).toBe(5.5);
        expect(stats?.observedRuntimeMin).toBe(4.5);
        expect(stats?.runtimeDeltaMin).toBe(-1);
        expect(stats?.sampleCount).toBe(2);
        expect(stats?.routeBreakdown[0]).toMatchObject({
            route: '8A',
            sampleCount: 2,
            scheduledRuntimeMin: 5.5,
            observedRuntimeMin: 4.5,
        });
    });

    it('withholds observed runtime when stop ids do not match the GTFS segment', () => {
        const scheduledSamples: ScheduledStopSegmentSample[] = [{
            segmentId: segment.id,
            route: '8A',
            dayType: 'weekday',
            directionId: 'South',
            departureMinutes: 450,
            runtimeMinutes: 5,
        }];

        const dailySummaries: DailySummary[] = [
            makeDailySummary({
                stopSegmentRuntimes: {
                    entries: [{
                        routeId: '8A',
                        direction: 'S',
                        fromStopId: 'wrong-a',
                        toStopId: 'wrong-b',
                        fromStopName: 'Wrong A',
                        toStopName: 'Wrong B',
                        fromRouteStopIndex: 0,
                        toRouteStopIndex: 1,
                        segmentName: 'Wrong A to Wrong B',
                        observations: [{ timeBucket: '07:00', runtimeMinutes: 4 }],
                    }],
                    totalObservations: 1,
                    tripsWithData: 1,
                },
            }),
        ];

        const index = buildCorridorSpeedIndexFromData([segment], scheduledSamples, dailySummaries);
        const stats = getStatsForPeriod(index, 'weekday', 'am-peak').get(segment.id);

        expect(stats?.scheduledRuntimeMin).toBe(5);
        expect(stats?.observedRuntimeMin).toBeNull();
        expect(stats?.sampleCount).toBe(0);
    });

    it('filters by direction when requested', () => {
        const scheduledSamples: ScheduledStopSegmentSample[] = [{
            segmentId: segment.id,
            route: '8A',
            dayType: 'weekday',
            directionId: 'South',
            departureMinutes: 450,
            runtimeMinutes: 5,
        }];

        const index = buildCorridorSpeedIndexFromData([segment], scheduledSamples, []);

        expect(getStatsForPeriod(index, 'weekday', 'am-peak', 'South').has(segment.id)).toBe(true);
        expect(getStatsForPeriod(index, 'weekday', 'am-peak', 'North').has(segment.id)).toBe(false);
    });
});

describe('buildCorridorSpeedMapIndexFromData', () => {
    it('aggregates adjacent stop-pair stats into a merged corridor segment', () => {
        const rawSegments: CorridorSpeedSegment[] = [
            {
                id: 'North|stop-a|stop-b',
                fromStopId: 'stop-a',
                toStopId: 'stop-b',
                fromStopName: 'Stop A',
                toStopName: 'Stop B',
                directionId: 'North',
                routes: ['8A'],
                geometry: [
                    [44.38, -79.69],
                    [44.381, -79.685],
                ],
                lengthMeters: 450,
            },
            {
                id: 'North|stop-b|stop-c',
                fromStopId: 'stop-b',
                toStopId: 'stop-c',
                fromStopName: 'Stop B',
                toStopName: 'Stop C',
                directionId: 'North',
                routes: ['8A'],
                geometry: [
                    [44.381, -79.685],
                    [44.382, -79.68],
                ],
                lengthMeters: 550,
            },
        ];

        const scheduledSamples: ScheduledStopSegmentSample[] = [
            {
                segmentId: 'North|stop-a|stop-b',
                route: '8A',
                dayType: 'weekday',
                directionId: 'North',
                departureMinutes: 450,
                runtimeMinutes: 5,
            },
            {
                segmentId: 'North|stop-b|stop-c',
                route: '8A',
                dayType: 'weekday',
                directionId: 'North',
                departureMinutes: 455,
                runtimeMinutes: 5,
            },
        ];

        const dailySummaries: DailySummary[] = [
            makeDailySummary({
                stopSegmentRuntimes: {
                    entries: [
                        {
                            routeId: '8A',
                            direction: 'N',
                            fromStopId: 'stop-a',
                            toStopId: 'stop-b',
                            fromStopName: 'Stop A',
                            toStopName: 'Stop B',
                            fromRouteStopIndex: 0,
                            toRouteStopIndex: 1,
                            segmentName: 'Stop A to Stop B',
                            observations: [
                                { timeBucket: '07:00', runtimeMinutes: 4 },
                                { timeBucket: '07:00', runtimeMinutes: 4 },
                            ],
                        },
                        {
                            routeId: '8A',
                            direction: 'N',
                            fromStopId: 'stop-b',
                            toStopId: 'stop-c',
                            fromStopName: 'Stop B',
                            toStopName: 'Stop C',
                            fromRouteStopIndex: 1,
                            toRouteStopIndex: 2,
                            segmentName: 'Stop B to Stop C',
                            observations: [
                                { timeBucket: '07:00', runtimeMinutes: 5 },
                                { timeBucket: '07:00', runtimeMinutes: 5 },
                            ],
                        },
                    ],
                    totalObservations: 4,
                    tripsWithData: 2,
                },
            }),
        ];

        const rawIndex = buildCorridorSpeedIndexFromData(rawSegments, scheduledSamples, dailySummaries);
        const corridorSegments: GtfsCorridorSegment[] = [{
            id: 'corr-1',
            stops: ['stop-a', 'stop-b', 'stop-c'],
            stopNames: ['Stop A', 'Stop B', 'Stop C'],
            routes: ['8A'],
            routeColors: ['888888'],
            geometry: [
                [44.38, -79.69],
                [44.381, -79.685],
                [44.382, -79.68],
            ],
            isShared: false,
        }];

        const corridorIndex = buildCorridorSpeedMapIndexFromData(rawIndex, corridorSegments);
        const stats = getStatsForPeriod(corridorIndex, 'weekday', 'am-peak').get('corr-1|North');

        expect(stats).toBeDefined();
        expect(stats?.scheduledRuntimeMin).toBe(10);
        expect(stats?.observedRuntimeMin).toBe(9);
        expect(stats?.sampleCount).toBe(2);
        expect(stats?.routeBreakdown[0]).toMatchObject({
            route: '8A',
            sampleCount: 2,
            scheduledRuntimeMin: 10,
            observedRuntimeMin: 9,
        });
    });

    it('splits long corridors into subsegments when they exceed five stop pairs', () => {
        const rawSegments: CorridorSpeedSegment[] = Array.from({ length: 6 }, (_, index) => ({
            id: `North|stop-${index}|stop-${index + 1}`,
            fromStopId: `stop-${index}`,
            toStopId: `stop-${index + 1}`,
            fromStopName: `Stop ${index}`,
            toStopName: `Stop ${index + 1}`,
            directionId: 'North',
            routes: ['11'],
            geometry: [
                [44.38 + (index * 0.001), -79.69 + (index * 0.001)],
                [44.381 + (index * 0.001), -79.689 + (index * 0.001)],
            ],
            lengthMeters: 210,
        }));

        const scheduledSamples: ScheduledStopSegmentSample[] = rawSegments.map((segment, index) => ({
            segmentId: segment.id,
            route: '11',
            dayType: 'weekday',
            directionId: 'North',
            departureMinutes: 420 + index,
            runtimeMinutes: 3,
        }));

        const rawIndex = buildCorridorSpeedIndexFromData(rawSegments, scheduledSamples, []);
        const corridorSegments: GtfsCorridorSegment[] = [{
            id: 'corr-long',
            stops: ['stop-0', 'stop-1', 'stop-2', 'stop-3', 'stop-4', 'stop-5', 'stop-6'],
            stopNames: ['Stop 0', 'Stop 1', 'Stop 2', 'Stop 3', 'Stop 4', 'Stop 5', 'Stop 6'],
            routes: ['11'],
            routeColors: ['888888'],
            geometry: rawSegments.flatMap((segment, index) =>
                index === 0 ? segment.geometry : segment.geometry.slice(1)
            ),
            isShared: false,
        }];

        const corridorIndex = buildCorridorSpeedMapIndexFromData(rawIndex, corridorSegments);
        const segmentIds = corridorIndex.segments.map(segment => segment.id);

        expect(segmentIds).toEqual(['corr-long|North|1', 'corr-long|North|2']);
        expect(corridorIndex.segments[0]?.sourceSegmentIds).toHaveLength(5);
        expect(corridorIndex.segments[1]?.sourceSegmentIds).toHaveLength(1);
    });

    it('splits long corridors into subsegments when they exceed the length cap', () => {
        const rawSegments: CorridorSpeedSegment[] = [
            {
                id: 'South|stop-a|stop-b',
                fromStopId: 'stop-a',
                toStopId: 'stop-b',
                fromStopName: 'Stop A',
                toStopName: 'Stop B',
                directionId: 'South',
                routes: ['11'],
                geometry: [
                    [44.38, -79.69],
                    [44.39, -79.68],
                ],
                lengthMeters: 900,
            },
            {
                id: 'South|stop-b|stop-c',
                fromStopId: 'stop-b',
                toStopId: 'stop-c',
                fromStopName: 'Stop B',
                toStopName: 'Stop C',
                directionId: 'South',
                routes: ['11'],
                geometry: [
                    [44.39, -79.68],
                    [44.4, -79.67],
                ],
                lengthMeters: 500,
            },
        ];

        const scheduledSamples: ScheduledStopSegmentSample[] = rawSegments.map((segment, index) => ({
            segmentId: segment.id,
            route: '11',
            dayType: 'weekday',
            directionId: 'South',
            departureMinutes: 500 + index,
            runtimeMinutes: 4,
        }));

        const rawIndex = buildCorridorSpeedIndexFromData(rawSegments, scheduledSamples, []);
        const corridorSegments: GtfsCorridorSegment[] = [{
            id: 'corr-distance',
            stops: ['stop-a', 'stop-b', 'stop-c'],
            stopNames: ['Stop A', 'Stop B', 'Stop C'],
            routes: ['11'],
            routeColors: ['888888'],
            geometry: [
                [44.38, -79.69],
                [44.39, -79.68],
                [44.4, -79.67],
            ],
            isShared: false,
        }];

        const corridorIndex = buildCorridorSpeedMapIndexFromData(rawIndex, corridorSegments);

        expect(corridorIndex.segments.map(segment => segment.id)).toEqual(['corr-distance|South|1', 'corr-distance|South|2']);
        expect(corridorIndex.segments[0]?.sourceSegmentIds).toEqual(['South|stop-a|stop-b']);
        expect(corridorIndex.segments[1]?.sourceSegmentIds).toEqual(['South|stop-b|stop-c']);
    });
});

describe('buildCorridorSpeedMapIndex', () => {
    it('does not inflate the clockwise Owen Street to Downtown Hub corridor into a loop-length segment', () => {
        const index = buildCorridorSpeedMapIndex([]);
        const segment = index.segments.find(value =>
            value.directionId === 'Clockwise'
            && value.fromStopName === 'Owen Street'
            && value.toStopName === 'Downtown Hub',
        );

        expect(segment).toBeDefined();
        expect(segment?.routes).toEqual(['10', '100']);
        expect(segment?.lengthMeters ?? 0).toBeGreaterThan(500);
        expect(segment?.lengthMeters ?? 0).toBeLessThan(1_500);
    });
});
