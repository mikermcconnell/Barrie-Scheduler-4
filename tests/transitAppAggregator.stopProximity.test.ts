import { describe, expect, it, vi } from 'vitest';
import type { TransitAppFileStats, TransitAppParsedData } from '../utils/transitAppTypes';

vi.mock('../utils/transitAppGtfsNormalization', () => ({
    getScheduledTripsForRouteOnDate: (): null => null,
    hasGtfsNormalizationData: () => false,
    hasGtfsSupplyProfiles: () => false,
    getRouteSupplyProfiles: (): unknown[] => [],
}));

vi.mock('../utils/gtfsStopLookup', () => ({
    getAllStopsWithCoords: () => [
        { stop_id: 'S1', stop_name: 'Downtown Terminal', lat: 44.38, lon: -79.69 },
        { stop_id: 'S2', stop_name: 'Georgian College', lat: 44.41, lon: -79.67 },
        { stop_id: 'S3', stop_name: 'Barrie South GO', lat: 44.35, lon: -79.63 },
    ],
}));

const { aggregateTransitAppData } = await import('../utils/transitAppAggregator');

const baseStats: TransitAppFileStats = {
    totalFiles: 0,
    dateRange: { start: '2025-01-01', end: '2025-09-30' },
    filesByType: {
        lines: 0,
        trips: 0,
        locations: 0,
        go_trip_legs: 0,
        planned_go_trip_legs: 0,
        tapped_trip_view_legs: 0,
        users: 0,
    },
    rowsParsed: 0,
    rowsSkipped: 0,
};

describe('aggregateTransitAppData stop proximity analysis (UC5)', () => {
    it('computes far-from-stop clusters and stop mention ranking', () => {
        const parsed: TransitAppParsedData = {
            lines: [],
            trips: [
                {
                    user_id: 'u1',
                    start_longitude: -79.6901,
                    start_latitude: 44.3801,
                    end_longitude: -79.7500,
                    end_latitude: 44.4600, // far
                    timestamp: '2025-01-06 07:10:00 UTC',
                    arrive_by: '',
                    leave_at: '',
                },
                {
                    user_id: 'u2',
                    start_longitude: -79.7495,
                    start_latitude: 44.4590, // far
                    end_longitude: -79.7488,
                    end_latitude: 44.4586, // far and clustered
                    timestamp: '2025-07-06 16:30:00 UTC',
                    arrive_by: '',
                    leave_at: '',
                },
            ],
            locations: [],
            goTripLegs: [
                {
                    user_trip_id: 'trip-1',
                    start_time: '2025-01-06 07:10:00 UTC',
                    end_time: '2025-01-06 07:25:00 UTC',
                    start_longitude: -79.69,
                    start_latitude: 44.38,
                    end_longitude: -79.67,
                    end_latitude: 44.41,
                    service_name: 'Barrie Transit',
                    route_short_name: '100',
                    mode: 'Transit',
                    start_stop_name: 'Downtown Terminal',
                    end_stop_name: 'Georgian College',
                },
                {
                    user_trip_id: 'trip-2',
                    start_time: '2025-07-06 16:30:00 UTC',
                    end_time: '2025-07-06 16:50:00 UTC',
                    start_longitude: -79.67,
                    start_latitude: 44.41,
                    end_longitude: -79.63,
                    end_latitude: 44.35,
                    service_name: 'Barrie Transit',
                    route_short_name: '8A',
                    mode: 'Transit',
                    start_stop_name: 'Georgian College',
                    end_stop_name: 'Barrie South GO',
                },
            ],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const proximity = summary.stopProximityAnalysis;

        expect(proximity).toBeDefined();
        expect(proximity?.totals.tripEndpointsAnalyzed).toBeGreaterThan(0);
        expect(proximity?.totals.farEndpointCount).toBeGreaterThan(0);
        expect(proximity?.totals.clusterCount).toBeGreaterThan(0);
        expect((proximity?.topClusters || [])[0]?.tripCount).toBeGreaterThan(0);

        const mentionNames = new Set((proximity?.stopMentions || []).map(row => row.stopName));
        expect(mentionNames.has('Downtown Terminal')).toBe(true);
        expect(mentionNames.has('Georgian College')).toBe(true);
    });
});
