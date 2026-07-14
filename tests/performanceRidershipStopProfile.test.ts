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
): RouteRidershipHeatmap {
    const tripCount = Math.max(0, ...stops.map(stop => stop.cells.length));
    return {
        routeId,
        routeName: `Route ${routeId}`,
        direction,
        trips: Array.from({ length: tripCount }, (_, index) => ({
            terminalDepartureTime: `${8 + index}:00`,
            tripName: `Trip ${index + 1}`,
            block: '1',
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

    it('omits ambiguous legacy zero loads instead of presenting missing APC as zero', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [{ id: 'A', index: 1, cells: [[1, 0]] }])], [
                loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 0 }]),
            ]),
        ]);

        expect(result.options[0]).toMatchObject({ hasEstimatedLoad: true });
        expect(result.options[0].rows[0]).toMatchObject({
            averageLoad: null,
            loadObservationCount: null,
            loadEstimated: true,
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

    it('keeps absent and explicitly unobserved load null rather than turning it into zero', () => {
        const result = buildRidershipStopProfiles([
            day('2026-07-07', [heatmap('10', 'CW', [
                { id: 'A', index: 1, cells: [[1, 0]] },
                { id: 'B', index: 2, cells: [[1, 0]] },
            ])], [loadProfile('10', 'CW', [{ id: 'A', index: 1, load: 0, count: 0 }])]),
        ]);

        expect(result.options[0].rows).toEqual([
            expect.objectContaining({ stopId: 'A', averageLoad: null, loadObservationCount: 0 }),
            expect.objectContaining({ stopId: 'B', averageLoad: null, loadObservationCount: null }),
        ]);
        expect(result.options[0].peakAverageLoad).toBeNull();
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
});
