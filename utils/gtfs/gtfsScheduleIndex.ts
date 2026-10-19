/**
 * GTFS Schedule Index — cross-references GTFS feed against STREETS data
 * to identify missed trips (scheduled but not operated).
 *
 * Schedules come from data/gtfsScheduleBundle.json (built by
 * scripts/buildGtfsScheduleBundle.ts), one entry per GTFS feed.
 *
 * Holiday handling (Option D):
 *  - Known Ontario statutory holidays map to their actual service type
 *  - Unknown mismatches use best-fit matching (try all 3 service types,
 *    pick the one with the strongest route+time match quality)
 */
import packagedBundleJson from '../../data/gtfsScheduleBundle.json';
import { flattenScheduleBundle, type ScheduleBundle } from './gtfsScheduleBundle';
import type { DayType } from '../performanceDataTypes';

const packagedBundle = packagedBundleJson as ScheduleBundle;

// ─── Types ──────────────────────────────────────────────────────────

export interface ScheduledTrip {
    tripId: string;
    routeId: string;
    headsign: string;
    blockId: string;
    departure: string;   // HH:MM, first stop
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
    departure: string;   // HH:MM, first stop
}

// ─── Ontario Statutory Holidays ─────────────────────────────────────
// Barrie Transit runs Sunday service on Ontario statutory holidays. Feeds often only
// remove regular service on these dates (Canada Day, Thanksgiving, Christmas) without
// adding the replacement, so holidays are computed by rule. A feed that adds its own
// service for the date (calendar_dates type 1, e.g. Labour Day 2026) is trusted instead.

/** One-off dates the holiday rules do not cover (e.g. a declared extra holiday). */
const SERVICE_TYPE_OVERRIDES: Record<string, DayType> = {};

function nthMondayOfMonth(year: number, monthIndex: number, n: number): number {
    const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    return 1 + ((8 - firstDow) % 7) + (n - 1) * 7;
}

/** Gregorian Easter Sunday (anonymous algorithm). */
function easterSunday(year: number): { month: number; day: number } {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return { month, day };
}

/** Name of the Ontario statutory holiday on this YYYY-MM-DD date, or null. */
export function getOntarioHolidayName(dateStr: string): string | null {
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);

    if (month === 1 && day === 1) return "New Year's Day";
    if (month === 2 && day === nthMondayOfMonth(year, 1, 3)) return 'Family Day';
    const easter = new Date(Date.UTC(year, easterSunday(year).month - 1, easterSunday(year).day));
    const goodFriday = new Date(easter.getTime() - 2 * 86_400_000);
    if (month === goodFriday.getUTCMonth() + 1 && day === goodFriday.getUTCDate()) return 'Good Friday';
    if (month === 5) {
        const may24Dow = new Date(Date.UTC(year, 4, 24)).getUTCDay();
        const victoriaDay = 24 - ((may24Dow + 6) % 7);
        if (day === victoriaDay) return 'Victoria Day';
    }
    if (month === 7 && day === 1) return 'Canada Day';
    if (month === 8 && day === nthMondayOfMonth(year, 7, 1)) return 'Civic Holiday';
    if (month === 9 && day === nthMondayOfMonth(year, 8, 1)) return 'Labour Day';
    if (month === 10 && day === nthMondayOfMonth(year, 9, 2)) return 'Thanksgiving';
    if (month === 12 && day === 25) return 'Christmas Day';
    if (month === 12 && day === 26) return 'Boxing Day';
    return null;
}

function feedAddsServiceOn(dateStr: string): boolean {
    return (calendarDatesByDate.get(toGtfsDate(dateStr)) || []).some(ex => ex.exceptionType === 1);
}

// ─── Schedule data ──────────────────────────────────────────────────
// One or more GTFS feeds, stitched in time order (see utils/gtfs/gtfsScheduleBundle.ts).

let calendar: CalendarEntry[] = [];
let trips: GtfsTrip[] = [];
let calendarDatesByDate = new Map<string, CalendarDateException[]>();
let tripsByService = new Map<string, GtfsTrip[]>();

/** Replaces the schedule used for matching, e.g. with feeds archived after this build. */
export function setScheduleBundle(bundle: ScheduleBundle): void {
    const flat = flattenScheduleBundle(bundle);
    calendar = flat.calendar;
    trips = flat.trips;
    calendarDatesByDate = new Map();
    for (const cd of flat.calendarDates) {
        const existing = calendarDatesByDate.get(cd.date) || [];
        existing.push(cd);
        calendarDatesByDate.set(cd.date, existing);
    }
    tripsByService = new Map();
    for (const t of trips) {
        const existing = tripsByService.get(t.serviceId) || [];
        existing.push(t);
        tripsByService.set(t.serviceId, existing);
    }
}

