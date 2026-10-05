import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { parseRegionalGoZip, validateRegionalGoFeed } from '../utils/gtfs/regionalGoParser';

function feedData() {
    return {
        agency: [{ agency_timezone: 'America/Toronto' }],
        routes: [{ route_id: 'BR', route_type: 2 }, { route_id: 'BUS', route_type: 3 }],
        trips: [
            { trip_id: 'TRAIN', route_id: 'BR', service_id: 'WK', trip_short_name: '6801', trip_headsign: 'Union Station', direction_id: '0' },
            { trip_id: 'BUS1', route_id: 'BUS', service_id: 'OTHER' },
        ],
        stops: [
            { stop_id: 'AD', stop_name: 'Allandale Waterfront GO', parent_station: '' },
            { stop_id: 'AD1', stop_name: 'Allandale Platform 1', parent_station: 'AD' },
            { stop_id: 'BA', stop_name: 'Barrie South GO', parent_station: '' },
            { stop_id: 'BUSSTOP', stop_name: 'Bus only', parent_station: '' },
        ],
        stopTimes: [
            { trip_id: 'TRAIN', stop_id: 'AD1', arrival_time: '24:15:00', departure_time: '24:17:00', stop_sequence: '1', pickup_type: '0', drop_off_type: 1 },
            { trip_id: 'TRAIN', stop_id: 'BA', arrival_time: '24:25:00', departure_time: '24:27:00', stop_sequence: 2, pickup_type: 1, drop_off_type: '0' },
            { trip_id: 'BUS1', stop_id: 'BUSSTOP', arrival_time: '', departure_time: '', stop_sequence: 1 },
        ],
        calendar: [
            { service_id: 'WK', start_date: '20260901', end_date: '20261031', monday: '1', tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: '0', sunday: 0 },
            { service_id: 'OTHER', start_date: '20260901', end_date: '20261031', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0 },
        ],
        calendarDates: [{ service_id: 'WK', date: '20261012', exception_type: '2' }],
    };
}

function zipFeed(raw: Record<string, unknown>): ArrayBuffer {
    const names: Record<string, string> = { stopTimes: 'stop_times', calendarDates: 'calendar_dates' };
    const files: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (value === undefined) continue;
        const table = value as Record<string, unknown>[];
        if (!table.length) { files[`${names[key] || key}.txt`] = strToU8(''); continue; }
        const headers = [...new Set(table.flatMap(row => Object.keys(row)))];
        const quote = (text: unknown) => `"${String(text ?? '').replace(/"/g, '""')}"`;
        files[`${names[key] || key}.txt`] = strToU8('\uFEFF' + [headers.join(','), ...table.map(row => headers.map(header => quote(row[header])).join(','))].join('\r\n'));
    }
    return zipSync(files).buffer as ArrayBuffer;
}

function response(raw: Record<string, unknown> = feedData()) {
    return { ok: true, headers: new Headers(), arrayBuffer: async () => zipFeed(raw) };
}

class MockWorker {
    static instances: MockWorker[] = [];
    static suspended = false;
    onmessage?: (event: unknown) => void;
    onerror?: (event: unknown) => void;
    terminate = vi.fn();
    constructor() { MockWorker.instances.push(this); }
    postMessage(buffer: ArrayBuffer) {
        if (MockWorker.suspended) return;
        try {
            const feed = parseRegionalGoZip(buffer);
            this.onmessage?.({ data: { feed } });
        } catch {
            this.onmessage?.({ data: { error: 'Invalid data' } });
        }
    }
}

