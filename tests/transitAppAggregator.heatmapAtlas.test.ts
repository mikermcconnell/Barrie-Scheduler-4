import { describe, expect, it, vi } from 'vitest';
import type { TransitAppFileStats, TransitAppParsedData } from '../utils/transit-app/transitAppTypes';

vi.mock('../utils/transit-app/transitAppGtfsNormalization', () => ({
    getScheduledTripsForRouteOnDate: (): null => null,
    hasGtfsNormalizationData: () => false,
    hasGtfsSupplyProfiles: () => false,
    getRouteSupplyProfiles: (): unknown[] => [],
}));

vi.mock('../utils/gtfsStopLookup', () => ({
    getAllStopsWithCoords: () => [
        { stop_id: 'S1', stop_name: 'Downtown Terminal', lat: 44.38, lon: -79.69 },
    ],
}));

const { aggregateTransitAppData } = await import('../utils/transit-app/transitAppAggregator');

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

describe('aggregateTransitAppData heatmap analysis (UC6)', () => {
    it('applies 15-min debiasing and builds 18-slice atlas', () => {
        const parsed: TransitAppParsedData = {
            lines: [],
            trips: [],
            locations: [
                // Same user, same 15-min window -> should debounce to 1 point
                { user_id: 'u1', longitude: -79.6901, latitude: 44.3801, timestamp: '2025-01-06 12:02:00 UTC' },
                { user_id: 'u1', longitude: -79.6902, latitude: 44.3802, timestamp: '2025-01-06 12:08:00 UTC' },

                // Same user, different window -> retained
                { user_id: 'u1', longitude: -79.6904, latitude: 44.3804, timestamp: '2025-01-06 12:20:00 UTC' },

                // Jul weekday midday
                { user_id: 'u2', longitude: -79.6700, latitude: 44.4100, timestamp: '2025-07-08 16:10:00 UTC' },

                // Sep saturday
                { user_id: 'u3', longitude: -79.6500, latitude: 44.3600, timestamp: '2025-09-13 18:10:00 UTC' },
            ],
            goTripLegs: [],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const heat = summary.heatmapAnalysis;

        expect(heat).toBeDefined();
        expect(heat?.debiasing.rawPoints).toBe(5);
        expect(heat?.debiasing.debiasedPoints).toBe(4);
        expect(heat?.atlas.length).toBe(18);

        const janAm = heat?.atlas.find(slice => slice.season === 'jan' && slice.id === 'weekday_am_peak');
        expect(janAm).toBeDefined();
        expect(janAm?.totalPoints).toBeGreaterThan(0);

        expect(summary.locationDensity.rawPoints).toBe(5);
        expect(summary.locationDensity.debiasedPoints).toBe(4);
    });
});
