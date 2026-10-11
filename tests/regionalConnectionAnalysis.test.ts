import { describe, expect, it } from 'vitest';
import { buildLocalConnectionRows, findConnection, formatServiceTime, getGoTrainEvents } from '../utils/regional-transit/connectionAnalysis';
import type { GoTrainEvent, LocalConnectionRow, PublishedRouteSource, RegionalGoFeed } from '../utils/regional-transit/types';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';

const DATE = '2026-10-02'; // Friday
function feed(): RegionalGoFeed {
    return { fetchedAt: new Date().toISOString(), sourceUrl: 'https://example.test/gtfs.zip', timezone: 'America/Toronto',
        stops: [{ stop_id: 'AD', stop_name: 'Allandale Waterfront GO' }, { stop_id: 'AD1', stop_name: 'Platform 1', parent_station: 'AD' },
            { stop_id: 'BA', stop_name: 'Barrie South GO' }], routes: [{ route_id: 'BR', route_type: 2 }, { route_id: 'BUS', route_type: 3 }],
        trips: [{ trip_id: 'train1', route_id: 'BR', service_id: 'WD', trip_short_name: '680', trip_headsign: 'BR - Union Station GO', direction_id: '1' }],
        stopTimes: [{ trip_id: 'train1', stop_id: 'AD1', arrival_time: '06:58:00', departure_time: '07:00:00', stop_sequence: 1 }],
        calendar: [{ service_id: 'WD', start_date: '20261001', end_date: '20261031', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0 }],
        calendarDates: [] };
}

function trip(patch: Partial<MasterTrip> = {}): MasterTrip {
    return { id: 'bus1', blockId: '8A-1', direction: 'North', tripNumber: 1, rowId: 1, startTime: 390, endTime: 440,
        recoveryTime: 0, travelTime: 50, cycleTime: 50, stops: { Origin: '6:30 AM', GO: '6:50 AM', End: '7:20 AM' },
        stopMinutes: { Origin: 390, GO: 410, End: 440 }, ...patch };
}
function source(bus = trip()): PublishedRouteSource {
    return { entry: { id: '8A-Weekday', routeNumber: '8A', dayType: 'Weekday', currentVersion: 4, storagePath: 'published.json',
        tripCount: 1, northStopCount: 3, southStopCount: 0, updatedAt: new Date(), updatedBy: 'u', uploaderName: 'Planner', source: 'draft' },
        content: { metadata: { routeNumber: '8A', dayType: 'Weekday', uploadedAt: new Date().toISOString() },
            northTable: { routeName: '8A (Weekday) (North)', stops: ['Origin', 'GO', 'End'], stopIds: { Origin: '101', GO: '9003', End: '102' }, trips: [bus] },
            southTable: { routeName: '8A (Weekday) (South)', stops: [], stopIds: {}, trips: [] } } };
}
function row(bus = trip()): LocalConnectionRow { return buildLocalConnectionRows([source(bus)], 'allandale', DATE, 'Weekday')[0]; }
function event(minutes = 420, direction: GoTrainEvent['direction'] = 'to-go'): GoTrainEvent {
    return { id: 'go', tripId: 'go', trainNumber: '680', headsign: 'Union', stationStopId: 'AD', direction, minutes };
}