setScheduleBundle(packagedBundle);

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
            result.push({
                tripId: t.tripId,
                routeId: t.routeId,
                headsign: t.headsign,
                blockId: t.blockId,
                departure: t.departure,
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
 * Priority: (1) manual override → (2) Ontario statutory holiday runs Sunday service,
 * unless the feed adds its own service that day → (3) STREETS dayType as-is.
 */
export function resolveServiceType(dateStr: string, streetsDayType: DayType): DayType {
    const override = SERVICE_TYPE_OVERRIDES[dateStr];
    if (override) return override;
    if (getOntarioHolidayName(dateStr) && !feedAddsServiceOn(dateStr)) return 'sunday';
    return streetsDayType;
}

/**
 * Returns all scheduled trips for a given date + day type.
 * Applies the holiday service type from resolveServiceType.
 */
export function getScheduledTrips(dateStr: string, dayType: DayType): ScheduledTrip[] {
    const effectiveDayType = resolveServiceType(dateStr, dayType);
    return getTripsForDayType(dateStr, effectiveDayType);
}

/**
 * Best-fit service matching: tries all 3 service types and returns the one
 * whose trip IDs best match the observed set. Used as fallback when the
 * primary match rate is too low (unlisted holiday, snow day, etc.).
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
    /** AVL direction code (N/S, CW/CCW, E/W); null when not reported. */
    direction: string | null;
}

interface ObservedTripInput {
    routeId: string;
    terminalDepartureTime: string;
    direction?: string | null;
}

function buildObservedByRoute(trips: ObservedTripInput[]): Map<string, ObservedDepartureEntry[]> {
    const byRoute = new Map<string, ObservedDepartureEntry[]>();
    for (const t of trips) {
        const mins = parseTimeToMinutes(t.terminalDepartureTime);
        if (mins === null) continue;
        const route = t.routeId;
        const arr = byRoute.get(route) || [];
        arr.push({ minute: minuteOfDay(mins), used: false, direction: t.direction?.trim() || null });
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
    direction: string | null = null,
): { index: number; delta: number } | null {
    let best: { index: number; delta: number; score: number } | null = null;
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].used) continue;
        if (direction && entries[i].direction && entries[i].direction !== direction) continue;
        const delta = circularSignedDelta(scheduledMinute, entries[i].minute);
        if (!predicate(delta)) continue;
        const s = score(delta);
        if (!best || s < best.score) best = { index: i, delta, score: s };
    }
    return best ? { index: best.index, delta: best.delta } : null;
}

const DIRECTION_LEARN_WINDOW_MINS = 2;
const DIRECTION_MIN_AGREEMENT = 0.8;

function headsignKey(routeId: string, headsign: string): string {
    return `${routeId}|${headsign}`;
}

/**
 * AVL trips carry a direction code; GTFS trips only carry a headsign. Learn each
 * route+headsign's code from departures where only one headsign is scheduled nearby
 * and exactly one bus left at that minute. A route with two headsigns and two codes
 * gives the unlearned headsign the remaining code (Route 400 runs both directions at
 * the same minute all day, so one side is never seen alone).
 */
function learnHeadsignDirections(
    scheduled: ScheduledTrip[],
    observedByRoute: Map<string, ObservedDepartureEntry[]>,
): Map<string, string> {
    const votes = new Map<string, Map<string, number>>();
    const headsignsByRoute = new Map<string, { headsign: string; minute: number }[]>();
    for (const s of scheduled) {
        const mins = parseTimeToMinutes(s.departure);
        if (mins === null) continue;
        const arr = headsignsByRoute.get(s.routeId) || [];
        arr.push({ headsign: s.headsign, minute: minuteOfDay(mins) });
        headsignsByRoute.set(s.routeId, arr);
    }

    for (const [routeId, trips] of headsignsByRoute) {
        const entries = observedByRoute.get(routeId) || [];
        for (const t of trips) {
            const otherHeadsignNearby = trips.some(o =>
                o.headsign !== t.headsign && Math.abs(circularSignedDelta(t.minute, o.minute)) <= MATCH_TOLERANCE_MINS);
            if (otherHeadsignNearby) continue;
            const near = entries.filter(e => Math.abs(circularSignedDelta(t.minute, e.minute)) <= DIRECTION_LEARN_WINDOW_MINS);
            if (near.length !== 1 || !near[0].direction) continue;
            const key = headsignKey(routeId, t.headsign);
            const tally = votes.get(key) || new Map<string, number>();
            tally.set(near[0].direction, (tally.get(near[0].direction) || 0) + 1);
            votes.set(key, tally);
        }
    }

    const learned = new Map<string, string>();
    for (const [key, tally] of votes) {
        let total = 0;
        let top: [string, number] | null = null;
        for (const entry of tally) {
            total += entry[1];
            if (!top || entry[1] > top[1]) top = entry;
        }
        if (top && top[1] / total >= DIRECTION_MIN_AGREEMENT) learned.set(key, top[0]);
    }

    for (const [routeId, trips] of headsignsByRoute) {
        const headsigns = [...new Set(trips.map(t => t.headsign))];
        const codes = [...new Set((observedByRoute.get(routeId) || []).map(e => e.direction).filter((d): d is string => !!d))];
        if (headsigns.length !== 2 || codes.length !== 2) continue;
        const keys = headsigns.map(h => headsignKey(routeId, h));
        const known = keys.filter(k => learned.has(k));
        if (known.length !== 1) continue;
        const remaining = codes.find(c => c !== learned.get(known[0]));
        const unknown = keys.find(k => !learned.has(k));
        if (remaining && unknown) learned.set(unknown, remaining);
    }

    return learned;
}

