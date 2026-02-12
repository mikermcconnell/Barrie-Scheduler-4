/**
 * GTFS Types
 *
 * Type definitions for General Transit Feed Specification (GTFS) entities.
 * Based on the GTFS Static specification: https://gtfs.org/schedule/reference/
 *
 * Used for importing existing schedules from Barrie Transit's GTFS feed.
 */

import type { DayType } from '../masterScheduleTypes';
import type { Direction } from '../config/routeDirectionConfig';
import { getRouteConfig } from '../config/routeDirectionConfig';

// ============ RAW GTFS ENTITIES (from feed files) ============

/**
 * GTFS Agency (agency.txt)
 */
export interface GTFSAgency {
    agency_id: string;
    agency_name: string;
    agency_url: string;
    agency_timezone: string;
    agency_lang?: string;
    agency_phone?: string;
}

/**
 * GTFS Route (routes.txt)
 */
export interface GTFSRoute {
    route_id: string;
    agency_id?: string;
    route_short_name: string;      // "400", "8A", "100"
    route_long_name: string;       // "Yonge Corridor", etc.
    route_desc?: string;
    route_type: number;            // 3 = Bus
    route_url?: string;
    route_color?: string;          // Hex color (no #)
    route_text_color?: string;
}

/**
 * GTFS Stop (stops.txt)
 */
export interface GTFSStop {
    stop_id: string;
    stop_code?: string;
    stop_name: string;
    stop_desc?: string;
    stop_lat: number;
    stop_lon: number;
    zone_id?: string;
    stop_url?: string;
    location_type?: number;        // 0 = stop, 1 = station
    parent_station?: string;
    stop_timezone?: string;
    wheelchair_boarding?: number;
}

/**
 * GTFS Trip (trips.txt)
 */
export interface GTFSTrip {
    route_id: string;
    service_id: string;            // Links to calendar.txt
    trip_id: string;
    trip_headsign?: string;        // "To Park Place", "To Georgian College"
    trip_short_name?: string;
    direction_id?: number;         // 0 or 1 (maps to North/South)
    block_id?: string;             // Vehicle block assignment
    shape_id?: string;
    wheelchair_accessible?: number;
    bikes_allowed?: number;
}

/**
 * GTFS Stop Time (stop_times.txt)
 */
export interface GTFSStopTime {
    trip_id: string;
    arrival_time: string;          // "HH:MM:SS" format (can exceed 24:00)
    departure_time: string;        // "HH:MM:SS" format
    stop_id: string;
    stop_sequence: number;         // Order of stops in trip
    stop_headsign?: string;
    pickup_type?: number;          // 0 = regular, 1 = no pickup
    drop_off_type?: number;        // 0 = regular, 1 = no drop off
    shape_dist_traveled?: number;
    timepoint?: number;            // 1 = exact time, 0 = approximate
}

/**
 * GTFS Calendar (calendar.txt)
 */
export interface GTFSCalendar {
    service_id: string;
    monday: number;                // 1 = service runs, 0 = doesn't
    tuesday: number;
    wednesday: number;
    thursday: number;
    friday: number;
    saturday: number;
    sunday: number;
    start_date: string;            // YYYYMMDD
    end_date: string;              // YYYYMMDD
}

/**
 * GTFS Calendar Date (calendar_dates.txt) - exceptions
 */
export interface GTFSCalendarDate {
    service_id: string;
    date: string;                  // YYYYMMDD
    exception_type: number;        // 1 = added, 2 = removed
}

// ============ PARSED/PROCESSED TYPES ============

/**
 * Parsed GTFS feed containing all relevant entities
 */
export interface ParsedGTFSFeed {
    agency: GTFSAgency[];
    routes: GTFSRoute[];
    stops: GTFSStop[];
    trips: GTFSTrip[];
    stopTimes: GTFSStopTime[];
    calendar: GTFSCalendar[];
    calendarDates: GTFSCalendarDate[];
    feedInfo?: {
        feedPublisherName?: string;
        feedPublisherUrl?: string;
        feedLang?: string;
        feedStartDate?: string;
        feedEndDate?: string;
        feedVersion?: string;
    };
}

/**
 * Route option for user selection (grouped by day type)
 *
 * For A/B direction routes (2, 7, 12), we merge 2A+2B into a single option
 * where A trips become North and B trips become South.
 */
export interface GTFSRouteOption {
    routeId: string;
    routeShortName: string;        // "400", "8A", or "2" for merged routes
    routeLongName: string;         // "Yonge Corridor"
    dayType: DayType;
    serviceId: string;
    tripCount: number;
    direction?: Direction | null;  // Inferred from direction_id
    color?: string;                // Route color for UI

    // Merged A/B direction route fields (for routes like 2, 7, 12)
    isMergedRoute?: boolean;       // True if this combines A+B direction routes
    northRouteId?: string;         // Route ID for North direction (e.g., "2A")
    northServiceId?: string;       // Service ID for North direction
    northTripCount?: number;       // Trip count for North direction
    southRouteId?: string;         // Route ID for South direction (e.g., "2B")
    southServiceId?: string;       // Service ID for South direction
    southTripCount?: number;       // Trip count for South direction
    displayName?: string;          // Custom display name like "Route 2 (2A + 2B)"
}

