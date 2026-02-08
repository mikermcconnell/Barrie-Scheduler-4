/**
 * RoundTripTableView Component
 *
 * Displays schedules in a combined North/South round-trip format.
 * Shows trips paired by block with metrics and interline connections.
 *
 * Extracted from ScheduleEditor.tsx for maintainability.
 */

import React, { useMemo, useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Plus,
    Pencil,
    Trash2,
    ArrowUpDown
} from 'lucide-react';
import {
    MasterRouteTable,
    MasterTrip,
    RoundTripTable,
    buildRoundTripView
} from '../../utils/masterScheduleParser';
import { TimeUtils } from '../../utils/timeUtils';
import { getRouteVariant, getRouteConfig, getDirectionDisplay, extractDirectionFromName, parseRouteInfo } from '../../utils/routeDirectionConfig';
import {
    calculateHeadways,
    getRatioColor,
    getRecoveryStatus,
    calculatePeakVehicles,
    calculateServiceSpan,
    analyzeHeadways,
    calculateTripsPerHour,
    getBandRowColor,
    parseTimeInput,
    validateSchedule,
    compareBlockIds
} from '../../utils/scheduleEditorUtils';
import {
    FilterState,
    shouldGrayOutTrip,
    shouldHighlightTrip,
    matchesSearch
} from '../NewSchedule/QuickActionsBar';
import { StackedTimeCell, StackedTimeInput } from '../ui/StackedTimeInput';
import type { ConnectionLibrary } from '../../utils/connectionTypes';
import type { DayType } from '../../utils/masterScheduleParser';
import { getConnectionsForStop } from '../../utils/connectionUtils';
import { ConnectionIndicator } from './ConnectionIndicator';

// --- Spreadsheet-style column letters ---
// Converts 0-indexed column number to Excel-style letter (A, B, C... Z, AA, AB...)
const getColumnLetter = (colIndex: number): string => {
    let result = '';
    let n = colIndex;
    while (n >= 0) {
        result = String.fromCharCode((n % 26) + 65) + result;
        n = Math.floor(n / 26) - 1;
    }
    return result;
};

// Column info for tooltip display
interface ColumnInfo {
    letter: string;
    label: string; // e.g., "Block", "Stop Name ARR", etc.
}

type DensityMode = 'ultra' | 'compact' | 'comfortable';

const STOP_ABBREVIATIONS: Array<[RegExp, string]> = [
    [/barrie south go station/gi, 'B. South GO'],
    [/barrie allandale transit terminal platforms?/gi, 'Allandale Term'],
    [/barrie allandale transit terminal/gi, 'Allandale Term'],
    [/georgian college/gi, 'Georgian Coll'],
    [/park place/gi, 'Park Pl'],
    [/downtown/gi, 'Downtown'],
    [/station/gi, 'Stn'],
    [/terminal/gi, 'Term'],
    [/community centre/gi, 'Comm Ctr'],
    [/community/gi, 'Comm'],
    [/veterans/gi, 'Vets'],
    [/mapleview/gi, 'Mapleview'],
    [/essa at/gi, 'Essa @'],
    [/peggy hill/gi, 'Peggy Hill']
];

const abbreviateStopName = (name: string): string => {
    let out = name;
    for (const [pattern, replacement] of STOP_ABBREVIATIONS) {
        out = out.replace(pattern, replacement);
    }
    return out.replace(/\s+/g, ' ').trim();
};

const isMajorTimepointStop = (stopName: string, index: number, stops: string[]): boolean => {
    if (index === 0 || index === stops.length - 1) return true;
    const n = stopName.toLowerCase();
    return (
        n.includes('terminal') ||
        n.includes('station') ||
        n.includes('downtown') ||
        n.includes('allandale') ||
        n.includes('georgian') ||
        n.includes('park place') ||
        n.includes('college') ||
        n.includes('go')
    );
};

const pickDisplayStops = (stops: string[], timepointOnly: boolean): string[] => {
    if (!timepointOnly || stops.length <= 3) return stops;
    const filtered = stops.filter((s, i) => isMajorTimepointStop(s, i, stops));
    if (filtered.length >= 3) return filtered;
    const midpoint = stops[Math.floor(stops.length / 2)];
    return Array.from(new Set([stops[0], midpoint, stops[stops.length - 1]]));
};

// --- Helper: Fuzzy stop name lookup ---
// Handles "(2)", "(3)" suffixes in loop routes where column headers have suffixes
// but trip data may not
const getStopValue = <T,>(record: Record<string, T> | undefined, stopName: string): T | undefined => {
    if (!record) return undefined;
    // Try exact match first
    if (record[stopName] !== undefined) return record[stopName];
    // Strip "(n)" suffix and try base name
    const baseName = stopName.replace(/\s*\(\d+\)$/, '');
    if (baseName !== stopName && record[baseName] !== undefined) return record[baseName];
    // Try case-insensitive match
    const lowerStop = stopName.toLowerCase();
    const lowerBase = baseName.toLowerCase();
    for (const key of Object.keys(record)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === lowerStop || lowerKey === lowerBase) return record[key];
    }
    return undefined;
};

const getArrivalDisplayTime = (trip: MasterTrip | undefined, stopName: string): string => {
    if (!trip) return '';
    return getStopValue(trip.arrivalTimes, stopName) || getStopValue(trip.stops, stopName) || '';
};

const getDepartureDisplayTime = (
    trip: MasterTrip | undefined,
    stopName: string,
    routeName: string,
    isLastSouthStop: boolean = false
): string => {
    if (!trip) return '';
    const arrival = getArrivalDisplayTime(trip, stopName);
    if (!arrival) return '';

    let recovery = getStopValue(trip.recoveryTimes, stopName) || 0;
    if (recovery === 0 && isLastSouthStop && isInterlineRoute(routeName)) {
        recovery = 10;
    }

    return recovery === 0 ? arrival : TimeUtils.addMinutes(arrival, recovery);
};

const getDeltaMinutes = (currentTime: string, originalTime: string): number | null => {
    const current = TimeUtils.toMinutes(currentTime);
    const original = TimeUtils.toMinutes(originalTime);
    if (current === null || original === null) return null;

    let diff = current - original;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return diff;
};

// --- Georgian College Pattern (moved up for use in getArrivalTimeForStop) ---
const GEORGIAN_COLLEGE_PATTERN = 'georgian college';

/**
 * Check if a stop is Georgian College.
 */
const isGeorgianCollegeStop = (stopName: string): boolean => {
    return stopName.toLowerCase().includes(GEORGIAN_COLLEGE_PATTERN);
};

// Get arrival time for a stop, handling loop routes where final stop uses trip.endTime
const getArrivalTimeForStop = (
    trip: MasterTrip | undefined,
    stopName: string,
    stopIndex: number,
    totalStops: number
): string => {
    if (!trip) return '';

    // Check if this is a "(n)" suffixed stop (loop route second occurrence)
    const hasSuffix = /\s*\(\d+\)$/.test(stopName);
    const isLastStop = stopIndex === totalStops - 1;

    // For loop routes: last stop with suffix uses trip.endTime
    if (hasSuffix && isLastStop) {
        return TimeUtils.fromMinutes(trip.endTime);
    }

    // For Georgian College as the last stop (interline turnaround), only show data
    // if there's explicit arrival time set (from linking process). Don't fall back
    // to trip.endTime as that would show phantom data for unlinked trips.
    if (isLastStop && isGeorgianCollegeStop(stopName)) {
        const normalLookup = getStopValue(trip.arrivalTimes, stopName) || getStopValue(trip.stops, stopName);
        // Only return if explicit data exists - no fallback to endTime
        return normalLookup || '';
    }

    // Normal lookup
    return getStopValue(trip.arrivalTimes, stopName) || getStopValue(trip.stops, stopName) || '';
};

// --- Interline Display Helpers ---
// Routes 8A/8B interline at Allandale Terminal during specific hours.
// During interline hours, DEP shows when the SAME route next departs (not ARR+Recovery).

const INTERLINE_ROUTES = ['8A', '8B'];
const INTERLINE_STOP_PATTERN = 'allandale';
const INTERLINE_START_TIME = 1200; // 8:00 PM in minutes
const INTERLINE_END_TIME = 120; // 2:00 AM in minutes (next day, wrapped format)
const INTERLINE_RECOVERY = 5; // Standard 5-minute recovery at Allandale

/**
 * Check if a trip is within the interline time window.
 * - Sundays: All day (interlining active from start of service)
 * - Weekdays/Saturdays: 8 PM to 2 AM
 *
 * Post-midnight times can be in two formats:
 * - Wrapped: 12:10 AM = 10 minutes, 2:00 AM = 120 minutes
 * - Extended: 12:10 AM = 1450 minutes (24*60 + 10), 2:00 AM = 1560 minutes
 */
const isInInterlineWindow = (tripTime: number, routeName: string): boolean => {
    const isSunday = routeName.toLowerCase().includes('sunday');
    if (isSunday) return true;

    // Weekdays/Saturdays: 8 PM to 2 AM (inclusive)
    // Check for:
    // - >= 1200: 8 PM to midnight (or extended format post-midnight times)
    // - <= 120: midnight to 2 AM (wrapped format, inclusive of 2:00 AM)
    return tripTime >= INTERLINE_START_TIME || tripTime <= INTERLINE_END_TIME;
};

/**
 * Check if this stop is an interline terminal (Allandale).
 */
const isInterlineStop = (stopName: string): boolean => {
    return stopName.toLowerCase().includes(INTERLINE_STOP_PATTERN);
};

/**
 * Check if this route participates in interlining.
 */
const isInterlineRoute = (routeName: string): boolean => {
    return INTERLINE_ROUTES.some(r => routeName.includes(r));
};

const normalizeRouteName = (raw: string): string => {
    return raw
        .replace(/\s*\((North|South)\)/gi, '')
        .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
        .trim();
};

const getTripInterlineDepartureAtStop = (trip: MasterTrip, stopName: string): number | null => {
    const arrStr = getStopValue(trip.stops, stopName) || getStopValue(trip.arrivalTimes, stopName);
    if (!arrStr) return null;
    const arrTime = TimeUtils.toMinutes(arrStr);
    if (arrTime === null) return null;
    const recovery = getStopValue(trip.recoveryTimes, stopName) || 0;
    return arrTime + recovery;
};

/**
 * Check if this route is specifically 8A (for cycle time calculations).
 */
const isRoute8A = (routeName: string): boolean => {
    return routeName.toUpperCase().includes('8A');
};

/**
 * Get recovery time for a stop, with interline override.
 * For 8A/8B at Allandale during interline hours, always returns 5 min.
 */
const getRecoveryForStop = (
    trip: MasterTrip | undefined,
    stopName: string,
    routeName: string
): number | string => {
    if (!trip) return '';

    // For interline routes at Allandale during interline hours, always show 5 min
    if (isInterlineRoute(routeName) && isInterlineStop(stopName)) {
        const arrivalTimeStr = getStopValue(trip.stops, stopName) || getStopValue(trip.arrivalTimes, stopName);
        if (arrivalTimeStr) {
            const arrivalTime = TimeUtils.toMinutes(arrivalTimeStr);
            if (arrivalTime !== null && isInInterlineWindow(arrivalTime, routeName)) {
                return INTERLINE_RECOVERY;
            }
        }
    }

    // Default: use trip's recoveryTimes
    return getStopValue(trip.recoveryTimes, stopName) ?? '';
};

/**
 * Get the interline DEP time for a trip at a terminal stop.
 * Returns the time when the SAME route next departs from this stop.
 * Returns null if not in interline situation or no next departure found.
 *
 * IMPORTANT: Interline only applies to NORTHBOUND legs at Allandale Terminal.
 */
export const getInterlineDepartureTime = (
    currentTrip: MasterTrip,
    stopName: string,
    allTripsOnRoute: MasterTrip[],
    routeName: string,
    interlineTripLookup?: Map<string, MasterTrip>
): number | null => {
    // Only apply to interline routes (8A, 8B)
    if (!isInterlineRoute(routeName)) return null;

    // Only apply to NORTHBOUND trips - southbound operates independently
    if (currentTrip.direction !== 'North') return null;

    // Only apply to interline stops (Allandale)
    if (!isInterlineStop(stopName)) return null;

    // Get arrival time at this stop
    const arrTimeStr = getStopValue(currentTrip.stops, stopName) ||
                       getStopValue(currentTrip.arrivalTimes, stopName);
    if (!arrTimeStr) {
        console.log('[InterlineDEP] Trip', currentTrip.id, 'no arrival time at', stopName);
        return null;
    }

    const arrTime = TimeUtils.toMinutes(arrTimeStr);
    if (arrTime === null) return null;

    // Only apply during interline hours - check ARRIVAL time, not trip start
    // A trip might start before 8pm but arrive at the terminal after 8pm
    if (!isInInterlineWindow(arrTime, routeName)) {
        console.log('[InterlineDEP] Trip', currentTrip.id, 'arrTime', arrTime, 'NOT in interline window for', routeName);
        return null;
    }

    // Prefer explicit interline metadata when available (from GTFS system import).
    if (currentTrip.interlineNext) {
        const linkedRoute = currentTrip.interlineNext.route;
        const linkedTripId = currentTrip.interlineNext.tripId;
        const linkedTrip = interlineTripLookup?.get(`${linkedRoute}|${linkedTripId}`);

        if (linkedTrip) {
            const linkedDep = getTripInterlineDepartureAtStop(linkedTrip, stopName);
            if (linkedDep !== null && linkedDep > arrTime) {
                return linkedDep;
            }
        }
    }

    console.log('[InterlineDEP] Trip', currentTrip.id, 'arrTime', arrTime, TimeUtils.fromMinutes(arrTime), 'IS in window, searching', allTripsOnRoute.length, 'trips');

    // Find the next trip on the SAME route that departs from this stop AFTER arrival
    // (i.e., trips that START at this terminal)
    const candidateTrips = allTripsOnRoute
        .filter(t => {
            // Must be a different trip
            if (t.id === currentTrip.id) return false;

            // Must start after our arrival
            if (t.startTime <= arrTime) {
                return false;
            }

            // Must have this stop as first stop (or have a time at this stop)
            const hasStopTime = getStopValue(t.stops, stopName) ||
                               getStopValue(t.arrivalTimes, stopName);
            if (!hasStopTime) {
                console.log('[InterlineDEP]   Candidate', t.id, 'startTime', t.startTime, 'has NO time at', stopName, 'stops keys:', Object.keys(t.stops || {}));
            }
            return !!hasStopTime;
        })
        .sort((a, b) => a.startTime - b.startTime);

    console.log('[InterlineDEP] Found', candidateTrips.length, 'candidate trips after filtering');

    // Return the actual departure time at this stop for the next trip
    // DEP = arrival time + recovery time at this stop
    if (candidateTrips.length > 0) {
        const nextTrip = candidateTrips[0];
        console.log('[InterlineDEP] Next trip is', nextTrip.id, 'startTime:', nextTrip.startTime, TimeUtils.fromMinutes(nextTrip.startTime));
        // Get the arrival time at this stop
        const nextArrTimeStr = getStopValue(nextTrip.stops, stopName) ||
                           getStopValue(nextTrip.arrivalTimes, stopName);
        if (nextArrTimeStr) {
            const nextArrTime = TimeUtils.toMinutes(nextArrTimeStr);
            if (nextArrTime !== null) {
                // Add recovery time to get departure time
                const recovery = getStopValue(nextTrip.recoveryTimes, stopName) || 0;
                const depTime = nextArrTime + recovery;
                console.log('[InterlineDEP] RETURNING DEP time:', depTime, TimeUtils.fromMinutes(depTime));
                return depTime;
            }
        }
        // Fallback to startTime if no stop time found
        console.log('[InterlineDEP] Fallback to startTime:', nextTrip.startTime);
        return nextTrip.startTime;
    }

    console.log('[InterlineDEP] No candidates found, returning null');
    return null
};

