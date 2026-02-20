/**
 * GTFS Schedule Index — cross-references GTFS feed against STREETS data
 * to identify missed trips (scheduled but not operated).
 *
 * Uses ?raw imports for bundled GTFS text files (~400KB total) and a
 * pre-built trip departure index from data/gtfsTripIndex.json.
 *
 * Holiday handling (Option D):
 *  - Known Ontario statutory holidays map to their actual service type
 *  - Unknown mismatches use best-fit matching (try all 3 service types,
 *    pick the one with the strongest route+time match quality)
 */
import tripsRaw from '../../gtfs/trips.txt?raw';
import calendarRaw from '../../gtfs/calendar.txt?raw';
import calendarDatesRaw from '../../gtfs/calendar_dates.txt?raw';
import tripIndex from '../../data/gtfsTripIndex.json';
import type { DayType } from '../performanceDataTypes';

// ─── Types ──────────────────────────────────────────────────────────

export interface ScheduledTrip {
    tripId: string;
    routeId: string;
    headsign: string;
    blockId: string;
    departure: string;   // HH:MM from tripIndex
    serviceId: string;
}

interface CalendarEntry {
    serviceId: string;
    days: boolean[];      // [mon, tue, wed, thu, fri, sat, sun]
    startDate: string;    // YYYYMMDD
    endDate: string;
}

interface CalendarDateException {
    serviceId: string;
    date: string;         // YYYYMMDD
    exceptionType: 1 | 2; // 1=added, 2=removed
}

interface GtfsTrip {
    routeId: string;
    serviceId: string;
    tripId: string;
    headsign: string;
    blockId: string;
}

// ─── Ontario Statutory Holidays ─────────────────────────────────────
// Maps known holidays to the service type Barrie Transit actually runs.
// Covers the current GTFS period (Dec 2025 – Feb 2026).
// Update when a new GTFS feed is loaded or a new year begins.

const ONTARIO_HOLIDAYS: Record<string, DayType> = {
    '2025-12-25': 'sunday',   // Christmas Day
    '2025-12-26': 'sunday',   // Boxing Day
    '2026-01-01': 'sunday',   // New Year's Day
    '2026-02-16': 'sunday',   // Family Day (3rd Monday of Feb)
};

// ─── Parse raw GTFS text ────────────────────────────────────────────

function parseCsv<T>(raw: string, mapper: (cols: string[], hdr: Map<string, number>) => T | null): T[] {
    const lines = raw.split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].trim().split(',');
    const hdr = new Map(headers.map((h, i) => [h.trim(), i]));
    const results: T[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');
        const item = mapper(cols, hdr);
        if (item) results.push(item);
    }
    return results;
}

const trips: GtfsTrip[] = parseCsv(tripsRaw, (cols, hdr) => ({
    routeId: cols[hdr.get('route_id')!]?.trim() ?? '',
    serviceId: cols[hdr.get('service_id')!]?.trim() ?? '',
    tripId: cols[hdr.get('trip_id')!]?.trim() ?? '',
    headsign: cols[hdr.get('trip_headsign')!]?.trim() ?? '',
    blockId: cols[hdr.get('block_id')!]?.trim() ?? '',
}));

const calendar: CalendarEntry[] = parseCsv(calendarRaw, (cols, hdr) => ({
    serviceId: cols[hdr.get('service_id')!]?.trim() ?? '',
    days: [
        cols[hdr.get('monday')!]?.trim() === '1',
        cols[hdr.get('tuesday')!]?.trim() === '1',
        cols[hdr.get('wednesday')!]?.trim() === '1',
        cols[hdr.get('thursday')!]?.trim() === '1',
        cols[hdr.get('friday')!]?.trim() === '1',
        cols[hdr.get('saturday')!]?.trim() === '1',
        cols[hdr.get('sunday')!]?.trim() === '1',
    ],
    startDate: cols[hdr.get('start_date')!]?.trim() ?? '',
    endDate: cols[hdr.get('end_date')!]?.trim() ?? '',
}));

const calendarDates: CalendarDateException[] = parseCsv(calendarDatesRaw, (cols, hdr) => {
    const et = parseInt(cols[hdr.get('exception_type')!]?.trim() ?? '0', 10);
    if (et !== 1 && et !== 2) return null;
    return {
        serviceId: cols[hdr.get('service_id')!]?.trim() ?? '',
        date: cols[hdr.get('date')!]?.trim() ?? '',
        exceptionType: et as 1 | 2,
    };
});