/**
 * Processed trip ready for conversion to MasterTrip
 */
export interface ProcessedGTFSTrip {
    tripId: string;
    routeId: string;
    serviceId: string;
    blockId: string | null;
    direction: Direction | 'Loop' | null;
    headsign: string | null;
    shapeId: string | null;
    stopTimes: {
        stopId: string;
        stopName: string;
        arrivalTime: string;       // "HH:MM:SS"
        departureTime: string;     // "HH:MM:SS"
        arrivalMinutes: number;    // Minutes from midnight
        departureMinutes: number;
        sequence: number;
        isTimepoint: boolean;      // True if this is a scheduled timepoint
    }[];
    startTime: number;             // Minutes from midnight
    endTime: number;
    travelTime: number;            // Minutes
}

/**
 * Import options for GTFS import
 */
export interface GTFSImportOptions {
    timepointsOnly: boolean;       // If true, only include timepoint stops (default: true)
}

/**
 * GTFS import configuration (stored per team)
 */
export interface GTFSImportConfig {
    feedUrl: string;               // Default: myridebarrie.ca/gtfs
    lastFetched?: string;          // ISO timestamp
    lastFetchedBy?: string;        // User ID
    cachedRoutes?: GTFSRouteOption[];
    directionMapping?: {           // Custom direction_id -> Direction mapping
        [routeId: string]: {
            0: Direction | 'Loop';
            1: Direction | 'Loop';
        };
    };
}

/**
 * Result of GTFS import operation
 */
export interface GTFSImportResult {
    success: boolean;
    routeIdentity?: string;        // "400-Weekday"
    draftId?: string;              // Created draft ID
    tripCount?: number;
    northTripCount?: number;
    southTripCount?: number;
    error?: string;
    warnings?: string[];
    // Bulk import: all successfully imported draft IDs
    allDraftIds?: string[];
}

// ============ HELPER FUNCTIONS ============

/**
 * Parse GTFS time string to minutes from midnight
 * GTFS times can exceed 24:00 for trips past midnight
 * @param timeStr - "HH:MM:SS" format (e.g., "25:30:00" = 1:30 AM next day)
 */
export function gtfsTimeToMinutes(timeStr: string): number {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    return hours * 60 + minutes;
}

/**
 * Convert minutes from midnight to GTFS time string
 * @param minutes - Minutes from midnight (can exceed 1440 for next-day times)
 */
export function minutesToGtfsTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`;
}

/**
 * Convert minutes to display time (12-hour format)
 * @param minutes - Minutes from midnight
 */
export function minutesToDisplayTime(minutes: number): string {
    // Normalize to 0-1439 range for display
    const normalizedMinutes = minutes % 1440;
    let hours = Math.floor(normalizedMinutes / 60);
    const mins = normalizedMinutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';

    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;

    return `${hours}:${mins.toString().padStart(2, '0')} ${period}`;
}

/**
 * Determine DayType from GTFS calendar entry
 */
export function calendarToDayType(calendar: GTFSCalendar): DayType | null {
    const weekdays = calendar.monday && calendar.tuesday && calendar.wednesday
        && calendar.thursday && calendar.friday;

    if (weekdays && !calendar.saturday && !calendar.sunday) {
        return 'Weekday';
    }
    if (calendar.saturday && !calendar.sunday && !weekdays) {
        return 'Saturday';
    }
    if (calendar.sunday && !calendar.saturday && !weekdays) {
        return 'Sunday';
    }

    // Mixed schedule - return null and let caller decide
    return null;
}

/**
 * Infer direction from GTFS trip data
 * Priority: 1) Headsign terminus matching, 2) Custom config mapping, 3) Default direction_id
 */
export function gtfsDirectionToDirection(
    directionId: number | undefined,
    routeId: string,
    config?: GTFSImportConfig,
    headsign?: string,
    routeShortName?: string
): Direction | null {
    // Try headsign-based inference first (most reliable)
    if (headsign && routeShortName) {
        const routeConfig = getRouteConfig(routeShortName);
        if (routeConfig && routeConfig.segments.length === 2) {
            const headsignLower = headsign.toLowerCase();

            for (const segment of routeConfig.segments) {
                if (segment.terminus) {
                    const terminusLower = segment.terminus.toLowerCase();
                    // Check if headsign contains the terminus name
                    if (headsignLower.includes(terminusLower) || terminusLower.includes(headsignLower)) {
                        return segment.name as Direction;
                    }
                }
            }
        }
    }

    if (directionId === undefined) return null;

    // Check for custom mapping
    if (config?.directionMapping?.[routeId]) {
        const mapping = config.directionMapping[routeId];
        const result = mapping[directionId as 0 | 1];
        return result === 'Loop' ? null : result;
    }

    // Default mapping (may need adjustment based on actual Barrie GTFS)
    // Standard GTFS: 0 = outbound (typically South), 1 = inbound (typically North)
    return directionId === 0 ? 'South' : 'North';
}
