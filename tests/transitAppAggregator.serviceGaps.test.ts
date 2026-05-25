import { describe, expect, it, vi } from 'vitest';
import type {
    TransitAppFileStats,
    TransitAppParsedData,
    TransitAppTripLegRow,
} from '../utils/transit-app/transitAppTypes';

vi.mock('../utils/transit-app/transitAppGtfsNormalization', () => ({
    getScheduledTripsForRouteOnDate: () => 10,
    hasGtfsNormalizationData: () => true,
    hasGtfsSupplyProfiles: () => true,
    getRouteSupplyProfiles: () => [
        {
            route: '2',
            dayType: 'weekday',
            firstDepartureMin: 360,
            lastDepartureMin: 1200,
            avgHeadwayMinutes: 30,
            departuresByHour: [
                0, 0, 0, 0, 0, 0,
                2, 2, 2, 2, 2, 2,
                2, 2, 2, 2, 2, 2,
                2, 2, 1, 0, 0, 0,
            ],
            totalDepartures: 33,
        },
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
            route: '200',
            dayType: 'weekday',
            firstDepartureMin: 390, // 06:30
            lastDepartureMin: 1200,
            avgHeadwayMinutes: 30,
            departuresByHour: [
                0, 0, 0, 0, 0, 0,
                1, 2, 2, 2, 2, 2,
                2, 2, 2, 2, 2, 2,
                2, 2, 1, 0, 0, 0,
            ],
            totalDepartures: 32,
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

function makeLeg(route: string, start: string, id: string, serviceName = 'Barrie Transit'): TransitAppTripLegRow {
    return {
        user_trip_id: id,
        start_time: start,
        end_time: start,
        start_longitude: -79.69,
        start_latitude: 44.38,
        end_longitude: -79.67,
        end_latitude: 44.4,
        service_name: serviceName,
        route_short_name: route,
        mode: 'Transit',
        start_stop_name: 'Stop A',
        end_stop_name: 'Stop B',
    };
}

describe('aggregateTransitAppData service gap analysis (UC4)', () => {
    it('builds demand-supply profiles and flags key gap types', () => {
        const janWeekdayLegs = [
            makeLeg('100', '2025-01-06 09:10:00 UTC', 'w1'), // 04:10 ET span-start
            makeLeg('100', '2025-01-07 02:10:00 UTC', 'w2'), // 21:10 ET span-end
            makeLeg('100', '2025-01-06 17:15:00 UTC', 'w3'), // 12:15 ET low jan midday baseline
        ];
        const julWeekdayMiddaySpike = [
            makeLeg('100', '2025-07-07 16:00:00 UTC', 'j1'),
            makeLeg('100', '2025-07-07 16:05:00 UTC', 'j2'),
            makeLeg('100', '2025-07-07 16:10:00 UTC', 'j3'),
            makeLeg('100', '2025-07-07 16:15:00 UTC', 'j4'),
            makeLeg('100', '2025-07-07 16:20:00 UTC', 'j5'),
            makeLeg('100', '2025-07-07 16:25:00 UTC', 'j6'),
        ];
        const saturdayDemand = [
            makeLeg('100', '2025-01-12 01:05:00 UTC', 's1'), // 20:05 ET Saturday, after weekend span
            makeLeg('100', '2025-01-12 01:10:00 UTC', 's2'),
            makeLeg('100', '2025-01-12 01:20:00 UTC', 's3'),
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
        expect(serviceGaps?.schemaVersion).toBe(2);
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

    it('filters non-Barrie transit legs out of Barrie service-gap demand', () => {
        const parsed: TransitAppParsedData = {
            lines: [],
            trips: [],
            locations: [],
            goTripLegs: [
                makeLeg('100', '2025-01-06 13:00:00 UTC', 'barrie-route-100'),
                makeLeg('100', '2025-01-06 13:05:00 UTC', 'regional-route-100', 'GO Transit'),
            ],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const weekdayJan = summary.serviceGapAnalysis?.routeProfiles.find(
            row => row.route === '100' && row.dayType === 'weekday' && row.season === 'jan'
        );

        expect(summary.serviceGapAnalysis?.totals.routesWithDemand).toBe(1);
        expect(weekdayJan?.totalDemand).toBe(1);
    });

    it('normalizes merged A/B route demand to the base Barrie route', () => {
        const parsed: TransitAppParsedData = {
            lines: [],
            trips: [],
            locations: [],
            goTripLegs: [
                makeLeg('2A', '2025-01-06 13:00:00 UTC', 'route-2a-demand'),
            ],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const profile = summary.serviceGapAnalysis?.routeProfiles.find(
            row => row.route === '2' && row.dayType === 'weekday' && row.season === 'jan'
        );

        expect(profile?.totalDemand).toBe(1);
        expect(summary.serviceGapAnalysis?.totals.matchedRoutes).toBe(1);
    });

    it('uses exact local minutes for span-start demand instead of whole-hour approximation', () => {
        const parsed: TransitAppParsedData = {
            lines: [],
            trips: [],
            locations: [],
            goTripLegs: [
                makeLeg('200', '2025-01-06 11:10:00 UTC', 'before-first'), // 06:10 ET, before 06:30 first trip
                makeLeg('200', '2025-01-06 11:45:00 UTC', 'after-first'), // 06:45 ET, after first trip
            ],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const profile = summary.serviceGapAnalysis?.routeProfiles.find(
            row => row.route === '200' && row.dayType === 'weekday' && row.season === 'jan'
        );
        const spanStart = summary.serviceGapAnalysis?.gapRegister.find(
            row => row.route === '200' && row.gapType === 'span_start'
        );

        expect(profile?.totalDemand).toBe(2);
        expect(profile?.demandBeforeFirst).toBe(1);
        expect(spanStart?.appRequestsPerHour).toBe(1);
    });
});
