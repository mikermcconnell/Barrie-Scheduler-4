import { describe, expect, it } from 'vitest';
import { aggregateTransitAppData } from '../utils/transit-app/transitAppAggregator';
import type { TransitAppFileStats, TransitAppParsedData, TransitAppTripRow } from '../utils/transit-app/transitAppTypes';
import {
    aggregateTransitAppODPairs,
    filterODPairForDisplay,
    getDirectionalCountsForZone,
    getHoursForODTimePeriod,
    getODPairCountForFilters,
    mergeBidirectionalODPairs,
    toUnmergedODPair,
    validateODPairTotals,
} from '../utils/transit-app/transitAppOdPairs';
import {
    buildODZonePanelData,
    filterPairsByRouteCorridor,
    getAvailableRouteNamesFromShapes,
} from '../utils/transit-app/transitAppOdDisplay';
import type { GtfsRouteShape } from '../utils/gtfs/gtfsShapesLoader';

function makeTrip(
    start_latitude: number,
    start_longitude: number,
    end_latitude: number,
    end_longitude: number,
    timestamp = '2025-01-15 14:00:00 UTC',
): TransitAppTripRow {
    return {
        user_id: `${start_latitude}-${start_longitude}-${end_latitude}-${end_longitude}-${timestamp}`,
        start_latitude,
        start_longitude,
        end_latitude,
        end_longitude,
        timestamp,
        arrive_by: '',
        leave_at: timestamp,
    };
}

function summarizeTrips(trips: TransitAppTripRow[]) {
    const parsed: TransitAppParsedData = {
        lines: [],
        trips,
        locations: [],
        goTripLegs: [],
        plannedTripLegs: [],
        tappedTripLegs: [],
        users: [],
    };
    const stats: TransitAppFileStats = {
        totalFiles: 1,
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        filesByType: {
            lines: 0,
            trips: 1,
            locations: 0,
            go_trip_legs: 0,
            planned_go_trip_legs: 0,
            tapped_trip_view_legs: 0,
            users: 0,
        },
        rowsParsed: trips.length,
        rowsSkipped: 0,
    };

    return aggregateTransitAppData(parsed, stats, 'test-user').odPairs!;
}

describe('Transit App OD pair aggregation', () => {
    it('skips invalid world coordinates and derives bounds from valid OD pairs only', () => {
        const odPairs = summarizeTrips([
            makeTrip(44.39, -79.69, 44.41, -79.67),
            makeTrip(-32.08, 115.91, 44.41, -79.67),
            makeTrip(44.39, -79.69, 51.48, -0.60),
        ]);

        expect(odPairs.totalTripsProcessed).toBe(1);
        expect(odPairs.totalTripsSkipped).toBe(2);
        expect(odPairs.pairs).toHaveLength(1);
        expect(odPairs.bounds).toEqual({
            minLat: 44.39,
            maxLat: 44.41,
            minLon: -79.69,
            maxLon: -79.67,
        });
    });

    it('keeps all generated OD pairs instead of silently dropping pairs after 5,000', () => {
        const trips = Array.from({ length: 5002 }, (_, index) => makeTrip(
            44.0,
            -80.0,
            44.5 + Math.floor(index / 1000) * 0.005,
            -79.0 + (index % 1000) * 0.005,
        ));

        const odPairs = aggregateTransitAppODPairs(trips);
        const retainedTrips = odPairs.pairs.reduce((sum, pair) => sum + pair.count, 0);

        expect(odPairs.totalTripsProcessed).toBe(5002);
        expect(odPairs.pairs).toHaveLength(5002);
        expect(retainedTrips).toBe(5002);
        expect(odPairs.totalTripsDroppedByPairLimit).toBe(0);
    });

    it('uses real America/Toronto time rules around DST boundaries', () => {
        const odPairs = summarizeTrips([
            makeTrip(44.39, -79.69, 44.41, -79.67, '2026-03-09 04:30:00 UTC'),
        ]);

        expect(odPairs.pairs[0].hourlyBins?.[0]).toBe(1);
        expect(odPairs.pairs[0].weekdayCount).toBe(1);
        expect(odPairs.pairs[0].weekendCount).toBe(0);
    });

    it('keeps invalid timestamps out of day, season, and hourly bins instead of assuming weekday', () => {
        const odPairs = summarizeTrips([
            makeTrip(44.39, -79.69, 44.41, -79.67, 'not-a-real-timestamp'),
        ]);

        expect(odPairs.totalTripsProcessed).toBe(1);
        expect(odPairs.pairs[0].count).toBe(1);
        expect(odPairs.pairs[0].weekdayCount).toBe(0);
        expect(odPairs.pairs[0].weekendCount).toBe(0);
        expect(odPairs.pairs[0].hourlyBins?.reduce((sum, count) => sum + count, 0)).toBe(0);
        expect(odPairs.pairs[0].seasonBins).toEqual({ jan: 0, jul: 0, sep: 0, other: 0 });
        expect(odPairs.pairs[0].odFilterBins).toEqual({});
    });
});