describe('GO train service-date selection', () => {
    it('resolves rail train trips at child platform stops and uses departure toward GO', () => {
        expect(getGoTrainEvents(feed(), 'allandale', DATE)).toMatchObject({ status: 'ready', events: [{ trainNumber: '680', minutes: 420, direction: 'to-go' }] });
    });
    it('uses actual weekdays and calendar removal/addition exceptions', () => {
        const data = feed();
        expect(getGoTrainEvents(data, 'allandale', '2026-10-03').status).toBe('no-service');
        data.calendarDates.push({ service_id: 'WD', date: '20261003', exception_type: 1 }, { service_id: 'WD', date: '20261002', exception_type: 2 });
        expect(getGoTrainEvents(data, 'allandale', '2026-10-03').events).toHaveLength(1);
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('no-service');
    });
    it('supports exception-only feeds without assuming a weekday pattern', () => {
        const data = feed(); data.calendar = []; data.calendarDates = [{ service_id: 'WD', date: '20261002', exception_type: '1' }];
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('ready');
        expect(getGoTrainEvents(data, 'allandale', '2026-10-03').status).toBe('unavailable');
    });
    it('rejects invalid, out-of-range, uncovered-gap dates, wrong timezone and stale feeds', () => {
        const data = feed();
        expect(getGoTrainEvents(data, 'allandale', '2026-02-30').status).toBe('unavailable');
        expect(getGoTrainEvents(data, 'allandale', '2026-11-01').status).toBe('unavailable');
        data.calendar[0].end_date = '20261001';
        data.calendarDates.push({ service_id: 'WD', date: '20261031', exception_type: 1 });
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
        data.timezone = 'UTC'; expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
        data.timezone = 'America/Toronto'; data.fetchedAt = '2000-01-01';
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
    });
    it('returns unavailable, not fallback train times, when calendar coverage is missing', () => {
        const data = feed(); data.calendar = [];
        expect(getGoTrainEvents(data, 'allandale', DATE)).toMatchObject({ status: 'unavailable', events: [] });
    });
    it('reports unknown trip service calendars and unknown pickup modes as unavailable', () => {
        const data = feed(); data.trips[0].service_id = 'MISSING';
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
        data.trips[0].service_id = 'WD'; data.stopTimes[0].pickup_type = 9;
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
    });
    it('preserves distinct same-time trips and excludes bus routes', () => {
        const data = feed(); data.trips.push({ ...data.trips[0], trip_id: 'train2' }, { ...data.trips[0], trip_id: 'bus', route_id: 'BUS' });
        data.stopTimes.push({ ...data.stopTimes[0], trip_id: 'train2' }, { ...data.stopTimes[0], trip_id: 'bus' });
        expect(getGoTrainEvents(data, 'allandale', DATE).events.map(item => item.tripId)).toEqual(['train1', 'train2']);
    });
    it('honors direction and station arrival times from GO including after midnight', () => {
        const data = feed(); data.trips[0].direction_id = 0; data.trips[0].trip_headsign = 'Allandale Waterfront GO';
        data.stopTimes[0].arrival_time = '24:10:00'; data.stopTimes[0].departure_time = '24:12:00';
        expect(getGoTrainEvents(data, 'allandale', DATE).events[0]).toMatchObject({ direction: 'from-go', minutes: 1450 });
        data.trips[0].trip_headsign = 'Union';
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
    });
    it('uses the verified GO mapping when headsign is absent and destination text when ID is absent', () => {
        const data = feed(); data.trips[0].trip_headsign = undefined;
        expect(getGoTrainEvents(data, 'allandale', DATE).events[0].direction).toBe('to-go');
        data.trips[0].direction_id = 0;
        expect(getGoTrainEvents(data, 'allandale', DATE).events[0].direction).toBe('from-go');
        data.trips[0].direction_id = undefined; data.trips[0].trip_headsign = 'BR - Allandale Waterfront GO';
        expect(getGoTrainEvents(data, 'allandale', DATE).events[0].direction).toBe('from-go');
        data.trips[0].trip_headsign = 'Unknown destination';
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
    });
    it('rejects malformed times and malformed calendar flags', () => {
        const data = feed(); data.stopTimes[0].departure_time = '07:60:00';
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
        data.calendar[0].friday = 'yes';
        expect(getGoTrainEvents(data, 'allandale', DATE).status).toBe('unavailable');
    });
    it.each([1, 2, 3])('does not offer restricted pickup mode %s as an ordinary To GO connection', mode => {
        const data = feed(); data.stopTimes[0].pickup_type = mode;
        expect(getGoTrainEvents(data, 'allandale', DATE).events).toEqual([]);
        if (mode > 1) expect(getGoTrainEvents(data, 'allandale', DATE).issues).not.toEqual([]);
    });
    it('ignores pickup restrictions From GO but obeys no drop-off', () => {
        const data = feed(); data.trips[0].direction_id = 0; data.trips[0].trip_headsign = 'Allandale'; data.stopTimes[0].pickup_type = 1;
        expect(getGoTrainEvents(data, 'allandale', DATE).events).toHaveLength(1);
        data.stopTimes[0].drop_off_type = 1;
        expect(getGoTrainEvents(data, 'allandale', DATE).events).toHaveLength(0);
    });
});

