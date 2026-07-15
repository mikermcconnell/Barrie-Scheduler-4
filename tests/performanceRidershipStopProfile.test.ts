import { describe, expect, it } from 'vitest';
import type {
    DailySummary,
    LoadProfileStop,
    RouteLoadProfile,
    RouteRidershipHeatmap,
} from '../utils/performanceDataTypes';
import { buildRidershipStopProfiles } from '../utils/performanceRidershipStopProfile';

type LoadStopFixture = LoadProfileStop & { loadObservationCount?: number };

function heatmap(
    routeId: string,
    direction: string,
    stops: Array<{ id: string; name?: string; index: number; cells: Array<[number, number] | null> }>,
    trips?: Array<{ time: string; block: string }>,
): RouteRidershipHeatmap {
    const tripCount = Math.max(0, ...stops.map(stop => stop.cells.length));
    return {
        routeId,
        routeName: `Route ${routeId}`,
        direction,
        trips: Array.from({ length: tripCount }, (_, index) => ({
            terminalDepartureTime: trips?.[index]?.time ?? `${8 + index}:00`,
            tripName: `Trip ${index + 1}`,
            block: trips?.[index]?.block ?? '1',
            direction,
        })),
        stops: stops.map(stop => ({
            stopId: stop.id,
            stopName: stop.name ?? stop.id,
            routeStopIndex: stop.index,
            isTimepoint: stop.index === 1,
        })),
        cells: stops.map(stop => stop.cells),
    };
}

function loadProfile(
    routeId: string,
    direction: string,
    stops: Array<{ id: string; index: number; load: number; count?: number }>,
): RouteLoadProfile {
    return {
        routeId,
        routeName: `Route ${routeId}`,
        direction,
        tripCount: 1,
        stops: stops.map((stop): LoadStopFixture => ({
            stopId: stop.id,
            stopName: stop.id,
            routeStopIndex: stop.index,
            avgBoardings: 0,
            avgAlightings: 0,
            avgLoad: stop.load,
            maxLoad: stop.load,
            isTimepoint: false,
            ...(stop.count === undefined ? {} : { loadObservationCount: stop.count }),
        })),
    };
}

function day(
    date: string,
    heatmaps: RouteRidershipHeatmap[],
    loadProfiles: RouteLoadProfile[] = [],
): DailySummary {
    return {
        date,
        dayType: 'weekday',
        ridershipHeatmaps: heatmaps,
        loadProfiles,
    } as DailySummary;
}