describe('Transit App bidirectional OD merge', () => {
    it('preserves forward and reverse counts for selected-zone inbound/outbound summaries', () => {
        const [merged] = mergeBidirectionalODPairs([
            {
                originLat: 44.39,
                originLon: -79.69,
                destLat: 44.41,
                destLon: -79.67,
                count: 10,
            },
            {
                originLat: 44.41,
                originLon: -79.67,
                destLat: 44.39,
                destLon: -79.69,
                count: 3,
            },
        ]);

        expect(merged.count).toBe(13);
        expect(merged.forwardCount).toBe(10);
        expect(merged.reverseCount).toBe(3);
        expect(getDirectionalCountsForZone(merged, '44.3900_-79.6900')).toEqual({
            outbound: 10,
            inbound: 3,
        });
        expect(getDirectionalCountsForZone(merged, '44.4100_-79.6700')).toEqual({
            outbound: 3,
            inbound: 10,
        });
    });

    it('does not fabricate zero day counts when merged source pairs have no valid breakdown bins', () => {
        const filteredLegacyForward = filterODPairForDisplay({
            originLat: 44.39,
            originLon: -79.69,
            destLat: 44.41,
            destLon: -79.67,
            count: 10,
            hourlyBins: new Array(24).fill(0),
            weekdayCount: 7,
            weekendCount: 3,
            seasonBins: { jan: 10, jul: 0, sep: 0, other: 0 },
        }, 'pm', 'weekday', 'jan');
        const filteredLegacyReverse = filterODPairForDisplay({
            originLat: 44.41,
            originLon: -79.67,
            destLat: 44.39,
            destLon: -79.69,
            count: 5,
            hourlyBins: new Array(24).fill(0),
            weekdayCount: 4,
            weekendCount: 1,
            seasonBins: { jan: 5, jul: 0, sep: 0, other: 0 },
        }, 'pm', 'weekday', 'jan');

        const [merged] = mergeBidirectionalODPairs([filteredLegacyForward, filteredLegacyReverse]);

        expect(merged.count).toBe(0);
        expect(merged.weekdayCount).toBeUndefined();
        expect(merged.weekendCount).toBeUndefined();
    });
});

