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
    it('applies 15-min debiasing and builds a 21-slice Jan/Jul/Sep atlas', () => {
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

                // Jan weekday overnight, separate from evening
                { user_id: 'u4', longitude: -79.6500, latitude: 44.3600, timestamp: '2025-01-07 04:30:00 UTC' },
            ],
            goTripLegs: [],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const heat = summary.heatmapAnalysis;

        expect(heat).toBeDefined();
        expect(heat?.schemaVersion).toBe(2);
        expect(heat?.debiasing.rawPoints).toBe(6);
        expect(heat?.debiasing.debiasedPoints).toBe(5);
        expect(heat?.atlas.length).toBe(21);

        const janAm = heat?.atlas.find(slice => slice.season === 'jan' && slice.id === 'weekday_am_peak');
        expect(janAm).toBeDefined();
        expect(janAm?.totalPoints).toBeGreaterThan(0);

        const janEvening = heat?.atlas.find(slice => slice.season === 'jan' && slice.id === 'weekday_evening');
        const janOvernight = heat?.atlas.find(slice => slice.season === 'jan' && slice.id === 'weekday_overnight');
        expect(janEvening?.totalPoints).toBe(0);
        expect(janOvernight?.totalPoints).toBe(1);

        expect(summary.locationDensity.rawPoints).toBe(6);
        expect(summary.locationDensity.debiasedPoints).toBe(5);
    });

    it('retains callouts for every non-empty atlas slice instead of capping globally', () => {
        const points: TransitAppParsedData['locations'] = [
            // January EST
            ['2025-01-06 12:00:00 UTC', 'jan_weekday_am_peak'],
            ['2025-01-06 15:00:00 UTC', 'jan_weekday_midday'],
            ['2025-01-06 21:00:00 UTC', 'jan_weekday_pm_peak'],
            ['2025-01-07 00:00:00 UTC', 'jan_weekday_evening'],
            ['2025-01-07 04:00:00 UTC', 'jan_weekday_overnight'],
            ['2025-01-04 17:00:00 UTC', 'jan_saturday_all_day'],
            ['2025-01-05 17:00:00 UTC', 'jan_sunday_all_day'],
            // July EDT
            ['2025-07-07 11:00:00 UTC', 'jul_weekday_am_peak'],
            ['2025-07-07 14:00:00 UTC', 'jul_weekday_midday'],
            ['2025-07-07 20:00:00 UTC', 'jul_weekday_pm_peak'],
            ['2025-07-07 23:00:00 UTC', 'jul_weekday_evening'],
            ['2025-07-08 03:00:00 UTC', 'jul_weekday_overnight'],
            ['2025-07-05 16:00:00 UTC', 'jul_saturday_all_day'],
            ['2025-07-06 16:00:00 UTC', 'jul_sunday_all_day'],
            // September EDT
            ['2025-09-08 11:00:00 UTC', 'sep_weekday_am_peak'],
            ['2025-09-08 14:00:00 UTC', 'sep_weekday_midday'],
            ['2025-09-08 20:00:00 UTC', 'sep_weekday_pm_peak'],
            ['2025-09-08 23:00:00 UTC', 'sep_weekday_evening'],
            ['2025-09-09 03:00:00 UTC', 'sep_weekday_overnight'],
            ['2025-09-06 16:00:00 UTC', 'sep_saturday_all_day'],
            ['2025-09-07 16:00:00 UTC', 'sep_sunday_all_day'],
            // Other season EST
            ['2025-02-03 12:00:00 UTC', 'other_weekday_am_peak'],
            ['2025-02-03 15:00:00 UTC', 'other_weekday_midday'],
            ['2025-02-03 21:00:00 UTC', 'other_weekday_pm_peak'],
            ['2025-02-04 00:00:00 UTC', 'other_weekday_evening'],
            ['2025-02-04 04:00:00 UTC', 'other_weekday_overnight'],
            ['2025-02-01 17:00:00 UTC', 'other_saturday_all_day'],
            ['2025-02-02 17:00:00 UTC', 'other_sunday_all_day'],
        ].map(([timestamp, label], index) => ({
            user_id: `u-${label}`,
            longitude: -79.6900 + index * 0.00001,
            latitude: 44.3800 + index * 0.00001,
            timestamp,
        }));

        const parsed: TransitAppParsedData = {
            lines: [],
            trips: [],
            locations: points,
            goTripLegs: [],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const heat = summary.heatmapAnalysis;

        expect(heat?.atlas).toHaveLength(28);
        expect(heat?.callouts).toHaveLength(28);
        expect(heat?.callouts.some(callout => callout.season === 'other')).toBe(true);
        expect(heat?.callouts.some(callout => callout.timeBand === 'overnight')).toBe(true);
    });
});