describe('buildRidershipStopProfiles', () => {
    it('uses exact heatmap totals for a single service day', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [heatmap('10', 'CW', [
            { id: 'A', index: 1, cells: [[10, 2], [4, 1]] },
            { id: 'B', index: 2, cells: [[1, 6], null] },
        ])])]);

        expect(result.defaultOptionKey).toBe('10__CW');
        expect(result.options[0]).toMatchObject({ serviceDays: 1, totalBoardings: 15, totalAlightings: 9 });
        expect(result.options[0].rows).toEqual([
            expect.objectContaining({ stopId: 'A', boardings: 14, alightings: 3, servedDays: 1 }),
            expect.objectContaining({ stopId: 'B', boardings: 1, alightings: 6, servedDays: 1 }),
        ]);
        expect(result.options[0].busiestBoardingStop).toMatchObject({ stopId: 'A', value: 14 });
        expect(result.options[0].busiestAlightingStop).toMatchObject({ stopId: 'B', value: 6 });
    });

    it('averages stop activity over distinct route-direction service days, not served stop days', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [
                { id: 'A', index: 1, cells: [[10, 4]] },
                { id: 'B', index: 2, cells: [[8, 2]] },
            ])]),
            day('2026-07-08', [heatmap('10', 'CW', [
                { id: 'A', index: 1, cells: [[20, 6]] },
            ])]),
        ]);

        const option = result.options[0];
        expect(option.serviceDays).toBe(2);
        expect(option.rows).toEqual([
            expect.objectContaining({ stopId: 'A', boardings: 15, alightings: 5, servedDays: 2 }),
            expect.objectContaining({ stopId: 'B', boardings: 4, alightings: 1, servedDays: 1 }),
        ]);
    });

    it('weights average load by reliable observation count', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[1, 0]] }])], [
                loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 10, count: 1 }]),
            ]),
            day('2026-07-08', [heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[1, 0]] }])], [
                loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 30, count: 3 }]),
            ]),
        ]);

        expect(result.options[0].rows[0]).toMatchObject({
            averageLoad: 25,
            loadObservationCount: 4,
            loadEstimated: false,
        });
        expect(result.options[0].peakAverageLoad).toMatchObject({ value: 25, loadObservationCount: 4, estimated: false });
    });

    it('falls back to an estimated average of daily averages for legacy load data', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[1, 0]] }])], [
                loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 10 }]),
            ]),
            day('2026-07-08', [heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[1, 0]] }])], [
                loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 30 }]),
            ]),
        ]);

        expect(result.options[0].hasEstimatedLoad).toBe(true);
        expect(result.options[0].rows[0]).toMatchObject({
            averageLoad: 20,
            loadObservationCount: null,
            loadEstimated: true,
        });
    });

    it('preserves equal daily weighting when legacy and count-backed load profiles are mixed', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[1, 0]] }])], [
                loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 10 }]),
            ]),
            day('2026-07-08', [heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[1, 0]] }])], [
                loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 30, count: 3 }]),
            ]),
        ]);

        expect(result.options[0].rows[0]).toMatchObject({
            averageLoad: 20,
            loadObservationCount: null,
            loadEstimated: true,
            loadSource: 'mixed',
        });
    });

    it('uses block inference instead of presenting an ambiguous legacy zero as observed load', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[1, 0]] }])], [
                loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 0 }]),
            ]),
        ]);

        expect(result.options[0]).toMatchObject({
            hasEstimatedLoad: true,
            hasBlockInferredLoad: true,
            blockInferenceAssumedEmptyAnchor: true,
        });
        expect(result.options[0].rows[0]).toMatchObject({
            averageLoad: 1,
            loadObservationCount: null,
            loadEstimated: true,
            loadSource: 'block-inferred',
            blockInferredLoadCount: 1,
        });
    });

    it('uses median route position, stable tie-breaks, and reports changing stop patterns', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [
                { id: 'B', index: 2, cells: [[1, 0]] },
                { id: 'A', index: 1, cells: [[1, 0]] },
            ])]),
            day('2026-07-08', [heatmap('10', 'CW', [
                { id: 'A', index: 3, cells: [[1, 0]] },
                { id: 'B', index: 2, cells: [[1, 0]] },
                { id: 'C', index: 2, cells: [[1, 0]] },
            ])]),
        ]);

        expect(result.options[0].multipleStopPatterns).toBe(true);
        expect(result.options[0].rows.map(row => [row.stopId, row.routeStopIndex])).toEqual([
            ['A', 2],
            ['B', 2],
            ['C', 2],
        ]);
    });

    it('keeps repeated visits to the same loop stop separate while matching them across days', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'Loop', [
                { id: 'A', index: 1, cells: [[2, 0]] },
                { id: 'B', index: 2, cells: [[1, 1]] },
                { id: 'A', index: 3, cells: [[0, 3]] },
            ])]),
            day('2026-07-08', [heatmap('10', 'Loop', [
                { id: 'X', index: 1, cells: [[1, 0]] },
                { id: 'A', index: 2, cells: [[4, 0]] },
                { id: 'B', index: 3, cells: [[1, 1]] },
                { id: 'A', index: 4, cells: [[0, 5]] },
            ])]),
        ]);

        const aRows = result.options[0].rows.filter(row => row.stopId === 'A');
        expect(aRows).toEqual([
            expect.objectContaining({ occurrenceIndex: 0, routeStopIndex: 1.5, boardings: 3, alightings: 0, servedDays: 2 }),
            expect.objectContaining({ occurrenceIndex: 1, routeStopIndex: 3.5, boardings: 0, alightings: 4, servedDays: 2 }),
        ]);
    });

    it('fills absent and explicitly unobserved load from block passenger deltas', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [
                { id: 'A', index: 1, cells: [[1, 0]] },
                { id: 'B', index: 2, cells: [[1, 0]] },
            ])], [loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 0, count: 0 }])]),
        ]);

        expect(result.options[0].rows).toEqual([
            expect.objectContaining({ stopId: 'A', averageLoad: 1, loadSource: 'block-inferred' }),
            expect.objectContaining({ stopId: 'B', averageLoad: 2, loadSource: 'block-inferred' }),
        ]);
        expect(result.options[0].peakAverageLoad).toMatchObject({ stopId: 'B', value: 2, estimated: true });
    });

    it('chooses the busiest option by raw boardings with deterministic ties', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [
            heatmap('20', 'West', [{ id: 'A', index: 1, cells: [[9, 0]] }]),
            heatmap('10', 'South', [{ id: 'A', index: 1, cells: [[10, 0]] }]),
            heatmap('10', 'North', [{ id: 'A', index: 1, cells: [[10, 0]] }]),
        ])]);

        expect(result.options.map(option => option.key)).toEqual(['10__North', '10__South', '20__West']);
        expect(result.defaultOptionKey).toBe('10__North');
    });

    it('does not double-count duplicate route-direction summaries for one date', () => {
        const duplicate = day('2026-07-07', [
            heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[10, 2]] }]),
        ]);

        const result = buildRidershipStopProfiles([duplicate, duplicate]);

        expect(result.options[0]).toMatchObject({ serviceDays: 1, totalBoardings: 10, totalAlightings: 2 });
        expect(result.options[0].rows[0]).toMatchObject({ boardings: 10, alightings: 2 });
    });

    it('carries a loop terminal residual into the next chronological trip on the same block', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [heatmap('10', 'Loop', [
            { id: 'A', index: 1, cells: [[5, 0], [1, 0]] },
            { id: 'B', index: 2, cells: [[0, 2], [0, 0]] },
            { id: 'A', index: 3, cells: [[0, 1], [0, 3]] },
        ])])]);

        const option = result.options[0];
        expect(option).toMatchObject({
            hasBlockInferredLoad: true,
            blockInferenceAssumedEmptyAnchor: true,
            invalidBlockInferenceChainCount: 0,
        });
        expect(option.rows).toEqual([
            expect.objectContaining({
                stopId: 'A', occurrenceIndex: 0, averageLoad: 4,
                loadSource: 'block-inferred', blockInferredLoadCount: 2,
            }),
            expect.objectContaining({ stopId: 'B', averageLoad: 3 }),
            expect.objectContaining({ stopId: 'A', occurrenceIndex: 1, averageLoad: 1 }),
        ]);
    });

    it('resets the assumed-empty anchor for separate blocks', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [heatmap('10', 'Loop', [
            { id: 'A', index: 1, cells: [[5, 0], [5, 0]] },
        ], [
            { time: '08:00', block: '1' },
            { time: '09:00', block: '2' },
        ])])]);

        expect(result.options[0].rows[0]).toMatchObject({ averageLoad: 5, blockInferredLoadCount: 2 });
    });

    it('orders block trips by terminal departure time before carrying load', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [heatmap('10', 'Loop', [
            { id: 'A', index: 1, cells: [[0, 3], [5, 0]] },
        ], [
            { time: '25:00', block: '1' },
            { time: '24:00', block: '1' },
        ])])]);

        expect(result.options[0]).toMatchObject({ invalidBlockInferenceChainCount: 0 });
        expect(result.options[0].rows[0]).toMatchObject({ averageLoad: 3.5, blockInferredLoadCount: 2 });
    });

    it('uses the minimum feasible starting load when cumulative block drift becomes negative', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [heatmap('10', 'Loop', [
            { id: 'A', index: 1, cells: [[2, 0], [0, 4]] },
        ])])]);

        expect(result.options[0]).toMatchObject({
            hasBlockInferredLoad: true,
            blockInferenceAssumedEmptyAnchor: false,
            blockInferenceUsesMinimumFeasibleAnchor: true,
            invalidBlockInferenceChainCount: 0,
        });
        expect(result.options[0].rows[0]).toMatchObject({
            averageLoad: 2,
            loadSource: 'block-inferred',
            blockInferredLoadCount: 2,
        });
    });

    it('rejects rather than clamps a minimum-anchored block whose load range exceeds the cap', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [heatmap('10', 'Loop', [
            { id: 'A', index: 1, cells: [[0, 10]] },
            { id: 'B', index: 2, cells: [[66, 0]] },
        ])])]);

        expect(result.options[0]).toMatchObject({
            hasBlockInferredLoad: false,
            blockInferenceUsesMinimumFeasibleAnchor: false,
            invalidBlockInferenceChainCount: 1,
        });
        expect(result.options[0].rows).toEqual([
            expect.objectContaining({ stopId: 'A', averageLoad: null, loadSource: 'none' }),
            expect.objectContaining({ stopId: 'B', averageLoad: null, loadSource: 'none' }),
        ]);
    });

    it('does not fill profile gaps when any stop has a usable daily load', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [heatmap('10', 'Loop', [
            { id: 'A', index: 1, cells: [[0, 10]] },
            { id: 'B', index: 2, cells: [[66, 0]] },
        ])], [loadProfile('10', 'Loop', [{ id: 'A', index: 1, load: 20, count: 2 }])])]);

        expect(result.options[0]).toMatchObject({
            hasBlockInferredLoad: false,
            blockInferenceAssumedEmptyAnchor: false,
            blockInferenceUsesMinimumFeasibleAnchor: false,
            invalidBlockInferenceChainCount: 0,
        });
        expect(result.options[0].rows).toEqual([
            expect.objectContaining({
                stopId: 'A', averageLoad: 20, loadObservationCount: 2,
                loadEstimated: false, loadSource: 'observed', blockInferredLoadCount: 0,
            }),
            expect.objectContaining({
                stopId: 'B', averageLoad: null, loadObservationCount: null,
                loadEstimated: false, loadSource: 'none', blockInferredLoadCount: 0,
            }),
        ]);
    });

    it('infers an all-missing day without filling gaps on a separate observed day', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'Loop', [
                { id: 'A', index: 1, cells: [[5, 0]] },
                { id: 'B', index: 2, cells: [[1, 0]] },
            ])], [loadProfile('10', 'Loop', [{ id: 'A', index: 1, load: 20, count: 2 }])]),
            day('2026-07-08', [heatmap('10', 'Loop', [
                { id: 'A', index: 1, cells: [[2, 0]] },
                { id: 'B', index: 2, cells: [[1, 0]] },
            ])]),
        ]);

        expect(result.options[0]).toMatchObject({
            hasBlockInferredLoad: true,
            blockInferenceAssumedEmptyAnchor: true,
            invalidBlockInferenceChainCount: 0,
        });
        expect(result.options[0].rows).toEqual([
            expect.objectContaining({
                stopId: 'A', averageLoad: 14, loadSource: 'mixed',
                loadObservationCount: null, blockInferredLoadCount: 1,
            }),
            expect.objectContaining({
                stopId: 'B', averageLoad: 3, loadSource: 'block-inferred',
                loadObservationCount: null, blockInferredLoadCount: 1,
            }),
        ]);
    });

    it('keeps identical block IDs on separate routes independent', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [
            heatmap('10', 'Loop', [{ id: 'A', index: 1, cells: [[5, 0]] }], [
                { time: '08:00', block: '1' },
            ]),
            heatmap('20', 'Loop', [{ id: 'B', index: 1, cells: [[0, 2]] }], [
                { time: '08:00', block: '1' },
            ]),
        ])]);

        const route10 = result.options.find(option => option.routeId === '10')!;
        const route20 = result.options.find(option => option.routeId === '20')!;
        expect(route10.rows[0]).toMatchObject({ averageLoad: 5 });
        expect(route20.rows[0]).toMatchObject({ averageLoad: 0 });
        expect(route20).toMatchObject({
            blockInferenceAssumedEmptyAnchor: false,
            blockInferenceUsesMinimumFeasibleAnchor: true,
        });
    });

    it('produces the same route inference when other routes are filtered out', () => {
        const route10 = heatmap('10', 'Loop', [{ id: 'A', index: 1, cells: [[5, 0]] }], [
            { time: '08:00', block: '1' },
        ]);
        const route20 = heatmap('20', 'Loop', [{ id: 'B', index: 1, cells: [[0, 2]] }], [
            { time: '08:00', block: '1' },
        ]);

        const allRoutes = buildRidershipStopProfiles([day('2026-07-07', [route10, route20])]);
        const filteredRoute = buildRidershipStopProfiles([day('2026-07-07', [route20])]);

        expect(allRoutes.options.find(option => option.routeId === '20')?.rows)
            .toEqual(filteredRoute.options[0].rows);
    });

    it('suppresses a whole same-route block when either direction has usable daily load', () => {
        const result = buildRidershipStopProfiles([day('2026-07-07', [
            heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[2, 0]] }], [
                { time: '08:00', block: '1' },
            ]),
            heatmap('10', 'CCW', [{ id: 'B', index: 1, cells: [[1, 0]] }], [
                { time: '09:00', block: '1' },
            ]),
        ], [loadProfile('10', 'CCW', [{ id: 'B', index: 1, load: 20, count: 2 }])])]);

        const missingDirection = result.options.find(option => option.direction === 'CW')!;
        const observedDirection = result.options.find(option => option.direction === 'CCW')!;
        expect(missingDirection).toMatchObject({
            hasBlockInferredLoad: false,
            blockInferenceAssumedEmptyAnchor: false,
            blockInferenceUsesMinimumFeasibleAnchor: false,
            invalidBlockInferenceChainCount: 0,
        });
        expect(missingDirection.rows[0]).toMatchObject({ averageLoad: null, loadSource: 'none' });
        expect(observedDirection.rows[0]).toMatchObject({ averageLoad: 20, loadSource: 'observed' });
    });
});
