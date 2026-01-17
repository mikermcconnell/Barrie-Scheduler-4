/**
 * GTFS Import Service
 *
 * Fetches, parses, and converts GTFS feeds to MasterScheduleContent.
 * Supports importing existing Barrie Transit schedules into the draft system.
 *
 * Architecture:
 * - Fetches GTFS ZIP via proxy API (avoids CORS issues, handles ZIP parsing server-side)
 * - Alternatively accepts pre-parsed JSON for testing/offline use
 * - Converts GTFS trips to MasterScheduleContent format
 * - Creates drafts via draftService
 */

import type {
    ParsedGTFSFeed,
    GTFSRoute,
    GTFSTrip,
    GTFSStopTime,
    GTFSStop,
    GTFSCalendar,
    GTFSRouteOption,
    ProcessedGTFSTrip,
    GTFSImportConfig,
    GTFSImportResult,
    GTFSImportOptions,
    gtfsTimeToMinutes,
    minutesToDisplayTime,
    calendarToDayType,
    gtfsDirectionToDirection,
} from './gtfsTypes';
import {
    gtfsTimeToMinutes as parseGtfsTime,
    minutesToDisplayTime as formatTime,
    calendarToDayType as getDayType,
    gtfsDirectionToDirection as mapDirection,
} from './gtfsTypes';
import type { MasterScheduleContent, DayType } from './masterScheduleTypes';
import type { MasterTrip, MasterRouteTable } from './masterScheduleParser';
import type { Direction } from './routeDirectionConfig';
import { inferDirectionFromTerminus, getRouteConfig, parseRouteInfo } from './routeDirectionConfig';
import { saveDraft } from './draftService';
import type { DraftScheduleInput } from './scheduleTypes';
import {
    getBaseStopName,
    getOperationalSortTime,
    TripForMatching,
    MatchConfigPresets,
    buildBlocksBidirectional,
    buildBlocks
} from './blockAssignmentCore';

// ============ CONSTANTS ============

const DEFAULT_GTFS_URL = 'https://www.myridebarrie.ca/gtfs/google_transit.zip';
const GTFS_PROXY_API = '/api/gtfs'; // Vercel serverless function

// ============ FETCH & PARSE ============

/**
 * Fetch GTFS feed via proxy API
 * The proxy handles:
 * - Fetching the ZIP file
 * - Extracting and parsing CSV files
 * - Returning structured JSON
 */