// --- Georgian College Turnaround Merge ---
// Route 8A trips that end at Georgian College and trips that start at Georgian College
// should be merged when arrival + recovery = departure time.
// This applies after 8pm on weekdays/Saturdays, and all day on Sundays.
// Note: GEORGIAN_COLLEGE_PATTERN and isGeorgianCollegeStop are defined earlier in the file.

/**
 * Find the Georgian College stop in a stops array.
 */
const findGeorgianStop = (stops: string[]): string | undefined => {
    return stops.find(s => isGeorgianCollegeStop(s));
};

/**
 * Check if this trip is a partial trip that ENDS at Georgian College.
 * (Has data at Georgian College as last stop with data, no data after)
 */
const isPartialTripEndingAtGeorgian = (
    trip: MasterTrip,
    stops: string[]
): { stopName: string; arrivalTime: number; recoveryTime: number } | null => {
    const georgianStop = findGeorgianStop(stops);
    if (!georgianStop) return null;

    // Find Georgian stop index
    const georgianIndex = stops.indexOf(georgianStop);

    // Check if this is the LAST stop with data (partial trip ending here)
    const stopsAfter = stops.slice(georgianIndex + 1);
    const hasDataAfter = stopsAfter.some(s =>
        getStopValue(trip.stops, s) || getStopValue(trip.arrivalTimes, s)
    );

    // Must have NO data after Georgian College
    if (hasDataAfter) return null;

    // Must have SOME data before Georgian College (otherwise it's just a single-stop trip)
    const stopsBefore = stops.slice(0, georgianIndex);
    const hasDataBefore = stopsBefore.some(s =>
        getStopValue(trip.stops, s) || getStopValue(trip.arrivalTimes, s)
    );

    if (!hasDataBefore) return null;

    // Get time at Georgian College - try stops/arrivalTimes first.
    // Only fall back to trip.endTime if the trip actually includes Georgian College.
    // This handles Sunday schedules where Georgian College may only have departure time
    const timeStr = getStopValue(trip.stops, georgianStop) ||
                    getStopValue(trip.arrivalTimes, georgianStop);
    let arrivalTime: number | null = null;

    if (timeStr) {
        arrivalTime = TimeUtils.toMinutes(timeStr);
    } else {
        const hasGeorgianKey =
            Object.keys(trip.stops || {}).some(k => isGeorgianCollegeStop(k)) ||
            Object.keys(trip.arrivalTimes || {}).some(k => isGeorgianCollegeStop(k));
        if (!hasGeorgianKey) return null;
        if (trip.endTime !== undefined && trip.endTime !== null) {
            // Use trip.endTime as the arrival time at Georgian College
            arrivalTime = trip.endTime;
        }
    }

    if (arrivalTime === null) return null;

    // Get recovery time at Georgian College (default to 0 if not set)
    // Prefer per-stop recovery; fall back to total recovery if per-stop data is missing.
    const recoveryTime = getStopValue(trip.recoveryTimes, georgianStop) ?? (trip.recoveryTime || 0);

    return { stopName: georgianStop, arrivalTime, recoveryTime };
};

/**
 * Check if this trip is a partial trip that STARTS at Georgian College.
 * (Has data at Georgian College as first stop with data, no data before)
 */
const isPartialTripStartingAtGeorgian = (
    trip: MasterTrip,
    stops: string[]
): { stopName: string; departureTime: number } | null => {
    const georgianStop = findGeorgianStop(stops);
    if (!georgianStop) return null;

    // Find Georgian stop index
    const georgianIndex = stops.indexOf(georgianStop);

    // Check if this is the FIRST stop with data (partial trip starting here)
    const stopsBefore = stops.slice(0, georgianIndex);
    const hasDataBefore = stopsBefore.some(s =>
        getStopValue(trip.stops, s) || getStopValue(trip.arrivalTimes, s)
    );

    // Must have NO data before Georgian College
    if (hasDataBefore) return null;

    // Must have SOME data after Georgian College (otherwise it's just a single-stop trip)
    const stopsAfter = stops.slice(georgianIndex + 1);
    const hasDataAfter = stopsAfter.some(s =>
        getStopValue(trip.stops, s) || getStopValue(trip.arrivalTimes, s)
    );

    if (!hasDataAfter) return null;

    // Get time at Georgian College - try stops/arrivalTimes first.
    // Only fall back to trip.startTime if the trip actually includes Georgian College.
    // This handles Sunday schedules where Georgian College may only have the time in startTime
    const timeStr = getStopValue(trip.stops, georgianStop) ||
                    getStopValue(trip.arrivalTimes, georgianStop);
    let departureTime: number | null = null;

    if (timeStr) {
        departureTime = TimeUtils.toMinutes(timeStr);
    } else {
        const hasGeorgianKey =
            Object.keys(trip.stops || {}).some(k => isGeorgianCollegeStop(k)) ||
            Object.keys(trip.arrivalTimes || {}).some(k => isGeorgianCollegeStop(k));
        if (!hasGeorgianKey) return null;
        if (trip.startTime !== undefined && trip.startTime !== null) {
            // Use trip.startTime as the departure time from Georgian College
            departureTime = trip.startTime;
        }
    }

    if (departureTime === null) return null;

    return { stopName: georgianStop, departureTime };
};

/**
 * Find available South trips departing Georgian College within a time window.
 * Used for manual link picker.
 */
const findAvailableSouthTripsForLinking = (
    southTrips: MasterTrip[],
    southStops: string[],
    northArrivalTime: number,
    maxWindowMinutes: number = 15
): Array<{ tripId: string; departureTime: number; displayTime: string }> => {
    const available: Array<{ tripId: string; departureTime: number; displayTime: string }> = [];

    for (const trip of southTrips) {
        const depInfo = isPartialTripStartingAtGeorgian(trip, southStops);
        if (!depInfo) continue;

        // Check if departure is within window of North arrival
        const diff = depInfo.departureTime - northArrivalTime;
        if (diff >= 0 && diff <= maxWindowMinutes) {
            available.push({
                tripId: trip.id,
                departureTime: depInfo.departureTime,
                displayTime: TimeUtils.fromMinutes(depInfo.departureTime)
            });
        }
    }

    // Sort by departure time
    available.sort((a, b) => a.departureTime - b.departureTime);

    return available;
};

/**
 * Merge two partial trips at Georgian College into one complete trip.
 *
 * CRITICAL: For Georgian College stop, we must preserve:
 * - ARRIVAL time from arriving trip (stored in arrivalTimes)
 * - RECOVERY time from arriving trip (stored in recoveryTimes)
 * - DEPARTURE time from departing trip (calculated as arrival + recovery in display)
 *
 * Both trips have "Georgian College" as a stop key, so we need to handle
 * the merge carefully to avoid overwriting the arrival time.
 */
const mergeGeorgianTrips = (
    arrivingTrip: MasterTrip,
    departingTrip: MasterTrip
): MasterTrip => {
    // Start with arriving trip's data for Georgian College stop
    const mergedStops: Record<string, string> = {};
    const mergedArrivalTimes: Record<string, string> = {};
    const mergedRecoveryTimes: Record<string, number> = {};

    // Add all stops from arriving trip
    for (const [stop, time] of Object.entries(arrivingTrip.stops || {})) {
        if (isGeorgianCollegeStop(stop)) {
            // For Georgian College, store arrival time in arrivalTimes (display uses this first)
            mergedArrivalTimes[stop] = time;
            // Also keep it in stops as a fallback
            mergedStops[stop] = time;
        } else {
            mergedStops[stop] = time;
        }
    }

    // Add arrivalTimes from arriving trip
    for (const [stop, time] of Object.entries(arrivingTrip.arrivalTimes || {})) {
        mergedArrivalTimes[stop] = time;
    }

    // Add recovery times from arriving trip (IMPORTANT: preserve Georgian College recovery)
    for (const [stop, rec] of Object.entries(arrivingTrip.recoveryTimes || {})) {
        mergedRecoveryTimes[stop] = rec;
    }

    // Add stops from departing trip (EXCEPT Georgian College - don't overwrite arrival)
    for (const [stop, time] of Object.entries(departingTrip.stops || {})) {
        if (!isGeorgianCollegeStop(stop)) {
            mergedStops[stop] = time;
        }
        // Note: We don't overwrite Georgian College in mergedStops because
        // we want to preserve the arrival time. The DEP is calculated as
        // arrival + recovery in the display, which gives us the correct
        // departure time (e.g., 8:08 + 2 = 8:10 PM)
    }

    // Add arrivalTimes from departing trip (except Georgian College)
    for (const [stop, time] of Object.entries(departingTrip.arrivalTimes || {})) {
        if (!isGeorgianCollegeStop(stop)) {
            mergedArrivalTimes[stop] = time;
        }
    }

    // Add recovery times from departing trip (except Georgian College - keep arriving trip's recovery)
    for (const [stop, rec] of Object.entries(departingTrip.recoveryTimes || {})) {
        if (!isGeorgianCollegeStop(stop)) {
            mergedRecoveryTimes[stop] = rec;
        }
    }

    return {
        ...arrivingTrip, // Keep most properties from arriving trip
        id: `${arrivingTrip.id}_merged_${departingTrip.id}`,
        endTime: departingTrip.endTime,
        travelTime: arrivingTrip.travelTime + departingTrip.travelTime,
        cycleTime: (arrivingTrip.cycleTime || 0) + (departingTrip.cycleTime || 0),
        recoveryTime: (arrivingTrip.recoveryTime || 0) + (departingTrip.recoveryTime || 0),
        stops: mergedStops,
        arrivalTimes: mergedArrivalTimes,
        recoveryTimes: mergedRecoveryTimes,
        // Mark as merged for debugging
        _mergedFrom: [arrivingTrip.id, departingTrip.id]
    } as MasterTrip;
};

/**
 * Link partial trips at Georgian College turnaround ACROSS North and South tables.
 * North trips ending at Georgian + South trips starting at Georgian
 * are linked by giving them the same block ID when arrival + recovery = departure time.
 *
 * This approach keeps both trips separate (for proper North/South display) but
 * links them so they appear in the same row.
 *
 * Only applies during interline hours (after 8pm weekdays/Sat, all day Sunday).
 *
 * @returns Modified North and South trip arrays with linked block IDs, and updated stops arrays
 */
