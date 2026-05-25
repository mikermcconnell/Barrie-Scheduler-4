import { describe, expect, it } from 'vitest';
import { aggregateTransitAppData } from '../utils/transit-app/transitAppAggregator';
import type { TransitAppFileStats, TransitAppParsedData, TransitAppTripRow } from '../utils/transit-app/transitAppTypes';
import {
    getDirectionalCountsForZone,
    getHoursForODTimePeriod,
    getODPairCountForFilters,
    mergeBidirectionalODPairs,
} from '../utils/transit-app/transitAppOdPairs';

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

        const odPairs = summarizeTrips(trips);
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
});