describe('published bus schedule analysis', () => {
    it('prefers numeric stopMinutes over display clocks and keeps schedule version', () => {
        const local = row(trip({ stops: { GO: '12:00 PM' } }));
        expect(local).toMatchObject({ version: 4, stopCodes: ['9003'], arrivals: [{ minutes: 410 }], departures: [{ minutes: 410 }] });
    });
    it('distinguishes station arrival from departure around recovery', () => {
        const local = row(trip({ arrivalTimes: { GO: '6:45 AM' }, recoveryTime: 5, recoveryTimes: { GO: 5 } }));
        expect(findConnection(local, event())).toMatchObject({ status: 'comfortable', busMinutes: 405, gapMinutes: 15 });
        expect(findConnection(local, event(400, 'from-go'))).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
    });
    it('derives arrival from granular recovery without changing any source data', () => {
        const bus = trip({ recoveryTime: 5, recoveryTimes: { GO: 5 } }); const before = JSON.stringify(bus);
        expect(row(bus).arrivals[0].minutes).toBe(405);
        expect(JSON.stringify(bus)).toBe(before);
    });
    it('does not guess terminal arrival when recovery timing is ambiguous', () => {
        const local = row(trip({ recoveryTime: 5, endStopIndex: 1 }));
        expect(findConnection(local, event()).status).toBe('unavailable');
        expect(findConnection(local, event(400, 'from-go')).status).toBe('no-connection');
    });
    it.each([['8A', '9005'], ['8B', '9013']])('assesses %s northbound at Allandale without applying recovery at the later terminus', (routeNumber, stopCode) => {
        const data = source(trip({ recoveryTime: 5, recoveryTimes: undefined, arrivalTimes: undefined }));
        data.entry.routeNumber = routeNumber; data.entry.id = `${routeNumber}-Weekday`;
        data.content!.metadata.routeNumber = routeNumber;
        data.content!.northTable.stopIds.GO = stopCode;
        const before = JSON.stringify(data);
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(findConnection(local, event())).toMatchObject({ status: 'comfortable', busMinutes: 410, gapMinutes: 10 });
        expect(findConnection(local, event(400, 'from-go'))).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
        expect(JSON.stringify(data)).toBe(before);
    });
    it('keeps missing explicit intermediate arrival clocks unassessed instead of replacing invalid data', () => {
        const local = row(trip({ recoveryTime: 5, arrivalTimes: { GO: '' } }));
        expect(findConnection(local, event())).toMatchObject({ status: 'unavailable', issue: expect.stringContaining('First rejected bus trip: bus1; stop: GO; arrival: ""') });
        expect(local.arrivalIssue).toContain('trip start/end minutes: 390/440');
        expect(local.arrivalIssue).toContain('station is intermediate');
    });
    it('preserves next-day intermediate timing with legacy terminal recovery', () => {
        const local = row(trip({ startTime: 1440, endTime: 1490, recoveryTime: 5, stopMinutes: { GO: 1450 } }));
        expect(findConnection(local, event(1460))).toMatchObject({ busMinutes: 1450, gapMinutes: 10 });
    });
    it('identifies the first rejected trip and flags overlapping connections it could have beaten', () => {
        const data = source();
        data.content!.northTable.trips.push(trip({ id: 'invalid-arrival-1', arrivalTimes: { GO: '12:00 AM' } }), trip({ id: 'invalid-arrival-2', arrivalTimes: { GO: '' } }));
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(local.arrivals).toHaveLength(1);
        expect(findConnection(local, event())).toMatchObject({ status: 'comfortable', tripId: 'bus1', issue: expect.stringContaining('invalid-arrival-1') });
        expect(findConnection(local, event(445))).toMatchObject({ status: 'unavailable', issue: expect.stringContaining('First rejected bus trip: invalid-arrival-1') });
        expect(local.arrivalIssue).toContain('arrival: "12:00 AM"');
        expect(local.arrivalIssue).not.toContain('invalid-arrival-2');
        expect(findConnection(local, event(400, 'from-go')).status).toBe('comfortable');
    });
    it('does not let imported 8A-N-33 interline dwell invalidate morning northbound connections', () => {
        const data = source();
        data.content!.northTable.stopIds.GO = '9005';
        data.content!.northTable.trips.push(trip({ id: '8A-N-33', startTime: 1242, endTime: 1273, stopMinutes: undefined,
            stops: { GO: '8:37 PM' }, arrivalTimes: { GO: '8:37 PM' }, recoveryTimes: { GO: 5, End: 4 }, recoveryTime: 9 }));
        const before = JSON.stringify(data);
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(local.arrivalIssue).toBeUndefined();
        expect(local.departureIssue).toBeUndefined();
        expect(findConnection(local, event())).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
        expect(findConnection(local, event(1247))).toMatchObject({ busMinutes: 1237, gapMinutes: 10 });
        expect(findConnection(local, event(1237, 'from-go'))).toMatchObject({ busMinutes: 1242, gapMinutes: 5 });
        expect(JSON.stringify(data)).toBe(before);
    });
    it('uses imported arrival plus stop recovery for onward departures within a trip', () => {
        const local = row(trip({ stopMinutes: undefined, stops: { GO: '6:45 AM' }, arrivalTimes: { GO: '6:45 AM' }, recoveryTimes: { GO: 5 }, recoveryTime: 5 }));
        expect(findConnection(local, event())).toMatchObject({ busMinutes: 405, gapMinutes: 15 });
        expect(findConnection(local, event(400, 'from-go'))).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
    });
    it('preserves explicit imported interline arrival and departure across midnight', () => {
        const local = row(trip({ startTime: 1442, endTime: 1473, stopMinutes: undefined,
            stops: { GO: '11:57 PM' }, arrivalTimes: { GO: '11:57 PM' }, recoveryTimes: { GO: 5 }, recoveryTime: 5 }));
        expect(local.arrivalIssue).toBeUndefined();
        expect(findConnection(local, event(1450))).toMatchObject({ busMinutes: 1437, gapMinutes: 13 });
        expect(findConnection(local, event(1437, 'from-go'))).toMatchObject({ busMinutes: 1442, gapMinutes: 5 });
    });
    it('rejects an early explicit arrival whose dwell does not explain the trip start', () => {
        const local = row(trip({ startTime: 1242, endTime: 1273, stopMinutes: undefined,
            stops: { GO: '8:36 PM' }, arrivalTimes: { GO: '8:36 PM' }, recoveryTimes: { GO: 5 }, recoveryTime: 9 }));
        expect(findConnection(local, event(1247)).status).toBe('unavailable');
        expect(findConnection(local, event(1237, 'from-go')).status).toBe('unavailable');
    });
    it('does not infer inbound service when interline dwell is recorded at the active trip origin', () => {
        const local = row(trip({ startStopIndex: 1, startTime: 1242, endTime: 1273, stopMinutes: undefined,
            stops: { GO: '8:37 PM' }, arrivalTimes: { GO: '8:37 PM' }, recoveryTimes: { GO: 5 }, recoveryTime: 5 }));
        expect(findConnection(local, event(1247)).status).toBe('no-connection');
        expect(findConnection(local, event(1237, 'from-go'))).toMatchObject({ busMinutes: 1242, gapMinutes: 5 });
    });
    it('anchors imported interline dwell on a later service-day midnight before adding recovery', () => {
        const local = row(trip({ startTime: 2882, endTime: 2913, stopMinutes: undefined,
            stops: { GO: '11:57 PM' }, arrivalTimes: { GO: '11:57 PM' }, recoveryTimes: { GO: 5 }, recoveryTime: 5 }));
        expect(findConnection(local, event(2890))).toMatchObject({ busMinutes: 2877, gapMinutes: 13 });
        expect(findConnection(local, event(2877, 'from-go'))).toMatchObject({ busMinutes: 2882, gapMinutes: 5 });
    });
    it.each([['7', '7-N-1', 329, 331, '9006'], ['12', '12-N-2', 354, 363, '9013']])('does not let a short %s trip before Allandale block full station-serving trips', (routeNumber, id, start, end, code) => {
        const data = source();
        data.entry.routeNumber = routeNumber; data.entry.id = `${routeNumber}-Weekday`;
        data.content!.metadata.routeNumber = routeNumber;
        data.content!.northTable.stops = ['Origin', 'ShortEnd', 'GO', 'End'];
        data.content!.northTable.stopIds.GO = code;
        data.content!.northTable.trips.push(trip({ id, startTime: start, endTime: end, recoveryTime: 2,
            stopMinutes: undefined, stops: { Origin: formatServiceTime(start), ShortEnd: formatServiceTime(end) }, arrivalTimes: undefined }));
        const before = JSON.stringify(data);
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(findConnection(local, event())).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
        expect(findConnection(local, event(400, 'from-go'))).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
        expect(local.arrivals.map(item => item.tripId)).toEqual(['bus1']);
        expect(JSON.stringify(data)).toBe(before);
    });
    it('does not let short 7-S-33 starting beyond Allandale block other trips', () => {
        const data = source(); data.content!.northTable.stops = ['Origin', 'GO', 'ShortStart', 'End'];
        data.content!.northTable.trips.push(trip({ id: '7-S-33', startTime: 1412, endTime: 1421, recoveryTime: 0,
            stopMinutes: undefined, stops: { ShortStart: '11:32 PM', End: '11:41 PM' }, arrivalTimes: undefined }));
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(findConnection(local, event())).toMatchObject({ busMinutes: 410 });
        expect(findConnection(local, event(400, 'from-go'))).toMatchObject({ busMinutes: 410 });
    });
    it('keeps missing station timing within the recorded trip span unassessed', () => {
        const local = row(trip({ stops: { Origin: '6:30 AM', End: '7:20 AM' }, stopMinutes: undefined }));
        expect(findConnection(local, event()).status).toBe('unavailable');
    });
    it('does not override explicit active bounds with sparse timing inference', () => {
        const local = row(trip({ startStopIndex: 0, endStopIndex: 2, stops: { GO: '6:50 AM', End: '7:20 AM' }, stopMinutes: undefined }));
        expect(findConnection(local, event())).toMatchObject({ busMinutes: 410 });
    });
    it.each([['Saturday', '2026-10-17'], ['Sunday', '2026-10-18']] as const)('discloses the rejected %s trip bounds and does not repair reversed anchors by guessing', (dayType, date) => {
        const data = source(trip({ id: `8A-${dayType}-invalid`, startTime: 1500, endTime: 20 }));
        data.entry.dayType = dayType; data.entry.id = `8A-${dayType}`; data.content!.metadata.dayType = dayType;
        const local = buildLocalConnectionRows([data], 'allandale', date, dayType)[0];
        expect(findConnection(local, event())).toMatchObject({ status: 'unavailable', issue: expect.stringContaining(`First rejected bus trip: 8A-${dayType}-invalid`) });
        expect(local.arrivalIssue).toContain('trip start/end minutes: 1500/20');
        expect(local.arrivalIssue).toContain('active stop indexes: 0/2; table stop count: 3');
    });
    it('does not let malformed timing on a proven unserved short trip invalidate the station chart', () => {
        const data = source(); data.content!.northTable.stops = ['Origin', 'ShortEnd', 'GO', 'End'];
        data.content!.northTable.trips.push(trip({ id: 'unserved-invalid', startTime: 1500, endTime: 20,
            stops: { Origin: '1:00 AM', ShortEnd: '1:02 AM' }, stopMinutes: undefined }));
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(findConnection(local, event())).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
    });
    it('aligns wrapped departure and arrival clocks to trips spanning midnight', () => {
        const local = row(trip({ startTime: 1420, endTime: 1490, stopMinutes: undefined, recoveryTime: 5,
            stops: { GO: '12:15 AM' }, arrivalTimes: { GO: '12:10 AM' } }));
        expect(local.arrivals[0].minutes).toBe(1450); expect(local.departures[0].minutes).toBe(1455);
        expect(findConnection(local, event(1460))).toMatchObject({ busMinutes: 1450, gapMinutes: 10 });
        expect(formatServiceTime(1450)).toBe('12:10 AM (+1 day)');
    });
    it('unwraps an adapter-imported end clock for a same-day trip crossing midnight', () => {
        const local = row(trip({ id: '7-T-75', startTime: 1412, endTime: 14, stopMinutes: undefined,
            stops: { Origin: '11:32 PM', GO: '11:50 PM', End: '12:14 AM' } }));
        expect(local.arrivalIssue).toBeUndefined(); expect(local.departureIssue).toBeUndefined();
        expect(local.arrivals[0].minutes).toBe(1430);
        expect(findConnection(local, event(1440))).toMatchObject({ busMinutes: 1430, gapMinutes: 10 });
    });
    it('blocks only cells near a trip carrying another trip station clock (8B-T-77)', () => {
        const local = row(); const data = source();
        data.content!.northTable.trips.push(trip({ id: '8B-T-77', startTime: 1223, endTime: 1343, recoveryTime: 39, stopMinutes: undefined,
            stops: { Origin: '8:23 PM', GO: '8:12 PM', End: '10:23 PM' } }));
        const mixed = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(mixed.arrivalIssue).toContain('8B-T-77'); expect(mixed.departureIssue).toContain('8B-T-77');
        expect(findConnection(mixed, event())).toEqual(findConnection(local, event()));
        expect(findConnection(mixed, event(400, 'from-go'))).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
        expect(findConnection(mixed, event(1300)).status).toBe('unavailable');
        expect(findConnection(mixed, event(1300, 'from-go')).status).toBe('unavailable');
        expect(findConnection(mixed, event(1000)).status).toBe('no-connection');
    });
    it('assesses the earlier onward leg of an interlined round-trip row as departure only (8B-T-77)', () => {
        const interlined = { ...trip({ id: '8B-T-77', startTime: 1223, endTime: 1343, recoveryTime: 39, stopMinutes: undefined,
            stops: { Origin: '8:23 PM', GO: '8:12 PM', End: '10:23 PM' } }), interlinePrev: { route: '8A', time: 1267 } } as MasterTrip;
        const local = row(interlined);
        expect(local.departureIssue).toBeUndefined(); expect(local.arrivalIssue).toBeUndefined();
        expect(local.departures).toMatchObject([{ tripId: '8B-T-77', minutes: 1212 }]);
        expect(local.arrivals).toEqual([]);
        expect(findConnection(local, event(1190, 'from-go'))).toMatchObject({ busMinutes: 1212, gapMinutes: 22 });
        const tooEarly = row({ ...interlined, stops: { Origin: '8:23 PM', GO: '7:12 PM', End: '10:23 PM' } } as MasterTrip);
        expect(tooEarly.departureIssue).toContain('8B-T-77');
    });
    it('keeps a late trip missing its station clock (7-T-75) from hiding daytime connections', () => {
        const data = source();
        data.content!.northTable.trips.push(trip({ id: '7-T-75', startTime: 1412, endTime: 1454, stopMinutes: undefined,
            stops: { Origin: '11:32 PM', End: '12:14 AM' } }));
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(local.arrivalIssue).toContain('7-T-75');
        expect(findConnection(local, event())).toMatchObject({ busMinutes: 410, gapMinutes: 10 });
        expect(findConnection(local, event(1450)).status).toBe('unavailable');
    });
    it('treats rejected trips with unusable anchors as blocking every empty cell', () => {
        const local = row(trip({ id: 'reversed', startTime: 1500, endTime: 20 }));
        expect(findConnection(local, event(100)).status).toBe('unavailable');
        expect(findConnection(local, event(900, 'from-go')).status).toBe('unavailable');
    });
    it('preserves explicit numeric next-day minutes, never joining an early same-day bus to a next-day train', () => {
        const local = row(trip({ startTime: 1440, endTime: 1490, stopMinutes: { GO: 1450 } }));
        expect(findConnection(local, event(1460)).status).toBe('comfortable');
        expect(findConnection(row(), event(1850)).status).toBe('no-connection');
    });
    it('honors partial trip bounds instead of using inactive stored stop values', () => {
        const local = row(trip({ startStopIndex: 2, endStopIndex: 2 }));
        expect(local.arrivals).toEqual([]); expect(findConnection(local, event()).status).toBe('no-connection');
        expect(findConnection(row(trip({ startStopIndex: -1 })), event()).status).toBe('unavailable');
    });
    it('does not invent inbound travel when a partial trip starts at GO', () => {
        const local = row(trip({ startStopIndex: 1, endStopIndex: 2 }));
        expect(local.arrivals).toEqual([]);
        expect(findConnection(local, event()).status).toBe('no-connection');
        expect(findConnection(local, event(400, 'from-go')).status).toBe('comfortable');
    });
    it('does not invent onward travel when a partial trip ends at GO, including block-ending trips', () => {
        const local = row(trip({ startStopIndex: 0, endStopIndex: 1, isBlockEnd: true }));
        expect(local.departures).toEqual([]);
        expect(findConnection(local, event(400, 'from-go')).status).toBe('no-connection');
        expect(findConnection(local, event()).status).toBe('comfortable');
    });
    it('never treats the whole-table GO terminal as an onward trip, even with a terminal departure', () => {
        const data = source(); data.content!.northTable.stops = ['Origin', 'GO'];
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(findConnection(local, event(400, 'from-go')).status).toBe('no-connection');
        expect(findConnection(local, event()).status).toBe('comfortable');
    });
    it('does not require unused arrival timing at an origin or unused departure timing at a terminal', () => {
        const starting = row(trip({ startStopIndex: 1, recoveryTime: 5 }));
        expect(findConnection(starting, event()).status).toBe('no-connection');
        expect(findConnection(starting, event(400, 'from-go')).status).toBe('comfortable');
        const ending = row(trip({ endStopIndex: 1, stops: { GO: '' }, stopMinutes: undefined, arrivalTimes: { GO: '6:50 AM' } }));
        expect(findConnection(ending, event()).status).toBe('comfortable');
        expect(findConnection(ending, event(400, 'from-go')).status).toBe('no-connection');
    });
    it('keeps block-ending origin trips eligible for their real onward segment', () => {
        const local = row(trip({ startStopIndex: 1, endStopIndex: 2, isBlockEnd: true }));
        expect(findConnection(local, event(400, 'from-go')).status).toBe('comfortable');
    });
    it('reports repeated active station-name timings as ambiguous instead of reusing one keyed clock', () => {
        const data = source(); data.content!.northTable.stops = ['Origin', 'GO', 'End', 'GO'];
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(findConnection(local, event()).status).toBe('unavailable');
        expect(findConnection(local, event(400, 'from-go')).status).toBe('unavailable');
    });
    it('uses the correct repeated station occurrence when partial bounds select only that call', () => {
        const data = source(trip({ startStopIndex: 2, endStopIndex: 3 }));
        data.content!.northTable.stops = ['GO', 'Origin', 'End', 'GO'];
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(findConnection(local, event()).status).toBe('comfortable');
        expect(findConnection(local, event(400, 'from-go')).status).toBe('no-connection');
    });
    it('matches Route 12B Stop 14 to Allandale without treating it as a terminal platform or Barrie South stop', () => {
        const data = source(); data.entry.routeNumber = '12'; data.entry.id = '12-Weekday'; data.content!.metadata.routeNumber = '12';
        data.content!.northTable = { routeName: '12 (North)', stops: [], stopIds: {}, trips: [] };
        data.content!.southTable = { routeName: '12 (South)', stops: ['Origin', 'GO', 'End'], stopIds: { Origin: '101', GO: '14', End: '102' }, trips: [trip()] };
        const before = JSON.stringify(data);
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(local).toMatchObject({ direction: 'South', stopCodes: ['14'], status: 'ready' });
        expect(findConnection(local, event())).toMatchObject({ busMinutes: 410, gapMinutes: 10, stopCode: '14' });
        expect(findConnection(local, event(400, 'from-go'))).toMatchObject({ busMinutes: 410, gapMinutes: 10, stopCode: '14' });
        expect(buildLocalConnectionRows([data], 'south', DATE, 'Weekday')).toEqual([]);
        expect(JSON.stringify(data)).toBe(before);
    });
    it('uses exact HUB stop codes rather than similarly named stations', () => {
        const data = source(); data.content!.northTable.stopIds.GO = '999';
        data.content!.northTable.stops = ['Allandale nearby']; data.content!.northTable.stopIds['Allandale nearby'] = '123';
        expect(buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0].status).toBe('unavailable');
        const south = source(); south.content!.northTable.stopIds.GO = '725';
        expect(buildLocalConnectionRows([south], 'south', DATE, 'Weekday')[0].status).toBe('ready');
    });
    it('discloses failed loads, null timing and malformed timing as unavailable', () => {
        const failed = source(); failed.content = undefined; failed.error = 'Read failed';
        expect(buildLocalConnectionRows([failed], 'allandale', DATE, 'Weekday')[0]).toMatchObject({ status: 'unavailable', issue: 'Read failed' });
        expect(findConnection(row(trip({ stopMinutes: undefined, stops: { GO: '' } })), event()).status).toBe('unavailable');
        expect(findConnection(row(trip({ stopMinutes: { GO: NaN } })), event()).status).toBe('unavailable');
    });
    it('uses the explicitly selected holiday day type rather than deriving weekdays internally', () => {
        expect(buildLocalConnectionRows([source()], 'allandale', DATE, 'Sunday')).toEqual([]);
        expect(buildLocalConnectionRows([source()], 'allandale', DATE, 'No Service')).toEqual([]);
    });
    it('omits directions that never name the station but flags a named station without a mapped code', () => {
        const data = source(); data.content!.northTable.stopIds.GO = '999';
        expect(buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')).toEqual([]);
        data.content!.northTable.stops = ['Origin', 'Barrie Allandale Transit Terminal', 'End'];
        data.content!.northTable.stopIds['Barrie Allandale Transit Terminal'] = '999';
        expect(buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0]).toMatchObject({ status: 'unavailable', issue: expect.stringContaining('appears by name') });
    });
    it('keeps loop rows loop-labelled rather than manufacturing North or South directions', () => {
        const data = source(); data.entry.routeNumber = '100'; data.entry.id = '100-Weekday'; data.content!.metadata.routeNumber = '100';
        const local = buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0];
        expect(local.id).toBe('100-Weekday:Loop:0'); expect(local.direction).toBe('Loop (Clockwise)');
    });
    it('rejects a published route or day type that does not match its entry', () => {
        const data = source(); data.content!.metadata.dayType = 'Sunday';
        expect(buildLocalConnectionRows([data], 'allandale', DATE, 'Weekday')[0].status).toBe('unavailable');
    });
});

describe('connection cells', () => {
    it.each([[1, 'tight'], [5, 'tight'], [6, 'comfortable'], [15, 'comfortable'], [16, 'long'], [30, 'long'], [0, 'no-connection'], [-1, 'no-connection'], [31, 'no-connection']] as const)
        ('classifies the raw gap %s as %s', (gap, status) => expect(findConnection(row(), event(410 + gap)).status).toBe(status));
    it('chooses the closest positive bus trip even when another trip is late or further away', () => {
        const local = row(); local.arrivals = [
            { tripId: 'late', minutes: 421, stopName: 'GO', stopCode: '9003' },
            { tripId: 'far', minutes: 400, stopName: 'GO', stopCode: '9003' },
            { tripId: 'best', minutes: 416, stopName: 'GO', stopCode: '9003' }];
        expect(findConnection(local, event())).toMatchObject({ status: 'tight', tripId: 'best', gapMinutes: 4 });
    });
    it('does not subtract walking time from the raw timetable gap or round GTFS seconds', () => {
        expect(findConnection(row(), event(415.5))).toMatchObject({ status: 'comfortable', gapMinutes: 5.5 });
    });
});
