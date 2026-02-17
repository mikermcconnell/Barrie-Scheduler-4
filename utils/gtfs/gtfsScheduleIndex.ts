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
 *    pick the one with the highest trip ID match rate)
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
function getTripsForDayType(dateStr: string, dayType: DayType): ScheduledTrip[] {
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