describe('regional public GO feed service', () => {
    let fetchRegionalGoFeed: typeof import('../utils/gtfs/regionalGoService').fetchRegionalGoFeed;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
        fetchMock = vi.fn().mockResolvedValue(response());
        MockWorker.instances = [];
        MockWorker.suspended = false;
        vi.stubGlobal('Worker', MockWorker);
        vi.stubGlobal('fetch', fetchMock);
        ({ fetchRegionalGoFeed } = await import('../utils/gtfs/regionalGoService'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('uses the fixed public ZIP and retains rail metadata and service-day hours', async () => {
        const result = await fetchRegionalGoFeed();
        expect(fetchMock).toHaveBeenCalledWith(result.sourceUrl, expect.objectContaining({ cache: 'no-cache', credentials: 'omit', signal: expect.any(AbortSignal) }));
        expect(MockWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
        expect(result.sourceUrl).toBe('https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip');
        expect(result.fetchedAt).toBe('2026-10-02T12:00:00.000Z');
        expect(result.timezone).toBe('America/Toronto');
        expect(result.routes).toEqual([{ route_id: 'BR', route_type: 2 }]);
        expect(result.trips).toEqual([expect.objectContaining({ trip_short_name: '6801', direction_id: 0, trip_headsign: 'Union Station' })]);
        expect(result.stopTimes).toHaveLength(2);
        expect(result.stopTimes[0]).toEqual(expect.objectContaining({ arrival_time: '24:15:00', departure_time: '24:17:00', stop_sequence: 1, pickup_type: 0, drop_off_type: 1 }));
        expect(result.stops.map(stop => stop.stop_id).sort()).toEqual(['AD', 'AD1', 'BA']);
        expect(result.stops.find(stop => stop.stop_id === 'AD1')?.parent_station).toBe('AD');
        expect(result.calendar).toHaveLength(1);
        expect(result.calendarDates[0].exception_type).toBe(2);
    });

    it('accepts a date-only service calendar and extended rail route types', async () => {
        const raw: Record<string, unknown> = feedData();
        raw.calendar = undefined;
        raw.calendarDates = [{ service_id: 'WK', date: '20261002', exception_type: 1 }];
        raw.routes = [{ route_id: 'BR', route_type: '100' }];
        fetchMock.mockResolvedValueOnce(response(raw));
        const result = await fetchRegionalGoFeed();
        expect(result.calendar).toEqual([]);
        expect(result.routes[0].route_type).toBe(100);
        expect(result.calendarDates).toEqual([{ service_id: 'WK', date: '20261002', exception_type: 1 }]);
    });

    it('reuses the short-lived memory cache, refreshes explicitly, and expires after 15 minutes', async () => {
        const first = await fetchRegionalGoFeed();
        expect(await fetchRegionalGoFeed()).toBe(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(60_000);
        const refreshed = await fetchRegionalGoFeed({ forceRefresh: true });
        expect(refreshed.fetchedAt).toBe('2026-10-02T12:01:00.000Z');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(15 * 60_000);
        await fetchRegionalGoFeed();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not turn HTTP or network failures into an empty or fallback feed', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
        await expect(fetchRegionalGoFeed()).rejects.toThrow('HTTP 503');
        fetchMock.mockRejectedValueOnce(new Error('private token in upstream failure'));
        await expect(fetchRegionalGoFeed()).rejects.toThrow('Check your connection');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not serve a stale feed when an explicit refresh fails', async () => {
        await fetchRegionalGoFeed();
        fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });
        await expect(fetchRegionalGoFeed({ forceRefresh: true })).rejects.toThrow('HTTP 502');
    });

    it('cancels promptly even if fetch does not respect cancellation', async () => {
        fetchMock.mockImplementationOnce(() => new Promise(() => {}));
        const controller = new AbortController();
        const request = fetchRegionalGoFeed({ signal: controller.signal });
        const check = expect(request).rejects.toThrow('cancelled');
        controller.abort();
        await check;
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects already cancelled requests before fetching or serving cached data', async () => {
        await fetchRegionalGoFeed();
        const controller = new AbortController();
        controller.abort();
        await expect(fetchRegionalGoFeed({ signal: controller.signal })).rejects.toThrow('cancelled');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('bounds the entire request including slow body reading to 45 seconds', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers(), arrayBuffer: () => new Promise(() => {}) });
        const request = fetchRegionalGoFeed();
        const check = expect(request).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(45_000);
        await check;
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['missing timezone', (raw: ReturnType<typeof feedData>) => { raw.agency = []; }],
        ['wrong timezone', (raw: ReturnType<typeof feedData>) => { raw.agency[0].agency_timezone = 'America/Vancouver'; }],
        ['no rail routes', (raw: ReturnType<typeof feedData>) => { raw.routes = [{ route_id: 'BUS', route_type: 3 }]; }],
        ['invalid route type', (raw: ReturnType<typeof feedData>) => { raw.routes[0].route_type = NaN; }],
        ['missing rail stops', (raw: ReturnType<typeof feedData>) => { raw.stops = []; }],
        ['missing parent station', (raw: ReturnType<typeof feedData>) => { raw.stops = raw.stops.filter(stop => stop.stop_id !== 'AD'); }],
        ['duplicate trip IDs', (raw: ReturnType<typeof feedData>) => { raw.trips.push(raw.trips[0]); }],
        ['invalid time', (raw: ReturnType<typeof feedData>) => { raw.stopTimes[0].arrival_time = '24:70:00'; }],
        ['invalid pickup', (raw: ReturnType<typeof feedData>) => { raw.stopTimes[0].pickup_type = '9'; }],
        ['invalid calendar date', (raw: ReturnType<typeof feedData>) => { raw.calendar[0].start_date = '20260230'; }],
        ['invalid weekday flag', (raw: ReturnType<typeof feedData>) => { raw.calendar[0].monday = '9'; }],
        ['invalid exception type', (raw: ReturnType<typeof feedData>) => { raw.calendarDates[0].exception_type = '0'; }],
        ['missing service', (raw: ReturnType<typeof feedData>) => { raw.calendar = []; raw.calendarDates = []; }],
        ['duplicate service', (raw: ReturnType<typeof feedData>) => { raw.calendar.push(raw.calendar[0]); }],
        ['duplicate exception', (raw: ReturnType<typeof feedData>) => { raw.calendarDates.push(raw.calendarDates[0]); }],
    ])('rejects malformed data: %s', async (_, mutate) => {
        const raw = feedData();
        mutate(raw);
        expect(() => validateRegionalGoFeed(raw)).toThrow('GO schedule data is invalid');
    });

    it('rejects malformed table shapes or non-ZIP responses instead of successful empty feeds', async () => {
        expect(() => validateRegionalGoFeed({ ...feedData(), stopTimes: {} })).toThrow('stop times');
        fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers(), arrayBuffer: async () => strToU8('<html>App shell</html>').buffer });
        await expect(fetchRegionalGoFeed()).rejects.toThrow('GO schedule data is invalid');
    });

    it('terminates worker parsing on cancellation and on timeout', async () => {
        MockWorker.suspended = true;
        const controller = new AbortController();
        const request = fetchRegionalGoFeed({ signal: controller.signal });
        const check = expect(request).rejects.toThrow('cancelled');
        await vi.advanceTimersByTimeAsync(1);
        controller.abort();
        await check;
        expect(MockWorker.instances[0].terminate).toHaveBeenCalled();
        const timedRequest = fetchRegionalGoFeed();
        const timedCheck = expect(timedRequest).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(45_000);
        await timedCheck;
        expect(MockWorker.instances[1].terminate).toHaveBeenCalled();
    });

    it('rejects oversized declared ZIPs before downloading the body', async () => {
        const body = vi.fn();
        fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-length': String(51 * 1024 * 1024) }), arrayBuffer: body });
        await expect(fetchRegionalGoFeed()).rejects.toThrow('ZIP size');
        expect(body).not.toHaveBeenCalled();
    });

    it('reports worker startup and runtime failures without falling back', async () => {
        vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker policy failed'); } });
        await expect(fetchRegionalGoFeed()).rejects.toThrow('could not be loaded');
        vi.stubGlobal('Worker', class extends MockWorker { postMessage() { this.onerror?.({}); } });
        await expect(fetchRegionalGoFeed()).rejects.toThrow('processing failed');
    });

    it('prevents an older overlapping request from overwriting the latest refresh', async () => {
        let resolveFirst!: (response: unknown) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
        const first = fetchRegionalGoFeed();
        const second = await fetchRegionalGoFeed({ forceRefresh: true });
        vi.advanceTimersByTime(10_000);
        resolveFirst(response());
        await first;
        expect(await fetchRegionalGoFeed()).toBe(second);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});


describe('regional GO ZIP parser', () => {
    it('filters other rail stations while preserving train metadata and station parents', () => {
        const raw = feedData();
        raw.stops.push({ stop_id: 'UN', stop_name: 'Union GO', parent_station: '' });
        raw.stopTimes.push({ trip_id: 'TRAIN', stop_id: 'UN', arrival_time: '25:30:00', departure_time: '25:30:00', stop_sequence: 3 });
        const parsed = parseRegionalGoZip(zipFeed(raw));
        expect(parsed.stopTimes.map(stop => stop.stop_id)).toEqual(['AD1', 'BA']);
        expect(parsed.stops.map(stop => stop.stop_id).sort()).toEqual(['AD', 'AD1', 'BA']);
        expect(parsed.trips[0].trip_short_name).toBe('6801');
    });

    it('handles escaped quotes, commas, BOM and quoted newlines', () => {
        const raw = feedData();
        raw.trips[0].trip_headsign = 'Union, "Express"\nTrain';
        const parsed = parseRegionalGoZip(zipFeed(raw));
        expect(parsed.trips[0].trip_headsign).toBe(raw.trips[0].trip_headsign);
    });

    it('rejects missing GTFS tables and does not infer a timezone', () => {
        const raw: Record<string, unknown> = feedData();
        delete raw.agency;
        expect(() => parseRegionalGoZip(zipFeed(raw))).toThrow('missing agency.txt');
    });

    it('ignores large unrelated files instead of extracting shapes', () => {
        const files = unzipSync(new Uint8Array(zipFeed(feedData())));
        files['shapes.txt'] = strToU8('ignored'.repeat(1_000_000));
        const parsed = parseRegionalGoZip(zipSync(files).buffer as ArrayBuffer);
        expect(parsed.routes).toEqual([{ route_id: 'BR', route_type: 2 }]);
        expect(parsed.calendar).toHaveLength(1);
    });

    it('rejects oversized unpacked declarations before decompression', () => {
        const bytes = new Uint8Array(zipFeed(feedData()));
        const view = new DataView(bytes.buffer);
        for (let index = 0; index < bytes.length - 28; index++) {
            if (view.getUint32(index, true) === 0x02014b50) {
                view.setUint32(index + 24, 251 * 1024 * 1024, true);
                break;
            }
        }
        expect(() => parseRegionalGoZip(bytes.buffer)).toThrow('unpacked size');
    });

    it('rejects duplicate ZIP tables even if they are in different folders', () => {
        const files = unzipSync(new Uint8Array(zipFeed(feedData())));
        files['nested/agency.txt'] = files['agency.txt'];
        expect(() => parseRegionalGoZip(zipSync(files).buffer as ArrayBuffer)).toThrow('duplicate ZIP table');
    });
});