export const mergeGeorgianTurnaroundTripsAcrossTables = (
    northTrips: MasterTrip[],
    northStops: string[],
    southTrips: MasterTrip[],
    southStops: string[],
    routeName: string
): { mergedNorthTrips: MasterTrip[]; mergedSouthTrips: MasterTrip[]; mergedNorthStops: string[]; mergedSouthStops: string[] } => {
    // Georgian College turnaround linking applies to Routes 8A and 8B
    // Both routes have North trips that END at Georgian College, South trips START there
    if (!isInterlineRoute(routeName)) {
        return { mergedNorthTrips: northTrips, mergedSouthTrips: southTrips, mergedNorthStops: northStops, mergedSouthStops: southStops };
    }

    // Find Georgian College stop in both tables
    const georgianStopNorth = findGeorgianStop(northStops);
    const georgianStopSouth = findGeorgianStop(southStops);

    // If Georgian College is missing from North but present in South, we can still link
    // by matching North trip endTime with South trip startTime at Georgian College
    if (!georgianStopSouth) {
        return { mergedNorthTrips: northTrips, mergedSouthTrips: southTrips, mergedNorthStops: northStops, mergedSouthStops: southStops };
    }

    // If Georgian College isn't in North stops, we'll use trip.endTime for matching
    const useEndTimeForNorth = !georgianStopNorth;

    // Find partial trips ending at Georgian in North table
    const endingTrips: Array<{ trip: MasterTrip; info: { stopName: string; arrivalTime: number; recoveryTime: number } }> = [];
    const normalNorthTrips: MasterTrip[] = [];

    for (const trip of northTrips) {
        if (useEndTimeForNorth) {
            // Georgian College not in North stops - use trip.endTime as arrival time
            // All North trips end at Georgian College for 8A, so treat them all as "ending" trips
            if (trip.endTime !== undefined && trip.endTime !== null) {
                const info = {
                    stopName: georgianStopSouth, // Use the South stop name
                    arrivalTime: trip.endTime,
                    recoveryTime: 0 // No recovery data available when stop is missing
                };
                endingTrips.push({ trip, info });
            } else {
                normalNorthTrips.push(trip);
            }
        } else {
            // Normal case: Georgian College is in North stops
            const arrInfo = isPartialTripEndingAtGeorgian(trip, northStops);
            if (arrInfo) {
                endingTrips.push({ trip, info: arrInfo });
            } else {
                normalNorthTrips.push(trip);
            }
        }
    }

    // Find partial trips starting at Georgian in South table
    const startingTrips: Array<{ trip: MasterTrip; info: NonNullable<ReturnType<typeof isPartialTripStartingAtGeorgian>> }> = [];
    const normalSouthTrips: MasterTrip[] = [];

    for (const trip of southTrips) {
        const depInfo = isPartialTripStartingAtGeorgian(trip, southStops);
        if (depInfo) {
            startingTrips.push({ trip, info: depInfo });
        } else {
            normalSouthTrips.push(trip);
        }
    }

    // Create mutable copies for linking
    const linkedNorthTrips: MasterTrip[] = [...normalNorthTrips];
    const linkedSouthTrips: MasterTrip[] = [...normalSouthTrips];
    const usedStartingTrips = new Set<string>();

    // Debug: Log what trips we're trying to link
    console.log('[GeorgianLink] Route:', routeName);
    console.log('[GeorgianLink] Ending trips (North arriving at Georgian):', endingTrips.length);
    console.log('[GeorgianLink] Starting trips (South departing Georgian):', startingTrips.length);
    endingTrips.forEach(({ trip, info }) => {
        console.log(`[GeorgianLink]   North ${trip.id} arrives ${info.arrivalTime} (${TimeUtils.fromMinutes(info.arrivalTime)}) gtfsBlockId=${trip.gtfsBlockId || 'NONE'}`);
    });
    startingTrips.forEach(({ trip, info }) => {
        console.log(`[GeorgianLink]   South ${trip.id} departs ${info.departureTime} (${TimeUtils.fromMinutes(info.departureTime)}) gtfsBlockId=${trip.gtfsBlockId || 'NONE'}`);
    });

    // Sort chronologically to keep pairings stable and intuitive.
    endingTrips.sort((a, b) => a.info.arrivalTime - b.info.arrivalTime);
    startingTrips.sort((a, b) => a.info.departureTime - b.info.departureTime);

    // Match ending trips with starting trips and link by block ID
    for (const { trip: endTrip, info: endInfo } of endingTrips) {
        const inInterlineWindow = isInInterlineWindow(endInfo.arrivalTime, routeName);

        console.log(`[GeorgianLink] Attempting to link North ${endTrip.id} (arr=${endInfo.arrivalTime}, gtfsBlockId=${endTrip.gtfsBlockId || 'NONE'})`);

        // PRIORITY 1: Match by GTFS block ID (same physical bus) + time proximity
        // Block ID alone isn't enough since one bus runs many trips per day
        // South trip must depart 0-15 min after North trip arrives
        let bestMatch: { trip: MasterTrip; info: { stopName: string; departureTime: number }; diff: number } | null = null;
        const blockTimeWindow = 15; // Max minutes between arrival and departure for same-block match

        if (inInterlineWindow && endTrip.gtfsBlockId) {
            for (const { trip: startTrip, info: startInfo } of startingTrips) {
                if (usedStartingTrips.has(startTrip.id)) continue;
                if (startTrip.gtfsBlockId === endTrip.gtfsBlockId) {
                    // Same GTFS block - check if departure is shortly after arrival
                    const diff = startInfo.departureTime - endInfo.arrivalTime;
                    // Must depart 0-15 min after arrival (reasonable turnaround)
                    if (diff >= 0 && diff <= blockTimeWindow) {
                        if (!bestMatch || diff < bestMatch.diff) {
                            bestMatch = { trip: startTrip, info: startInfo, diff };
                        }
                    }
                }
            }
        }

        // PRIORITY 2: Fall back to time-based matching if no block ID match
        if (!bestMatch) {
            // Expected departure time = arrival + recovery
            const expectedDep = endInfo.arrivalTime + endInfo.recoveryTime;
            // When using endTime (no recovery data), use larger tolerance since we don't know exact turnaround
            const tolerance = useEndTimeForNorth ? 10 : 2; // 10 min tolerance when no recovery data

            // Find matching starting trip - prefer closest match within tolerance
            for (const { trip: startTrip, info: startInfo } of startingTrips) {
                if (usedStartingTrips.has(startTrip.id)) continue;
                // When using endTime, look for South trips that depart AT or AFTER the North trip ends
                const diff = useEndTimeForNorth
                    ? startInfo.departureTime - expectedDep // South should depart after North ends
                    : Math.abs(startInfo.departureTime - expectedDep);

                // For endTime matching: South must depart 0-10 min after North ends
                // For normal matching: within tolerance in either direction
                const isValidMatch = useEndTimeForNorth
                    ? (diff >= 0 && diff <= tolerance)
                    : (Math.abs(diff) <= tolerance);

                if (isValidMatch && (!bestMatch || Math.abs(diff) < Math.abs(bestMatch.diff))) {
                    bestMatch = { trip: startTrip, info: startInfo, diff };
                }
            }
        }

        // PRIORITY 3: Final fallback - simple turnaround window match (arrival -> departure)
        if (!bestMatch) {
            const turnaroundWindow = 15; // minutes after arrival
            for (const { trip: startTrip, info: startInfo } of startingTrips) {
                if (usedStartingTrips.has(startTrip.id)) continue;
                const diff = startInfo.departureTime - endInfo.arrivalTime;
                if (diff >= 0 && diff <= turnaroundWindow) {
                    if (!bestMatch || diff < bestMatch.diff) {
                        bestMatch = { trip: startTrip, info: startInfo, diff };
                    }
                }
            }
        }
        const match = bestMatch;

        // Outside interline hours, only link if we found a tight time-based match
        if (!match && !inInterlineWindow) {
            console.log(`[GeorgianLink] North ${endTrip.id} NOT linked (outside interline window, no tight match)`);
            linkedNorthTrips.push(endTrip);
            continue;
        }

        if (match) {
            console.log(`[GeorgianLink] ✓ LINKED North ${endTrip.id} with South ${match.trip.id} (diff=${match.diff} min)`);
            // Link the trips by giving the South trip the same block ID as the North trip
            usedStartingTrips.add(match.trip.id);

            // Calculate recovery time = South departure - North arrival
            const recoveryTime = match.info.departureTime - endInfo.arrivalTime;

            // Create/update North trip with Georgian College arrival data
            const georgianStopName = georgianStopSouth; // Use the South stop name for consistency
            const linkedNorthTrip: MasterTrip = {
                ...endTrip,
                // Add Georgian College arrival time
                arrivalTimes: {
                    ...(endTrip.arrivalTimes || {}),
                    [georgianStopName]: TimeUtils.fromMinutes(endInfo.arrivalTime)
                },
                // Add Georgian College recovery time
                recoveryTimes: {
                    ...(endTrip.recoveryTimes || {}),
                    [georgianStopName]: recoveryTime > 0 ? recoveryTime : 0
                },
                // Store departure time for display (used by DEP column calculation)
                stops: {
                    ...(endTrip.stops || {}),
                    [georgianStopName]: TimeUtils.fromMinutes(endInfo.arrivalTime)
                }
            };
            linkedNorthTrips.push(linkedNorthTrip);

            // Update the South trip's block ID to match the North trip
            const linkedSouthTrip: MasterTrip = {
                ...match.trip,
                blockId: endTrip.blockId, // Use North trip's block ID
                _linkedFrom: endTrip.id // Mark for debugging
            } as MasterTrip;
            linkedSouthTrips.push(linkedSouthTrip);
        } else {
            // No match found - keep as partial
            console.log(`[GeorgianLink] ✗ NO MATCH for North ${endTrip.id} - keeping as unlinked`);
            linkedNorthTrips.push(endTrip);
        }
    }

    // Add any unmatched starting trips to South table
    const unmatchedStartingTrips: string[] = [];
    for (const { trip } of startingTrips) {
        if (!usedStartingTrips.has(trip.id)) {
            unmatchedStartingTrips.push(trip.id);
            linkedSouthTrips.push(trip);
        }
    }
    if (unmatchedStartingTrips.length > 0) {
        console.log(`[GeorgianLink] ⚠ PHANTOM TRIPS - ${unmatchedStartingTrips.length} unmatched South trips:`, unmatchedStartingTrips);
    }

    // If Georgian College was missing from North stops, add it at the end
    let mergedNorthStops = northStops;
    if (useEndTimeForNorth && georgianStopSouth) {
        mergedNorthStops = [...northStops, georgianStopSouth];
    }

    return { mergedNorthTrips: linkedNorthTrips, mergedSouthTrips: linkedSouthTrips, mergedNorthStops, mergedSouthStops: southStops };
};

/**
 * Link interline trips at Allandale Terminal by time sequence.
 *
 * During interline (8pm+ weekdays/Sat, all day Sunday), 8A/8B share vehicles.
 * When an 8A bus arrives at Allandale, it departs as 8B (and vice versa).
 * A different 8A bus (coming from 8B) departs ~35 min later.
 *
 * This function:
 * 1. Creates partial trips for those passing through Allandale during interline hours
 *    (only keeps Start → Allandale portion, discards Allandale → End which is served by the other route)
 * 2. Pairs these partial trips with the NEXT 8A departure from Allandale by time sequence
 * 3. Stores the departure time as metadata (_interlineDepartureTime) for display
 *
 * Display result: One row shows ARR 8:07 | R 5 | DEP 8:42 at Allandale
 * The 35-min gap implicitly shows the interline occurred (the bus became 8B in between).
 *
 * @param trips - The trips to process
 * @param stops - The stop names for this direction
 * @param routeName - The route name (includes day type for interline window check)
 * @returns Array of trips with interline linking applied
 */
