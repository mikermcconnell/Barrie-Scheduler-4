import { describe, expect, it } from 'vitest';
import { diffGoFeeds, representativeServiceDate } from '../utils/regional-transit/feedDiff';
import type { RegionalGoFeed } from '../utils/regional-transit/types';

interface TrainSpec { id: string; number: string; headsign: string; service: string; time: string; stop?: string }

function feed(trains: TrainSpec[], options: { start?: string; end?: string; removedDates?: { service: string; date: string }[] } = {}): RegionalGoFeed {
    const start = options.start ?? '20260929';
    const end = options.end ?? '20261127';
    return {
        fetchedAt: '2020-01-01T00:00:00.000Z',
        sourceUrl: 'test',
        timezone: 'America/Toronto',
        stops: [{ stop_id: 'AD', stop_name: 'Allandale Waterfront GO' }, { stop_id: 'BA', stop_name: 'Barrie South GO' }],
        routes: [{ route_id: 'BR', route_type: 2 }],
        trips: trains.map(train => ({ trip_id: train.id, route_id: 'BR', service_id: train.service, trip_short_name: train.number, trip_headsign: train.headsign })),
        stopTimes: trains.map((train, index) => ({ trip_id: train.id, stop_id: train.stop ?? 'AD', arrival_time: train.time, departure_time: train.time, stop_sequence: index + 1 })),
        calendar: [
            { service_id: 'WK', start_date: start, end_date: end, monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0 },
            { service_id: 'SA', start_date: start, end_date: end, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 1, sunday: 0 },
        ],
        calendarDates: (options.removedDates ?? []).map(item => ({ service_id: item.service, date: item.date, exception_type: 2 })),
    };
}

const base: TrainSpec[] = [
    { id: 't1', number: '1000', headsign: 'Union Station', service: 'WK', time: '06:00:00' },
    { id: 't2', number: '1002', headsign: 'Union Station', service: 'WK', time: '07:00:00' },
    { id: 't3', number: '1001', headsign: 'Allandale Waterfront', service: 'WK', time: '18:00:00' },
    { id: 't4', number: '2000', headsign: 'Union Station', service: 'SA', time: '09:00:00' },
];

describe('diffGoFeeds', () => {
    it('reports no changes for identical feeds', () => {
        const diff = diffGoFeeds(feed(base), feed(base));
        expect(diff.changes).toEqual([]);
        expect(diff.comparisons.find(item => item.dayType === 'Weekday')?.unchanged).toBe(3);
        expect(diff.comparisons.find(item => item.dayType === 'Sunday')?.beforeDate).toBeNull();
    });

    it('reports added, removed and shifted trains by train number', () => {
        const after = feed([
            { ...base[0], time: '06:10:00' },
            base[2],
            base[3],
            { id: 't9', number: '1010', headsign: 'Union Station', service: 'WK', time: '08:00:00' },
        ]);
        const changes = diffGoFeeds(feed(base), after).changes;
        expect(changes).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'shifted', trainNumber: '1000', dayType: 'Weekday', direction: 'to-go', beforeMinutes: 360, afterMinutes: 370 }),
            expect.objectContaining({ kind: 'removed', trainNumber: '1002', beforeMinutes: 420 }),
            expect.objectContaining({ kind: 'added', trainNumber: '1010', afterMinutes: 480 }),
        ]));
        expect(changes).toHaveLength(3);
    });

    it('keeps stations separate', () => {
        const moved = base.map(train => train.id === 't1' ? { ...train, stop: 'BA' } : train);
        const changes = diffGoFeeds(feed(base), feed(moved)).changes;
        expect(changes.map(change => `${change.kind}:${change.station}`).sort()).toEqual(['added:south', 'removed:allandale']);
    });

    it('compares a whole day type that only exists in one snapshot', () => {
        const withSunday = feed([...base, { id: 't5', number: '3000', headsign: 'Union Station', service: 'SU', time: '10:00:00' }]);
        withSunday.calendar.push({ service_id: 'SU', start_date: '20260929', end_date: '20261127', monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 1 });
        const diff = diffGoFeeds(feed(base), withSunday);
        expect(diff.changes).toEqual([expect.objectContaining({ kind: 'added', dayType: 'Sunday', trainNumber: '3000' })]);
        expect(diff.comparisons.find(item => item.dayType === 'Sunday')).toMatchObject({ beforeDate: null, afterDate: expect.any(String) });
    });

    it('works on snapshots far older than the live-feed freshness limit', () => {
        expect(diffGoFeeds(feed(base), feed(base)).comparisons.every(item => item.issues.length === 0)).toBe(true);
    });
});

describe('representativeServiceDate', () => {
    it('skips a holiday where service is removed', () => {
        const holiday = feed(base, { removedDates: [{ service: 'WK', date: '20260930' }] });
        const date = representativeServiceDate(holiday, 'Weekday');
        expect(date).not.toBe('2026-09-30');
        expect(date).toMatch(/^2026-/);
    });

    it('returns null when no day of that type has service', () => {
        expect(representativeServiceDate(feed(base), 'Sunday')).toBeNull();
    });
});
