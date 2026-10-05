import type { DayType } from '../masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { getRouteConfig, isLoop } from '../config/routeDirectionConfig';
import { HUBS } from '../platform/platformConfig';
import { fromMinutes } from '../timeUtils';
import type { ConnectionCell, GoDateResult, GoStationKey, GoTrainEvent, LocalConnectionRow, PublishedRouteSource, RegionalGoFeed, RejectedBusTrip } from './types';

const FEED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STATIONS = {
    allandale: { id: 'AD', names: ['allandale waterfront go', 'allandale waterfront', 'barrie allandale waterfront go'], hub: 'Barrie Allandale Transit Terminal', nearbyStopCodes: ['14'], stopNamePattern: /allandale/i },
    south: { id: 'BA', names: ['barrie south go', 'barrie south'], hub: 'Barrie South GO', nearbyStopCodes: [], stopNamePattern: /barrie south/i },
} as const;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function dateKey(value: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value.replaceAll('-', '') : null;
}

function validGtfsDate(value: string): boolean {
    return /^\d{8}$/.test(value) && dateKey(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`) !== null;
}

/** Strict service-day parser: GTFS hours above 23 are deliberately retained. */
function gtfsMinutes(value: string): number | null {
    const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value);
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 60;
    return minutes <= 72 * 60 ? minutes : null;
}

function stationStopIds(feed: RegionalGoFeed, station: GoStationKey): Set<string> {
    const config = STATIONS[station];
    const ids = new Set(feed.stops.filter(stop => stop.stop_id === config.id ||
        (config.names as readonly string[]).includes(stop.stop_name.trim().toLowerCase())).map(stop => stop.stop_id));
    // Resolve parent/child platforms without accepting unrelated fuzzy stop names.
    let changed = true;
    while (changed) {
        changed = false;
        for (const stop of feed.stops) {
            if (stop.parent_station && (ids.has(stop.stop_id) || ids.has(stop.parent_station))) {
                for (const id of [stop.stop_id, stop.parent_station]) {
                    if (!ids.has(id)) { ids.add(id); changed = true; }
                }
            }
        }
    }
    return ids;
}

export function getGoTrainEvents(feed: RegionalGoFeed, station: GoStationKey, date: string): GoDateResult {
    const unavailable = (issue: string): GoDateResult => ({ status: 'unavailable', events: [], issues: [issue] });
    const key = dateKey(date);
    if (!key) return unavailable('Choose a valid service date.');
    if (!feed || ![feed.stops, feed.routes, feed.trips, feed.stopTimes, feed.calendar, feed.calendarDates].every(Array.isArray)) {
        return unavailable('The GO feed is incomplete.');
    }
    if (feed.timezone !== 'America/Toronto') return unavailable('The GO feed must use America/Toronto service-day time.');
    const fetchedAt = Date.parse(feed.fetchedAt);
    if (!Number.isFinite(fetchedAt) || fetchedAt > Date.now() + 5 * 60 * 1000 || Date.now() - fetchedAt > FEED_MAX_AGE_MS) {
        return unavailable('The GO feed is missing a current retrieval date or is older than 30 days. Refresh it.');
    }
    if (!feed.calendar.every(row => validGtfsDate(row.start_date) && validGtfsDate(row.end_date) && row.start_date <= row.end_date &&
        WEEKDAYS.every(day => String(row[day]) === '0' || String(row[day]) === '1')) ||
        !feed.calendarDates.every(row => validGtfsDate(row.date) && ['1', '2'].includes(String(row.exception_type)))) {
        return unavailable('The GO feed contains an invalid service calendar.');
    }
    const starts = [...feed.calendar.map(row => row.start_date), ...feed.calendarDates.map(row => row.date)].sort();
    const ends = [...feed.calendar.map(row => row.end_date), ...feed.calendarDates.map(row => row.date)].sort();
    if (!starts.length || key < starts[0] || key > ends[ends.length - 1] ||
        (!feed.calendar.some(row => row.start_date <= key && row.end_date >= key) && !feed.calendarDates.some(row => row.date === key))) {
        return unavailable('The GO feed does not cover this service date.');
    }
    const coverage = { validFrom: starts[0], validTo: ends[ends.length - 1] };
    const day = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const active = new Set(feed.calendar.filter(row => row.start_date <= key && row.end_date >= key && String(row[day]) === '1').map(row => row.service_id));
    for (const row of feed.calendarDates.filter(row => row.date === key)) {
        if (String(row.exception_type) === '1') active.add(row.service_id);
        else active.delete(row.service_id);
    }
    const ids = stationStopIds(feed, station);
    if (!ids.size) return unavailable('This GO station could not be resolved in the feed.');
    const railRoutes = new Set(feed.routes.filter(route => route.route_type === 2 || (route.route_type >= 100 && route.route_type < 200)).map(route => route.route_id));
    if (!railRoutes.size) return unavailable('No rail routes were found in the GO feed.');
    const knownServices = new Set([...feed.calendar.map(row => row.service_id), ...feed.calendarDates.map(row => row.service_id)]);
    const timesByTrip = new Map<string, RegionalGoFeed['stopTimes']>();
    for (const time of feed.stopTimes) {
        if (!ids.has(time.stop_id)) continue;
        const times = timesByTrip.get(time.trip_id) ?? [];
        times.push(time);
        timesByTrip.set(time.trip_id, times);
    }
    const events: GoTrainEvent[] = [];
    const issues: string[] = [];
    for (const trip of feed.trips) {
        if (railRoutes.has(trip.route_id) && timesByTrip.has(trip.trip_id) && !knownServices.has(trip.service_id)) {
            return unavailable(`GO trip ${trip.trip_id} has no service calendar.`);
        }
        if (!active.has(trip.service_id) || !railRoutes.has(trip.route_id)) continue;
        const times = timesByTrip.get(trip.trip_id);
        if (!times) continue;
        const headsign = trip.trip_headsign ?? '';
        const toUnion = /\bunion\b/i.test(headsign);
        const toAllandale = /\ballandale\b/i.test(headsign);
        const directionId = String(trip.direction_id ?? '');
        // GO's actual Barrie rail feed uses 1 toward Union and 0 toward Allandale.
        // Headsigns provide the stronger destination evidence; never assume GTFS 0 means outbound.
        const idDirection = directionId === '1' ? 'to-go' : directionId === '0' ? 'from-go' : null;
        const headsignDirection = toUnion && !toAllandale ? 'to-go' : toAllandale && !toUnion ? 'from-go' : null;
        const direction = headsignDirection ?? idDirection;
        if (!direction || (toUnion && toAllandale) || (headsignDirection && idDirection && headsignDirection !== idDirection)) {
            return unavailable(`GO trip ${trip.trip_id} has an unknown or inconsistent train direction.`);
        }
        // Parent and platform copies of the same train call are not additional trains.
        const ordered = [...times].sort((a, b) => a.stop_sequence - b.stop_sequence || a.stop_id.localeCompare(b.stop_id));
        if (ordered.some(item => ![0, 1, 2, 3].includes(Number(direction === 'to-go' ? item.pickup_type ?? 0 : item.drop_off_type ?? 0)))) {
            return unavailable(`GO trip ${trip.trip_id} has an invalid pickup/drop-off mode.`);
        }
        const time = ordered.find(item => Number(direction === 'to-go' ? item.pickup_type ?? 0 : item.drop_off_type ?? 0) === 0);
        if (ordered.some(item => [2, 3].includes(Number(direction === 'to-go' ? item.pickup_type : item.drop_off_type)))) {
            issues.push(`GO trip ${trip.trip_id} requires an arranged pickup/drop-off and is excluded from ordinary connections.`);
        }
        if (!time) continue;
        const minutes = gtfsMinutes(direction === 'to-go' ? time.departure_time : time.arrival_time);
        if (minutes === null) return unavailable(`GO trip ${trip.trip_id} has an invalid station time.`);
        events.push({ id: `${trip.trip_id}:${time.stop_id}:${direction}`, tripId: trip.trip_id,
            trainNumber: trip.trip_short_name || '', headsign, stationStopId: time.stop_id, direction, minutes });
    }
    events.sort((a, b) => a.minutes - b.minutes || a.tripId.localeCompare(b.tripId));
    return { status: events.length ? 'ready' : 'no-service', events, issues, ...coverage };
}

function validMinutes(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 72 * 60;
}

function clockMinutes(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2}):([0-5]\d)\s*([ap]m?)?$/i.exec(value.trim());
    if (!match) return null;
    let hours = Number(match[1]);
    const period = match[3]?.[0].toLowerCase();
    if (period && (hours < 1 || hours > 12)) return null;
    if (period) hours = hours % 12 + (period === 'p' ? 12 : 0);
    return hours <= 71 ? hours * 60 + Number(match[2]) : null;
}

/** Resolve wrapped display clocks against numeric trip anchors, never against today's clock. */
function anchoredMinutes(raw: number | null, start: number, end: number, preferred = start): number | null {
    if (raw === null) return null;
    const candidates = raw >= 1440 ? [raw] : [raw, raw + 1440, raw + 2880];
    return candidates.filter(value => value >= start && value <= end)
        .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0] ?? null;
}

function departureMinutes(trip: MasterTrip, stop: string): number | null {
    const numeric = trip.stopMinutes?.[stop];
    if (numeric !== undefined) return validMinutes(numeric) && numeric >= trip.startTime && numeric <= trip.endTime + Math.max(0, trip.recoveryTime) ? numeric : null;
    const stopClock = clockMinutes(trip.stops?.[stop]);
    const explicitArrivalClock = clockMinutes(trip.arrivalTimes?.[stop]);
    const stopRecovery = trip.recoveryTimes?.[stop];
    // GTFS-imported masters store ARR in both clock fields. Generated masters store DEP in stops.
    // Only add documented dwell when both clocks agree; numeric departures remain authoritative.
    const latestDeparture = trip.endTime + Math.max(0, trip.recoveryTime);
    if (stopClock !== null && explicitArrivalClock === stopClock && stopRecovery !== undefined) {
        if (!validMinutes(stopRecovery)) return null;
        const arrival = anchoredMinutes(stopClock, Math.max(0, trip.startTime - stopRecovery), latestDeparture - stopRecovery);
        return arrival === null ? null : arrival + stopRecovery;
    }
    return anchoredMinutes(stopClock, trip.startTime, latestDeparture);
}

function arrivalMinutes(trip: MasterTrip, stop: string, departure: number | null, isTerminal: boolean): number | null {
    const explicit = trip.arrivalTimes?.[stop];
    if (explicit !== undefined) {
        const stopRecovery = trip.recoveryTimes?.[stop];
        const documentedRecovery = validMinutes(stopRecovery) ? stopRecovery : 0;
        const arrival = anchoredMinutes(clockMinutes(explicit), Math.max(0, trip.startTime - documentedRecovery), departure ?? trip.endTime, departure ?? trip.startTime);
        // Imported interline arrivals can precede the outgoing trip start by the recorded dwell.
        // Do not relax bounds for unexplained early clocks or reconstruct a preceding trip.
        if (arrival !== null && arrival < trip.startTime &&
            (departure !== trip.startTime || arrival + documentedRecovery !== departure)) return null;
        return arrival;
    }
    if (departure === null) return null;
    // Legacy recoveryTime belongs after the trip, not to every intermediate stop.
    // Explicit arrivals/per-stop recovery take precedence; unknown terminal timing stays unassessed.
    const recovery = trip.recoveryTimes ? trip.recoveryTimes[stop] ?? 0 : !isTerminal || trip.recoveryTime === 0 ? 0 : null;
    if (recovery === null || !validMinutes(recovery) || departure - recovery < trip.startTime) return null;
    return departure - recovery;
}

function arrivalTimingIssue(trip: MasterTrip, stop: string, departure: number | null, isTerminal: boolean): string {
    const explicit = trip.arrivalTimes?.[stop];
    const reason = explicit !== undefined ? 'The recorded arrival cannot be resolved within the active trip.' :
        departure === null ? 'The recorded stop time cannot be resolved within the active trip.' :
        isTerminal && !trip.recoveryTimes && trip.recoveryTime !== 0 ? 'Terminal recovery has no stop-level arrival timing.' :
        'The recorded stop recovery does not produce a valid arrival.';
    return `A station-serving bus trip has missing or ambiguous arrival/recovery timing. ${reason} ` +
        `First rejected bus trip: ${trip.id}; stop: ${stop}; ` +
        `arrival: ${JSON.stringify(explicit) ?? 'not recorded'}; ` +
        `stop time: ${JSON.stringify(trip.stops?.[stop]) ?? 'not recorded'}; ` +
        `stop minutes: ${String(trip.stopMinutes?.[stop] ?? 'not recorded')}; ` +
        `resolved departure minutes: ${String(departure ?? 'not resolved')}; ` +
        `trip start/end minutes: ${trip.startTime}/${trip.endTime}; ` +
        `stop recovery: ${String(trip.recoveryTimes?.[stop] ?? 'not recorded')}; ` +
        `trip recovery: ${trip.recoveryTime}; station is ${isTerminal ? 'terminal' : 'intermediate'}.`;
}

function tripBoundsIssue(trip: MasterTrip, startIndex: number, endIndex: number, stopCount: number, reason: string): string {
    return `A station-serving bus trip has invalid timing or stop indexes. ${reason} ` +
        `First rejected bus trip: ${trip.id}; trip start/end minutes: ${String(trip.startTime)}/${String(trip.endTime)}; ` +
        `active stop indexes: ${String(startIndex)}/${String(endIndex)}; table stop count: ${stopCount}; ` +
        `trip recovery: ${String(trip.recoveryTime)}.`;
}

function recordedTripSpan(trip: MasterTrip, stops: string[]): { first: number; last: number } | null {
    // Explicit partial-trip bounds remain authoritative. Older sparse imports have no such bounds.
    if (trip.startStopIndex !== undefined || trip.endStopIndex !== undefined) return null;
    const hasRecordedValue = (value: unknown) => value !== undefined && value !== null &&
        (typeof value !== 'string' || value.trim().length > 0);
    const indexes = stops.flatMap((stop, index) =>
        [trip.stopMinutes?.[stop], trip.stops?.[stop], trip.arrivalTimes?.[stop]].some(hasRecordedValue) ? [index] : []);
    // Insufficient evidence is not a short-turn inference. Malformed nonblank values remain present.
    return indexes.length >= 2 ? { first: indexes[0], last: indexes[indexes.length - 1] } : null;
}

/**
 * Earliest recorded clock of an interlined row when it precedes the nominal start, else null.
 * Only rows carrying interline markers are relaxed, and never by more than an hour.
 */
function interlinedLegStart(trip: MasterTrip, stops: string[]): number | null {
    const marked = trip as MasterTrip & { interlinePrev?: unknown; interlineNext?: unknown };
    if (!marked.interlinePrev && !marked.interlineNext) return null;
    if (!validMinutes(trip.startTime) || !validMinutes(trip.endTime) || trip.endTime < trip.startTime) return null;
    const clocks = stops.map(stop => clockMinutes(trip.stops?.[stop])).flatMap(raw => raw === null ? [] :
        [[raw, raw + 1440, raw + 2880].sort((a, b) => Math.abs(a - trip.startTime) - Math.abs(b - trip.startTime))[0]]);
    const earliest = Math.min(...clocks);
    return earliest < trip.startTime && earliest >= trip.startTime - 60 ? earliest : null;
}

/** Minutes in which a rejected trip could call at the station, padded by any recorded dwell or recovery. */
function tripWindow(trip: MasterTrip): [number, number] | null {
    if (!validMinutes(trip.startTime) || !validMinutes(trip.endTime) || trip.endTime < trip.startTime) return null;
    const slack = Math.max(0, ...[trip.recoveryTime, ...Object.values(trip.recoveryTimes ?? {})].filter(validMinutes));
    return [trip.startTime - slack, trip.endTime + slack];
}

function rowsForSource(source: PublishedRouteSource, station: GoStationKey, date: string): LocalConnectionRow[] {
    const { entry, content } = source;
    const base: Pick<LocalConnectionRow, 'routeNumber' | 'version' | 'arrivals' | 'departures' | 'stopNames' | 'stopCodes'> = {
        routeNumber: entry.routeNumber, version: entry.currentVersion, arrivals: [], departures: [], stopNames: [], stopCodes: [],
    };
    const failure = source.error || (!content ? 'Published schedule could not be loaded.' : undefined) ||
        (content && (content.metadata.routeNumber !== entry.routeNumber || content.metadata.dayType !== entry.dayType) ? 'Published content does not match this route and service day.' : undefined);
    if (failure) return [{ ...base, id: entry.id, direction: 'Not loaded', status: 'unavailable', issue: failure }];
    // Connection area includes approved nearby curbside stops, without changing platform assignment.
    const codes = new Set<string>([...(HUBS.find(hub => hub.name === STATIONS[station].hub)?.stopCodes ?? []), ...STATIONS[station].nearbyStopCodes]);
    return [content!.northTable, content!.southTable].flatMap((table: MasterRouteTable, tableIndex) => {
        const config = getRouteConfig(entry.routeNumber);
        const loop = isLoop(config) || /\(Loop\)/i.test(table?.routeName ?? '');
        const direction = loop ? `Loop${isLoop(config) ? ` (${config!.segments[0].name})` : ''}` :
            /\(South\)/i.test(table?.routeName ?? '') ? 'South' : /\(North\)/i.test(table?.routeName ?? '') ? 'North' : tableIndex === 0 ? 'North' : 'South';
        const row: LocalConnectionRow = { ...base, arrivals: [], departures: [], id: `${entry.id}:${loop ? `Loop:${tableIndex}` : direction}`, direction, status: 'ready' };
        if (!table || !Array.isArray(table.stops) || !Array.isArray(table.trips) || !table.stopIds) {
            return [{ ...row, status: 'unavailable' as const, issue: 'Published direction has an invalid schedule table.' }];
        }
        if (!table.stops.length && !table.trips.length) return [];
        // Preserve occurrence indexes: indexOf loses the second call at a repeated stop.
        const stops = table.stops.map((stopName, index) => ({ stopName, index })).filter(stop => codes.has(table.stopIds[stop.stopName]));
        row.stopNames = [...new Set(stops.map(stop => stop.stopName))];
        row.stopCodes = row.stopNames.map(stop => table.stopIds[stop]);
        if (!stops.length) {
            // A direction that never names the station does not serve it; one that names it without a mapped code is a data gap.
            return table.stops.some(stopName => STATIONS[station].stopNamePattern.test(stopName))
                ? [{ ...row, status: 'unavailable' as const, issue: 'The station appears by name in this direction, but no exact station stop code is mapped.' }] : [];
        }
        // One bad trip is excluded on its own; it blocks only cells within its service window.
        const reject = (kind: 'arrival' | 'departure', trip: MasterTrip, issue: string) => {
            const entry: RejectedBusTrip = { tripId: trip.id, window: tripWindow(trip), issue };
            if (kind === 'arrival') { row.arrivalIssue ??= issue; (row.rejectedArrivals ??= []).push(entry); }
            else { row.departureIssue ??= issue; (row.rejectedDepartures ??= []).push(entry); }
        };
        for (const storedTrip of table.trips) {
            // Adapter imports store a post-midnight end as a wrapped clock (end < same-day start), as cycleTime does.
            // Only that convention is unwrapped; starts already past midnight stay rejected below.
            const unwrapped = validMinutes(storedTrip.startTime) && validMinutes(storedTrip.endTime) &&
                storedTrip.startTime < 1440 && storedTrip.endTime < storedTrip.startTime
                ? { ...storedTrip, endTime: storedTrip.endTime + 1440 } : storedTrip;
            // Interlined round-trip rows (e.g. 8B-T-77) can begin their onward leg before the row's nominal start.
            const legStart = interlinedLegStart(unwrapped, table.stops);
            const trip = legStart === null ? unwrapped : { ...unwrapped, startTime: legStart };
            const startIndex = trip.startStopIndex ?? 0;
            const endIndex = trip.endStopIndex ?? table.stops.length - 1;
            if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || endIndex >= table.stops.length || startIndex > endIndex) {
                const issue = tripBoundsIssue(trip, startIndex, endIndex, table.stops.length, 'Active stop bounds do not fit this direction table.');
                reject('arrival', trip, issue); reject('departure', trip, issue);
                continue;
            }
            const recordedSpan = recordedTripSpan(trip, table.stops);
            // A station outside a sparse trip's recorded stop span is not served by that short trip.
            // Missing timing inside the span still fails closed; do not manufacture a stop call.
            const activeStops = stops.filter(stop => stop.index >= startIndex && stop.index <= endIndex &&
                (!recordedSpan || (stop.index >= recordedSpan.first && stop.index <= recordedSpan.last)));
            if (!activeStops.length) continue;
            if (!validMinutes(trip.startTime) || !validMinutes(trip.endTime) || trip.endTime < trip.startTime) {
                const issue = tripBoundsIssue(trip, startIndex, endIndex, table.stops.length, 'Trip start/end are invalid or reversed; service-day anchors are not guessed.');
                reject('arrival', trip, issue); reject('departure', trip, issue);
                continue;
            }
            for (const { stopName, index } of activeStops) {
                // Riders must actually travel to/from the station within this active trip.
                // A terminal DEP is not an onward journey, and an origin ARR is not a feeder.
                const hasOnwardSegment = index < endIndex;
                if (index <= startIndex && !hasOnwardSegment) continue;
                if (activeStops.filter(stop => stop.stopName === stopName).length > 1) {
                    // Name-keyed timing cannot distinguish multiple active calls at one stop.
                    if (index > startIndex) reject('arrival', trip, `Repeated station stop calls have ambiguous arrival timing. Rejected bus trip: ${trip.id}; stop: ${stopName}.`);
                    if (hasOnwardSegment) reject('departure', trip, `Repeated station stop calls have ambiguous departure timing. Rejected bus trip: ${trip.id}; stop: ${stopName}.`);
                    continue;
                }
                const departure = departureMinutes(trip, stopName);
                // A call before the nominal start begins the interlined leg; this route did not carry riders into it.
                const hasInboundSegment = index > startIndex && !(legStart !== null && departure !== null && departure < unwrapped.startTime);
                const arrival = arrivalMinutes(trip, stopName, departure, index === endIndex);
                const detail = { tripId: trip.id, stopName, stopCode: table.stopIds[stopName] };
                if (hasOnwardSegment) {
                    if (departure === null) reject('departure', trip, `A station-serving bus trip is missing a valid departure time. Rejected bus trip: ${trip.id}; stop: ${stopName}; ` +
                        `stop time: ${JSON.stringify(trip.stops?.[stopName]) ?? 'not recorded'}; trip start/end minutes: ${trip.startTime}/${trip.endTime}.`);
                    else row.departures.push({ ...detail, minutes: departure });
                }
                if (hasInboundSegment) {
                    if (arrival === null) reject('arrival', trip, arrivalTimingIssue(trip, stopName, departure, index === endIndex));
                    else row.arrivals.push({ ...detail, minutes: arrival });
                }
            }
        }
        row.arrivals.sort((a, b) => a.minutes - b.minutes);
        row.departures.sort((a, b) => a.minutes - b.minutes);
        return [row];
    });
}

export function buildLocalConnectionRows(sources: PublishedRouteSource[], station: GoStationKey, date: string, dayType: DayType | 'No Service'): LocalConnectionRow[] {
    if (dayType === 'No Service') return [];
    return sources.filter(source => source.entry.dayType === dayType).flatMap(source => {
        if (!dateKey(date)) return [{ id: source.entry.id, routeNumber: source.entry.routeNumber, direction: 'Not loaded', version: source.entry.currentVersion,
            stopNames: [], stopCodes: [], status: 'unavailable' as const, arrivals: [], departures: [], issue: 'Choose a valid service date.' }];
        return rowsForSource(source, station, date);
    }).sort((a, b) => a.routeNumber.localeCompare(b.routeNumber, undefined, { numeric: true }) || a.direction.localeCompare(b.direction));
}

export function findConnection(row: LocalConnectionRow, event: GoTrainEvent): ConnectionCell {
    const issue = row.status === 'unavailable' ? row.issue ?? 'Published bus schedule unavailable.' : undefined;
    if (issue || !validMinutes(event.minutes)) return { status: 'unavailable', issue: issue ?? 'Train time is invalid.' };
    const toGo = event.direction === 'to-go';
    const times = toGo ? row.arrivals : row.departures;
    if (times.some(time => !validMinutes(time.minutes))) return { status: 'unavailable', issue: 'Bus timing is invalid.' };
    const matches = times.map(time => ({ ...time, gap: toGo ? event.minutes - time.minutes : time.minutes - event.minutes }))
        .filter(time => time.gap >= 1 && time.gap <= 30).sort((a, b) => a.gap - b.gap || a.tripId.localeCompare(b.tripId));
    const best = matches[0];
    // A rejected trip matters only if it could fall in this train's 1–30 minute window; unknown windows always matter.
    const [low, high] = toGo ? [event.minutes - 30, event.minutes - 1] : [event.minutes + 1, event.minutes + 30];
    const blocking = (toGo ? row.rejectedArrivals : row.rejectedDepartures)?.find(rejected =>
        !rejected.window || (rejected.window[0] <= high && rejected.window[1] >= low));
    if (!best) return blocking ? { status: 'unavailable', issue: blocking.issue } : { status: 'no-connection' };
    return { status: best.gap <= 5 ? 'tight' : best.gap <= 15 ? 'comfortable' : 'long',
        busMinutes: best.minutes, gapMinutes: best.gap, tripId: best.tripId, stopName: best.stopName, stopCode: best.stopCode,
        issue: blocking ? `Bus trip ${blocking.tripId} near this train could not be assessed, so a closer connection may exist.` : undefined };
}

export function formatServiceTime(minutes: number): string {
    if (!validMinutes(minutes)) return '—';
    const days = Math.floor(minutes / 1440);
    return `${fromMinutes(minutes)}${days ? ` (+${days} day${days > 1 ? 's' : ''})` : ''}`;
}