// Pre-index calendar_dates by date for fast lookup
const calendarDatesByDate = new Map<string, CalendarDateException[]>();
for (const cd of calendarDates) {
    const existing = calendarDatesByDate.get(cd.date) || [];
    existing.push(cd);
    calendarDatesByDate.set(cd.date, existing);
}

// Pre-index trips by serviceId
const tripsByService = new Map<string, GtfsTrip[]>();
for (const t of trips) {
    const existing = tripsByService.get(t.serviceId) || [];
    existing.push(t);
    tripsByService.set(t.serviceId, existing);
}

const departureIndex = tripIndex as Record<string, string>;

export interface RouteMatchStats {
    scheduled: number;
    matched: number;
}

export interface ServiceCandidate {
    relevantScheduled: ScheduledTrip[];
    matched: number;
    matchRatio: number;
    routeStats: Map<string, RouteMatchStats>;
}

// ─── Day-type matching ──────────────────────────────────────────────

/** Check if a calendar entry's day flags match the given STREETS day type. */
function calendarMatchesDayType(cal: CalendarEntry, dayType: DayType): boolean {
    switch (dayType) {
        case 'weekday':
            return cal.days[0] || cal.days[1] || cal.days[2] || cal.days[3] || cal.days[4];
        case 'saturday':
            return cal.days[5];
        case 'sunday':
            return cal.days[6];
    }
}

// ─── Core scheduling logic ──────────────────────────────────────────

/** Date string YYYY-MM-DD → YYYYMMDD for GTFS comparison */
function toGtfsDate(dateStr: string): string {
    return dateStr.replace(/-/g, '');
}

/** Build the list of scheduled trips for a date + service type. */
export function getTripsForDayType(dateStr: string, dayType: DayType): ScheduledTrip[] {
    const gtfsDate = toGtfsDate(dateStr);
    const exceptions = calendarDatesByDate.get(gtfsDate) || [];

    const activeServices = new Set<string>();

    for (const cal of calendar) {
        if (gtfsDate < cal.startDate || gtfsDate > cal.endDate) continue;
        if (!calendarMatchesDayType(cal, dayType)) continue;
        activeServices.add(cal.serviceId);
    }

    // Apply calendar_dates exceptions for this specific date
    for (const ex of exceptions) {
        if (ex.exceptionType === 1) {
            activeServices.add(ex.serviceId);
        } else {
            activeServices.delete(ex.serviceId);
        }
    }

    const result: ScheduledTrip[] = [];
    for (const serviceId of activeServices) {
        const serviceTrips = tripsByService.get(serviceId) || [];
        for (const t of serviceTrips) {
            const departure = departureIndex[t.tripId];
            if (!departure) continue;
            result.push({
                tripId: t.tripId,
                routeId: t.routeId,
                headsign: t.headsign,
                blockId: t.blockId,
                departure,
                serviceId: t.serviceId,
            });
        }
    }

    return result.sort((a, b) => a.departure.localeCompare(b.departure));
}

// ─── Public API ─────────────────────────────────────────────────────

/** Whether the GTFS feed covers this date at all */
export function hasGtfsCoverage(dateStr: string): boolean {
    const gtfsDate = toGtfsDate(dateStr);
    return calendar.some(c => gtfsDate >= c.startDate && gtfsDate <= c.endDate);
}

/**
 * Resolve the effective service type for a date.
 * Priority: (1) Ontario holiday calendar → (2) STREETS dayType as-is.
 */
export function resolveServiceType(dateStr: string, streetsDayType: DayType): DayType {
    return ONTARIO_HOLIDAYS[dateStr] ?? streetsDayType;
}

/**
 * Returns all scheduled trips for a given date + day type.
 * Applies holiday override from ONTARIO_HOLIDAYS if applicable.
 */
export function getScheduledTrips(dateStr: string, dayType: DayType): ScheduledTrip[] {
    const effectiveDayType = resolveServiceType(dateStr, dayType);
    return getTripsForDayType(dateStr, effectiveDayType);
}