export async function fetchGTFSFeed(
    feedUrl: string = DEFAULT_GTFS_URL
): Promise<ParsedGTFSFeed> {
    const response = await fetch(`${GTFS_PROXY_API}?url=${encodeURIComponent(feedUrl)}`);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to fetch GTFS feed: ${error}`);
    }

    return response.json();
}

/**
 * Parse pre-loaded GTFS JSON (for testing or offline use)
 */
export function parseGTFSJson(json: unknown): ParsedGTFSFeed {
    const feed = json as ParsedGTFSFeed;

    // Basic validation
    if (!feed.routes || !Array.isArray(feed.routes)) {
        throw new Error('Invalid GTFS data: missing routes');
    }
    if (!feed.trips || !Array.isArray(feed.trips)) {
        throw new Error('Invalid GTFS data: missing trips');
    }
    if (!feed.stopTimes || !Array.isArray(feed.stopTimes)) {
        throw new Error('Invalid GTFS data: missing stop_times');
    }

    return feed;
}

// ============ ROUTE LISTING ============

/**
 * Get available routes from GTFS feed, grouped by day type.
 * Merges A/B direction routes (2A+2B, 7A+7B, 12A+12B) into single options.
 */
export function getAvailableRoutes(
    feed: ParsedGTFSFeed,
    config?: GTFSImportConfig
): GTFSRouteOption[] {
    const rawOptions: GTFSRouteOption[] = [];

    // Build lookup maps
    const calendarMap = new Map<string, GTFSCalendar>();
    feed.calendar.forEach(c => calendarMap.set(c.service_id, c));

    const routeMap = new Map<string, GTFSRoute>();
    feed.routes.forEach(r => routeMap.set(r.route_id, r));

    // Group trips by route + service
    const tripsByRouteService = new Map<string, GTFSTrip[]>();
    feed.trips.forEach(trip => {
        const key = `${trip.route_id}|${trip.service_id}`;
        if (!tripsByRouteService.has(key)) {
            tripsByRouteService.set(key, []);
        }
        tripsByRouteService.get(key)!.push(trip);
    });

    // Create raw route options
    tripsByRouteService.forEach((trips, key) => {
        const [routeId, serviceId] = key.split('|');
        const route = routeMap.get(routeId);
        const calendar = calendarMap.get(serviceId);

        if (!route || !calendar) return;

        const dayType = getDayType(calendar);
        if (!dayType) return; // Skip mixed schedules

        // Determine direction from first trip
        const firstTrip = trips[0];
        const direction = mapDirection(firstTrip.direction_id, routeId, config);

        rawOptions.push({
            routeId,
            routeShortName: route.route_short_name,
            routeLongName: route.route_long_name,
            dayType,
            serviceId,
            tripCount: trips.length,
            direction,
            color: route.route_color,
        });
    });

    // Merge A/B direction routes (2A+2B, 7A+7B, 12A+12B)
    const mergedOptions = mergeDirectionRoutes(rawOptions);

    // Sort by route number, then day type
    mergedOptions.sort((a, b) => {
        const routeCompare = a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true });
        if (routeCompare !== 0) return routeCompare;

        const dayOrder = { Weekday: 0, Saturday: 1, Sunday: 2 };
        return dayOrder[a.dayType] - dayOrder[b.dayType];
    });

    return mergedOptions;
}

/**
 * Merge A/B direction routes into single options.
 * Routes like 2A+2B become "Route 2" with A as North and B as South.
 * Routes like 8A, 8B remain separate (they are different route variants).
 */
function mergeDirectionRoutes(options: GTFSRouteOption[]): GTFSRouteOption[] {
    const result: GTFSRouteOption[] = [];
    const processed = new Set<string>();

    // Group by potential merge candidates: base route + day type
    const candidates = new Map<string, GTFSRouteOption[]>();

    for (const option of options) {
        const parsed = parseRouteInfo(option.routeShortName);

        if (parsed.suffixIsDirection) {
            // This is an A/B direction route (like 2A, 2B, 7A, 7B, 12A, 12B)
            const key = `${parsed.baseRoute}|${option.dayType}`;
            if (!candidates.has(key)) {
                candidates.set(key, []);
            }
            candidates.get(key)!.push(option);
        } else {
            // Not a direction variant (8A, 8B, 400, 10, etc.) - keep as-is
            result.push(option);
            processed.add(`${option.routeId}|${option.serviceId}`);
        }
    }

    // Process merge candidates
    for (const [key, group] of candidates) {
        const [baseRoute, dayType] = key.split('|');

        // Find A (North) and B (South) options
        const northOption = group.find(o => {
            const parsed = parseRouteInfo(o.routeShortName);
            return parsed.direction === 'North';
        });
        const southOption = group.find(o => {
            const parsed = parseRouteInfo(o.routeShortName);
            return parsed.direction === 'South';
        });

        if (northOption && southOption) {
            // Both directions found - create merged option
            const totalTrips = northOption.tripCount + southOption.tripCount;

            result.push({
                routeId: northOption.routeId, // Primary route ID (A variant)
                routeShortName: baseRoute,    // Base route number (e.g., "2")
                routeLongName: northOption.routeLongName,
                dayType: northOption.dayType,
                serviceId: northOption.serviceId,
                tripCount: totalTrips,
                direction: null, // Both directions included
                color: northOption.color,

                // Merged route fields
                isMergedRoute: true,
                northRouteId: northOption.routeId,
                northServiceId: northOption.serviceId,
                northTripCount: northOption.tripCount,
                southRouteId: southOption.routeId,
                southServiceId: southOption.serviceId,
                southTripCount: southOption.tripCount,
                displayName: `Route ${baseRoute} (${northOption.routeShortName} + ${southOption.routeShortName})`,
            });

            processed.add(`${northOption.routeId}|${northOption.serviceId}`);
            processed.add(`${southOption.routeId}|${southOption.serviceId}`);
        } else {
            // Only one direction found - add individually
            for (const option of group) {
                const optionKey = `${option.routeId}|${option.serviceId}`;
                if (!processed.has(optionKey)) {
                    result.push(option);
                    processed.add(optionKey);
                }
            }
        }
    }

    return result;
}

// ============ TRIP PROCESSING ============

/**
 * Default import options
 */
const DEFAULT_IMPORT_OPTIONS: GTFSImportOptions = {
    timepointsOnly: true,  // Default to timepoints only for scheduling
};

/**
 * Process trips for a specific route/service into structured format
 */
export function processTripsForRoute(
    feed: ParsedGTFSFeed,
    routeId: string,
    serviceId: string,
    config?: GTFSImportConfig,
    options: GTFSImportOptions = DEFAULT_IMPORT_OPTIONS
): ProcessedGTFSTrip[] {
    // Build lookup maps
    const stopMap = new Map<string, GTFSStop>();
    feed.stops.forEach(s => stopMap.set(s.stop_id, s));

    // Get trips for this route/service
    const routeTrips = feed.trips.filter(
        t => t.route_id === routeId && t.service_id === serviceId
    );

    // Group stop times by trip
    const stopTimesByTrip = new Map<string, GTFSStopTime[]>();
    feed.stopTimes.forEach(st => {
        if (!stopTimesByTrip.has(st.trip_id)) {
            stopTimesByTrip.set(st.trip_id, []);
        }
        stopTimesByTrip.get(st.trip_id)!.push(st);
    });

    // Process each trip
    const processed: ProcessedGTFSTrip[] = [];

    for (const trip of routeTrips) {
        let stopTimes = stopTimesByTrip.get(trip.trip_id) || [];
        if (stopTimes.length === 0) continue;

        // Sort by sequence
        stopTimes.sort((a, b) => a.stop_sequence - b.stop_sequence);

        // Build stop time records with timepoint info
        // GTFS spec: timepoint=1 means exact time (timepoint), timepoint=0 means approximate
        // If timepoint field is not set (undefined), traditionally treated as exact (timepoint)
        // First and last stops are always considered timepoints

        // First, check if any stops have timepoint=1 explicitly set
        const hasExplicitTimepoints = stopTimes.some(st => st.timepoint === 1);

        let processedStopTimes = stopTimes.map(st => {
            const stop = stopMap.get(st.stop_id);
            const isFirst = st.stop_sequence === stopTimes[0].stop_sequence;
            const isLast = st.stop_sequence === stopTimes[stopTimes.length - 1].stop_sequence;

            // Determine if this is a timepoint:
            // - First/last stops are always timepoints
            // - If explicit timepoints exist: timepoint=1 is a timepoint
            // - If NO explicit timepoints: timepoint !== 0 is a timepoint (includes undefined)
            let isTimepoint: boolean;
            if (isFirst || isLast) {
                isTimepoint = true;
            } else if (hasExplicitTimepoints) {
                isTimepoint = st.timepoint === 1;
            } else {
                // No explicit timepoints set - treat undefined as timepoint, 0 as not
                isTimepoint = st.timepoint !== 0;
            }

            return {
                stopId: st.stop_id,
                stopName: stop?.stop_name || st.stop_id,
                arrivalTime: st.arrival_time,
                departureTime: st.departure_time,
                arrivalMinutes: parseGtfsTime(st.arrival_time),
                departureMinutes: parseGtfsTime(st.departure_time),
                sequence: st.stop_sequence,
                isTimepoint,
            };
        });

        // Filter to timepoints only if requested
        if (options.timepointsOnly) {
            const timepointStops = processedStopTimes.filter(st => st.isTimepoint);
            // If filtering results in too few stops (< 2), keep all stops
            if (timepointStops.length >= 2) {
                processedStopTimes = timepointStops;
            } else {
                console.warn(`Route ${routeId}: Only ${timepointStops.length} timepoints found, keeping all ${processedStopTimes.length} stops`);
            }
        }

        // Skip trips with no stops after filtering
        if (processedStopTimes.length === 0) continue;

        const firstStop = processedStopTimes[0];
        const lastStop = processedStopTimes[processedStopTimes.length - 1];

        // Determine direction
        let direction: Direction | 'Loop' | null = mapDirection(
            trip.direction_id,
            routeId,
            config
        );

        // If no direction from GTFS, try to infer from terminus
        if (!direction) {
            const route = feed.routes.find(r => r.route_id === routeId);
            if (route) {
                direction = inferDirectionFromTerminus(
                    route.route_short_name,
                    firstStop.stopName,
                    lastStop.stopName
                );
            }
        }

        processed.push({
            tripId: trip.trip_id,
            routeId,
            serviceId,
            blockId: trip.block_id || null,
            direction,
            headsign: trip.trip_headsign || null,
            stopTimes: processedStopTimes,
            startTime: firstStop.departureMinutes,
            endTime: lastStop.arrivalMinutes,
            travelTime: lastStop.arrivalMinutes - firstStop.departureMinutes,
        });
    }

    // Sort by start time
    processed.sort((a, b) => a.startTime - b.startTime);

    // Calculate terminal recovery from consecutive trips in the same GTFS block
    // Terminal recovery = gap between this trip ending and next trip starting
    calculateTerminalRecovery(processed);

    return processed;
}

/**
 * Calculate terminal recovery for each trip by finding the next trip that starts
 * after this trip ends. For loop routes, this links trips done by the same bus.
 *
 * Example: If trip 10-3 ends at 7:30 AM and trip 10-5 starts at 7:40 AM,
 * the terminal recovery is 10 minutes, and 10-3's departure should be 7:40 AM.
 */
function calculateTerminalRecovery(trips: ProcessedGTFSTrip[]): void {
    if (trips.length < 2) return;

    // Sort trips by end time to find matches efficiently
    const tripsByEndTime = [...trips].sort((a, b) => a.endTime - b.endTime);
    // Also need trips sorted by start time to find the next departure
    const tripsByStartTime = [...trips].sort((a, b) => a.startTime - b.startTime);

    // For each trip, find the next trip that starts after this one ends
    // This represents the same bus doing its next loop
    for (const currentTrip of tripsByEndTime) {
        const currentEndTime = currentTrip.endTime;

        // Find the earliest trip that starts AFTER this trip ends
        // Allow a reasonable recovery window (1-20 minutes for transit)
        let bestMatch: ProcessedGTFSTrip | null = null;
        let bestGap = Infinity;

        for (const candidateTrip of tripsByStartTime) {
            // Skip if candidate starts before current ends
            if (candidateTrip.startTime <= currentEndTime) continue;

            const gap = candidateTrip.startTime - currentEndTime;

            // Terminal recovery should be reasonable (1-20 minutes typically)
            if (gap >= 1 && gap <= 20 && gap < bestGap) {
                bestMatch = candidateTrip;
                bestGap = gap;
            }

            // Once we're past 20 minutes, no point checking further
            if (gap > 20) break;
        }

        if (bestMatch) {
            // Set terminal recovery = gap to next trip
            const lastStopTime = currentTrip.stopTimes[currentTrip.stopTimes.length - 1];
            if (lastStopTime) {
                // Departure time = next trip's start time
                lastStopTime.departureMinutes = bestMatch.startTime;
            }
        }
    }
}

// ============ CONVERSION TO MASTER SCHEDULE ============

// NOTE: getOperationalSortTime and getBaseStopName are now imported from blockAssignmentCore.ts

/**
 * Apply block assignment logic to link trips together.
 *
 * Uses unified block assignment from blockAssignmentCore.ts.
 * Handles both standard routes and merged A/B routes (2A+2B, 7A+7B, 12A+12B).
 *
 * Generates user-friendly block IDs like "10-1", "10-2".
 */
function applyBlockAssignment(
    northTrips: MasterTrip[],
    southTrips: MasterTrip[],
    routeShortName: string,
    northStops: string[],
    southStops: string[]
): void {
    // Detect if this is a merged A/B route (e.g., 2A+2B where they meet at Downtown)
    const lastNorthStop = northStops[northStops.length - 1]?.toLowerCase() || '';
    const firstSouthStop = southStops[0]?.toLowerCase() || '';
    const isMergedRoute = northStops.length > 0 && southStops.length > 0 &&
        lastNorthStop === firstSouthStop;

    // Convert MasterTrips to TripForMatching
    const convertToMatching = (
        trip: MasterTrip,
        stops: string[],
        direction: 'North' | 'South'
    ): TripForMatching => ({
        id: trip.id,
        blockId: trip.blockId,
        tripNumber: trip.tripNumber,
        direction,
        startTime: trip.startTime,
        endTime: trip.endTime,
        firstStopName: stops[0] || '',
        lastStopName: stops[stops.length - 1] || '',
        recoveryTimes: trip.recoveryTimes
    });

    const northMatching = northTrips.map(t => convertToMatching(t, northStops, 'North'));
    const southMatching = southTrips.map(t => convertToMatching(t, southStops, 'South'));

    // Choose matching config based on route type
    const config = isMergedRoute ? MatchConfigPresets.merged : MatchConfigPresets.gtfs;

    // Build blocks using core module
    const blocks = isMergedRoute
        ? buildBlocksBidirectional(northMatching, southMatching, routeShortName, config)
        : buildBlocksBidirectional(northMatching, southMatching, routeShortName, config);

    // Apply block assignments back to MasterTrips
    const tripLookup = new Map<string, MasterTrip>();
    northTrips.forEach(t => tripLookup.set(t.id, t));
    southTrips.forEach(t => tripLookup.set(t.id, t));

    for (const block of blocks) {
        for (let i = 0; i < block.trips.length; i++) {
            const matchingTrip = block.trips[i];
            const masterTrip = tripLookup.get(matchingTrip.id);
            if (masterTrip) {
                masterTrip.blockId = matchingTrip.blockId;
                masterTrip.tripNumber = matchingTrip.tripNumber;
                masterTrip.isBlockStart = i === 0;
                masterTrip.isBlockEnd = i === block.trips.length - 1;

                // Calculate recovery if there's a next trip in block
                if (i < block.trips.length - 1) {
                    const nextTrip = block.trips[i + 1];
                    const gap = nextTrip.startTime - masterTrip.endTime;
                    if (gap > 0) {
                        const lastStopName = Object.keys(masterTrip.stops).pop();
                        if (lastStopName) {
                            if (!masterTrip.recoveryTimes) masterTrip.recoveryTimes = {};
                            masterTrip.recoveryTimes[lastStopName] = gap;
                            masterTrip.recoveryTime = Object.values(masterTrip.recoveryTimes)
                                .reduce((sum, r) => sum + r, 0);
                        }
                    }
                }
            }
        }
    }
}

/**
 * Generate unique stop names for a trip.
 * For loop routes where first and last stop have the same name,
 * the last stop gets a "(2)" suffix to avoid key collision.
 */
function generateUniqueStopNames(stopTimes: ProcessedGTFSTrip['stopTimes']): string[] {
    const usedNames = new Set<string>();
    return stopTimes.map((st, idx) => {
        let name = st.stopName;
        // If this name was already used, add a suffix
        if (usedNames.has(name)) {
            // Find the next available suffix
            let suffix = 2;
            while (usedNames.has(`${st.stopName} (${suffix})`)) {
                suffix++;
            }
            name = `${st.stopName} (${suffix})`;
        }
        usedNames.add(name);
        return name;
    });
}

/**
 * Convert processed GTFS trips to MasterScheduleContent
 */
export function convertToMasterSchedule(
    trips: ProcessedGTFSTrip[],
    routeShortName: string,
    dayType: DayType
): MasterScheduleContent {
    // Separate by direction
    const northTrips = trips.filter(t => t.direction === 'North');
    const southTrips = trips.filter(t => t.direction === 'South');
    const loopTrips = trips.filter(t => t.direction === 'Loop' || !t.direction);

    // For loop routes, put all in north table
    const effectiveNorthTrips = northTrips.length > 0 ? northTrips : loopTrips;
    const effectiveSouthTrips = southTrips;

    // Generate unique stop names for each direction
    // Use trip with MOST stops as canonical (first trip might be a partial trip missing stops)
    const northCanonicalTrip = effectiveNorthTrips.length > 0
        ? effectiveNorthTrips.reduce((best, trip) =>
            trip.stopTimes.length > best.stopTimes.length ? trip : best
        )
        : null;
    const southCanonicalTrip = effectiveSouthTrips.length > 0
        ? effectiveSouthTrips.reduce((best, trip) =>
            trip.stopTimes.length > best.stopTimes.length ? trip : best
        )
        : null;

    const northUniqueStopNames = northCanonicalTrip
        ? generateUniqueStopNames(northCanonicalTrip.stopTimes)
        : [];
    const southUniqueStopNames = southCanonicalTrip
        ? generateUniqueStopNames(southCanonicalTrip.stopTimes)
        : [];

    // Extract stop order using unique names
    const northStops = northUniqueStopNames;
    const southStops = southUniqueStopNames;

    // Build stop ID maps using canonical trips
    const northStopIds: Record<string, string> = {};
    const southStopIds: Record<string, string> = {};

    if (northCanonicalTrip) {
        northCanonicalTrip.stopTimes.forEach((st, idx) => {
            northStopIds[northUniqueStopNames[idx]] = st.stopId;
        });
    }
    if (southCanonicalTrip) {
        southCanonicalTrip.stopTimes.forEach((st, idx) => {
            southStopIds[southUniqueStopNames[idx]] = st.stopId;
        });
    }

    // Build stop name lookup map for name-based matching
    // Maps actual stop name -> unique stop name (handles duplicates like "Park Place (2)")
    const buildStopNameMap = (uniqueNames: string[]): Map<string, string> => {
        const map = new Map<string, string>();
        uniqueNames.forEach(name => {
            // Extract base name (without "(2)" suffix if present)
            const baseName = name.replace(/\s*\(\d+\)$/, '');
            // Store both the full unique name and base name mappings
            map.set(name, name);
            if (!map.has(baseName)) {
                map.set(baseName, name);
            }
        });
        return map;
    };

    const northStopNameMap = buildStopNameMap(northUniqueStopNames);
    const southStopNameMap = buildStopNameMap(southUniqueStopNames);

    // Convert to MasterTrips with temporary IDs (will be reassigned by block assignment)
    const convertToMasterTrip = (
        trip: ProcessedGTFSTrip,
        index: number,
        direction: Direction,
        uniqueStopNames: string[],
        stopNameMap: Map<string, string>
    ): MasterTrip => {
        const stops: Record<string, string> = {};
        const arrivalTimes: Record<string, string> = {};
        const recoveryTimes: Record<string, number> = {};

        // Use name-based lookup instead of index-based
        // This handles trips with different stop counts correctly
        trip.stopTimes.forEach((st) => {
            // Look up the unique stop name for this actual stop name
            const stopName = stopNameMap.get(st.stopName);
            if (!stopName) {
                console.warn(`Stop "${st.stopName}" not found in stop name map, skipping`);
                return;
            }

            // NOTE: RoundTripTableView expects `stops` to contain ARRIVAL times
            // It then adds recoveryTimes to calculate departure times for display
            // So we store arrival in `stops`, not departure

            // Arrival time (when bus arrives at this stop) - stored in `stops`
            stops[stopName] = formatTime(st.arrivalMinutes);

            // Also store in arrivalTimes for backward compatibility
            arrivalTimes[stopName] = formatTime(st.arrivalMinutes);

            // Recovery time at this stop (difference between departure and arrival)
            const stopRecovery = st.departureMinutes - st.arrivalMinutes;
            if (stopRecovery > 0) {
                recoveryTimes[stopName] = stopRecovery;
            }
        });

        // Ensure the last stop has a recovery entry so UI shows ARR | R | DEP columns
        // In GTFS, last stop often has arrival = departure (no explicit recovery)
        // We default to 0 which allows manual editing later
        const lastStopName = uniqueStopNames[uniqueStopNames.length - 1];
        const lastStop = trip.stopTimes[trip.stopTimes.length - 1];
        const terminalRecovery = lastStop.departureMinutes - lastStop.arrivalMinutes;

        // Always set recovery for last stop (even if 0) so UI shows ARR | R | DEP
        if (!recoveryTimes[lastStopName]) {
            recoveryTimes[lastStopName] = terminalRecovery >= 0 ? terminalRecovery : 0;
        }

        // Total recovery time
        const totalRecovery = Object.values(recoveryTimes).reduce((sum, r) => sum + r, 0);
        const firstDeparture = trip.stopTimes[0]?.departureMinutes ?? trip.startTime;
        const lastDeparture = lastStop.departureMinutes;
        const rawCycle = ((lastDeparture - firstDeparture) + 1440) % 1440;
        const cycleTime = rawCycle > 0 ? rawCycle : trip.travelTime + totalRecovery;

        return {
            id: `${routeShortName}-${direction[0]}-${index + 1}`,
            // Temporary block ID - will be reassigned by applyBlockAssignment
            blockId: `${routeShortName}-temp-${index + 1}`,
            direction,
            // Temporary trip number - will be reassigned by applyBlockAssignment
            tripNumber: index + 1,
            rowId: index,
            startTime: trip.startTime,
            endTime: trip.endTime,
            recoveryTime: totalRecovery,
            recoveryTimes: Object.keys(recoveryTimes).length > 0 ? recoveryTimes : undefined,
            travelTime: trip.travelTime,
            cycleTime,
            stops,
            arrivalTimes: Object.keys(arrivalTimes).length > 0 ? arrivalTimes : undefined,
        };
    };

    const northMasterTrips = effectiveNorthTrips.map((t, i) =>
        convertToMasterTrip(t, i, 'North', northUniqueStopNames, northStopNameMap)
    );
    const southMasterTrips = effectiveSouthTrips.map((t, i) =>
        convertToMasterTrip(t, i, 'South', southUniqueStopNames, southStopNameMap)
    );

    // Apply block assignment to generate user-friendly block IDs
    // Uses same logic as blockAssignment.ts: time + location matching
    applyBlockAssignment(northMasterTrips, southMasterTrips, routeShortName, northStops, southStops);

    // Build route tables
    const directionLabel = northTrips.length > 0 || southTrips.length > 0
        ? '' // Linear route
        : ' (Loop)';

    const northTable: MasterRouteTable = {
        routeName: `${routeShortName}${directionLabel} (${dayType}) (North)`,
        stops: northStops,
        stopIds: northStopIds,
        trips: northMasterTrips,
    };

    const southTable: MasterRouteTable = {
        routeName: `${routeShortName}${directionLabel} (${dayType}) (South)`,
        stops: southStops,
        stopIds: southStopIds,
        trips: southMasterTrips,
    };

    return {
        northTable,
        southTable,
        metadata: {
            routeNumber: routeShortName,
            dayType,
            uploadedAt: new Date().toISOString(),
            notes: `Imported from GTFS feed`,
        },
    };
}

// ============ IMPORT WORKFLOW ============

/**
 * Import a route from GTFS feed and create a draft.
 * Handles both regular routes and merged A/B direction routes.
 */
export async function importRouteFromGTFS(
    feed: ParsedGTFSFeed,
    routeOption: GTFSRouteOption,
    userId: string,
    draftName?: string,
    config?: GTFSImportConfig,
    options: GTFSImportOptions = { timepointsOnly: true }
): Promise<GTFSImportResult> {
    console.log('🚌 importRouteFromGTFS started', { routeOption, userId, options });
    try {
        let content: MasterScheduleContent;
        let totalTripCount: number;

        if (routeOption.isMergedRoute) {
            // Handle merged A/B direction routes (2A+2B, 7A+7B, 12A+12B)
            console.log('📊 Processing MERGED route...', routeOption.displayName);

            // Process North (A) trips
            const northTrips = processTripsForRoute(
                feed,
                routeOption.northRouteId!,
                routeOption.northServiceId!,
                config,
                options
            );
            // Force direction to North for A trips
            northTrips.forEach(t => { t.direction = 'North'; });
            console.log(`📊 Processed ${northTrips.length} North trips from ${routeOption.northRouteId}`);

            // Process South (B) trips
            const southTrips = processTripsForRoute(
                feed,
                routeOption.southRouteId!,
                routeOption.southServiceId!,
                config,
                options
            );
            // Force direction to South for B trips
            southTrips.forEach(t => { t.direction = 'South'; });
            console.log(`📊 Processed ${southTrips.length} South trips from ${routeOption.southRouteId}`);

            // Combine trips
            const allTrips = [...northTrips, ...southTrips];
            totalTripCount = allTrips.length;

            if (allTrips.length === 0) {
                return {
                    success: false,
                    error: `No trips found for merged route ${routeOption.displayName}`,
                };
            }

            // Convert to master schedule format
            console.log('🔄 Converting merged trips to master schedule format...');
            content = convertToMasterSchedule(
                allTrips,
                routeOption.routeShortName,
                routeOption.dayType
            );
            console.log('🔄 Conversion complete', {
                northTrips: content.northTable.trips.length,
                southTrips: content.southTable.trips.length
            });
        } else {
            // Handle regular (non-merged) routes
            console.log('📊 Processing trips...', options.timepointsOnly ? '(timepoints only)' : '(all stops)');
            const trips = processTripsForRoute(
                feed,
                routeOption.routeId,
                routeOption.serviceId,
                config,
                options
            );
            totalTripCount = trips.length;
            console.log(`📊 Processed ${trips.length} trips`);

            if (trips.length === 0) {
                return {
                    success: false,
                    error: `No trips found for route ${routeOption.routeShortName} (${routeOption.dayType})`,
                };
            }

            // Convert to master schedule format
            console.log('🔄 Converting to master schedule format...');
            content = convertToMasterSchedule(
                trips,
                routeOption.routeShortName,
                routeOption.dayType
            );
            console.log('🔄 Conversion complete', {
                northTrips: content.northTable.trips.length,
                southTrips: content.southTable.trips.length
            });
        }

        // Count trips by direction
        const northCount = content.northTable.trips.length;
        const southCount = content.southTable.trips.length;

        // Create draft
        const defaultName = routeOption.isMergedRoute
            ? `Route ${routeOption.routeShortName} - GTFS Import ${new Date().toLocaleDateString()}`
            : `Route ${routeOption.routeShortName} - GTFS Import ${new Date().toLocaleDateString()}`;

        const draftInput: DraftScheduleInput = {
            name: draftName || defaultName,
            routeNumber: routeOption.routeShortName,
            dayType: routeOption.dayType,
            content,
            status: 'draft',
            createdBy: userId,
            basedOn: {
                type: 'gtfs',
                importedAt: new Date(),
            },
        };

        console.log('💾 Saving draft to Firebase...', { userId, name: draftInput.name });
        const draftId = await saveDraft(userId, draftInput);
        console.log('✅ Draft saved with ID:', draftId);

        return {
            success: true,
            routeIdentity: `${routeOption.routeShortName}-${routeOption.dayType}`,
            draftId,
            tripCount: totalTripCount,
            northTripCount: northCount,
            southTripCount: southCount,
            warnings: northCount === 0 || southCount === 0
                ? [`Only ${northCount > 0 ? 'North' : 'South'} direction trips found`]
                : undefined,
        };
    } catch (error) {
        console.error('❌ importRouteFromGTFS error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during import',
        };
    }
}

// ============ CONFIG MANAGEMENT ============

/**
 * Get default GTFS config
 */
export function getDefaultGTFSConfig(): GTFSImportConfig {
    return {
        feedUrl: DEFAULT_GTFS_URL,
    };
}

/**
 * Update cached routes in config
 */
export function updateCachedRoutes(
    config: GTFSImportConfig,
    feed: ParsedGTFSFeed,
    userId: string
): GTFSImportConfig {
    const routes = getAvailableRoutes(feed, config);

    return {
        ...config,
        lastFetched: new Date().toISOString(),
        lastFetchedBy: userId,
        cachedRoutes: routes,
    };
}

// ============ EXPORTS ============

export {
    DEFAULT_GTFS_URL,
    GTFS_PROXY_API,
};
