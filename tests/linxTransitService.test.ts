import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LINX_GTFS_FEED_URL,
    fetchLinxFeed,
    getLinxBarrieStops,
    getLinxEventsForDay,
    toConnectionTimes,
    type LinxFeed
} from '../utils/gtfs/linxTransitService';

// 2026-10-20 is a Tuesday.
const TUE = new Date(2026, 9, 20, 9, 0);
const SAT = new Date(2026, 9, 24, 9, 0);

function makeFeed(overrides: Partial<LinxFeed> = {}): LinxFeed {
    return {
        fetchedAt: new Date().toISOString(),
        stops: [{ stopId: 'S1', name: 'Barrie, Georgian College' }],
        routes: [
            { routeId: 'R3', shortName: '3', longName: 'Barrie-Orillia' },
            { routeId: 'R1', shortName: '1', longName: 'Barrie - Midland-Penetanguishene' }
        ],
        trips: [
            { tripId: 'T_start', routeId: 'R3', serviceId: 'WK', headsign: 'Orillia' },
            { tripId: 'T_end', routeId: 'R3', serviceId: 'WK', headsign: 'Barrie' },
            { tripId: 'T_thru', routeId: 'R1', serviceId: 'WK', headsign: 'Midland' },
            { tripId: 'T_late', routeId: 'R1', serviceId: 'WK', headsign: 'Midland' },
            { tripId: 'T_dup', routeId: 'R3', serviceId: 'WK', headsign: 'Orillia' }
        ],
        stopTimes: [
            { tripId: 'T_start', stopId: 'S1', arr: '07:00:00', dep: '07:05:00', first: true, last: false },
            { tripId: 'T_end', stopId: 'S1', arr: '08:10:00', dep: '08:10:00', first: false, last: true },
            { tripId: 'T_thru', stopId: 'S1', arr: '09:00:00', dep: '09:03:00', first: false, last: false },
            { tripId: 'T_late', stopId: 'S1', arr: '24:30:00', dep: '24:30:00', first: true, last: false },
            { tripId: 'T_dup', stopId: 'S1', arr: '07:05:00', dep: '07:05:00', first: true, last: false }
        ],
        calendarDates: [
            { serviceId: 'WK', date: '20261020', exceptionType: 1 },
            { serviceId: 'WK', date: '20261021', exceptionType: 1 },
            { serviceId: 'WK', date: '20261022', exceptionType: 2 }
        ],
        ...overrides
    };
}