describe('Transit App OD zone isolation summaries', () => {
    it('uses every supplied filtered zone flow instead of only a visible top-N slice', () => {
        const hourly = (hour: number, count: number) => {
            const bins = new Array(24).fill(0);
            bins[hour] = count;
            return bins;
        };
        const allZonePairs = [
            toUnmergedODPair({
                originLat: 44.39,
                originLon: -79.69,
                destLat: 44.41,
                destLon: -79.67,
                count: 10,
                hourlyBins: hourly(7, 10),
            }),
            toUnmergedODPair({
                originLat: 44.39,
                originLon: -79.69,
                destLat: 44.42,
                destLon: -79.66,
                count: 7,
                hourlyBins: hourly(16, 7),
            }),
            toUnmergedODPair({
                originLat: 44.39,
                originLon: -79.69,
                destLat: 44.43,
                destLon: -79.65,
                count: 3,
                hourlyBins: hourly(18, 3),
            }),
        ];

        const summary = buildODZonePanelData(
            allZonePairs,
            '44.3900_-79.6900',
            (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`,
        );

        expect(summary?.totalTrips).toBe(20);
        expect(summary?.uniqueConnections).toBe(3);
        expect(summary?.flows.map(flow => flow.total)).toEqual([10, 7, 3]);
        expect(summary?.peakPeriod).toBe('AM Peak');
    });

    it('preserves merged-pair inbound and outbound counts in the selected-zone flow list', () => {
        const [merged] = mergeBidirectionalODPairs([
            {
                originLat: 44.39,
                originLon: -79.69,
                destLat: 44.41,
                destLon: -79.67,
                count: 10,
            },
            {
                originLat: 44.41,
                originLon: -79.67,
                destLat: 44.39,
                destLon: -79.69,
                count: 4,
            },
        ]);

        const summary = buildODZonePanelData([merged], '44.3900_-79.6900');

        expect(summary?.totalTrips).toBe(14);
        expect(summary?.flows[0]).toMatchObject({
            outbound: 10,
            inbound: 4,
            total: 14,
        });
    });

    it('does not report Overnight as the peak when hourly bins exist but contain no trips', () => {
        const summary = buildODZonePanelData([
            toUnmergedODPair({
                originLat: 44.39,
                originLon: -79.69,
                destLat: 44.41,
                destLon: -79.67,
                count: 5,
                hourlyBins: new Array(24).fill(0),
            }),
        ], '44.3900_-79.6900');

        expect(summary?.totalTrips).toBe(5);
        expect(summary?.peakPeriod).toBeNull();
    });
});

describe('Transit App OD route corridor filter', () => {
    const shapes: GtfsRouteShape[] = [
        {
            routeId: '10-a',
            shapeId: 'shape-a',
            routeShortName: '10',
            routeColor: '888888',
            points: [
                [44.00, -79.00],
                [44.00, -79.10],
            ],
        },
        {
            routeId: '10-b',
            shapeId: 'shape-b',
            routeShortName: '10',
            routeColor: '888888',
            points: [
                [44.50, -79.50],
                [44.50, -79.60],
            ],
        },
        {
            routeId: '2',
            shapeId: 'shape-c',
            routeShortName: '2',
            routeColor: '888888',
            points: [
                [44.10, -79.20],
                [44.10, -79.30],
            ],
        },
    ];

    it('keeps OD pairs near any shape variant for the selected route', () => {
        const pairs = [
            {
                originLat: 44.50,
                originLon: -79.55,
                destLat: 44.50,
                destLon: -79.58,
                count: 8,
            },
            {
                originLat: 44.50,
                originLon: -79.55,
                destLat: 44.80,
                destLon: -79.80,
                count: 4,
            },
        ];

        const filtered = filterPairsByRouteCorridor(pairs, '10', shapes);

        expect(filtered).toHaveLength(1);
        expect(filtered[0].count).toBe(8);
    });

    it('dedupes and numerically sorts available route names from shape variants', () => {
        expect(getAvailableRouteNamesFromShapes(shapes)).toEqual(['2', '10']);
    });
});

describe('Transit App OD time filters', () => {
    it('uses the shared AM, midday, PM, evening, and overnight hour definitions', () => {
        expect(getHoursForODTimePeriod('am')).toEqual([6, 7, 8]);
        expect(getHoursForODTimePeriod('midday')).toEqual([9, 10, 11, 12, 13, 14]);
        expect(getHoursForODTimePeriod('pm')).toEqual([15, 16, 17]);
        expect(getHoursForODTimePeriod('evening')).toEqual([18, 19, 20, 21]);
        expect(getHoursForODTimePeriod('overnight')).toEqual([22, 23, 0, 1, 2, 3, 4, 5]);
    });

    it('counts exact day-season-hour intersections when OD filter bins are available', () => {
        const pair = {
            originLat: 44.39,
            originLon: -79.69,
            destLat: 44.41,
            destLon: -79.67,
            count: 9,
            odFilterBins: {
                'weekday|jan|17': 2,
                'weekday|jan|18': 3,
                'saturday|jan|23': 4,
            },
        };

        expect(getODPairCountForFilters(pair, 'pm', 'weekday', 'jan')).toBe(2);
        expect(getODPairCountForFilters(pair, 'evening', 'weekday', 'jan')).toBe(3);
        expect(getODPairCountForFilters(pair, 'overnight', 'weekend', 'jan')).toBe(4);
    });

    it('rebuilds display bins to match the active exact OD filter intersection', () => {
        const filtered = filterODPairForDisplay({
            originLat: 44.39,
            originLon: -79.69,
            destLat: 44.41,
            destLon: -79.67,
            count: 12,
            odFilterBins: {
                'weekday|jan|17': 2,
                'weekday|jan|18': 3,
                'saturday|jan|23': 4,
                'weekday|sep|17': 3,
            },
        }, 'pm', 'weekday', 'jan');

        expect(filtered.count).toBe(2);
        expect(filtered.hourlyBins?.reduce((sum, count) => sum + count, 0)).toBe(2);
        expect(filtered.hourlyBins?.[17]).toBe(2);
        expect(filtered.hourlyBins?.[18]).toBe(0);
        expect(filtered.weekdayCount).toBe(2);
        expect(filtered.weekendCount).toBe(0);
        expect(filtered.seasonBins).toEqual({ jan: 2, jul: 0, sep: 0, other: 0 });
        expect(validateODPairTotals(filtered)).toBe(true);
    });

    it('does not carry stale breakdown bins when exact OD filter bins are unavailable', () => {
        const filtered = filterODPairForDisplay({
            originLat: 44.39,
            originLon: -79.69,
            destLat: 44.41,
            destLon: -79.67,
            count: 9,
            hourlyBins: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3],
            weekdayCount: 7,
            weekendCount: 2,
            seasonBins: { jan: 4, jul: 2, sep: 3, other: 0 },
        }, 'overnight', 'weekday', 'jan');

        expect(filtered.count).toBe(4);
        expect(filtered.hourlyBins).toBeUndefined();
        expect(filtered.weekdayCount).toBeUndefined();
        expect(filtered.weekendCount).toBeUndefined();
        expect(filtered.seasonBins).toBeUndefined();
    });
});
