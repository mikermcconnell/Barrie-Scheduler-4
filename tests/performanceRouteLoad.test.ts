import { describe, expect, it } from 'vitest';
import type { DailySummary, RidershipHeatmapTrip, RouteLoadProfile, RouteRidershipHeatmap } from '../utils/performanceDataTypes';
import {
    analyzeTripMovements,
    buildRouteLoadAnalysis,
    buildRouteLoadViews,
    FULL_LOAD,
    inferTripLoads,
    MAX_TRIP_IMBALANCE_RATIO,
} from '../utils/performanceRouteLoad';

type Cell = [number, number] | null;

/** Builds a heatmap from stop ids and a per-trip list of cells (one cell per stop). */
function heatmap(
    stopIds: string[],
    trips: Cell[][],
    overrides: Partial<RouteRidershipHeatmap> = {},
    tripOverrides: Array<Partial<RidershipHeatmapTrip>> = [],
): RouteRidershipHeatmap {
    return {
        routeId: '8A',
        routeName: 'RVH/YONGE',
        direction: 'N',
        trips: trips.map((_, index) => ({
            tripId: `T${index}`,
            terminalDepartureTime: `${String(6 + index).padStart(2, '0')}:00`,
            tripName: `Trip ${index}`,
            block: `B${index}`,
            direction: 'N',
            vehicleId: `V${index}`,
            ...tripOverrides[index],
        })),
        stops: stopIds.map((stopId, index) => ({ stopId, stopName: `Stop ${stopId}`, routeStopIndex: index, isTimepoint: false })),
        // cells are [stop][trip]
        cells: stopIds.map((_, stopIndex) => trips.map(trip => trip[stopIndex])),
        ...overrides,
    };
}

function day(date: string, heatmaps: RouteRidershipHeatmap[], loadProfiles: RouteLoadProfile[] = []): DailySummary {
    return { date, ridershipHeatmaps: heatmaps, loadProfiles } as unknown as DailySummary;
}

describe('analyzeTripMovements', () => {
    it('accumulates boardings minus alightings along the trip', () => {
        expect(inferTripLoads([[5, 0], [3, 2], [0, 6]])).toEqual([5, 6, 0]);
    });

    it('scales alightings so an unbalanced trip ends empty', () => {
        // 10 on, 8 off: alightings scaled by 1.25.
        const loads = inferTripLoads([[10, 0], [0, 4], [0, 4]])!;
        expect(loads[0]).toBe(10);
        expect(loads[1]).toBeCloseTo(5);
        expect(loads[2]).toBeCloseTo(0);
    });

    it('never lets the load go negative and counts the clamps', () => {
        const result = analyzeTripMovements([[0, 2], [4, 0], [0, 2]]);
        expect(result.loads).toEqual([0, 4, 2]);
        expect(result.clampedStops).toBe(1);
    });

    it('rejects empty and badly unbalanced trips but reports their ratio', () => {
        expect(inferTripLoads([[0, 0], [0, 0]])).toBeNull();
        expect(inferTripLoads([[5, 0], [0, 0]])).toBeNull();
        const tooMany = Math.ceil(10 * MAX_TRIP_IMBALANCE_RATIO) + 1;
        const result = analyzeTripMovements([[tooMany, 0], [0, 10]]);
        expect(result.loads).toBeNull();
        expect(result.ratio).toBeCloseTo(tooMany / 10);
    });
});

