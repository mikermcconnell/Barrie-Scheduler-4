import { describe, expect, it, vi } from 'vitest';
import type {
    TransitAppFileStats,
    TransitAppParsedData,
    TransitAppTripLegRow,
} from '../utils/transitAppTypes';

vi.mock('../utils/transitAppGtfsNormalization', () => ({
    getScheduledTripsForRouteOnDate: () => 10,
    hasGtfsNormalizationData: () => true,
    hasGtfsSupplyProfiles: () => true,
    getRouteSupplyProfiles: () => [
        {
            route: '100',
            dayType: 'weekday',
            firstDepartureMin: 360, // 06:00
            lastDepartureMin: 1200, // 20:00
            avgHeadwayMinutes: 30,
            departuresByHour: [
                0, 0, 0, 0, 0, 0, // 00-05
                2, 2, 2, 2, 2, 2, // 06-11
                2, 2, 2, 2, 2, 2, // 12-17
                2, 2, 1, 0, 0, 0, // 18-23
            ],
            totalDepartures: 33,
        },
        {
            route: '100',
            dayType: 'saturday',
            firstDepartureMin: 480, // 08:00
            lastDepartureMin: 1080, // 18:00
            avgHeadwayMinutes: 60,
            departuresByHour: [
                0, 0, 0, 0, 0, 0, 0, 0, // 00-07
                1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 08-18
                0, 0, 0, 0, 0, // 19-23
            ],
            totalDepartures: 11,
        },
        {
            route: '100',
            dayType: 'sunday',
            firstDepartureMin: 540, // 09:00
            lastDepartureMin: 1020, // 17:00
            avgHeadwayMinutes: 70,
            departuresByHour: [
                0, 0, 0, 0, 0, 0, 0, 0, 0, // 00-08
                1, 1, 1, 1, 1, 1, 1, 1, 1, // 09-17
                0, 0, 0, 0, 0, 0, // 18-23
            ],
            totalDepartures: 9,
        },
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

function makeLeg(route: string, start: string, id: string): TransitAppTripLegRow {
    return {
        user_trip_id: id,
        start_time: start,
        end_time: start,
        start_longitude: -79.69,
        start_latitude: 44.38,
        end_longitude: -79.67,
        end_latitude: 44.4,
        service_name: 'Barrie Transit',
        route_short_name: route,
        mode: 'Transit',
        start_stop_name: 'Stop A',
        end_stop_name: 'Stop B',
    };
}

describe('aggregateTransitAppData service gap analysis (UC4)', () => {
    it('builds demand-supply profiles and flags key gap types', () => {
        const janWeekdayLegs = [
            makeLeg('100', '2025-01-06 05:10:00 UTC', 'w1'), // span-start
            makeLeg('100', '2025-01-06 22:10:00 UTC', 'w2'), // span-end
            makeLeg('100', '2025-01-06 12:15:00 UTC', 'w3'), // low jan midday baseline
        ];
        const julWeekdayMiddaySpike = [
            makeLeg('100', '2025-07-07 12:00:00 UTC', 'j1'),
            makeLeg('100', '2025-07-07 12:05:00 UTC', 'j2'),
            makeLeg('100', '2025-07-07 12:10:00 UTC', 'j3'),
            makeLeg('100', '2025-07-07 12:15:00 UTC', 'j4'),
            makeLeg('100', '2025-07-07 12:20:00 UTC', 'j5'),
            makeLeg('100', '2025-07-07 12:25:00 UTC', 'j6'),
        ];
        const saturdayDemand = [
            makeLeg('100', '2025-01-11 20:05:00 UTC', 's1'), // after weekend span
            makeLeg('100', '2025-01-11 20:10:00 UTC', 's2'),
            makeLeg('100', '2025-01-11 20:20:00 UTC', 's3'),
        ];

        const parsed: TransitAppParsedData = {
            lines: [
                {
                    route_short_name: '100',
                    nearby_views: 200,
                    nearby_taps: 110,
                    tapped_routing_suggestions: 70,
                    go_trips: 12,
                    date: '2025-01-06',
                },
            ],
            trips: [],
            locations: [],
            goTripLegs: [...janWeekdayLegs, ...julWeekdayMiddaySpike, ...saturdayDemand],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const serviceGaps = summary.serviceGapAnalysis;

        expect(serviceGaps).toBeDefined();
        expect(serviceGaps?.routeProfiles.length).toBeGreaterThan(0);
        expect(serviceGaps?.totals.routesWithDemand).toBe(1);
        expect(serviceGaps?.totals.matchedRoutes).toBe(1);

        const weekdayJan = serviceGaps?.routeProfiles.find(
            row => row.route === '100' && row.dayType === 'weekday' && row.season === 'jan'
        );
        expect(weekdayJan).toBeDefined();
        expect(weekdayJan?.demandBeforeFirst).toBeGreaterThan(0);
        expect(weekdayJan?.demandAfterLast).toBeGreaterThan(0);

        const gapTypes = new Set((serviceGaps?.gapRegister || []).map(row => row.gapType));
        expect(gapTypes.has('span_start')).toBe(true);
        expect(gapTypes.has('span_end')).toBe(true);
        expect(gapTypes.has('weekend')).toBe(true);
        expect(gapTypes.has('seasonal_shift')).toBe(true);
    });
});