/**
 * Best-fit service matching: tries all 3 service types and returns the one
 * whose trip IDs best match the observed set. Used as fallback when the
 * primary match rate is too low (holiday not in ONTARIO_HOLIDAYS, snow day, etc.).
 *
 * Returns { trips, dayType, matchCount } for the best-fitting service,
 * or null if no service achieves any matches.
 */
export function bestFitScheduledTrips(
    dateStr: string,
    observedTripIds: Set<string>,
): { trips: ScheduledTrip[]; dayType: DayType; matchCount: number } | null {
    const candidates: DayType[] = ['weekday', 'saturday', 'sunday'];
    let best: { trips: ScheduledTrip[]; dayType: DayType; matchCount: number } | null = null;

    for (const dt of candidates) {
        const trips = getTripsForDayType(dateStr, dt);
        if (trips.length === 0) continue;
        let matchCount = 0;
        for (const t of trips) {
            if (observedTripIds.has(t.tripId)) matchCount++;
        }
        if (!best || matchCount > best.matchCount) {
            best = { trips, dayType: dt, matchCount };
        }
    }

    return best && best.matchCount > 0 ? best : null;
}

// ─── Route + departure-time matching (resilient to GTFS feed ID changes) ────

const MATCH_TOLERANCE_MINS = 15;
const MIN_DAY_MATCH_RATIO = 0.25;
const MIN_ROUTE_MATCH_RATIO = 0.1;
const LATE_CLASSIFICATION_WINDOW_MINS = 60;

function parseTimeToMinutes(raw: string): number | null {
    const value = raw.trim();
    const m = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    const hours = Number.parseInt(m[1], 10);
    const mins = Number.parseInt(m[2], 10);
    if (!Number.isFinite(hours) || !Number.isFinite(mins) || mins < 0 || mins > 59) return null;
    if (hours < 0) return null;
    return (hours * 60) + mins;
}

function minuteOfDay(totalMinutes: number): number {
    return ((totalMinutes % 1440) + 1440) % 1440;
}

function minuteKey(routeId: string, minute: number): string {
    return `${routeId}|${minute}`;
}

function circularSignedDelta(fromMinute: number, toMinute: number): number {
    let diff = toMinute - fromMinute;
    while (diff > 720) diff -= 1440;
    while (diff <= -720) diff += 1440;
    return diff;
}

interface ObservedDepartureEntry {
    minute: number;
    used: boolean;
}

function buildObservedByRoute(trips: { routeId: string; terminalDepartureTime: string }[]): Map<string, ObservedDepartureEntry[]> {
    const byRoute = new Map<string, ObservedDepartureEntry[]>();
    for (const t of trips) {
        const mins = parseTimeToMinutes(t.terminalDepartureTime);
        if (mins === null) continue;
        const route = t.routeId;
        const arr = byRoute.get(route) || [];
        arr.push({ minute: minuteOfDay(mins), used: false });
        byRoute.set(route, arr);
    }
    for (const arr of byRoute.values()) {
        arr.sort((a, b) => a.minute - b.minute);
    }
    return byRoute;
}

function findBestObserved(
    entries: ObservedDepartureEntry[],
    scheduledMinute: number,
    predicate: (delta: number) => boolean,
    score: (delta: number) => number,
): { index: number; delta: number } | null {
    let best: { index: number; delta: number; score: number } | null = null;
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].used) continue;
        const delta = circularSignedDelta(scheduledMinute, entries[i].minute);
        if (!predicate(delta)) continue;
        const s = score(delta);
        if (!best || s < best.score) best = { index: i, delta, score: s };
    }
    return best ? { index: best.index, delta: best.delta } : null;
}

/** Build route|time keys from observed trips for O(1) matching */
export function buildObservedKeys(trips: { routeId: string; terminalDepartureTime: string }[]): Set<string> {
    const keys = new Set<string>();
    for (const t of trips) {
        const mins = parseTimeToMinutes(t.terminalDepartureTime);
        if (mins === null) continue;
        keys.add(minuteKey(t.routeId, minuteOfDay(mins)));
    }
    return keys;
}

/** Check if a scheduled trip matches any observed trip within ±15 min tolerance */
export function hasRouteTimeMatch(routeId: string, departure: string, keys: Set<string>): boolean {
    const mins = parseTimeToMinutes(departure);
    if (mins === null) return false;
    for (let offset = -MATCH_TOLERANCE_MINS; offset <= MATCH_TOLERANCE_MINS; offset++) {
        const adj = minuteOfDay(mins + offset);
        if (keys.has(minuteKey(routeId, adj))) return true;
    }
    return false;
}