describe('buildRouteLoadAnalysis', () => {
    it('averages inferred loads per trip across trips and days', () => {
        const [view] = buildRouteLoadViews([
            day('2026-09-01', [heatmap(['A', 'B', 'C'], [[[4, 0], [2, 2], [0, 4]]])]),
            day('2026-09-02', [heatmap(['A', 'B', 'C'], [[[8, 0], [0, 4], [0, 4]]])]),
        ]);

        expect(view.inferenceBlocked).toBeNull();
        expect(view.serviceDays).toBe(2);
        expect(view.tripCount).toBe(2);
        expect(view.usableTripCount).toBe(2);
        expect(view.stops.map(s => s.avgLoad)).toEqual([6, 4, 0]);
        expect(view.stops[0].avgBoardings).toBe(6);
        expect(view.maxTripLoad).toBe(8);
    });

    it('skips trips without counts and leaves unbalanced trips out of the load but not the bars', () => {
        const [view] = buildRouteLoadViews([day('2026-09-01', [heatmap(['A', 'B'], [
            [[4, 0], [0, 4]],
            [[0, 0], [0, 0]],
            [[20, 0], [0, 2]],
        ])])]);

        expect(view.tripCount).toBe(2);
        expect(view.usableTripCount).toBe(1);
        expect(view.usableShare).toBe(0.5);
        expect(view.stops[0].avgLoad).toBe(4);
        expect(view.stops[0].loadSamples).toBe(1);
        expect(view.stops[0].avgBoardings).toBe(12);
        expect(view.diagnostics.noCountTrips).toBe(1);
    });

    it('starts each trip at its first served stop', () => {
        const [view] = buildRouteLoadViews([day('2026-09-01', [heatmap(['A', 'B', 'C'], [
            [[6, 0], [0, 3], [0, 3]],
            [null, [2, 0], [0, 2]],
        ])])]);

        expect(view.stops[0].loadSamples).toBe(1);
        expect(view.stops[1].avgLoad).toBe(2.5);
    });

    it('flags low-sample and partial-pattern stops and keeps them out of the peak', () => {
        const regular: Cell[] = [[5, 0], [0, 1], null, [0, 4]];
        const detour: Cell[] = [[5, 0], [0, 1], [10, 0], [0, 14]];
        const trips = [...Array.from({ length: 9 }, () => regular), detour];
        const [view] = buildRouteLoadViews([day('2026-09-01', [heatmap(['A', 'B', 'X', 'C'], trips)])]);

        const byId = Object.fromEntries(view.stops.map(s => [s.stopId, s]));
        expect(byId.X.lowSample).toBe(true);
        expect(byId.X.partialPattern).toBe(true);
        expect(byId.A.partialPattern).toBe(false);
        expect(view.peakStop?.stopId).toBe('A');
    });

    it('withholds load on loop routes by direction or trip shape but keeps boardings', () => {
        const byDirection = buildRouteLoadViews([day('2026-09-01', [
            heatmap(['A', 'B'], [[[3, 0], [0, 3]]], { routeId: '100', direction: 'CW' }),
        ])])[0];
        const loopStops = ['A', 'B', 'A'];
        const byShape = buildRouteLoadViews([day('2026-09-01', [heatmap(loopStops, [[[3, 0], [1, 1], [0, 3]]], {
            stops: [
                { stopId: 'A', stopName: 'Terminal', routeStopIndex: 0, occurrenceIndex: 0, isTimepoint: true },
                { stopId: 'B', stopName: 'Stop B', routeStopIndex: 1, isTimepoint: false },
                { stopId: 'A', stopName: 'Terminal', routeStopIndex: 2, occurrenceIndex: 1, isTimepoint: true },
            ],
        })])])[0];

        expect(byDirection.inferenceBlocked).toBe('loop');
        expect(byShape.inferenceBlocked).toBe('loop');
        expect(byShape.stops.map(s => [s.stopId, s.occurrenceIndex])).toEqual([['A', 0], ['B', 0], ['A', 1]]);
        expect(byShape.stops.every(s => s.avgLoad === null)).toBe(true);
        expect(byShape.stops[0].avgBoardings).toBe(3);
        expect(byShape.usableShare).toBeNull();
        expect(byShape.busiestTrips).toEqual([]);
    });

    it('withholds load on routes whose trips mostly continue as another route', () => {
        const views = buildRouteLoadViews([day('2026-09-01', [
            heatmap(['A', 'T'], [[[5, 0], [0, 5]]], { routeId: '8A' }, [{ block: 'B1', terminalDepartureTime: '07:00' }]),
            heatmap(['T', 'C'], [[[5, 0], [0, 5]]], { routeId: '8B' }, [{ block: 'B1', terminalDepartureTime: '07:30' }]),
        ])]);
        const byRoute = Object.fromEntries(views.map(v => [v.routeId, v]));

        expect(byRoute['8A'].inferenceBlocked).toBe('interlined');
        expect(byRoute['8A'].diagnostics.interlinedTripShare).toBe(1);
        // The last trip of the block does not continue, so 8B is still inferred.
        expect(byRoute['8B'].inferenceBlocked).toBeNull();
    });

    it('ranks busiest scheduled trips and counts trips reaching full load', () => {
        const busy: Cell[] = [[FULL_LOAD + 5, 0], [0, FULL_LOAD + 5]];
        const quiet: Cell[] = [[10, 0], [0, 10]];
        const sameTimes = [{ terminalDepartureTime: '07:40', block: '8-03' }, { terminalDepartureTime: '09:10', block: '8-01' }];
        const [view] = buildRouteLoadViews([
            day('2026-09-01', [heatmap(['A', 'B'], [busy, quiet], {}, sameTimes)]),
            day('2026-09-02', [heatmap(['A', 'B'], [quiet, quiet], {}, sameTimes)]),
        ]);

        expect(view.fullTripCount).toBe(1);
        expect(view.busiestTrips[0]).toEqual(expect.objectContaining({
            departure: '07:40', block: '8-03', days: 2, avgPeakLoad: (FULL_LOAD + 5 + 10) / 2, maxPeakLoad: FULL_LOAD + 5, peakStopName: 'Stop A', fullDays: 1,
        }));
        expect(view.busiestTrips[1].departure).toBe('09:10');
    });

    it('reports imbalance, skipped-vs-kept boardings and clamping', () => {
        const [view] = buildRouteLoadViews([day('2026-09-01', [heatmap(['A', 'B', 'C'], [
            [[10, 0], [0, 5], [0, 5]],
            [[0, 3], [10, 0], [0, 7]],
            [[40, 0], [0, 5], [0, 5]],
        ])])]);
        const d = view.diagnostics;

        expect(d.imbalanceBuckets.find(b => b.label === 'Within 10%')?.trips).toBe(2);
        expect(d.imbalanceBuckets.find(b => b.label === 'Far more boardings')?.trips).toBe(1);
        expect(d.keptAvgBoardings).toBe(10);
        expect(d.skippedAvgBoardings).toBe(40);
        expect(d.clampedTripShare).toBe(0.5);
    });

    it('compares inferred load with APC load where APC has enough readings', () => {
        const trips = Array.from({ length: 5 }, (): Cell[] => [[10, 0], [0, 10]]);
        const apc: RouteLoadProfile = {
            routeId: '8A', routeName: 'RVH/YONGE', direction: 'N', tripCount: 5,
            stops: [{ stopId: 'A', stopName: 'Stop A', routeStopIndex: 0, avgBoardings: 10, avgAlightings: 0, avgLoad: 7, loadObservationCount: 5, maxLoad: 9, isTimepoint: false }],
        };
        const [view] = buildRouteLoadViews([day('2026-09-01', [heatmap(['A', 'B'], trips)], [apc])]);

        expect(view.diagnostics.apcComparison).toEqual({ stopsCompared: 1, meanDifference: 3, meanAbsoluteDifference: 3 });
    });

    it('flags vehicles whose counts are consistently unbalanced', () => {
        const balanced: Cell[] = [[10, 0], [0, 10]];
        const offset: Cell[] = [[13, 0], [0, 10]];
        const trips = [...Array.from({ length: 5 }, () => offset), ...Array.from({ length: 5 }, () => balanced)];
        const vehicles = Array.from({ length: 10 }, (_, i) => ({ vehicleId: i < 5 ? '2112' : '2200' }));
        const { vehicles: diagnostics } = buildRouteLoadAnalysis([day('2026-09-01', [heatmap(['A', 'B'], trips, {}, vehicles)])]);

        expect(diagnostics[0]).toEqual(expect.objectContaining({ vehicleId: '2112', trips: 5, medianRatio: 1.3, flagged: true }));
        expect(diagnostics.find(v => v.vehicleId === '2200')?.flagged).toBe(false);
    });

    it('returns no views for days without heatmaps', () => {
        expect(buildRouteLoadViews([{ date: '2026-09-01', loadProfiles: [] } as unknown as DailySummary])).toEqual([]);
    });

    it('sorts route views by route then direction', () => {
        const views = buildRouteLoadViews([day('2026-09-01', [
            heatmap(['A', 'B'], [[[1, 0], [0, 1]]], { routeId: '10', direction: 'S' }),
            heatmap(['A', 'B'], [[[1, 0], [0, 1]]], { routeId: '8A', direction: 'S' }),
            heatmap(['A', 'B'], [[[1, 0], [0, 1]]], { routeId: '8A', direction: 'N' }),
        ])]);

        expect(views.map(v => v.key)).toEqual(['8A__N', '8A__S', '10__S']);
    });
});