describe('getLinxEventsForDay', () => {
    it('classifies arrivals, departures and pass-through trips', () => {
        const events = getLinxEventsForDay(makeFeed(), ['S1'], 'Weekday', TUE);
        const byTime = (t: number) => events.filter(e => e.time === t);

        // trip ending here: arrival only
        expect(byTime(8 * 60 + 10)).toEqual([expect.objectContaining({ eventType: 'arrival', routeShortName: '3' })]);
        // trip starting here: departure only
        expect(byTime(7 * 60 + 5).map(e => e.eventType)).toEqual(['departure']);
        // pass-through: departure plus an arrival because times differ
        expect(byTime(9 * 60 + 3).map(e => e.eventType)).toEqual(['departure']);
        expect(byTime(9 * 60).map(e => e.eventType)).toEqual(['arrival']);
    });

    it('keeps times past 24:00 and sorts by time', () => {
        const events = getLinxEventsForDay(makeFeed(), ['S1'], 'Weekday', TUE);
        expect(events[events.length - 1].time).toBe(24 * 60 + 30);
        const times = events.map(e => e.time);
        expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it('removes duplicates with the same time, route and type', () => {
        const events = getLinxEventsForDay(makeFeed(), ['S1'], 'Weekday', TUE);
        expect(events.filter(e => e.time === 425 && e.eventType === 'departure' && e.routeShortName === '3')).toHaveLength(1);
    });

    it('returns an empty list for a day type with no service', () => {
        expect(getLinxEventsForDay(makeFeed(), ['S1'], 'Saturday', TUE)).toEqual([]);
        expect(getLinxEventsForDay(makeFeed(), ['S1'], 'Sunday', SAT)).toEqual([]);
    });

    it('skips a date whose service is removed and moves to the next active date', () => {
        const feed = makeFeed({
            calendarDates: [
                { serviceId: 'WK', date: '20261022', exceptionType: 1 },
                { serviceId: 'WK', date: '20261022', exceptionType: 2 },
                { serviceId: 'WK', date: '20261023', exceptionType: 1 }
            ]
        });
        // Thursday 22nd is removed, so Friday 23rd supplies the times.
        expect(getLinxEventsForDay(feed, ['S1'], 'Weekday', new Date(2026, 9, 22, 8, 0)).length).toBeGreaterThan(0);
    });

    it('picks a Saturday when Saturday service exists', () => {
        const feed = makeFeed({
            calendarDates: [{ serviceId: 'WK', date: '20261031', exceptionType: 1 }]
        });
        expect(getLinxEventsForDay(feed, ['S1'], 'Saturday', TUE).length).toBeGreaterThan(0);
        // beyond the 21 day look-ahead
        expect(getLinxEventsForDay(feed, ['S1'], 'Saturday', new Date(2026, 9, 1, 8, 0))).toEqual([]);
    });

    it('ignores stops that were not asked for', () => {
        expect(getLinxEventsForDay(makeFeed(), ['OTHER'], 'Weekday', TUE)).toEqual([]);
    });
});

describe('toConnectionTimes', () => {
    it('builds labels, day type and event type', () => {
        const events = getLinxEventsForDay(makeFeed(), ['S1'], 'Weekday', TUE);
        const deps = toConnectionTimes(events, 'Weekday', 'departure');
        const arrs = toConnectionTimes(events, 'Weekday', 'arrival');

        expect(deps.find(d => d.time === 425)).toMatchObject({
            label: 'LINX 3 to Orillia', eventType: 'departure', daysActive: ['Weekday'], enabled: true
        });
        expect(deps.find(d => d.time === 183 + 360)?.label).toBe('LINX 1 to Midland-Penetanguishene');
        expect(arrs.find(a => a.time === 490)?.label).toBe('LINX 3 from Orillia');
        expect(arrs.every(a => a.eventType === 'arrival')).toBe(true);
        expect(new Set([...deps, ...arrs].map(c => c.id)).size).toBe(deps.length + arrs.length);
    });
});

describe('fetchLinxFeed', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    const proxyBody = {
        stops: [
            { stop_id: 'SCSTOP110', stop_name: 'Barrie, Georgian College', stop_lat: 44.4, stop_lon: -79.6 },
            { stop_id: 'SCSTOP999', stop_name: 'Orillia Terminal' }
        ],
        routes: [
            { route_id: 'R3', route_short_name: '3', route_long_name: 'Barrie-Orillia' },
            { route_id: 'R9', route_short_name: '9', route_long_name: 'Elsewhere' }
        ],
        trips: [
            { trip_id: 'A', route_id: 'R3', service_id: 'WK', trip_headsign: 'Orillia' },
            { trip_id: 'B', route_id: 'R9', service_id: 'OTHER' }
        ],
        stopTimes: [
            { trip_id: 'A', stop_id: 'SCSTOP110', arrival_time: '07:00:00', departure_time: '07:00:00', stop_sequence: 1 },
            { trip_id: 'A', stop_id: 'SCSTOP999', arrival_time: '08:00:00', departure_time: '08:00:00', stop_sequence: 2 },
            { trip_id: 'B', stop_id: 'SCSTOP999', arrival_time: '09:00:00', departure_time: '09:00:00', stop_sequence: 1 }
        ],
        calendarDates: [
            { service_id: 'WK', date: '20261020', exception_type: 1 },
            { service_id: 'OTHER', date: '20261020', exception_type: 1 }
        ],
        feedInfo: { feedVersion: 'v1', feedEndDate: '20261231' }
    };

    it('calls the proxy with the encoded LINX url and keeps only Barrie data', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => proxyBody });
        vi.stubGlobal('fetch', fetchMock);

        const feed = await fetchLinxFeed();

        expect(fetchMock).toHaveBeenCalledWith(`/api/gtfs?url=${encodeURIComponent(LINX_GTFS_FEED_URL)}`);
        expect(getLinxBarrieStops(feed).map(s => s.stopId)).toEqual(['SCSTOP110']);
        expect(feed.stopTimes).toHaveLength(1);
        expect(feed.stopTimes[0]).toMatchObject({ tripId: 'A', first: true, last: false });
        expect(feed.trips.map(t => t.tripId)).toEqual(['A']);
        expect(feed.routes.map(r => r.routeId)).toEqual(['R3']);
        expect(feed.calendarDates.map(c => c.serviceId)).toEqual(['WK']);
        expect(feed.feedVersion).toBe('v1');
        expect(feed.feedEndDate).toBe('20261231');
    });

    it('uses the cache on a second call unless forceRefresh is set', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => proxyBody });
        vi.stubGlobal('fetch', fetchMock);

        await fetchLinxFeed();
        await fetchLinxFeed();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await fetchLinxFeed({ forceRefresh: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws when the proxy fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ details: 'boom' }) }));
        await expect(fetchLinxFeed()).rejects.toThrow(/500.*boom/);
    });
});