export function countRouteTimeMatches(scheduled: ScheduledTrip[], keys: Set<string>): number {
    let n = 0;
    for (const s of scheduled) {
        if (hasRouteTimeMatch(s.routeId, s.departure, keys)) n++;
    }
    return n;
}

export function isBetterServiceCandidate(next: ServiceCandidate, current: ServiceCandidate): boolean {
    if (next.matchRatio !== current.matchRatio) return next.matchRatio > current.matchRatio;
    if (next.matched !== current.matched) return next.matched > current.matched;
    return next.relevantScheduled.length < current.relevantScheduled.length;
}

function evaluateCandidate(
    scheduled: ScheduledTrip[],
    observedRoutes: Set<string>,
    observedKeys: Set<string>,
): ServiceCandidate {
    const relevantScheduled = scheduled.filter(s => observedRoutes.has(s.routeId));
    const routeStats = new Map<string, RouteMatchStats>();
    let matched = 0;

    for (const s of relevantScheduled) {
        const existing = routeStats.get(s.routeId) || { scheduled: 0, matched: 0 };
        existing.scheduled++;
        const isMatch = hasRouteTimeMatch(s.routeId, s.departure, observedKeys);
        if (isMatch) {
            matched++;
            existing.matched++;
        }
        routeStats.set(s.routeId, existing);
    }

    return {
        relevantScheduled,
        matched,
        matchRatio: relevantScheduled.length > 0 ? (matched / relevantScheduled.length) : 0,
        routeStats,
    };
}

function isRouteReliable(stats: RouteMatchStats): boolean {
    if (stats.scheduled <= 0) return false;
    if (stats.matched <= 0) return false;
    return (stats.matched / stats.scheduled) >= MIN_ROUTE_MATCH_RATIO;
}

export interface MissedTripRow {
    tripId: string;
    routeId: string;
    departure: string;
    headsign: string;
    blockId: string;
    serviceId: string;
    missType: 'not_performed' | 'late_over_15';
    lateByMinutes?: number;
}

export interface MissedTripsSummary {
    totalScheduled: number;
    totalMatched: number;
    totalMissed: number;
    missedPct: number;
    notPerformedCount: number;
    lateOver15Count: number;
    byRoute: { routeId: string; count: number; earliestDep: string }[];
    trips: MissedTripRow[];
}

/**
 * Compute missed trips for a single day's observed data.
 * Returns null if no GTFS coverage or match rate too low.
 */