export const linkInterlineTripsAtAllandale = (
    trips: MasterTrip[],
    stops: string[],
    routeName: string
): MasterTrip[] => {
    // Only apply to interline routes (8A, 8B)
    if (!isInterlineRoute(routeName)) {
        return trips;
    }

    // Find Allandale stop
    const allandaleStopIdx = stops.findIndex(s => isInterlineStop(s));
    if (allandaleStopIdx === -1) {
        return trips; // No Allandale stop found
    }
    const allandaleStop = stops[allandaleStopIdx];

    // Check if there are stops before Allandale (trips must arrive from somewhere)
    const hasStopsBefore = allandaleStopIdx > 0;
    if (!hasStopsBefore) {
        return trips; // Allandale is at start, no arriving trips to process
    }

    // Note: hasStopsAfter check removed - Sunday schedules may not have Georgian College
    // in the North stops array, but we still need to process interline departures
    const hasStopsAfter = allandaleStopIdx < stops.length - 1;

    const stopsBeforeAllandale = stops.slice(0, allandaleStopIdx);
    const stopsAfterAllandale = hasStopsAfter ? stops.slice(allandaleStopIdx + 1) : [];

    // Step 1: Identify full trips passing through Allandale during interline hours
    // Extract BOTH arrival AND departure times from each trip
    interface InterlineTrip {
        trip: MasterTrip;
        arrivalTime: number;
        departureTime: number;  // arrival + recovery
        recovery: number;
    }

    const interlineTrips: InterlineTrip[] = [];
    const normalTrips: MasterTrip[] = [];

    for (const trip of trips) {
        // Only process NORTHBOUND trips
        if (trip.direction !== 'North') {
            normalTrips.push(trip);
            continue;
        }

        // Get time at Allandale
        const allandaleTimeStr = getStopValue(trip.stops, allandaleStop) ||
                                  getStopValue(trip.arrivalTimes, allandaleStop);
        const allandaleTime = allandaleTimeStr ? TimeUtils.toMinutes(allandaleTimeStr) : null;

        if (allandaleTime === null) {
            normalTrips.push(trip);
            continue;
        }

        // Check if in interline window
        if (!isInInterlineWindow(allandaleTime, routeName)) {
            normalTrips.push(trip);
            continue;
        }

        // Check if trip passes THROUGH Allandale (has data before AND after)
        const hasDataBefore = stopsBeforeAllandale.some(s =>
            getStopValue(trip.stops, s) || getStopValue(trip.arrivalTimes, s)
        );
        const hasDataAfter = stopsAfterAllandale.some(s =>
            getStopValue(trip.stops, s) || getStopValue(trip.arrivalTimes, s)
        );

        if (hasDataBefore && hasDataAfter) {
            // Full trip passing through Allandale - extract both arrival and departure
            const recovery = getStopValue(trip.recoveryTimes, allandaleStop) ?? 5;
            const departureTime = allandaleTime + recovery;
            interlineTrips.push({ trip, arrivalTime: allandaleTime, departureTime, recovery });
        } else if (hasDataBefore && !hasDataAfter) {
            // Trip ENDS at Allandale - already partial, treat as interline trip
            const recovery = getStopValue(trip.recoveryTimes, allandaleStop) ?? 5;
            const departureTime = allandaleTime + recovery;
            interlineTrips.push({ trip, arrivalTime: allandaleTime, departureTime, recovery });
        } else if (!hasDataBefore && hasDataAfter) {
            // Trip STARTS at Allandale - this is a "departure only" trip
            // Don't add as separate row - its departure time is used for pairing only
            const recovery = getStopValue(trip.recoveryTimes, allandaleStop) ?? 0;
            const departureTime = allandaleTime + recovery;
            // Add to interlineTrips but mark as departure-only (no arrival to display)
            interlineTrips.push({ trip, arrivalTime: -1, departureTime, recovery }); // -1 signals no arrival
            console.log('[InterlineLink] Departure-only trip', trip.id, 'DEP', TimeUtils.fromMinutes(departureTime));
        } else {
            // Single stop or other edge case - keep as normal
            normalTrips.push(trip);
        }
    }

    // Sort by arrival time
    interlineTrips.sort((a, b) => a.arrivalTime - b.arrivalTime);

    // Build list of ALL departure times from these trips (with reference to full trip for merging)
    const allDepartures = interlineTrips
        .map(t => ({ tripId: t.trip.id, departureTime: t.departureTime, trip: t.trip }))
        .sort((a, b) => a.departureTime - b.departureTime);

    console.log('[InterlineLink] Route:', routeName);
    console.log('[InterlineLink] Interline trips:', interlineTrips.length);
    console.log('[InterlineLink] Departures:', allDepartures.map(d => TimeUtils.fromMinutes(d.departureTime)));

    // Step 2: Create partial trips and pair by time sequence
    // For each arrival, find the NEXT departure that:
    // 1. Is AFTER the arrival time
    // 2. Is NOT from the same trip (skip same trip's immediate departure)
    // 3. MERGE the departure trip's stop data into the arriving trip
    const result: MasterTrip[] = [...normalTrips];
    const usedDepartureTrips = new Set<string>();

    for (const { trip, arrivalTime, recovery } of interlineTrips) {
        // Skip departure-only trips (arrivalTime === -1) - they don't get their own row
        // Their stop data gets merged into arriving trips
        if (arrivalTime === -1) {
            continue;
        }

        // Find the next departure AFTER this arrival, but NOT from the same trip
        // Prefer departure-only trips (arrivalTime === -1) since those have the continuing segment data
        const nextDeparture = allDepartures.find(d =>
            d.departureTime > arrivalTime && d.tripId !== trip.id && !usedDepartureTrips.has(d.tripId)
        );
        const interlineDepartureTime = nextDeparture?.departureTime ?? null;
        const departureTrip = nextDeparture?.trip ?? null;

        if (departureTrip) {
            usedDepartureTrips.add(departureTrip.id);
        }

        console.log('[InterlineLink] Trip', trip.id, 'ARR', TimeUtils.fromMinutes(arrivalTime),
            '→ DEP', interlineDepartureTime ? TimeUtils.fromMinutes(interlineDepartureTime) : 'NONE',
            '(skipped own departure at', TimeUtils.fromMinutes(arrivalTime + recovery) + ')',
            departureTrip ? `MERGING stops from ${departureTrip.id}` : '');

        // Merge stop data from the departure trip into the arriving trip
        // This gives us the complete route: Start → Allandale → Georgian College
        let mergedStops = { ...(trip.stops || {}) };
        let mergedArrivalTimes = { ...(trip.arrivalTimes || {}) };
        let mergedRecoveryTimes = { ...(trip.recoveryTimes || {}) };

        if (departureTrip) {
            // Add stops from the departure trip (Allandale onwards)
            // These are the stops AFTER Allandale (Downtown Hub, Blake at Johnson, Georgian College)
            for (const [stopName, time] of Object.entries(departureTrip.stops || {})) {
                // Don't overwrite Allandale stop (keep arriving trip's data)
                if (!isInterlineStop(stopName)) {
                    mergedStops[stopName] = time;
                }
            }
            for (const [stopName, time] of Object.entries(departureTrip.arrivalTimes || {})) {
                if (!isInterlineStop(stopName)) {
                    mergedArrivalTimes[stopName] = time;
                }
            }
            for (const [stopName, rec] of Object.entries(departureTrip.recoveryTimes || {})) {
                if (!isInterlineStop(stopName)) {
                    mergedRecoveryTimes[stopName] = rec;
                }
            }
        }

        // Create linked trip with merged data and interline metadata
        // Include departure trip's travelTime and recoveryTime for accurate totals
        const linkedTrip: MasterTrip = {
            ...trip,
            stops: mergedStops,
            arrivalTimes: mergedArrivalTimes,
            recoveryTimes: mergedRecoveryTimes,
            endTime: departureTrip?.endTime ?? trip.endTime,
            travelTime: trip.travelTime + (departureTrip?.travelTime || 0),
            recoveryTime: trip.recoveryTime + (departureTrip?.recoveryTime || 0),
            _interlinePartial: true,
            _interlineDepartureTime: interlineDepartureTime,
            _interlineStop: allandaleStop,
            _mergedFromDepartureTrip: departureTrip?.id
        } as MasterTrip;

        result.push(linkedTrip);
    }

    return result;
};

// --- Types ---

export interface RoundTripTableViewProps {
    schedules: MasterRouteTable[];
    interlineScopeSchedules?: MasterRouteTable[];
    onCellEdit?: (tripId: string, col: string, val: string) => void;
    onTimeAdjust?: (tripId: string, stopName: string, delta: number) => void;
    onRecoveryEdit?: (tripId: string, stopName: string, delta: number) => void;
    originalSchedules?: MasterRouteTable[];
    onDeleteTrip?: (tripId: string) => void;
    onDuplicateTrip?: (tripId: string) => void;
    onAddTrip?: (blockId: string, afterTripId: string) => void;
    onTripRightClick?: (
        e: React.MouseEvent,
        tripId: string,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[],
        stopName?: string,
        stopIndex?: number
    ) => void;
    onMenuOpen?: (tripId: string, x: number, y: number, direction: 'North' | 'South', blockId: string, stops: string[]) => void;
    /** Callback when user manually links a North trip to a South trip at Georgian College */
    onLinkTrips?: (northTripId: string, southTripId: string, stopName: string) => void;
    draftName?: string;
    filter?: FilterState;
    targetCycleTime?: number;
    targetHeadway?: number;
    readOnly?: boolean;
    connectionLibrary?: ConnectionLibrary | null;
    dayType?: DayType;
}

/** State for the Georgian College link picker popup */
interface LinkPickerState {
    northTripId: string;
    northArrivalTime: number;
    stopName: string;
    x: number;
    y: number;
    availableSouthTrips: Array<{ tripId: string; departureTime: number; displayTime: string }>;
}

// --- Component ---

type RoundTripPair = {
    north: MasterRouteTable;
    south: MasterRouteTable;
    combined: RoundTripTable;
    northTripOrder: Map<string, number>;
    southTripOrder: Map<string, number>;
};

