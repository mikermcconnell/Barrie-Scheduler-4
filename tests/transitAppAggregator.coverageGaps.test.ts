import { describe, expect, it, vi } from 'vitest';
import type { ODPairData } from '../utils/transit-app/transitAppTypes';

const gtfsShapeMock = vi.hoisted(() => ({
    shapes: [] as Array<{
        routeId: string;
        routeShortName: string;
        routeColor: string;
        points: [number, number][];
    }>,
}));

vi.mock('../utils/transit-app/transitAppGtfsNormalization', () => ({
    getRouteSupplyProfiles: (): unknown[] => [],
    getScheduledTripsForRouteOnDate: (): null => null,
    hasGtfsNormalizationData: () => false,
    hasGtfsSupplyProfiles: () => false,
}));

vi.mock('../utils/gtfs/gtfsStopLookup', () => ({
    getAllStopsWithCoords: (): unknown[] => [],
    findNearestStopName: (): null => null,
}));

vi.mock('../utils/gtfs/gtfsShapesLoader', async () => {
    const actual = await vi.importActual<typeof import('../utils/gtfs/gtfsShapesLoader')>('../utils/gtfs/gtfsShapesLoader');
    return {
        ...actual,
        loadGtfsRouteShapes: () => gtfsShapeMock.shapes,
        loadGtfsRouteShapeVariants: () => gtfsShapeMock.shapes,
    };
});

const { analyzeODCoverageGaps } = await import('../utils/transit-app/transitAppAggregator');

function odData(pairs: ODPairData['pairs']): ODPairData {
    return {
        pairs,
        resolution: 0.01,
        totalTripsProcessed: pairs.reduce((sum, pair) => sum + pair.count, 0),
        totalTripsSkipped: 0,
        bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
    };
}

describe('Transit App OD coverage gap analysis', () => {
    it('filters to Barrie-only pairs before applying the top-N limit', () => {
        gtfsShapeMock.shapes = [{
            routeId: '400',
            routeShortName: '400',
            routeColor: '00C4DC',
            points: [[44.38, -79.69], [44.41, -79.67]],
        }];

        const result = analyzeODCoverageGaps(odData([
            {
                originLat: 43.65,
                originLon: -79.38,
                destLat: 44.39,
                destLon: -79.69,
                count: 1000,
            },
            {
                originLat: 44.38,
                originLon: -79.69,
                destLat: 44.41,
                destLon: -79.67,
                count: 10,
            },
        ]), 1);

        expect(result).toHaveLength(1);
        expect(result[0].pair.count).toBe(10);
        expect(result[0].isServedByDirectRoute).toBe(true);
        expect(result[0].coverageStatus).toBe('served');
    });

    it('detects direct service across merged A/B route shape variants', () => {
        gtfsShapeMock.shapes = [
            {
                routeId: '2A',
                routeShortName: '2A',
                routeColor: '006838',
                points: [[44.3800, -79.7000], [44.3800, -79.6800]],
            },
            {
                routeId: '2B',
                routeShortName: '2B',
                routeColor: '006838',
                points: [[44.3500, -79.6400], [44.3500, -79.6200]],
            },
        ];

        const [gap] = analyzeODCoverageGaps(odData([
            {
                originLat: 44.3800,
                originLon: -79.6900,
                destLat: 44.3500,
                destLon: -79.6300,
                count: 25,
            },
        ]));

        expect(gap.isServedByDirectRoute).toBe(true);
        expect(gap.coverageStatus).toBe('served');
        expect(gap.servingRoutes).toEqual(['2']);
        expect(gap.nearestRouteOrigin).toBe('2');
        expect(gap.nearestRouteDest).toBe('2');
        expect(gap.originRouteDistKm).toBeLessThan(0.1);
        expect(gap.destRouteDistKm).toBeLessThan(0.1);
    });
});