export function computeMissedTripsForDay(
    date: string,
    dayType: DayType,
    observedTrips: { routeId: string; terminalDepartureTime: string }[],
): MissedTripsSummary | null {
    if (!hasGtfsCoverage(date)) return null;

    const observedRoutes = new Set(observedTrips.map(t => t.routeId));
    if (observedRoutes.size === 0) return null;
    const observedKeys = buildObservedKeys(observedTrips);

    let best = evaluateCandidate(getScheduledTrips(date, dayType), observedRoutes, observedKeys);

    // Best-fit fallback
    if (best.relevantScheduled.length > 0 && best.matchRatio < MIN_DAY_MATCH_RATIO) {
        for (const dt of ['weekday', 'saturday', 'sunday'] as const) {
            const next = evaluateCandidate(getTripsForDayType(date, dt), observedRoutes, observedKeys);
            if (isBetterServiceCandidate(next, best)) best = next;
        }
    }

    if (best.relevantScheduled.length === 0 || best.matchRatio < MIN_DAY_MATCH_RATIO) return null;

    const reliableRoutes = new Set<string>();
    for (const [routeId, stats] of best.routeStats) {
        if (isRouteReliable(stats)) reliableRoutes.add(routeId);
    }
    if (reliableRoutes.size === 0) return null;

    const reliableScheduled = best.relevantScheduled.filter(s => reliableRoutes.has(s.routeId));
    const dayMatched = countRouteTimeMatches(reliableScheduled, observedKeys);
    if (reliableScheduled.length === 0 || (dayMatched / reliableScheduled.length) < MIN_DAY_MATCH_RATIO) return null;

    const observedByRoute = buildObservedByRoute(observedTrips.filter(t => reliableRoutes.has(t.routeId)));
    const scheduledOrdered = [...reliableScheduled].sort((a, b) => {
        const routeCmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
        if (routeCmp !== 0) return routeCmp;
        const aMin = parseTimeToMinutes(a.departure);
        const bMin = parseTimeToMinutes(b.departure);
        if (aMin === null && bMin === null) return 0;
        if (aMin === null) return 1;
        if (bMin === null) return -1;
        return minuteOfDay(aMin) - minuteOfDay(bMin);
    });

    let matchedCount = 0;
    const unmatched: { s: ScheduledTrip; depMin: number | null }[] = [];
    for (const s of scheduledOrdered) {
        const depRaw = parseTimeToMinutes(s.departure);
        const depMin = depRaw === null ? null : minuteOfDay(depRaw);
        if (depMin === null) {
            unmatched.push({ s, depMin });
            continue;
        }
        const entries = observedByRoute.get(s.routeId) || [];
        const exact = findBestObserved(
            entries,
            depMin,
            (delta) => Math.abs(delta) <= MATCH_TOLERANCE_MINS,
            (delta) => Math.abs(delta),
        );
        if (exact) {
            entries[exact.index].used = true;
            matchedCount++;
            continue;
        }
        unmatched.push({ s, depMin });
    }

    const missedTrips: MissedTripRow[] = [];
    let notPerformedCount = 0;
    let lateOver15Count = 0;
    const missedByRoute = new Map<string, { routeId: string; count: number; earliestDep: string }>();
    for (const { s, depMin } of unmatched) {
        const entries = observedByRoute.get(s.routeId) || [];
        const late = depMin === null
            ? null
            : findBestObserved(
                entries,
                depMin,
                (delta) => delta > MATCH_TOLERANCE_MINS && delta <= LATE_CLASSIFICATION_WINDOW_MINS,
                (delta) => delta,
            );

        if (late) {
            entries[late.index].used = true;
            lateOver15Count++;
            missedTrips.push({
                tripId: s.tripId,
                routeId: s.routeId,
                departure: s.departure,
                headsign: s.headsign,
                blockId: s.blockId,
                serviceId: s.serviceId,
                missType: 'late_over_15',
                lateByMinutes: Math.round(late.delta),
            });
        } else {
            notPerformedCount++;
            missedTrips.push({
                tripId: s.tripId,
                routeId: s.routeId,
                departure: s.departure,
                headsign: s.headsign,
                blockId: s.blockId,
                serviceId: s.serviceId,
                missType: 'not_performed',
            });
        }

        const existing = missedByRoute.get(s.routeId);
        if (existing) {
            existing.count++;
            if (s.departure < existing.earliestDep) existing.earliestDep = s.departure;
        } else {
            missedByRoute.set(s.routeId, { routeId: s.routeId, count: 1, earliestDep: s.departure });
        }
    }

    const totalMissed = missedTrips.length;
    return {
        totalScheduled: scheduledOrdered.length,
        totalMatched: matchedCount,
        totalMissed,
        missedPct: (totalMissed / scheduledOrdered.length) * 100,
        notPerformedCount,
        lateOver15Count,
        byRoute: Array.from(missedByRoute.values()).sort((a, b) => b.count - a.count),
        trips: missedTrips.sort((a, b) => {
            const typeCmp = a.missType.localeCompare(b.missType);
            if (typeCmp !== 0) return typeCmp;
            const routeCmp = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
            if (routeCmp !== 0) return routeCmp;
            const depCmp = a.departure.localeCompare(b.departure);
            if (depCmp !== 0) return depCmp;
            return a.tripId.localeCompare(b.tripId);
        }),
    };
}

/** Quick summary for diagnostics */
export function getGtfsIndexStats(): { totalTrips: number; services: number; coverageStart: string; coverageEnd: string } {
    let earliest = '99999999';
    let latest = '00000000';
    for (const c of calendar) {
        if (c.startDate < earliest) earliest = c.startDate;
        if (c.endDate > latest) latest = c.endDate;
    }
    return {
        totalTrips: trips.length,
        services: calendar.length,
        coverageStart: `${earliest.slice(0, 4)}-${earliest.slice(4, 6)}-${earliest.slice(6, 8)}`,
        coverageEnd: `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}`,
    };
}
