import { describe, expect, it } from 'vitest';
import { buildDemoGoChange } from '../utils/regional-transit/demoGoChange';
import { diffGoFeedsOnDates } from '../utils/regional-transit/feedDiff';
import type { RegionalGoFeed } from '../utils/regional-transit/types';

const trains = [
    { id: 'u1', number: '1000', headsign: 'Union Station', time: '06:00:00' },
    { id: 'u2', number: '1002', headsign: 'Union Station', time: '07:00:00' },
    { id: 'a1', number: '1001', headsign: 'Allandale Waterfront', time: '17:00:00' },
    { id: 'a2', number: '1003', headsign: 'Allandale Waterfront', time: '18:00:00' },
    { id: 'a3', number: '1005', headsign: 'Allandale Waterfront', time: '23:50:00' },
];

const feed: RegionalGoFeed = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: 'test',
    timezone: 'America/Toronto',
    stops: [{ stop_id: 'AD', stop_name: 'Allandale Waterfront GO' }],
    routes: [{ route_id: 'BR', route_type: 2 }],
    trips: trains.map(train => ({ trip_id: train.id, route_id: 'BR', service_id: 'WK', trip_short_name: train.number, trip_headsign: train.headsign })),
    stopTimes: trains.map(train => ({ trip_id: train.id, stop_id: 'AD', arrival_time: train.time, departure_time: train.time, stop_sequence: 1 })),
    calendar: [{ service_id: 'WK', start_date: '20260101', end_date: '20271231', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0 }],
    calendarDates: [],
};

describe('buildDemoGoChange', () => {
    it('moves, removes and adds trains without touching the source feed', () => {
        const demo = buildDemoGoChange(feed, '2026-10-07')!;
        const diff = diffGoFeedsOnDates(feed, demo.feed, '2026-10-07', '2026-10-07', 'Weekday');
        expect(diff.changes.map(change => [change.trainNumber, change.kind, change.beforeMinutes, change.afterMinutes])).toEqual(expect.arrayContaining([
            ['1003', 'shifted', 1080, 1070],
            ['1005', 'removed', 1430, undefined],
            ['1002', 'shifted', 420, 428],
            ['DEMO', 'added', undefined, 390],
        ]));
        expect(diff.changes).toHaveLength(4);
        expect(diff.comparisons[0].unchanged).toBe(2);
        expect(feed.trips).toHaveLength(5);
        expect(demo.summary).toHaveLength(4);
    });

    it('declines dates without enough trains', () => {
        expect(buildDemoGoChange(feed, '2026-10-10')).toBeNull();
    });
});
