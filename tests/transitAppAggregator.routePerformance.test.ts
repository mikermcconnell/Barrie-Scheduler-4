import { describe, expect, it } from 'vitest';
import { aggregateTransitAppData } from '../utils/transit-app/transitAppAggregator';
import type {
    TransitAppFileStats,
    TransitAppLineRow,
    TransitAppParsedData,
    TransitAppTripLegRow,
} from '../utils/transit-app/transitAppTypes';

function makeLine(route: string, date: string, views: number, taps: number, suggestions: number, goTrips: number): TransitAppLineRow {
    return {
        route_short_name: route,
        date,
        nearby_views: views,
        nearby_taps: taps,
        tapped_routing_suggestions: suggestions,
        go_trips: goTrips,
    };
}

function makeLeg(route: string, userTripId: string): TransitAppTripLegRow {
    return {
        user_trip_id: userTripId,
        start_time: '2025-09-01 08:00:00 UTC',
        end_time: '2025-09-01 08:20:00 UTC',
        start_longitude: -79.69,
        start_latitude: 44.38,
        end_longitude: -79.67,
        end_latitude: 44.40,
        service_name: 'Barrie Transit',
        route_short_name: route,
        mode: 'Transit',
        start_stop_name: 'Stop A',
        end_stop_name: 'Stop B',
    };
}

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

describe('aggregateTransitAppData routePerformance', () => {
    it('computes monthly scores and watchlist flags', () => {
        const parsed: TransitAppParsedData = {
            lines: [
                // January
                makeLine('400', '2025-01-06', 200, 140, 90, 24),
                makeLine('100', '2025-01-06', 200, 100, 60, 16),
                makeLine('7A', '2025-01-06', 200, 40, 16, 4),

                // July
                makeLine('400', '2025-07-08', 200, 150, 95, 30),
                makeLine('100', '2025-07-08', 200, 120, 70, 18),
                makeLine('7A', '2025-07-08', 200, 50, 20, 5),

                // September
                makeLine('400', '2025-09-09', 200, 160, 100, 32),
                makeLine('100', '2025-09-09', 200, 35, 8, 1),
                makeLine('7A', '2025-09-09', 200, 90, 50, 12),
            ],
            trips: [],
            locations: [],
            goTripLegs: [
                makeLeg('400', 'a1'),
                makeLeg('400', 'a2'),
                makeLeg('100', 'b1'),
                makeLeg('100', 'b2'),
                makeLeg('7A', 'c1'),
            ],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        expect(summary.routePerformance).toBeDefined();
        expect(summary.routePerformance?.months).toEqual(['2025-01', '2025-07', '2025-09']);
        expect(summary.routePerformance?.scorecard.length).toBe(3);

        const route100 = summary.routePerformance?.scorecard.find(r => r.route === '100');
        expect(route100).toBeDefined();
        expect(route100?.trend).toBe('Declining');
        expect(route100?.isWatchRoute).toBe(true);
    });

    it('marks normalization unavailable when route not found in GTFS', () => {
        const parsed: TransitAppParsedData = {
            lines: [makeLine('ZZZ', '2025-09-09', 120, 60, 24, 3)],
            trips: [],
            locations: [],
            goTripLegs: [makeLeg('ZZZ', 'z1')],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const zzz = summary.routePerformance?.monthly.find(r => r.route === 'ZZZ');
        expect(zzz).toBeDefined();
        expect(zzz?.normalizationAvailable).toBe(false);
        expect(zzz?.viewsPerScheduledTrip).toBeNull();
    });

    it('uses view-based suggestion rates for planner scorecards', () => {
        const parsed: TransitAppParsedData = {
            lines: [makeLine('400', '2025-09-09', 100, 20, 30, 6)],
            trips: [],
            locations: [],
            goTripLegs: [makeLeg('400', 'a1')],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const route400 = summary.routePerformance?.scorecard.find(r => r.route === '400');

        expect(route400).toBeDefined();
        expect(route400?.viewToTapRate).toBe(0.2);
        expect(route400?.viewToSuggestionRate).toBe(0.3);
        expect(route400?.tapToSuggestionRate).toBe(1.5);
        expect(route400?.suggestionToGoRate).toBe(0.2);
    });

    it('scopes observed legs to the row month instead of all imported history', () => {
        const parsed: TransitAppParsedData = {
            lines: [
                makeLine('A', '2025-01-09', 100, 50, 30, 6),
                makeLine('B', '2025-01-09', 100, 50, 30, 6),
                makeLine('A', '2025-09-09', 100, 50, 30, 6),
                makeLine('B', '2025-09-09', 100, 50, 30, 6),
            ],
            trips: [],
            locations: [],
            goTripLegs: [
                {
                    ...makeLeg('A', 'a-sep'),
                    start_time: '2025-09-09 08:00:00 UTC',
                    end_time: '2025-09-09 08:20:00 UTC',
                },
                {
                    ...makeLeg('B', 'b-jan-1'),
                    start_time: '2025-01-09 08:00:00 UTC',
                    end_time: '2025-01-09 08:20:00 UTC',
                },
                {
                    ...makeLeg('B', 'b-jan-2'),
                    start_time: '2025-01-10 08:00:00 UTC',
                    end_time: '2025-01-10 08:20:00 UTC',
                },
                {
                    ...makeLeg('B', 'b-jan-3'),
                    start_time: '2025-01-11 08:00:00 UTC',
                    end_time: '2025-01-11 08:20:00 UTC',
                },
                {
                    ...makeLeg('B', 'b-sep'),
                    start_time: '2025-09-09 08:00:00 UTC',
                    end_time: '2025-09-09 08:20:00 UTC',
                },
            ],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const septemberB = summary.routePerformance?.monthly.find(r => r.route === 'B' && r.month === '2025-09');
        const januaryB = summary.routePerformance?.monthly.find(r => r.route === 'B' && r.month === '2025-01');
        const scorecardB = summary.routePerformance?.scorecard.find(r => r.route === 'B');

        expect(januaryB?.totalLegs).toBe(3);
        expect(septemberB?.totalLegs).toBe(1);
        expect(scorecardB?.totalLegs).toBe(1);
    });
});