interface PendingScheduledTrip {
    s: ScheduledTrip;
    depMin: number;
}

/**
 * Pair scheduled trips with observed departures within the match tolerance, one bus
 * per trip. Uses augmenting paths, so it matches as many trips as possible, and tries
 * each trip's closest bus first, so a bus that left on the minute is credited to that
 * trip rather than to an earlier trip that happened to be checked first.
 * Returns the trips left without a bus.
 */
function matchClosestFirst(
    trips: PendingScheduledTrip[],
    observedByRoute: Map<string, ObservedDepartureEntry[]>,
    directionFor: (s: ScheduledTrip) => string | null,
): PendingScheduledTrip[] {
    const candidates = trips.map(({ s, depMin }) => {
        const entries = observedByRoute.get(s.routeId) || [];
        const direction = directionFor(s);
        const options: { entry: ObservedDepartureEntry; distance: number }[] = [];
        for (const entry of entries) {
            if (entry.used) continue;
            if (direction && entry.direction && entry.direction !== direction) continue;
            const distance = Math.abs(circularSignedDelta(depMin, entry.minute));
            if (distance <= MATCH_TOLERANCE_MINS) options.push({ entry, distance });
        }
        return options.sort((a, b) => a.distance - b.distance || a.entry.minute - b.entry.minute);
    });

    const owner = new Map<ObservedDepartureEntry, number>();
    const tryAssign = (tripIndex: number, visited: Set<ObservedDepartureEntry>): boolean => {
        for (const { entry } of candidates[tripIndex]) {
            if (visited.has(entry)) continue;
            visited.add(entry);
            const current = owner.get(entry);
            if (current === undefined || tryAssign(current, visited)) {
                owner.set(entry, tripIndex);
                return true;
            }
        }
        return false;
    };

    const order = trips
        .map((_, i) => i)
        .sort((a, b) => (candidates[a][0]?.distance ?? Infinity) - (candidates[b][0]?.distance ?? Infinity) || a - b);
    for (const i of order) tryAssign(i, new Set());

    const matched = new Set<number>();
    for (const [entry, tripIndex] of owner) {
        entry.used = true;
        matched.add(tripIndex);
    }
    return trips.filter((_, i) => !matched.has(i));
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
    observedTrips: ObservedTripInput[],
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

    // Match same-direction buses first so a miss is charged to the direction that had
    // no bus; then let any leftover bus match regardless of its direction code.
    const directionByHeadsign = learnHeadsignDirections(reliableScheduled, observedByRoute);
    const expectedDirection = (s: ScheduledTrip) => directionByHeadsign.get(headsignKey(s.routeId, s.headsign)) ?? null;

    const unmatched: { s: ScheduledTrip; depMin: number | null }[] = [];
    const timed: PendingScheduledTrip[] = [];
    for (const s of scheduledOrdered) {
        const depRaw = parseTimeToMinutes(s.departure);
        const depMin = depRaw === null ? null : minuteOfDay(depRaw);
        if (depMin === null) unmatched.push({ s, depMin });
        else timed.push({ s, depMin });
    }
    const sameDirectionLeftover = matchClosestFirst(timed, observedByRoute, expectedDirection);
    const leftover = matchClosestFirst(sameDirectionLeftover, observedByRoute, () => null);
    const matchedCount = timed.length - leftover.length;
    unmatched.push(...leftover);

    const missedTrips: MissedTripRow[] = [];
    let notPerformedCount = 0;
    let lateOver15Count = 0;
    const missedByRoute = new Map<string, { routeId: string; count: number; earliestDep: string }>();
    for (const { s, depMin } of unmatched) {
        const entries = observedByRoute.get(s.routeId) || [];
        const isLate = (delta: number) => delta > MATCH_TOLERANCE_MINS && delta <= LATE_CLASSIFICATION_WINDOW_MINS;
        const late = depMin === null
            ? null
            : findBestObserved(entries, depMin, isLate, (delta) => delta, expectedDirection(s))
                ?? findBestObserved(entries, depMin, isLate, (delta) => delta);

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