export const RoundTripTableView: React.FC<RoundTripTableViewProps> = ({
    schedules,
    interlineScopeSchedules,
    onCellEdit,
    onTimeAdjust,
    onRecoveryEdit,
    originalSchedules,
    onDeleteTrip,
    onDuplicateTrip,
    onAddTrip,
    onTripRightClick,
    onMenuOpen,
    onLinkTrips,
    draftName,
    filter,
    targetCycleTime,
    targetHeadway,
    readOnly = false,
    connectionLibrary,
    dayType = 'Weekday'
}) => {
    // Sort state: 'blockFlow' (default), 'blockId', 'endTime', 'startTime', or a stop name
    const [sortColumn, setSortColumn] = useState<string>('blockFlow');
    const [focusMode, setFocusMode] = useState(true);
    const [showDirectionLegend, setShowDirectionLegend] = useState(false);
    const [density, setDensity] = useState<DensityMode>('compact');
    const [timepointOnly, setTimepointOnly] = useState(false);
    const [showMetaCols, setShowMetaCols] = useState(true);
    const [showActionsCol, setShowActionsCol] = useState(false);
    const [showRowNumberCol, setShowRowNumberCol] = useState(false);
    // State for Georgian College link picker popup
    const [linkPicker, setLinkPicker] = useState<LinkPickerState | null>(null);

    const originalTripLookup = useMemo(() => {
        const lookup = new Map<string, MasterTrip>();
        (originalSchedules || []).forEach(table => {
            table.trips.forEach(trip => {
                lookup.set(`${table.routeName}::${trip.id}`, trip);
            });
        });
        return lookup;
    }, [originalSchedules]);

    const getOriginalTrip = (routeName: string, tripId: string): MasterTrip | undefined =>
        originalTripLookup.get(`${routeName}::${tripId}`);

    const interlineTripLookup = useMemo(() => {
        const lookup = new Map<string, MasterTrip>();
        const scope = interlineScopeSchedules || schedules;
        scope.forEach(table => {
            const route = normalizeRouteName(table.routeName);
            table.trips.forEach(trip => {
                lookup.set(`${route}|${trip.id}`, trip);
            });
        });
        return lookup;
    }, [interlineScopeSchedules, schedules]);

    const roundTripData = useMemo(() => {
        const pairs: RoundTripPair[] = [];
        const routeGroups: Record<string, { north?: MasterRouteTable; south?: MasterRouteTable }> = {};

        schedules.forEach(table => {
            // Strip direction suffixes to get the route variant
            const routeVariant = table.routeName.replace(/ \(North\).*$/, '').replace(/ \(South\).*$/, '').trim();

            // Use parseRouteInfo to determine if this is a direction variant (like 2A/2B)
            // For routes where A=North, B=South, we group them under the base route number
            const parsed = parseRouteInfo(routeVariant);
            const baseName = parsed.suffixIsDirection ? parsed.baseRoute : routeVariant;

            if (!routeGroups[baseName]) routeGroups[baseName] = {};

            // Determine direction: either from explicit (North)/(South) suffix or from A/B variant
            let tableDirection = extractDirectionFromName(table.routeName);
            if (!tableDirection && parsed.suffixIsDirection) {
                // A/B suffix IS the direction (e.g., 2A=North, 2B=South)
                tableDirection = parsed.direction;
            }

            if (tableDirection === 'North') routeGroups[baseName].north = table;
            else if (tableDirection === 'South') routeGroups[baseName].south = table;
            else if (!routeGroups[baseName].north) routeGroups[baseName].north = table;
            else routeGroups[baseName].south = table;
        });

        Object.entries(routeGroups).forEach(([baseName, group]) => {
            if (!group.north && !group.south) return;

            // Normalize to always have both tables so formatting stays consistent across
            // directional and loop/single-sided routes.
            const northTable: MasterRouteTable = group.north || {
                routeName: `${baseName} (North)`,
                stops: [],
                stopIds: {},
                trips: []
            };
            const southTable: MasterRouteTable = group.south || {
                routeName: `${baseName} (South)`,
                stops: [],
                stopIds: {},
                trips: []
            };

            const hasBothDirections = northTable.trips.length > 0 && southTable.trips.length > 0;

            if (hasBothDirections) {
                console.log('[RoundTripData] Processing group:', baseName, 'north route:', northTable.routeName, 'trips:', northTable.trips.length);

                // Step 1: Link interline trips at Allandale Terminal during interline hours
                // For 8A/8B trips passing through Allandale, creates partial trips (Start → Allandale)
                // and pairs them with the next departure by time sequence
                // Stores _interlineDepartureTime metadata for DEP column display
                const interlineLinkedTrips = linkInterlineTripsAtAllandale(
                    northTable.trips,
                    northTable.stops,
                    northTable.routeName
                );
                console.log('[RoundTripData] After interline link:', interlineLinkedTrips.length, 'trips (was', northTable.trips.length, ')');

                // Step 2: Apply Georgian College turnaround merge for routes 8A/8B
                // This merges North trips ending at Georgian with South trips starting there
                const { mergedNorthTrips, mergedSouthTrips, mergedNorthStops, mergedSouthStops } = mergeGeorgianTurnaroundTripsAcrossTables(
                    interlineLinkedTrips,  // Use the interline-linked trips
                    northTable.stops,
                    southTable.trips,
                    southTable.stops,
                    northTable.routeName
                );

                // Create modified tables with merged trips AND stops (Georgian College may have been added)
                const mergedNorth: MasterRouteTable = { ...northTable, trips: mergedNorthTrips, stops: mergedNorthStops };
                const mergedSouth: MasterRouteTable = { ...southTable, trips: mergedSouthTrips, stops: mergedSouthStops };

                const combined = buildRoundTripView(mergedNorth, mergedSouth);
                const northTripOrder = new Map<string, number>();
                mergedNorth.trips.forEach((trip, idx) => {
                    northTripOrder.set(trip.id, idx + 1);
                });
                const southTripOrder = new Map<string, number>();
                mergedSouth.trips.forEach((trip, idx) => {
                    southTripOrder.set(trip.id, idx + 1);
                });
                pairs.push({ north: mergedNorth, south: mergedSouth, combined, northTripOrder, southTripOrder });
            } else {
                const combined = buildRoundTripView(northTable, southTable);
                const northTripOrder = new Map<string, number>();
                northTable.trips.forEach((trip, idx) => {
                    northTripOrder.set(trip.id, idx + 1);
                });
                const southTripOrder = new Map<string, number>();
                southTable.trips.forEach((trip, idx) => {
                    southTripOrder.set(trip.id, idx + 1);
                });
                pairs.push({ north: northTable, south: southTable, combined, northTripOrder, southTripOrder });
            }
        });
        return pairs;
    }, [schedules]);

    if (roundTripData.length === 0) return <div className="text-center p-8 text-gray-400">No matching North/South pairs found.</div>;

    return (
        <div className="space-y-8 h-full flex flex-col">
            {roundTripData.map(({ combined, north, south, northTripOrder, southTripOrder }) => {
                const allNorthTrips = north?.trips || [];
                const allSouthTrips = south?.trips || [];
                const headways = calculateHeadways([...allNorthTrips, ...allSouthTrips]);
                const northStopsWithRecovery = new Set<string>();
                const southStopsWithRecovery = new Set<string>();

                combined.rows.forEach(row => {
                    row.trips.forEach(t => {
                        if (t.recoveryTimes) {
                            Object.entries(t.recoveryTimes).forEach(([stop, min]) => {
                                if (min !== undefined && min !== null) {
                                    // Use stop's location (north vs south stops) rather than trip direction
                                    // Fixes loop routes where trips may have inconsistent direction values
                                    const isNorthStop = combined.northStops.includes(stop);
                                    const isSouthStop = combined.southStops.includes(stop);
                                    if (isNorthStop) northStopsWithRecovery.add(stop);
                                    if (isSouthStop) southStopsWithRecovery.add(stop);
                                }
                            });
                        }
                    });
                });

                // Force Georgian College to show ARR | R columns for Route 8A/8B
                // This ensures the turnaround linking can work even if recovery times aren't
                // explicitly set in the source data (common on Sunday schedules)
                if (isInterlineRoute(combined.routeName)) {
                    const georgianStopNorth = findGeorgianStop(combined.northStops);
                    if (georgianStopNorth) {
                        northStopsWithRecovery.add(georgianStopNorth);
                    }
                }

                const summaryTable: MasterRouteTable = {
                    routeName: combined.routeName,
                    trips: [...allNorthTrips, ...allSouthTrips],
                    stops: [], stopIds: {}
                };

                // Detect merged terminus: last North stop = first South stop (for A/B merged routes like 2A+2B)
                // When merged, the last North stop shows only ARRIVE (not ARR|R|DEP)
                // and the first South stop shows only DEPART (already the default)
                const lastNorthStop = combined.northStops[combined.northStops.length - 1];
                const firstSouthStop = combined.southStops[0];
                const hasMergedTerminus = lastNorthStop && firstSouthStop &&
                    lastNorthStop.toLowerCase() === firstSouthStop.toLowerCase();
                const northDisplayStops = pickDisplayStops(combined.northStops, timepointOnly);
                const southDisplayStops = pickDisplayStops(combined.southStops, timepointOnly);
                const lastNorthStopIdx = northDisplayStops.length - 1;
                const showActions = !readOnly && showActionsCol;
                const showRowNum = showRowNumberCol;
                const densityClass =
                    density === 'ultra'
                        ? { cell: 'text-[10px]', header: 'text-[10px]', pad: 'p-1', rowH: 'h-8' }
                        : density === 'comfortable'
                            ? { cell: 'text-sm', header: 'text-sm', pad: 'p-2', rowH: 'h-12' }
                            : { cell: 'text-xs', header: 'text-xs', pad: 'p-1.5', rowH: 'h-10' };

                // Build column mapping for spreadsheet-style references (A, B, C...)
                const columnMapping: ColumnInfo[] = [];
                let colIdx = 0;

                // Row # column (A)
                if (showRowNum) {
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Row #' });
                }

                // Actions column (only if not readOnly)
                if (showActions) {
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Actions' });
                }

                // Pattern column (before Block ID)
                if (showMetaCols) {
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Pattern' });
                }

                // Block ID column
                columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Block' });

                // North stops with sub-columns
                northDisplayStops.forEach((stop, i) => {
                    const isLastStop = i === lastNorthStopIdx;
                    const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                    const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                    const showArrRCols = hasRecovery || isMergedTerminusStop;

                    if (showArrRCols) {
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} ARR` });
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} R` });
                    }
                    if (!isMergedTerminusStop) {
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} DEP` });
                    }
                });

                // South stops with sub-columns
                southDisplayStops.forEach((stop, i) => {
                    const hasRecovery = i > 0 && southStopsWithRecovery.has(stop);

                    if (hasRecovery) {
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} ARR` });
                        columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} R` });
                    }
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: `${stop} DEP` });
                });

                // Metrics columns
                if (showMetaCols) {
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Travel' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Band' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Rec' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Ratio' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Hdwy' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Cycle' });
                    columnMapping.push({ letter: getColumnLetter(colIdx++), label: 'Trip #' });
                }

                // Calculate Route Totals for the Header
                const totalTrips = combined.rows.length;
                const allTrips = [...allNorthTrips, ...allSouthTrips];
                const totalTravelSum = combined.rows.reduce((sum, r) => sum + r.totalTravelTime, 0);
                const totalRecoverySum = combined.rows.reduce((sum, r) => sum + r.totalRecoveryTime, 0);
                const avgTravel = totalTrips > 0 ? (totalTravelSum / totalTrips).toFixed(1) : '0';
                const avgRecovery = totalTrips > 0 ? (totalRecoverySum / totalTrips).toFixed(1) : '0';

                const totalCycleSum = combined.rows.reduce((sum, r) => sum + r.totalCycleTime, 0);

                const overallRatio = totalTravelSum > 0 ? ((totalRecoverySum / totalTravelSum) * 100) : 0;
                const ratioStatus = getRecoveryStatus(overallRatio);

                const peakVehicles = calculatePeakVehicles(allTrips);
                const serviceSpan = calculateServiceSpan(allTrips);
                const headwayAnalysis = analyzeHeadways(allTrips);
                const tripsPerHour = calculateTripsPerHour(allTrips);
                const warnings = validateSchedule(allTrips);

                const hours = Object.keys(tripsPerHour).map(Number).sort((a, b) => a - b);
                const minHour = hours.length > 0 ? hours[0] : 6;
                const maxHour = hours.length > 0 ? hours[hours.length - 1] : 22;
                const maxTripsInHour = Math.max(...Object.values(tripsPerHour), 1);

                return (
                    <div key={combined.routeName} className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 h-full min-h-0">

                        {/* Focus Toolbar + Optional Stats */}
                        <div className="px-3 py-2 border-b border-gray-200 flex-shrink-0 bg-gray-50">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={() => setFocusMode(v => !v)}
                                    className={`px-2 py-1 rounded text-xs font-semibold border ${focusMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                                    title="Focus mode prioritizes schedule grid space"
                                >
                                    Focus
                                </button>
                                <button
                                    onClick={() => setTimepointOnly(v => !v)}
                                    className={`px-2 py-1 rounded text-xs font-semibold border ${timepointOnly ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300'}`}
                                >
                                    Timepoints
                                </button>
                                {!readOnly && (
                                    <button
                                        onClick={() => setShowActionsCol(v => !v)}
                                        className={`px-2 py-1 rounded text-xs font-semibold border ${showActionsCol ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300'}`}
                                    >
                                        Actions
                                    </button>
                                )}
                                <button
                                    onClick={() => setShowRowNumberCol(v => !v)}
                                    className={`px-2 py-1 rounded text-xs font-semibold border ${showRowNumberCol ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300'}`}
                                >
                                    Row #
                                </button>
                                <select
                                    value={density}
                                    onChange={(e) => setDensity(e.target.value as DensityMode)}
                                    className="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-700"
                                    title="Density"
                                >
                                    <option value="ultra">Ultra</option>
                                    <option value="compact">Compact</option>
                                    <option value="comfortable">Comfortable</option>
                                </select>
                                <button
                                    onClick={() => setShowDirectionLegend(v => !v)}
                                    className={`px-2 py-1 rounded text-xs font-semibold border ${showDirectionLegend ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300'}`}
                                >
                                    Legend
                                </button>

                                {/* Always-visible summary */}
                                <div className="flex items-center gap-2 text-xs md:text-sm">
                                    <span className="font-semibold text-gray-800">{serviceSpan.start} – {serviceSpan.end}</span>
                                    <span className="text-gray-500">•</span>
                                    <span className="text-gray-700"><span className="font-semibold">{peakVehicles}</span> vehicles</span>
                                    <span className="text-gray-500">•</span>
                                    <span className="text-gray-700"><span className="font-semibold">{totalTrips}</span> trips</span>
                                    <span className="text-gray-500">•</span>
                                    {/* Sort dropdown */}
                                    <div className="flex items-center gap-1">
                                        <ArrowUpDown size={12} className="text-gray-600" />
                                        <select
                                            value={sortColumn}
                                            onChange={(e) => setSortColumn(e.target.value)}
                                            className="text-xs md:text-sm bg-transparent border-none text-gray-700 cursor-pointer hover:text-gray-900 pr-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded"
                                        >
                                            <option value="blockFlow">Sort: Block Flow</option>
                                            <option value="blockId">Sort: Block #</option>
                                            <option value="endTime">Sort: End Arrival</option>
                                            <option value="startTime">Sort: Start Time</option>
                                            <optgroup label="North Stops">
                                                {northDisplayStops.map(stop => (
                                                    <option key={`n-${stop}`} value={`north:${stop}`}>{stop}</option>
                                                ))}
                                            </optgroup>
                                            <optgroup label="South Stops">
                                                {southDisplayStops.map(stop => (
                                                    <option key={`s-${stop}`} value={`south:${stop}`}>{stop}</option>
                                                ))}
                                            </optgroup>
                                        </select>
                                    </div>
                                </div>

                                {/* Expanded stats */}
                                {!focusMode && (
                                    <>
                                        <div className="flex-1" />
                                        <div className="flex items-center gap-4 text-sm text-gray-700">
                                            <span className={`font-semibold ${overallRatio > 25 ? 'text-amber-700' : overallRatio < 10 ? 'text-red-700' : 'text-gray-700'}`}>
                                                {overallRatio.toFixed(0)}% recovery
                                            </span>
                                            <span>{headwayAnalysis.avg} min avg headway</span>
                                            <span>{(totalCycleSum / 60).toFixed(1)}h service ({(totalTravelSum / 60).toFixed(1)}h travel + {(totalRecoverySum / 60).toFixed(1)}h recovery)</span>
                                            {!readOnly && (() => {
                                                const hourCounts = Object.values(tripsPerHour).filter(c => c > 0);
                                                const avgTrips = hourCounts.length > 0
                                                    ? (hourCounts.reduce((a, b) => a + b, 0) / hourCounts.length).toFixed(1)
                                                    : '0';
                                                return <span>Avg {avgTrips} trips/hr • Peak {maxTripsInHour}/hr</span>;
                                            })()}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Direction Info Row */}
                        {showDirectionLegend && (() => {
                            // Extract route number - don't strip A/B suffix, let getRouteConfig handle it
                            // (8A/8B are distinct routes, not direction variants)
                            const baseRoute = combined.routeName.split(' ')[0];
                            const config = getRouteConfig(baseRoute);
                            const isLoop = config?.segments.length === 1;
                            const northSegment = config?.segments.find(s => s.name === 'North');
                            const southSegment = config?.segments.find(s => s.name === 'South');
                            const northVariant = northSegment?.variant ?? baseRoute;
                            const southVariant = southSegment?.variant ?? baseRoute;
                            const northTerminus = northSegment?.terminus ?? '';
                            const southTerminus = southSegment?.terminus ?? '';

                            return (
                                <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 flex flex-wrap items-center gap-4 text-xs md:text-sm">
                                    <span className="font-semibold text-blue-800">Route Directions:</span>
                                    {isLoop ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-blue-700">Loop:</span>
                                            <code className="bg-blue-100 px-2 py-0.5 rounded font-mono text-blue-800">
                                                {config?.segments[0]?.name ?? 'Unknown'}
                                            </code>
                                            <span className="text-gray-600">({(north?.trips?.length || 0) + (south?.trips?.length || 0)} trips)</span>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2">
                                                <span className="text-blue-700">Northbound:</span>
                                                <code className="bg-green-100 px-2 py-0.5 rounded font-mono text-green-800 font-bold">
                                                    {northVariant}
                                                </code>
                                                {northTerminus && (
                                                    <span className="text-gray-700">→ {northTerminus}</span>
                                                )}
                                                <span className="text-gray-600">({north?.trips?.length || 0} trips)</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-blue-700">Southbound:</span>
                                                <code className="bg-orange-100 px-2 py-0.5 rounded font-mono text-orange-800 font-bold">
                                                    {southVariant}
                                                </code>
                                                {southTerminus && (
                                                    <span className="text-gray-700">→ {southTerminus}</span>
                                                )}
                                                <span className="text-gray-600">({south?.trips?.length || 0} trips)</span>
                                            </div>
                                        </>
                                    )}
                                    {!config && (
                                        <span className="text-amber-600 italic">⚠ Route not in config</span>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Main Table Area */}
                        <div className="overflow-auto custom-scrollbar relative w-full flex-1 min-h-0">

                            <table className={`w-full text-left border-collapse ${densityClass.cell}`} style={{ tableLayout: 'fixed' }}>
                                <colgroup>
                                    {/* Row number column - sticky */}
                                    {showRowNum && <col className="w-8" />}
                                    {showActions && <col className="w-16" />}
                                    {showMetaCols && <col style={{ width: '200px' }} />}  {/* Pattern */}
                                    <col className="w-14" />
                                    {northDisplayStops.map((stop, i) => {
                                        // For merged terminus, show ARR | R (no DEP) for last North stop
                                        const isLastStop = i === lastNorthStopIdx;
                                        const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                                        const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                        const showArrRCols = hasRecovery || isMergedTerminusStop;
                                        return (
                                            <React.Fragment key={`n-col-${i}`}>
                                                {showArrRCols && <col className="w-14" />}
                                                {showArrRCols && <col className="w-8" />}
                                                {/* Skip DEP column for merged terminus (only show ARR | R) */}
                                                {!isMergedTerminusStop && <col style={{ width: '80px' }} />}
                                            </React.Fragment>
                                        );
                                    })}
                                    {southDisplayStops.map((stop, i) => (
                                        <React.Fragment key={`s-col-${i}`}>
                                            {i > 0 && southStopsWithRecovery.has(stop) && <col className="w-14" />}
                                            {i > 0 && southStopsWithRecovery.has(stop) && <col className="w-8" />}
                                            <col style={{ width: '80px' }} />
                                        </React.Fragment>
                                    ))}
                                    {showMetaCols && <col style={{ width: '50px' }} />}  {/* Travel */}
                                    {showMetaCols && <col style={{ width: '42px' }} />}  {/* Band */}
                                    {showMetaCols && <col style={{ width: '38px' }} />}  {/* Rec */}
                                    {showMetaCols && <col style={{ width: '46px' }} />}  {/* Ratio */}
                                    {showMetaCols && <col style={{ width: '42px' }} />}  {/* Hdwy */}
                                    {showMetaCols && <col style={{ width: '48px' }} />}  {/* Cycle */}
                                    {showMetaCols && <col style={{ width: '46px' }} />}  {/* Trip # */}
                                </colgroup>
                                <thead className="sticky top-0 z-40 bg-white shadow-sm">
                                    {/* Column Letters Row (Spreadsheet-style) */}
                                    {!focusMode && (
                                        <tr className="bg-gray-100 border-b border-gray-200">
                                            {columnMapping.map((col, idx) => (
                                                <th
                                                    key={`col-letter-${idx}`}
                                                    className="py-0.5 px-1 text-center text-xs font-mono font-medium text-gray-600 border-r border-gray-200 last:border-r-0"
                                                    title={col.label}
                                                >
                                                    {col.letter}
                                                </th>
                                            ))}
                                        </tr>
                                    )}
                                    {/* Stop Names Row */}
                                    <tr className="bg-white">
                                        {/* Row # header - spans 2 rows */}
                                        {showRowNum && <th rowSpan={2} className="p-1 border-b border-gray-200 bg-gray-100 text-xs font-mono font-medium text-gray-600 text-center align-middle">#</th>}
                                        {showActions && <th rowSpan={2} className="p-2 border-b border-gray-200 bg-gray-100 text-xs font-medium text-gray-600 uppercase text-center align-middle"></th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Shape/Pattern">Pattern</th>}
                                        <th rowSpan={2} className={`p-2 border-b border-gray-200 bg-gray-100 sticky left-0 z-50 ${densityClass.header} font-semibold text-gray-700 uppercase tracking-wide text-center align-middle`}>Block</th>
                                        {northDisplayStops.map((stop, i) => {
                                            const isLastStop = i === lastNorthStopIdx;
                                            const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                                            const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                            // For merged terminus: ARR | R = 2 cols. Otherwise: normal (1 or 3)
                                            const colSpan = i === 0 ? 1 : (isMergedTerminusStop ? 2 : (hasRecovery ? 3 : 1));
                                            // For merged terminus, show "ARRIVE" prefix on last North stop
                                            const displayName = isMergedTerminusStop ? `ARRIVE ${stop}` : stop;
                                            const stopCode = combined.northStopIds?.[stop];
                                            return (
                                                <th
                                                    key={`n-name-${stop}`}
                                                    colSpan={colSpan}
                                                    className={`px-1 py-1 border-b border-l border-gray-200 bg-blue-50/50 ${densityClass.header} font-semibold text-blue-800 uppercase tracking-tight text-center align-middle`}
                                                    title={stopCode ? `${stop} (Stop #${stopCode})` : stop}
                                                >
                                                    <div className="leading-tight line-clamp-2 overflow-hidden">
                                                        {abbreviateStopName(displayName)}
                                                    </div>
                                                    {stopCode && (
                                                        <div className="text-[10px] font-normal text-blue-600/70 mt-0.5">#{stopCode}</div>
                                                    )}
                                                </th>
                                            );
                                        })}
                                        {southDisplayStops.map((stop, i) => {
                                            const hasRecovery = i > 0 && southStopsWithRecovery.has(stop);
                                            const colSpan = i === 0 ? 1 : (hasRecovery ? 3 : 1);
                                            // For merged terminus, show "DEPART" prefix on first South stop
                                            const isFirstStop = i === 0;
                                            const displayName = (isFirstStop && hasMergedTerminus) ? `DEPART ${stop}` : stop;
                                            const stopCode = combined.southStopIds?.[stop];
                                            return (
                                                <th
                                                    key={`s-name-${stop}`}
                                                    colSpan={colSpan}
                                                    className={`px-1 py-1 border-b border-l border-gray-200 bg-orange-50/50 ${densityClass.header} font-semibold text-orange-800 uppercase tracking-tight text-center align-middle`}
                                                    title={stopCode ? `${stop} (Stop #${stopCode})` : stop}
                                                >
                                                    <div className="leading-tight line-clamp-2 overflow-hidden">
                                                        {abbreviateStopName(displayName)}
                                                    </div>
                                                    {stopCode && (
                                                        <div className="text-[10px] font-normal text-orange-600/70 mt-0.5">#{stopCode}</div>
                                                    )}
                                                </th>
                                            );
                                        })}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Travel Time">Travel</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Time Band">Band</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Recovery Time">Rec</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Recovery Ratio">Ratio</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Headway">Hdwy</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Cycle Time">Cycle</th>}
                                        {showMetaCols && <th rowSpan={2} className={`py-1 px-1 border-b border-gray-200 bg-gray-50 text-center ${densityClass.header} font-semibold text-gray-700 uppercase align-middle whitespace-nowrap`} title="Trip Number">Trip #</th>}
                                    </tr>
                                    {/* Sub-headers Row */}
                                    <tr className="bg-gray-50 text-gray-500">
                                        {northDisplayStops.map((stop, i) => {
                                            const isLastStop = i === lastNorthStopIdx;
                                            const isMergedTerminusStop = isLastStop && hasMergedTerminus;
                                            const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                            const showArrRCols = hasRecovery || isMergedTerminusStop;
                                            return (
                                                <React.Fragment key={`n-sub-${stop}`}>
                                                    {showArrRCols && <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-xs font-medium text-gray-700 uppercase">Arr</th>}
                                                    {showArrRCols && <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-xs font-medium text-gray-700">R</th>}
                                                    {/* Skip DEP column for merged terminus - only show Arr | R */}
                                                    {!isMergedTerminusStop && <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-xs font-medium text-gray-700 uppercase">Dep</th>}
                                                </React.Fragment>
                                            );
                                        })}
                                        {southDisplayStops.map((stop, i) => (
                                            <React.Fragment key={`s-sub-${stop}`}>
                                                {i > 0 && southStopsWithRecovery.has(stop) && <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-xs font-medium text-gray-700 uppercase">Arr</th>}
                                                {i > 0 && southStopsWithRecovery.has(stop) && <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-xs font-medium text-gray-700">R</th>}
                                                <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-xs font-medium text-gray-700 uppercase">Dep</th>
                                            </React.Fragment>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-gray-100">
                                    {(() => {
                                        // Helper to get sort time for a row based on selected column
                                        const getSortTime = (row: typeof combined.rows[0]): number => {
                                            const northTrip = row.trips.find(t => t.direction === 'North');
                                            const southTrip = row.trips.find(t => t.direction === 'South');

                                            if (sortColumn === 'startTime') {
                                                return northTrip?.startTime ?? southTrip?.startTime ?? 0;
                                            }
                                            if (sortColumn === 'endTime') {
                                                // End arrival = last trip's end time
                                                const lastTrip = [...row.trips].sort((a, b) => b.endTime - a.endTime)[0];
                                                return lastTrip?.endTime ?? 0;
                                            }
                                            // Stop-based sorting: "north:StopName" or "south:StopName"
                                            if (sortColumn.startsWith('north:')) {
                                                const stopName = sortColumn.replace('north:', '');
                                                const timeStr = northTrip?.stops?.[stopName];
                                                return timeStr ? TimeUtils.toMinutes(timeStr) ?? 0 : 0;
                                            }
                                            if (sortColumn.startsWith('south:')) {
                                                const stopName = sortColumn.replace('south:', '');
                                                const timeStr = southTrip?.stops?.[stopName];
                                                return timeStr ? TimeUtils.toMinutes(timeStr) ?? 0 : 0;
                                            }
                                            return northTrip?.startTime ?? southTrip?.startTime ?? 0;
                                        };

                                        // Sort rows by the selected column
                                        const sortedRows = [...combined.rows].sort((a, b) => {
                                            if (sortColumn === 'blockFlow') {
                                                const pairDiff = (a.pairIndex || 0) - (b.pairIndex || 0);
                                                if (pairDiff !== 0) return pairDiff;
                                                const timeDiff = getSortTime(a) - getSortTime(b);
                                                if (timeDiff !== 0) return timeDiff;
                                                const blockDiff = compareBlockIds(a.blockId, b.blockId);
                                                if (blockDiff !== 0) return blockDiff;
                                            }
                                            if (sortColumn === 'blockId') {
                                                const blockDiff = compareBlockIds(a.blockId, b.blockId);
                                                if (blockDiff !== 0) return blockDiff;
                                            }
                                            return getSortTime(a) - getSortTime(b);
                                        });

                                        return sortedRows.map((row, rowIdx) => {
                                        const northTrip = row.trips.find(t => t.direction === 'North');
                                        const southTrip = row.trips.find(t => t.direction === 'South');
                                        const lastTrip = [...row.trips].sort((a, b) => a.startTime - b.startTime).pop();

                                        const uniqueRowKey = `${row.blockId}-${northTrip?.id || 'n'}-${southTrip?.id || 's'}-${rowIdx}`;

                                        const totalTravel = (northTrip?.travelTime || 0) + (southTrip?.travelTime || 0);
                                        const totalRec = (northTrip?.recoveryTime || 0) + (southTrip?.recoveryTime || 0);
                                        const ratio = totalTravel > 0 ? (totalRec / totalTravel) * 100 : 0;

                                        // Calculate cycle time - for Route 8A/8B interline trips, use pure runtime
                                        // (sum of travel times + recovery times) instead of wall-clock span
                                        // which incorrectly includes the interline gap at Allandale
                                        const tripWithInterline = northTrip as MasterTrip & { _interlinePartial?: boolean; _interlineStop?: string };
                                        let displayCycleTime = row.totalCycleTime;

                                        if (isInterlineRoute(combined.routeName) && tripWithInterline?._interlinePartial) {
                                            // For 8A/8B interline: cycle = travel + Allandale recovery + Georgian College recovery + terminal recovery
                                            // Get Allandale recovery (the interline stop)
                                            const interlineStopName = tripWithInterline._interlineStop;
                                            const allandaleRecovery = (interlineStopName && northTrip?.recoveryTimes?.[interlineStopName]) || 5;

                                            // Get Georgian College recovery (turnaround point)
                                            const georgianStopNorth = findGeorgianStop(combined.northStops);
                                            const georgianRecovery = (georgianStopNorth && northTrip?.recoveryTimes?.[georgianStopNorth]) || 0;

                                            // Get terminal recovery from the last South stop (Park Place or South GO)
                                            // Default to 10 min for interline routes when GTFS data shows 0
                                            const lastSouthStop = combined.southStops[combined.southStops.length - 1];
                                            const rawTerminalRecovery = (lastSouthStop && southTrip?.recoveryTimes?.[lastSouthStop]) || 0;
                                            const terminalRecovery = rawTerminalRecovery === 0 ? 10 : rawTerminalRecovery;

                                            displayCycleTime = totalTravel + allandaleRecovery + georgianRecovery + terminalRecovery;
                                        }

                                        const headway = northTrip ? headways[northTrip.id] : (southTrip ? headways[southTrip.id] : '-');

                                        const ratioColorClass = getRatioColor(ratio);

                                        const assignedBand = northTrip?.assignedBand || southTrip?.assignedBand;
                                        const northIndex = northTrip ? northTripOrder.get(northTrip.id) : undefined;
                                        const southIndex = southTrip ? southTripOrder.get(southTrip.id) : undefined;
                                        const routeTripNumber = northIndex ?? southIndex ?? rowIdx + 1;
                                        const bandColor = getBandRowColor(assignedBand);
                                        const rowBg = bandColor || (rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50');
                                        const originalNorthTrip = northTrip ? getOriginalTrip(north.routeName, northTrip.id) : undefined;
                                        const originalSouthTrip = southTrip ? getOriginalTrip(south.routeName, southTrip.id) : undefined;

                                        const tripStartTime = northTrip?.startTime || southTrip?.startTime || 0;
                                        const tripEndTime = northTrip?.endTime || southTrip?.endTime || 0;
                                        const isGrayedOut = filter ? shouldGrayOutTrip(tripStartTime, tripEndTime, filter) : false;
                                        const isHighlighted = filter ? shouldHighlightTrip(totalTravel, totalRec, typeof headway === 'number' ? headway : null, filter) : false;
                                        const matchesSearchFilter = filter ? matchesSearch(row.blockId, [...combined.northStops, ...combined.southStops], filter.search) : true;

                                        const grayOutClass = isGrayedOut ? 'opacity-40' : '';
                                        const filterHighlightClass = isHighlighted ? 'bg-amber-50 ring-2 ring-inset ring-amber-200' : '';
                                        const searchHideClass = !matchesSearchFilter ? 'hidden' : '';

                                        // Calculate the display row number (1-indexed)
                                        const displayRowNum = rowIdx + 1;

                                        // Track column index for cell references (starts after optional row#, optional actions, block)
                                        let dataColIdx = 1; // block
                                        if (showRowNum) dataColIdx += 1;
                                        if (showActions) dataColIdx += 1;
                                        const getCellRef = () => {
                                            const col = columnMapping[dataColIdx];
                                            return col ? `${col.letter}${displayRowNum}` : '';
                                        };

                                        return (
                                            <tr
                                                key={uniqueRowKey}
                                                className={`group hover:bg-blue-50/50 ${rowBg} ${grayOutClass} ${filterHighlightClass} ${searchHideClass}`}
                                                onContextMenu={(e) => {
                                                    if (onTripRightClick && northTrip) {
                                                        onTripRightClick(e, northTrip.id, 'North', row.blockId, combined.northStops);
                                                    }
                                                }}
                                            >
                                                {/* Row Number Column */}
                                                {showRowNum && (
                                                    <td
                                                        className="p-1 border-r border-gray-200 bg-gray-50 z-20 text-center text-xs font-mono text-gray-600"
                                                        title={`Row ${displayRowNum}`}
                                                    >
                                                        {displayRowNum}
                                                    </td>
                                                )}
                                                {/* Actions Column */}
                                                {showActions && (
                                                    <td className="p-1 border-r border-gray-100 bg-white group-hover:bg-gray-100 z-20">
                                                        <div className="flex items-center justify-center gap-0.5">
                                                            {onAddTrip && (
                                                                <button
                                                                    onClick={() => onAddTrip(row.blockId, lastTrip?.id || '')}
                                                                    className="p-1 rounded hover:bg-green-50 text-gray-600 hover:text-green-700 transition-colors"
                                                                    title="Add trip to block"
                                                                    aria-label="Add trip"
                                                                >
                                                                    <Plus size={12} />
                                                                </button>
                                                            )}
                                                            {northTrip && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        if (onMenuOpen) {
                                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                                            onMenuOpen(northTrip.id, rect.left, rect.bottom + 4, 'North', row.blockId, combined.northStops);
                                                                        }
                                                                    }}
                                                                    className="p-1 rounded hover:bg-blue-50 text-gray-600 hover:text-blue-700 transition-colors"
                                                                    title="Edit trip"
                                                                    aria-label="Edit trip"
                                                                >
                                                                    <Pencil size={12} />
                                                                </button>
                                                            )}
                                                            {onDeleteTrip && northTrip && (
                                                                <button
                                                                    onClick={() => onDeleteTrip(northTrip.id)}
                                                                    className="p-1 rounded hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
                                                                    title="Delete trip"
                                                                    aria-label="Delete trip"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}

                                                {/* Pattern */}
                                                {showMetaCols && (
                                                    <td className="p-1 text-left text-xs text-gray-500" title={`${northTrip?.patternLabel || '-'}\n${southTrip?.patternLabel || '-'}`}>
                                                        <div className="flex flex-col gap-0.5 leading-tight">
                                                            <span className="truncate"><span className="font-semibold text-blue-700">N</span> {northTrip?.patternLabel || '-'}</span>
                                                            <span className="truncate"><span className="font-semibold text-orange-600">S</span> {southTrip?.patternLabel || '-'}</span>
                                                        </div>
                                                    </td>
                                                )}

                                                {/* Block ID */}
                                                <td className={`p-2 border-r border-gray-100 sticky left-0 bg-white group-hover:bg-gray-100 z-30 font-medium text-xs text-gray-700 text-center`}>
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <span>{row.blockId}</span>
                                                        {lastTrip?.isBlockEnd && (
                                                            <span className="text-[9px] text-orange-600 font-bold">END</span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* North Cells */}
                                                {northDisplayStops.map((stop, i) => {
                                                    // For merged terminus (A/B routes), show ARR | R but skip DEP for last North stop
                                                    const isMergedTerminusStop = i === lastNorthStopIdx && hasMergedTerminus;
                                                    const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                                    const showArrRCols = hasRecovery || isMergedTerminusStop;

                                                    // Check if this is a partial trip that STARTS at this stop
                                                    // (no stops with times BEFORE this one - interline incoming from 8B)
                                                    const isPartialTripStartingHere = northTrip && i > 0 && (() => {
                                                        const previousStops = northDisplayStops.slice(0, i);
                                                        return !previousStops.some(prevStop =>
                                                            getStopValue(northTrip.stops, prevStop) ||
                                                            getStopValue(northTrip.arrivalTimes, prevStop)
                                                        );
                                                    })();

                                                    // Get actual arrival time at this stop (used to decide if recovery should show)
                                                    const northArrivalAtStop = isPartialTripStartingHere ? '' : getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                    const canAdjustNorthDep = !!northTrip && (() => {
                                                        const arrival = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                        if (!arrival) return false;

                                                        const remainingStops = northDisplayStops.slice(i + 1);
                                                        const hasContinuingStops = remainingStops.some(nextStop =>
                                                            getStopValue(northTrip.stops, nextStop) ||
                                                            getStopValue(northTrip.arrivalTimes, nextStop)
                                                        );
                                                        if (!hasContinuingStops) return false;

                                                        const tripWithInterline = northTrip as MasterTrip & {
                                                            _interlineDepartureTime?: number | null;
                                                            _interlineStop?: string;
                                                        };
                                                        const isInterlineStopMatch = tripWithInterline?._interlineStop &&
                                                            stop.toLowerCase().includes(tripWithInterline._interlineStop.toLowerCase());
                                                        const metadataInterlineDepTime = isInterlineStopMatch ? tripWithInterline._interlineDepartureTime : null;
                                                        const explicitInterlineDepTime = getInterlineDepartureTime(
                                                            northTrip,
                                                            stop,
                                                            allNorthTrips,
                                                            combined.routeName,
                                                            interlineTripLookup
                                                        );
                                                        const interlineDepTime = explicitInterlineDepTime ?? metadataInterlineDepTime;

                                                        if (isInterlineStop(stop) && !interlineDepTime) {
                                                            const precedingStops = northDisplayStops.slice(0, i);
                                                            const tripStartsHere = !precedingStops.some(prevStop =>
                                                                getStopValue(northTrip.stops, prevStop) ||
                                                                getStopValue(northTrip.arrivalTimes, prevStop)
                                                            );

                                                            if (!tripStartsHere) {
                                                                const arrTimeStr = getStopValue(northTrip.stops, stop) ||
                                                                    getStopValue(northTrip.arrivalTimes, stop);
                                                                if (arrTimeStr) {
                                                                    const arrTime = TimeUtils.toMinutes(arrTimeStr);
                                                                    if (arrTime !== null && isInInterlineWindow(arrTime, combined.routeName)) {
                                                                        return false;
                                                                    }
                                                                }
                                                            }
                                                        }

                                                        return true;
                                                    })();

                                                    // Get cell references for this stop's columns
                                                    const arrCellRef = showArrRCols ? columnMapping[dataColIdx]?.letter + displayRowNum : '';
                                                    const rCellRef = showArrRCols ? columnMapping[dataColIdx + 1]?.letter + displayRowNum : '';
                                                    const depCellRef = !isMergedTerminusStop ? columnMapping[dataColIdx + (showArrRCols ? 2 : 0)]?.letter + displayRowNum : '';

                                                    // Increment dataColIdx after computing refs
                                                    const stopColCount = (showArrRCols ? 2 : 0) + (isMergedTerminusStop ? 0 : 1);
                                                    dataColIdx += stopColCount;

                                                    return (
                                                    <React.Fragment key={`n-${stop}`}>
                                                        {showArrRCols && (
                                                            <td className="p-0 relative h-10 group/arr" title={arrCellRef}>
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onTimeAdjust && northTrip && northArrivalAtStop && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, `${stop}__ARR`, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/arr:opacity-100 flex items-center justify-center text-gray-400 hover:text-blue-600 transition-all"
                                                                            title="-1 min"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <StackedTimeInput
                                                                        value={northArrivalAtStop}
                                                                        onChange={(val) => northTrip && onCellEdit?.(northTrip.id, `${stop}__ARR`, val)}
                                                                        onBlur={(val) => {
                                                                            if (northTrip && val && onCellEdit) {
                                                                                const formatted = parseTimeInput(val, northArrivalAtStop);
                                                                                if (formatted) onCellEdit(northTrip.id, `${stop}__ARR`, formatted);
                                                                            }
                                                                        }}
                                                                        disabled={readOnly || !northTrip || !northArrivalAtStop}
                                                                        focusClass="focus:ring-blue-100"
                                                                        onAdjust={onTimeAdjust && northTrip && northArrivalAtStop ? (delta) => onTimeAdjust(northTrip.id, `${stop}__ARR`, delta) : undefined}
                                                                    />
                                                                    {(() => {
                                                                        const originalArrival = getArrivalDisplayTime(originalNorthTrip, stop);
                                                                        const diff = getDeltaMinutes(northArrivalAtStop, originalArrival);
                                                                        if (!diff) return null;
                                                                        return (
                                                                            <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${diff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                                {diff > 0 ? '+' : ''}{diff}
                                                                            </span>
                                                                        );
                                                                    })()}
                                                                    {onTimeAdjust && northTrip && northArrivalAtStop && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, `${stop}__ARR`, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-40 group-hover/arr:opacity-100 flex items-center justify-center text-gray-400 hover:text-blue-600 transition-all"
                                                                            title="+1 min"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {showArrRCols && (
                                                            <td className="p-0 relative h-8 group/rec text-center font-mono text-xs text-gray-700 font-medium" title={rCellRef}>
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onRecoveryEdit && northTrip && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(northTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="-1 min recovery"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <span className="px-2">{northArrivalAtStop ? getRecoveryForStop(northTrip, stop, combined.routeName) : ''}</span>
                                                                    {onRecoveryEdit && northTrip && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(northTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="+1 min recovery"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {/* Skip DEP cell for merged terminus - South's first stop handles departure */}
                                                        {!isMergedTerminusStop && (() => {
                                                            // Compute departure time for connection indicator
                                                            const arrival = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                            const recovery = getStopValue(northTrip?.recoveryTimes, stop) || 0;
                                                            const depTimeMinutes = arrival ? TimeUtils.toMinutes(
                                                                recovery === 0 ? arrival : TimeUtils.addMinutes(arrival, recovery)
                                                            ) : null;
                                                            const stopCode = combined.northStopIds?.[stop] || '';
                                                            const connections = connectionLibrary && stopCode && depTimeMinutes !== null
                                                                ? getConnectionsForStop(stopCode, depTimeMinutes, connectionLibrary, dayType)
                                                                : [];

                                                            return (
                                                            <td className={`p-0 relative ${connections.length > 0 ? 'h-14' : 'h-10'} group/cell ${i === 0 ? 'sticky left-14 z-20 bg-white border-l border-dashed border-gray-100' : ''}`} title={depCellRef}>
                                                                <div className={`flex ${connections.length > 0 ? 'flex-col' : 'items-center'} justify-center h-full`}>
                                                                    {onTimeAdjust && northTrip && canAdjustNorthDep && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-4 opacity-40 group-hover/cell:opacity-100 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                                                                            title="-1 min"
                                                                        >
                                                                            <ChevronDown size={12} />
                                                                        </button>
                                                                    )}
                                                                    {(() => {
                                                                        // Standard calculation: arrival + recovery
                                                                        const arrival = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                                        if (!arrival) return null;

                                                                        // Check if this is a trip that ENDS at this stop
                                                                        const remainingStops = northDisplayStops.slice(i + 1);
                                                                        const hasContinuingStops = northTrip ? remainingStops.some(nextStop =>
                                                                            getStopValue(northTrip.stops, nextStop) ||
                                                                            getStopValue(northTrip.arrivalTimes, nextStop)
                                                                        ) : false;

                                                                        // Check if this is Georgian College and trip ends here - show link picker
                                                                        if (!hasContinuingStops && isGeorgianCollegeStop(stop) && northTrip && onLinkTrips && !readOnly) {
                                                                            const arrTime = TimeUtils.toMinutes(arrival);
                                                                            if (arrTime !== null && isInInterlineWindow(arrTime, combined.routeName)) {
                                                                                return (
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                                                            const availableTrips = findAvailableSouthTripsForLinking(
                                                                                                south?.trips || [],
                                                                                                combined.southStops,
                                                                                                arrTime,
                                                                                                15
                                                                                            );
                                                                                            setLinkPicker({
                                                                                                northTripId: northTrip.id,
                                                                                                northArrivalTime: arrTime,
                                                                                                stopName: stop,
                                                                                                x: rect.left,
                                                                                                y: rect.bottom,
                                                                                                availableSouthTrips: availableTrips
                                                                                            });
                                                                                        }}
                                                                                        className="w-full h-full flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                                                                                        title="Click to link South trip"
                                                                                    >
                                                                                        <Plus size={14} />
                                                                                    </button>
                                                                                );
                                                                            }
                                                                        }

                                                                        // If trip ends here but not at Georgian College during interline, show empty
                                                                        if (!hasContinuingStops) {
                                                                            return null;
                                                                        }

                                                                        const recovery = getStopValue(northTrip?.recoveryTimes, stop) || 0;

                                                                        // Check for interline departure time (set by linkInterlineTripsAtAllandale)
                                                                        // If this trip has _interlineDepartureTime and this is the interline stop,
                                                                        // use the paired departure time instead of arrival + recovery
                                                                        const tripWithInterline = northTrip as MasterTrip & {
                                                                            _interlineDepartureTime?: number | null;
                                                                            _interlineStop?: string;
                                                                        };
                                                                        const isInterlineStopMatch = tripWithInterline?._interlineStop &&
                                                                            stop.toLowerCase().includes(tripWithInterline._interlineStop.toLowerCase());
                                                                        const metadataInterlineDepTime = isInterlineStopMatch ? tripWithInterline._interlineDepartureTime : null;
                                                                        const explicitInterlineDepTime = getInterlineDepartureTime(
                                                                            northTrip,
                                                                            stop,
                                                                            allNorthTrips,
                                                                            combined.routeName,
                                                                            interlineTripLookup
                                                                        );
                                                                        const interlineDepTime = explicitInterlineDepTime ?? metadataInterlineDepTime;

                                                                        // For interline stops (Allandale), handle DEP based on whether trip starts or arrives here
                                                                        // BUT if we have an interline departure time, show it instead of returning null
                                                                        if (northTrip && isInterlineStop(stop) && !interlineDepTime) {
                                                                            const precedingStops = northDisplayStops.slice(0, i);
                                                                            const tripStartsHere = !precedingStops.some(prevStop =>
                                                                                getStopValue(northTrip.stops, prevStop) ||
                                                                                getStopValue(northTrip.arrivalTimes, prevStop)
                                                                            );

                                                                            if (!tripStartsHere) {
                                                                                const arrTimeStr = getStopValue(northTrip.stops, stop) ||
                                                                                                   getStopValue(northTrip.arrivalTimes, stop);
                                                                                if (arrTimeStr) {
                                                                                    const arrTime = TimeUtils.toMinutes(arrTimeStr);
                                                                                    if (arrTime !== null && isInInterlineWindow(arrTime, combined.routeName)) {
                                                                                        return null;
                                                                                    }
                                                                                }
                                                                            }
                                                                        }

                                                                        const depValue = interlineDepTime
                                                                            ? TimeUtils.fromMinutes(interlineDepTime)
                                                                            : (recovery === 0 ? arrival : TimeUtils.addMinutes(arrival, recovery));

                                                                        return (
                                                                            <StackedTimeInput
                                                                                value={depValue}
                                                                                onChange={(val) => northTrip && onCellEdit?.(northTrip.id, stop, val)}
                                                                                onBlur={(val) => {
                                                                                    if (northTrip && val && onCellEdit) {
                                                                                        const originalValue = getArrivalTimeForStop(northTrip, stop, i, northDisplayStops.length);
                                                                                        const formatted = parseTimeInput(val, originalValue);
                                                                                        if (formatted) onCellEdit(northTrip.id, stop, formatted);
                                                                                    }
                                                                                }}
                                                                                disabled={readOnly || !northTrip}
                                                                                focusClass="focus:ring-blue-100"
                                                                                onAdjust={onTimeAdjust && northTrip && canAdjustNorthDep ? (delta) => onTimeAdjust(northTrip.id, stop, delta) : undefined}
                                                                            />
                                                                        );
                                                                    })()}
                                                                    {onTimeAdjust && northTrip && canAdjustNorthDep && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-4 opacity-40 group-hover/cell:opacity-100 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                                                                            title="+1 min"
                                                                        >
                                                                            <ChevronUp size={12} />
                                                                        </button>
                                                                    )}
                                                                    {connections.length > 0 && (
                                                                        <ConnectionIndicator connections={connections} />
                                                                    )}
                                                                    {(() => {
                                                                        const currentDep = northTrip ? getDepartureDisplayTime(northTrip, stop, combined.routeName, false) : '';
                                                                        const originalDep = getDepartureDisplayTime(originalNorthTrip, stop, combined.routeName, false);
                                                                        const diff = getDeltaMinutes(currentDep, originalDep);
                                                                        if (!diff) return null;
                                                                        return (
                                                                            <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${diff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                                {diff > 0 ? '+' : ''}{diff}
                                                                            </span>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            </td>
                                                            );
                                                        })()}
                                                    </React.Fragment>
                                                    );
                                                })}

                                                {/* South Cells */}
                                                {southDisplayStops.map((stop, i) => {
                                                    const hasRecovery = i > 0 && southStopsWithRecovery.has(stop);

                                                    // Get cell references for this stop's columns
                                                    const arrCellRef = hasRecovery ? columnMapping[dataColIdx]?.letter + displayRowNum : '';
                                                    const rCellRef = hasRecovery ? columnMapping[dataColIdx + 1]?.letter + displayRowNum : '';
                                                    const depCellRef = columnMapping[dataColIdx + (hasRecovery ? 2 : 0)]?.letter + displayRowNum;

                                                    // Increment dataColIdx after computing refs
                                                    const stopColCount = (hasRecovery ? 2 : 0) + 1;
                                                    dataColIdx += stopColCount;

                                                    const southArrivalAtStop = getStopValue(southTrip?.arrivalTimes, stop) || getStopValue(southTrip?.stops, stop) || '';

                                                    return (
                                                    <React.Fragment key={`s-${stop}`}>
                                                        {hasRecovery && (
                                                            <td className="p-0 relative h-10 group/arr" title={arrCellRef}>
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onTimeAdjust && southTrip && southArrivalAtStop && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(southTrip.id, `${stop}__ARR`, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/arr:opacity-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 transition-all"
                                                                            title="-1 min"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <StackedTimeInput
                                                                        value={southArrivalAtStop}
                                                                        onChange={(val) => southTrip && onCellEdit?.(southTrip.id, `${stop}__ARR`, val)}
                                                                        onBlur={(val) => {
                                                                            if (southTrip && val && onCellEdit) {
                                                                                const originalValue = getStopValue(southTrip.arrivalTimes, stop) || getStopValue(southTrip.stops, stop);
                                                                                const formatted = parseTimeInput(val, originalValue);
                                                                                if (formatted) onCellEdit(southTrip.id, `${stop}__ARR`, formatted);
                                                                            }
                                                                        }}
                                                                        disabled={readOnly || !southTrip || !southArrivalAtStop}
                                                                        focusClass="focus:ring-indigo-100"
                                                                        onAdjust={onTimeAdjust && southTrip && southArrivalAtStop ? (delta) => onTimeAdjust(southTrip.id, `${stop}__ARR`, delta) : undefined}
                                                                    />
                                                                    {(() => {
                                                                        const originalArrival = getArrivalDisplayTime(originalSouthTrip, stop);
                                                                        const diff = getDeltaMinutes(southArrivalAtStop, originalArrival);
                                                                        if (!diff) return null;
                                                                        return (
                                                                            <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${diff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                                {diff > 0 ? '+' : ''}{diff}
                                                                            </span>
                                                                        );
                                                                    })()}
                                                                    {onTimeAdjust && southTrip && southArrivalAtStop && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(southTrip.id, `${stop}__ARR`, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-40 group-hover/arr:opacity-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 transition-all"
                                                                            title="+1 min"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {hasRecovery && (
                                                            <td className="p-0 relative h-8 group/rec text-center font-mono text-xs text-gray-700 font-medium" title={rCellRef}>
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onRecoveryEdit && southTrip && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(southTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="-1 min recovery"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <span className="px-2">{getRecoveryForStop(southTrip, stop, combined.routeName)}</span>
                                                                    {onRecoveryEdit && southTrip && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(southTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-40 group-hover/rec:opacity-100 flex items-center justify-center text-gray-400 hover:text-green-600 transition-all"
                                                                            title="+1 min recovery"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {(() => {
                                                            // Compute departure time for connection indicator
                                                            const southArrival = getStopValue(southTrip?.arrivalTimes, stop) || getStopValue(southTrip?.stops, stop);
                                                            let southRecovery = getStopValue(southTrip?.recoveryTimes, stop) || 0;
                                                            const isLastSouthStop = i === southDisplayStops.length - 1;
                                                            if (southRecovery === 0 && isLastSouthStop && isInterlineRoute(combined.routeName)) {
                                                                southRecovery = 10;
                                                            }
                                                            const southDepValue = southArrival
                                                                ? (southRecovery === 0 ? southArrival : TimeUtils.addMinutes(southArrival, southRecovery))
                                                                : '';
                                                            const canAdjustSouthDep = !!southTrip && !!southDepValue;
                                                            const southDepTimeMinutes = southDepValue ? TimeUtils.toMinutes(southDepValue) : null;
                                                            const southStopCode = combined.southStopIds?.[stop] || '';
                                                            const southConnections = connectionLibrary && southStopCode && southDepTimeMinutes !== null
                                                                ? getConnectionsForStop(southStopCode, southDepTimeMinutes, connectionLibrary, dayType)
                                                                : [];

                                                            return (
                                                        <td className={`p-0 relative ${southConnections.length > 0 ? 'h-14' : 'h-10'} group/cell ${i === 0 ? 'border-l border-dashed border-gray-100' : ''}`} title={depCellRef}>
                                                            <div className={`flex ${southConnections.length > 0 ? 'flex-col' : 'items-center'} justify-center h-full`}>
                                                                {onTimeAdjust && southTrip && canAdjustSouthDep && (
                                                                    <button
                                                                        onClick={() => onTimeAdjust(southTrip.id, stop, -1)}
                                                                        className="absolute left-0 top-0 bottom-0 w-4 opacity-40 group-hover/cell:opacity-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                                                                        title="-1 min"
                                                                    >
                                                                        <ChevronDown size={12} />
                                                                    </button>
                                                                )}
                                                                <StackedTimeInput
                                                                    value={southDepValue}
                                                                    onChange={(val) => southTrip && onCellEdit?.(southTrip.id, stop, val)}
                                                                    onBlur={(val) => {
                                                                        if (southTrip && val && onCellEdit) {
                                                                            const originalValue = getStopValue(southTrip.arrivalTimes, stop) || getStopValue(southTrip.stops, stop);
                                                                            const formatted = parseTimeInput(val, originalValue);
                                                                            if (formatted) onCellEdit(southTrip.id, stop, formatted);
                                                                        }
                                                                    }}
                                                                    disabled={readOnly || !southTrip}
                                                                    focusClass="focus:ring-indigo-100"
                                                                    onAdjust={onTimeAdjust && southTrip && canAdjustSouthDep ? (delta) => onTimeAdjust(southTrip.id, stop, delta) : undefined}
                                                                />
                                                                {onTimeAdjust && southTrip && canAdjustSouthDep && (
                                                                    <button
                                                                        onClick={() => onTimeAdjust(southTrip.id, stop, 1)}
                                                                        className="absolute right-0 top-0 bottom-0 w-4 opacity-40 group-hover/cell:opacity-100 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                                                                        title="+1 min"
                                                                    >
                                                                        <ChevronUp size={12} />
                                                                    </button>
                                                                )}
                                                                {southConnections.length > 0 && (
                                                                    <ConnectionIndicator connections={southConnections} />
                                                                )}
                                                                {(() => {
                                                                    const isLastSouthStop = i === southDisplayStops.length - 1;
                                                                    const currentDep = southTrip ? getDepartureDisplayTime(southTrip, stop, combined.routeName, isLastSouthStop) : '';
                                                                    const originalDep = getDepartureDisplayTime(originalSouthTrip, stop, combined.routeName, isLastSouthStop);
                                                                    const diff = getDeltaMinutes(currentDep, originalDep);
                                                                    if (!diff) return null;
                                                                    return (
                                                                        <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${diff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                            {diff > 0 ? '+' : ''}{diff}
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </td>
                                                            );
                                                        })()}
                                                    </React.Fragment>
                                                    );
                                                })}

                                                {/* Metrics Columns */}
                                                {showMetaCols && (
                                                    <>
                                                        <td className="p-2 text-center text-sm font-semibold text-gray-700 border-l border-gray-100" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>{totalTravel}</td>
                                                        <td className="p-1 text-center" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            {(() => {
                                                                const displayBand = northTrip?.assignedBand || southTrip?.assignedBand || '-';
                                                                return (
                                                                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                                                        {displayBand}
                                                                    </span>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="p-2 text-center text-sm text-gray-700" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>{totalRec}</td>

                                                        <td className={`p-2 text-center text-sm font-semibold ${ratio > 25 ? 'text-amber-700' : ratio < 10 ? 'text-red-700' : 'text-gray-700'}`} title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            {ratio.toFixed(0)}%
                                                        </td>

                                                        <td className={`p-2 text-center text-sm ${targetHeadway && typeof headway === 'number' && headway !== targetHeadway
                                                            ? 'text-amber-700 bg-amber-100 font-bold ring-1 ring-amber-300'
                                                            : 'text-gray-700'
                                                            }`} title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            {headway}
                                                            {targetHeadway && typeof headway === 'number' && headway !== targetHeadway && (
                                                                <span className="ml-1 text-xs font-semibold">({headway > targetHeadway ? '+' : ''}{headway - targetHeadway})</span>
                                                            )}
                                                        </td>

                                                        <td className={`p-2 text-center text-sm font-semibold ${targetCycleTime && Math.round(displayCycleTime) !== targetCycleTime
                                                            ? 'text-amber-700 bg-amber-100 font-bold ring-1 ring-amber-300'
                                                            : 'text-gray-800'
                                                            }`} title={columnMapping[dataColIdx++]?.letter + displayRowNum}>
                                                            {Math.round(displayCycleTime)}
                                                            {targetCycleTime && Math.round(displayCycleTime) !== targetCycleTime && (
                                                                <span className="ml-1 text-xs font-semibold">({Math.round(displayCycleTime) > targetCycleTime ? '+' : ''}{Math.round(displayCycleTime) - targetCycleTime})</span>
                                                            )}
                                                        </td>

                                                        <td className="p-2 text-center text-sm font-mono text-gray-700" title={columnMapping[dataColIdx++]?.letter + displayRowNum}>{routeTripNumber}</td>
                                                    </>
                                                )}

                                            </tr>
                                        );
                                    });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}

            {/* Georgian College Link Picker Popup */}
            {linkPicker && (
                <div
                    className="fixed bg-white rounded-lg shadow-xl border border-gray-200 z-50 min-w-[140px]"
                    style={{ left: linkPicker.x, top: linkPicker.y }}
                >
                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
                        <div className="text-xs font-medium text-gray-600">Link South Trip</div>
                        <div className="text-xs text-gray-600">
                            Arr: {TimeUtils.fromMinutes(linkPicker.northArrivalTime)}
                        </div>
                    </div>
                    {linkPicker.availableSouthTrips.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-gray-600 text-center">
                            No departures within 15 min
                        </div>
                    ) : (
                        <div className="py-1">
                            {linkPicker.availableSouthTrips.map(({ tripId, displayTime }) => (
                                <button
                                    key={tripId}
                                    onClick={() => {
                                        onLinkTrips?.(linkPicker.northTripId, tripId, linkPicker.stopName);
                                        setLinkPicker(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center gap-2"
                                >
                                    <span className="font-mono">{displayTime}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="px-2 py-1 border-t border-gray-100">
                        <button
                            onClick={() => setLinkPicker(null)}
                            className="w-full px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Click outside to close link picker */}
            {linkPicker && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setLinkPicker(null)}
                />
            )}
        </div>
    );
};
