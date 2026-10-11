import { unzipSync } from 'fflate';
import type { RegionalGoFeed } from '../regional-transit/goFeedTypes';

export const GO_SOURCE_URL = 'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip';
export const GO_ZIP_MAX_BYTES = 50 * 1024 * 1024;
const UNPACKED_MAX_BYTES = 250 * 1024 * 1024;

type RecordValue = Record<string, unknown>;

function invalid(field: string): never {
    throw new Error(`GO schedule data is invalid (${field}). Please refresh or try again later.`);
}

function record(value: unknown, field: string): RecordValue {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
    return value as RecordValue;
}

function rows(value: unknown, field: string, optional = false): RecordValue[] {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)) invalid(field);
    return value.map(item => record(item, field));
}

function text(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) invalid(field);
    return value;
}

function optionalText(value: unknown, field: string): string | undefined {
    if (value === undefined || value === '') return undefined;
    return text(value, field);
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) invalid(field);
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) invalid(field);
    return number;
}

function optionalEnum(value: unknown, field: string, maximum: number): number | undefined {
    return value === undefined || value === '' ? undefined : integer(value, field, 0, maximum);
}

function date(value: unknown, field: string): string {
    const result = text(value, field);
    if (!/^\d{8}$/.test(result)) invalid(field);
    const parsed = new Date(`${result.slice(0, 4)}-${result.slice(4, 6)}-${result.slice(6, 8)}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10).replace(/-/g, '') !== result) invalid(field);
    return result;
}

function time(value: unknown, field: string): string {
    const result = text(value, field);
    // GTFS service-day hours may exceed 24: preserve them without clock wrapping.
    if (!/^\d{2,}:[0-5]\d:[0-5]\d$/.test(result)) invalid(field);
    return result;
}

function uniqueIds(values: { [key: string]: unknown }[], field: string): Set<string> {
    const ids = new Set<string>();
    for (const value of values) {
        const id = text(value[field], field);
        if (ids.has(id)) invalid(`duplicate ${field}`);
        ids.add(id);
    }
    return ids;
}

export function validateRegionalGoFeed(value: unknown): RegionalGoFeed {
    const raw = record(value, 'response');
    const agencies = rows(raw.agency, 'agency');
    if (!agencies.length || agencies.some(agency => agency.agency_timezone !== 'America/Toronto')) invalid('agency timezone');

    const routes = rows(raw.routes, 'routes').map(route => ({
        route_id: text(route.route_id, 'route ID'),
        route_type: integer(route.route_type, 'route type', 0, 1702),
    })).filter(route => route.route_type === 2 || (route.route_type >= 100 && route.route_type <= 199));
    if (!routes.length) invalid('no rail routes');
    const routeIds = uniqueIds(routes, 'route_id');
    const trips = rows(raw.trips, 'trips').filter(trip => routeIds.has(String(trip.route_id))).map(trip => ({
        trip_id: text(trip.trip_id, 'trip ID'),
        route_id: text(trip.route_id, 'trip route ID'),
        service_id: text(trip.service_id, 'trip service ID'),
        trip_short_name: optionalText(trip.trip_short_name, 'train number'),
        trip_headsign: optionalText(trip.trip_headsign, 'trip headsign'),
        direction_id: optionalEnum(trip.direction_id, 'trip direction', 1),
    }));
    if (!trips.length) invalid('no rail trips');
    const tripIds = uniqueIds(trips, 'trip_id');
    const stopTimes = rows(raw.stopTimes, 'stop times').filter(stop => tripIds.has(String(stop.trip_id))).map(stop => ({
        trip_id: text(stop.trip_id, 'stop-time trip ID'),
        stop_id: text(stop.stop_id, 'stop-time stop ID'),
        arrival_time: time(stop.arrival_time, 'arrival time'),
        departure_time: time(stop.departure_time, 'departure time'),
        stop_sequence: integer(stop.stop_sequence, 'stop sequence', 0, Number.MAX_SAFE_INTEGER),
        pickup_type: optionalEnum(stop.pickup_type, 'pickup type', 3),
        drop_off_type: optionalEnum(stop.drop_off_type, 'drop-off type', 3),
    }));
    if (!stopTimes.length) invalid('no rail stop times');
    const rawStops = rows(raw.stops, 'stops');
    const stopsById = new Map(rawStops.map(stop => [text(stop.stop_id, 'stop ID'), stop]));
    if (stopsById.size !== rawStops.length) invalid('duplicate stop ID');
    const usedStops = new Set(stopTimes.map(stop => stop.stop_id));
    // Keep platform parents too, so station resolution never loses the hierarchy.
    for (const id of usedStops) {
        const stop = stopsById.get(id);
        if (!stop) invalid('missing rail stop');
        const parent = optionalText(stop.parent_station, 'parent station');
        if (parent) usedStops.add(parent);
    }
    const stops = [...usedStops].map(id => {
        const stop = stopsById.get(id);
        if (!stop) invalid('missing parent station');
        return {
            stop_id: id,
            stop_name: text(stop.stop_name, 'stop name'),
            parent_station: optionalText(stop.parent_station, 'parent station'),
        };
    });
    const serviceIds = new Set(trips.map(trip => trip.service_id));
    const calendar = rows(raw.calendar, 'calendar', true).filter(row => serviceIds.has(String(row.service_id))).map(row => {
        const start = date(row.start_date, 'calendar start date');
        const end = date(row.end_date, 'calendar end date');
        if (start > end) invalid('calendar date range');
        return {
            service_id: text(row.service_id, 'calendar service ID'), start_date: start, end_date: end,
            monday: integer(row.monday, 'Monday flag', 0, 1), tuesday: integer(row.tuesday, 'Tuesday flag', 0, 1),
            wednesday: integer(row.wednesday, 'Wednesday flag', 0, 1), thursday: integer(row.thursday, 'Thursday flag', 0, 1),
            friday: integer(row.friday, 'Friday flag', 0, 1), saturday: integer(row.saturday, 'Saturday flag', 0, 1),
            sunday: integer(row.sunday, 'Sunday flag', 0, 1),
        };
    });
    const calendarDates = rows(raw.calendarDates, 'calendar dates', true).filter(row => serviceIds.has(String(row.service_id))).map(row => ({
        service_id: text(row.service_id, 'exception service ID'), date: date(row.date, 'exception date'),
        exception_type: integer(row.exception_type, 'exception type', 1, 2),
    }));
    uniqueIds(calendar, 'service_id');
    const exceptionKeys = new Set<string>();
    for (const exception of calendarDates) {
        const key = `${exception.service_id}\u0000${exception.date}`;
        if (exceptionKeys.has(key)) invalid('duplicate calendar exception');
        exceptionKeys.add(key);
    }
    const definedServices = new Set([...calendar, ...calendarDates].map(row => row.service_id));
    if ([...serviceIds].some(id => !definedServices.has(id))) invalid('missing rail service calendar');
    return { fetchedAt: new Date().toISOString(), sourceUrl: GO_SOURCE_URL, timezone: 'America/Toronto', routes, trips, stops, stopTimes, calendar, calendarDates };
}

/** Handles GTFS CSV quotes, escaped quotes, BOM, CRLF and quoted newlines. */
function* csvRecords(content: string): Generator<RecordValue> {
    let fields: string[] = [];
    let field = '';
    let quoted = false;
    let headers: string[] | undefined;
    for (let index = 0; index <= content.length; index++) {
        const character = content[index];
        if (character === '"') {
            if (quoted && content[index + 1] === '"') { field += '"'; index++; }
            else quoted = !quoted;
        } else if (!quoted && (character === ',' || character === '\n' || character === undefined)) {
            fields.push(field.trim());
            field = '';
            if (character !== ',') {
                if (!headers) {
                    headers = fields.map(value => value.replace(/^\uFEFF/, ''));
                    if (new Set(headers).size !== headers.length) invalid('duplicate CSV columns');
                } else if (fields.some(Boolean)) {
                    if (fields.length !== headers.length) invalid('CSV column count');
                    yield Object.fromEntries(headers.map((header, column) => [header, fields[column]]));
                }
                fields = [];
            }
        } else if (character !== undefined && (quoted || character !== '\r')) field += character;
    }
    if (quoted) invalid('unterminated CSV quote');
}

/**
 * Yields rows whose `column` value passes `keep`. Unquoted tables take a fast path that reads one
 * column per line and builds records only for kept rows; any quote falls back to the full CSV parser.
 */
function* selectRecords(content: string, column: string, keep: (value: string) => boolean): Generator<RecordValue> {
    if (content.includes('"')) {
        for (const row of csvRecords(content)) if (keep(String(row[column]))) yield row;
        return;
    }
    const headerEnd = content.indexOf('\n');
    if (headerEnd === -1) return;
    const headerLine = content.slice(content.charCodeAt(0) === 0xfeff ? 1 : 0, headerEnd);
    const headers = headerLine.split(',').map(header => header.trim());
    if (new Set(headers).size !== headers.length) invalid('duplicate CSV columns');
    const target = headers.indexOf(column);
    if (target === -1) invalid(`missing ${column} column`);
    let start = headerEnd + 1;
    while (start < content.length) {
        let end = content.indexOf('\n', start);
        if (end === -1) end = content.length;
        // Locate the target field without splitting the whole line.
        let fieldStart = start;
        for (let index = 0; index < target && fieldStart !== 0; index++) fieldStart = content.indexOf(',', fieldStart) + 1;
        if (fieldStart === 0 || fieldStart > end) { if (content.slice(start, end).trim()) invalid('CSV column count'); start = end + 1; continue; }
        let fieldEnd = content.indexOf(',', fieldStart);
        if (fieldEnd === -1 || fieldEnd > end) fieldEnd = end;
        if (keep(content.slice(fieldStart, fieldEnd).replace(/\r$/, '').trim())) {
            const fields = content.slice(start, end).replace(/\r$/, '').split(',').map(field => field.trim());
            if (fields.length !== headers.length) invalid('CSV column count');
            yield Object.fromEntries(headers.map((header, index) => [header, fields[index]]));
        }
        start = end + 1;
    }
}

/** Runs in a worker. Only Barrie station rail trips cross back to the UI thread. */
export function parseRegionalGoZip(buffer: ArrayBuffer): RegionalGoFeed {
    if (!buffer.byteLength || buffer.byteLength > GO_ZIP_MAX_BYTES) invalid('ZIP size');
    const requiredNames = new Set(['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt']);
    let declaredBytes = 0;
    const seen = new Set<string>();
    const files = unzipSync(new Uint8Array(buffer), { filter: entry => {
        const name = entry.name.split('/').pop()?.toLowerCase() || '';
        if (!requiredNames.has(name)) return false;
        if (seen.has(name)) invalid('duplicate ZIP table');
        seen.add(name);
        declaredBytes += entry.originalSize;
        if (declaredBytes > UNPACKED_MAX_BYTES) invalid('unpacked size');
        return true;
    } });
    const contents = new Map<string, Uint8Array>();
    let unpackedBytes = 0;
    for (const [path, bytes] of Object.entries(files)) {
        unpackedBytes += bytes.byteLength;
        if (unpackedBytes > UNPACKED_MAX_BYTES) invalid('unpacked size');
        contents.set(path.split('/').pop()!.toLowerCase(), bytes);
    }
    const decode = (name: string, optional = false): string => {
        const bytes = contents.get(name);
        if (!bytes) {
            if (optional) return '';
            invalid(`missing ${name}`);
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    };
    const table = (name: string, optional = false): Generator<RecordValue> => csvRecords(decode(name, optional));
    const agency = [...table('agency.txt')];
    const routes = [...table('routes.txt')];
    const railRouteIds = new Set(routes.filter(route => {
        const routeType = integer(route.route_type, 'route type', 0, 1702);
        return routeType === 2 || (routeType >= 100 && routeType <= 199);
    }).map(route => text(route.route_id, 'route ID')));
    const stops = [...table('stops.txt')];
    const stationIds = new Set(stops.filter(stop => /allandale|barrie south/i.test(text(stop.stop_name, 'stop name'))).map(stop => text(stop.stop_id, 'stop ID')));
    // Include platform children even when their names only identify a platform.
    for (const stop of stops) if (stationIds.has(String(stop.parent_station))) stationIds.add(String(stop.stop_id));
    // Station calls first (a tiny subset of stop_times), then only the trips they reference.
    const stationTimes = [...selectRecords(decode('stop_times.txt'), 'stop_id', id => stationIds.has(id))];
    const stationTripIds = new Set(stationTimes.map(stop => String(stop.trip_id)));
    const trips = [...selectRecords(decode('trips.txt'), 'trip_id', id => stationTripIds.has(id))]
        .filter(trip => railRouteIds.has(String(trip.route_id)));
    const railTripIds = new Set(trips.map(trip => text(trip.trip_id, 'trip ID')));
    const stopTimes = stationTimes.filter(stop => railTripIds.has(String(stop.trip_id)));
    const relevantTrips = new Set(stopTimes.map(stop => String(stop.trip_id)));
    return validateRegionalGoFeed({
        agency, routes, stops, stopTimes,
        trips: trips.filter(trip => relevantTrips.has(String(trip.trip_id))),
        calendar: [...table('calendar.txt', true)],
        calendarDates: [...table('calendar_dates.txt', true)],
    });
}

