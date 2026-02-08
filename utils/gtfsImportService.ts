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
import { TimeUtils } from './timeUtils';
import { saveDraft } from './draftService';
import { saveSystemDraft, generateSystemDraftName } from './systemDraftService';
import type { DraftScheduleInput, SystemDraftInput, SystemDraftRoute } from './scheduleTypes';
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

        // Determine direction from first trip (using headsign for better accuracy)
        const firstTrip = trips[0];
        const direction = mapDirection(
            firstTrip.direction_id,
            routeId,
            config,
            firstTrip.trip_headsign,
            route.route_short_name
        );

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

        // Determine direction (using headsign for better accuracy)
        const route = feed.routes.find(r => r.route_id === routeId);
        let direction: Direction | 'Loop' | null = mapDirection(
            trip.direction_id,
            routeId,
            config,
            trip.trip_headsign,
            route?.route_short_name
        );

        // If no direction from GTFS, try to infer from terminus
        if (!direction && route) {
            direction = inferDirectionFromTerminus(
                route.route_short_name,
                firstStop.stopName,
                lastStop.stopName
            );
        }

        processed.push({
            tripId: trip.trip_id,
            routeId,
            serviceId,
            blockId: trip.block_id || null,
            direction,
            headsign: trip.trip_headsign || null,
            shapeId: trip.shape_id || null,
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
        const lastStopId = currentTrip.stopTimes[currentTrip.stopTimes.length - 1]?.stopId;

        // Find the earliest trip that starts AFTER this trip ends at the SAME stop.
        // The stop match ensures we only link trips by the same bus doing another loop
        // (e.g., Route 10 looping at Downtown Terminal), not unrelated trips that
        // happen to be nearby in time (e.g., 8A ending at Allandale vs 8A starting at RVH).
        let bestMatch: ProcessedGTFSTrip | null = null;
        let bestGap = Infinity;

        for (const candidateTrip of tripsByStartTime) {
            // Skip if candidate starts before current ends
            if (candidateTrip.startTime <= currentEndTime) continue;

            const gap = candidateTrip.startTime - currentEndTime;

            // Once we're past 20 minutes, no point checking further
            if (gap > 20) break;

            // Only match if the candidate starts at the same stop where current ends
            const firstStopId = candidateTrip.stopTimes[0]?.stopId;
            if (firstStopId !== lastStopId) continue;

            // Terminal recovery should be reasonable (1-20 minutes typically)
            if (gap >= 1 && gap < bestGap) {
                bestMatch = candidateTrip;
                bestGap = gap;
            }
        }

        if (bestMatch) {
            // Set terminal recovery = gap to next trip, but only if the GTFS
            // doesn't already encode a recovery (arrival != departure).
            // Overwriting GTFS-provided recovery with a cross-trip gap can
            // produce incorrect values (e.g., matching unrelated 8A/8B trips).
            const lastStopTime = currentTrip.stopTimes[currentTrip.stopTimes.length - 1];
            if (lastStopTime && lastStopTime.departureMinutes === lastStopTime.arrivalMinutes) {
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
    const allMasterTrips = [...northTrips, ...southTrips];

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
    const allMatching = [...northMatching, ...southMatching];

    // Prefer GTFS-provided block continuity when available.
    // This is especially important for loop routes and routes with long or uneven layovers.
    const gtfsBlockTrips = allMasterTrips.filter(t => !!t.gtfsBlockId && t.gtfsBlockId.trim() !== '');
    const canUseGtfsBlocks = allMasterTrips.length > 0 &&
        gtfsBlockTrips.length >= Math.max(2, Math.ceil(allMasterTrips.length * 0.7));

    let blocks;
    if (canUseGtfsBlocks) {
        const tripsByGtfsBlock = new Map<string, MasterTrip[]>();
        for (const trip of gtfsBlockTrips) {
            const gtfsBlockId = trip.gtfsBlockId!.trim();
            if (!tripsByGtfsBlock.has(gtfsBlockId)) tripsByGtfsBlock.set(gtfsBlockId, []);
            tripsByGtfsBlock.get(gtfsBlockId)!.push(trip);
        }

        const orderedGtfsBlocks = Array.from(tripsByGtfsBlock.entries()).sort(([, aTrips], [, bTrips]) => {
            const aStart = Math.min(...aTrips.map(t => getOperationalSortTime(t.startTime)));
            const bStart = Math.min(...bTrips.map(t => getOperationalSortTime(t.startTime)));
            if (aStart !== bStart) return aStart - bStart;
            return (aTrips[0]?.gtfsBlockId || '').localeCompare(bTrips[0]?.gtfsBlockId || '', undefined, { numeric: true });
        });

        blocks = orderedGtfsBlocks.map(([_, blockTrips], idx) => {
            const blockId = `${routeShortName}-${idx + 1}`;
            const orderedTrips = [...blockTrips].sort((a, b) => {
                const aStart = getOperationalSortTime(a.startTime);
                const bStart = getOperationalSortTime(b.startTime);
                if (aStart !== bStart) return aStart - bStart;
                return a.endTime - b.endTime;
            });

            const matchingTrips = orderedTrips.map((t, tripIdx): TripForMatching => ({
                id: t.id,
                blockId,
                tripNumber: tripIdx + 1,
                direction: t.direction,
                startTime: t.startTime,
                endTime: t.endTime,
                firstStopName: '',
                lastStopName: '',
                recoveryTimes: t.recoveryTimes
            }));

            return {
                blockId,
                trips: matchingTrips,
                startTime: orderedTrips[0]?.startTime ?? 0,
                endTime: orderedTrips[orderedTrips.length - 1]?.endTime ?? 0
            };
        });
    } else {
        // Choose matching config based on route type
        const config = isMergedRoute ? MatchConfigPresets.merged : MatchConfigPresets.gtfs;

        // Build blocks using core module
        blocks = isMergedRoute
            ? buildBlocksBidirectional(northMatching, southMatching, routeShortName, config)
            : buildBlocks(allMatching, routeShortName, config);
    }

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
                // Cap at 20 min to match calculateTerminalRecovery — large gaps
                // (e.g., 8A→8B block transitions) are layovers, not recovery
                if (i < block.trips.length - 1) {
                    const nextTrip = block.trips[i + 1];
                    const gap = nextTrip.startTime - masterTrip.endTime;
                    if (gap > 0 && gap <= 20) {
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
 * Merge stop lists from multiple partial trips into a complete stop list.
 * This handles cases like Sunday schedules where some trips go A→B and others go B→C,
 * and we need the full A→B→C stop list.
 *
 * Algorithm:
 * 1. Build a graph of stop connections (which stop follows which)
 * 2. Find the starting stop (one that's never preceded by another)
 * 3. Walk the graph to build the complete ordered stop list
 */
function mergeStopListsFromTrips(trips: ProcessedGTFSTrip[]): ProcessedGTFSTrip['stopTimes'] {
    if (trips.length === 0) return [];
    if (trips.length === 1) return trips[0].stopTimes;

    // Build a map of stop connections: stopId -> next stopId
    // Also track which stops exist and their stop info
    const stopInfoMap = new Map<string, ProcessedGTFSTrip['stopTimes'][0]>();
    const nextStopMap = new Map<string, string>(); // stopId -> next stopId
    const prevStopSet = new Set<string>(); // stops that have a predecessor

    // Sort trips by number of stops (descending) so the most complete trip pattern
    // sets adjacency edges first. This prevents shorter trips (that skip stops) from
    // creating edges that orphan stops only present in longer trip variants.
    const sortedTrips = [...trips].sort((a, b) => b.stopTimes.length - a.stopTimes.length);

    for (const trip of sortedTrips) {
        for (let i = 0; i < trip.stopTimes.length; i++) {
            const st = trip.stopTimes[i];
            // Store stop info (prefer earlier occurrence for timing)
            if (!stopInfoMap.has(st.stopId)) {
                stopInfoMap.set(st.stopId, st);
            }

            // Record the connection to next stop
            if (i < trip.stopTimes.length - 1) {
                const nextSt = trip.stopTimes[i + 1];
                // Only set if not already set (preserve first occurrence)
                if (!nextStopMap.has(st.stopId)) {
                    nextStopMap.set(st.stopId, nextSt.stopId);
                }
                prevStopSet.add(nextSt.stopId);
            }
        }
    }

    // Find starting stops (stops that are never a "next" stop)
    const startingStops: string[] = [];
    for (const stopId of stopInfoMap.keys()) {
        if (!prevStopSet.has(stopId)) {
            startingStops.push(stopId);
        }
    }

    // If no clear starting stop, fall back to the trip with earliest operational start time
    // (midnight-4AM trips are late-night, not early morning)
    if (startingStops.length === 0) {
        const earliestTrip = trips.reduce((best, trip) =>
            getOperationalSortTime(trip.startTime) < getOperationalSortTime(best.startTime) ? trip : best
        );
        return earliestTrip.stopTimes;
    }

    // Walk from starting stop(s) to build complete list
    // If multiple starting stops, pick the one from the trip with earliest operational time
    let startStopId = startingStops[0];
    if (startingStops.length > 1) {
        // Find which starting stop appears in the earliest trip
        // (midnight-4AM trips are late-night, not early morning)
        const earliestTrip = trips.reduce((best, trip) =>
            getOperationalSortTime(trip.startTime) < getOperationalSortTime(best.startTime) ? trip : best
        );
        const earliestStart = earliestTrip.stopTimes[0]?.stopId;
        if (earliestStart && startingStops.includes(earliestStart)) {
            startStopId = earliestStart;
        }
    }

    // Build the merged stop list by walking the graph
    const mergedStops: ProcessedGTFSTrip['stopTimes'] = [];
    const visited = new Set<string>();
    let currentStopId: string | undefined = startStopId;

    while (currentStopId && !visited.has(currentStopId)) {
        visited.add(currentStopId);
        const stopInfo = stopInfoMap.get(currentStopId);
        if (stopInfo) {
            mergedStops.push(stopInfo);
        }
        currentStopId = nextStopMap.get(currentStopId);
    }

    // If we didn't get all stops, there might be disconnected segments
    // Fall back to adding any missing stops at the end
    for (const [stopId, stopInfo] of stopInfoMap) {
        if (!visited.has(stopId)) {
            mergedStops.push(stopInfo);
        }
    }

    return mergedStops;
}

/**
 * Split "Loop" trips into North and South based on terminus detection.
 *
 * Logic:
 * - Find the terminus (Downtown, Terminal, etc.) by looking at stop names
 * - Trips ending at terminus = North (going TO downtown)
 * - Trips starting at terminus = South (going FROM downtown)
 */
function splitLoopTripsByTerminus(
    loopTrips: ProcessedGTFSTrip[],
    terminusKeywords: string[]
): { north: ProcessedGTFSTrip[]; south: ProcessedGTFSTrip[] } {
    const north: ProcessedGTFSTrip[] = [];
    const south: ProcessedGTFSTrip[] = [];

    // Helper to check if a stop name matches terminus keywords
    const isTerminus = (stopName: string): boolean => {
        const normalized = stopName.toLowerCase();
        return terminusKeywords.some(kw => normalized.includes(kw));
    };

    for (const trip of loopTrips) {
        if (trip.stopTimes.length === 0) continue;

        const firstStop = trip.stopTimes[0].stopName;
        const lastStop = trip.stopTimes[trip.stopTimes.length - 1].stopName;

        const startsAtTerminus = isTerminus(firstStop);
        const endsAtTerminus = isTerminus(lastStop);

        if (endsAtTerminus && !startsAtTerminus) {
            // Going TO terminus = North direction
            north.push({ ...trip, direction: 'North' });
        } else if (startsAtTerminus && !endsAtTerminus) {
            // Coming FROM terminus = South direction
            south.push({ ...trip, direction: 'South' });
        } else if (startsAtTerminus && endsAtTerminus) {
            // Starts and ends at terminus - check middle stops to determine direction
            // Or use time-based heuristic: earlier trips tend to be first direction
            // For now, alternate based on departure time
            const departureHour = Math.floor(trip.stopTimes[0].departureMinutes / 60);
            // Morning trips going TO downtown (North), return trips FROM downtown (South)
            // This is a simplification - may need refinement
            if (north.length <= south.length) {
                north.push({ ...trip, direction: 'North' });
            } else {
                south.push({ ...trip, direction: 'South' });
            }
        } else {
            // Neither start nor end at terminus - try to find terminus in middle
            const hasTerminusInMiddle = trip.stopTimes.slice(1, -1).some(st => isTerminus(st.stopName));
            if (hasTerminusInMiddle) {
                // This is likely a full round-trip in one trip record
                // Split it into two trips at the terminus
                const terminusIdx = trip.stopTimes.findIndex((st, idx) =>
                    idx > 0 && idx < trip.stopTimes.length - 1 && isTerminus(st.stopName)
                );

                if (terminusIdx > 0) {
                    // First half: origin → terminus = North
                    const northStops = trip.stopTimes.slice(0, terminusIdx + 1);
                    north.push({
                        ...trip,
                        direction: 'North',
                        stopTimes: northStops
                    });

                    // Second half: terminus → origin = South
                    const southStops = trip.stopTimes.slice(terminusIdx);
                    south.push({
                        ...trip,
                        direction: 'South',
                        stopTimes: southStops
                    });
                } else {
                    // Fallback: put in north
                    north.push({ ...trip, direction: 'North' });
                }
            } else {
                // No terminus found - use heuristic based on count balance
                if (north.length <= south.length) {
                    north.push({ ...trip, direction: 'North' });
                } else {
                    south.push({ ...trip, direction: 'South' });
                }
            }
        }
    }

    return { north, south };
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

    // Determine effective trips for each direction
    let effectiveNorthTrips: ProcessedGTFSTrip[];
    let effectiveSouthTrips: ProcessedGTFSTrip[];

    if (northTrips.length > 0 || southTrips.length > 0) {
        // Normal case: we have explicit direction data
        effectiveNorthTrips = northTrips;
        effectiveSouthTrips = southTrips;
    } else if (loopTrips.length > 0) {
        // All trips are "Loop" - need to intelligently split them
        // Detect terminus keywords to determine direction
        const terminusKeywords = ['downtown', 'terminal', 'hub', 'allandale', 'georgian'];

        const splitLoopTrips = splitLoopTripsByTerminus(loopTrips, terminusKeywords);
        effectiveNorthTrips = splitLoopTrips.north;
        effectiveSouthTrips = splitLoopTrips.south;

        console.log(`[GTFS Import] Split ${loopTrips.length} loop trips: ${effectiveNorthTrips.length} North, ${effectiveSouthTrips.length} South`);
    } else {
        effectiveNorthTrips = [];
        effectiveSouthTrips = [];
    }

    // Generate unique stop names for each direction
    // Merge stops from ALL trips to handle partial trips (e.g., Sunday schedules
    // where some trips go A→B and others go B→C, we need full A→B→C)
    const northMergedStopTimes = mergeStopListsFromTrips(effectiveNorthTrips);
    const southMergedStopTimes = mergeStopListsFromTrips(effectiveSouthTrips);

    const northUniqueStopNames = generateUniqueStopNames(northMergedStopTimes);
    const southUniqueStopNames = generateUniqueStopNames(southMergedStopTimes);

    // Extract stop order using unique names
    const northStops = northUniqueStopNames;
    const southStops = southUniqueStopNames;

    // Build stop ID maps using merged stop times
    const northStopIds: Record<string, string> = {};
    const southStopIds: Record<string, string> = {};

    northMergedStopTimes.forEach((st, idx) => {
        northStopIds[northUniqueStopNames[idx]] = st.stopId;
    });
    southMergedStopTimes.forEach((st, idx) => {
        southStopIds[southUniqueStopNames[idx]] = st.stopId;
    });

    // Build stop name lookup that tracks occurrences for loop routes
    // For trips where same stop appears multiple times (e.g., loop routes),
    // we need to map the Nth occurrence to the Nth unique name
    const buildStopOccurrenceMap = (uniqueNames: string[]): Map<string, string[]> => {
        const map = new Map<string, string[]>();
        uniqueNames.forEach(name => {
            const baseName = name.replace(/\s*\(\d+\)$/, '');
            if (!map.has(baseName)) {
                map.set(baseName, []);
            }
            map.get(baseName)!.push(name);
        });
        return map;
    };

    const northStopOccurrenceMap = buildStopOccurrenceMap(northUniqueStopNames);
    const southStopOccurrenceMap = buildStopOccurrenceMap(southUniqueStopNames);

    /** Derive a pattern label from a trip's first and last stop names */
    const derivePatternLabel = (trip: ProcessedGTFSTrip): string => {
        if (trip.stopTimes.length < 2) return '-';
        const first = trip.stopTimes[0].stopName;
        const last = trip.stopTimes[trip.stopTimes.length - 1].stopName;
        return `${first} → ${last}`;
    };

    // Convert to MasterTrips with temporary IDs (will be reassigned by block assignment)
    const convertToMasterTrip = (
        trip: ProcessedGTFSTrip,
        index: number,
        direction: Direction,
        uniqueStopNames: string[],
        stopOccurrenceMap: Map<string, string[]>
    ): MasterTrip => {
        const stops: Record<string, string> = {};
        const arrivalTimes: Record<string, string> = {};
        const recoveryTimes: Record<string, number> = {};

        // Track how many times we've seen each stop name in this trip
        // For loop routes, the Nth occurrence maps to the Nth unique name
        const occurrenceCount = new Map<string, number>();

        trip.stopTimes.forEach((st) => {
            // Get current occurrence count for this stop name
            const count = occurrenceCount.get(st.stopName) || 0;
            occurrenceCount.set(st.stopName, count + 1);

            // Look up the unique stop names for this base name
            const uniqueNames = stopOccurrenceMap.get(st.stopName);
            if (!uniqueNames || uniqueNames.length === 0) {
                console.warn(`Stop "${st.stopName}" not found in stop occurrence map, skipping`);
                return;
            }

            // Use the Nth unique name for the Nth occurrence (0-indexed)
            const stopName = uniqueNames[Math.min(count, uniqueNames.length - 1)];

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
            travelTime: Math.max(0, cycleTime - totalRecovery),
            cycleTime,
            stops,
            arrivalTimes: Object.keys(arrivalTimes).length > 0 ? arrivalTimes : undefined,
            // Preserve original GTFS block ID for linking trips on same physical bus
            gtfsBlockId: trip.blockId || undefined,
            // GTFS shape/pattern identification
            shapeId: trip.shapeId || undefined,
            patternLabel: derivePatternLabel(trip),
        };
    };

    const northMasterTrips = effectiveNorthTrips.map((t, i) =>
        convertToMasterTrip(t, i, 'North', northUniqueStopNames, northStopOccurrenceMap)
    );
    const southMasterTrips = effectiveSouthTrips.map((t, i) =>
        convertToMasterTrip(t, i, 'South', southUniqueStopNames, southStopOccurrenceMap)
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

// ============ CROSS-ROUTE INTERLINE RECOVERY ============

/**
 * Apply interline recovery times across routes using GTFS block continuity.
 *
 * When a bus interlines between routes (e.g., 8A arrives at Allandale, recovers
 * 5 min, then departs as 8B), the recovery gap spans two separate routes.
 * Per-route import can't see this — the 8A trip ends with 0 recovery and the
 * 8B trip starts with no preceding arrival.
 *
 * This function runs after all routes are imported and uses gtfsBlockId to find
 * trips that are consecutive on the same physical bus across different routes,
 * then sets the terminal recovery on the earlier trip.
 */
function applyInterlineRecovery(systemRoutes: SystemDraftRoute[]): number {
    // Collect all MasterTrips across all routes, tagged with their route number
    const allTrips: { trip: MasterTrip; routeNumber: string }[] = [];
    for (const route of systemRoutes) {
        for (const trip of route.northTable.trips) {
            allTrips.push({ trip, routeNumber: route.routeNumber });
        }
        for (const trip of route.southTable.trips) {
            allTrips.push({ trip, routeNumber: route.routeNumber });
        }
    }

    // Group by GTFS block ID
    const blockMap = new Map<string, { trip: MasterTrip; routeNumber: string }[]>();
    for (const entry of allTrips) {
        const blockId = entry.trip.gtfsBlockId?.trim();
        if (!blockId) continue;
        if (!blockMap.has(blockId)) blockMap.set(blockId, []);
        blockMap.get(blockId)!.push(entry);
    }

    let fixCount = 0;

    for (const [, blockTrips] of blockMap) {
        // Only care about blocks with trips from multiple routes
        const routeNumbers = new Set(blockTrips.map(e => e.routeNumber));
        if (routeNumbers.size < 2) continue;

        // Sort by start time (operational sort for post-midnight)
        blockTrips.sort((a, b) =>
            getOperationalSortTime(a.trip.startTime) - getOperationalSortTime(b.trip.startTime)
        );

        // For each consecutive pair of trips from DIFFERENT routes,
        // check if the earlier trip has 0 terminal recovery
        for (let i = 0; i < blockTrips.length - 1; i++) {
            const current = blockTrips[i];
            const next = blockTrips[i + 1];

            // Only apply for cross-route transitions (interline)
            if (current.routeNumber === next.routeNumber) continue;

            const gap = next.trip.startTime - current.trip.endTime;

            // Reasonable interline recovery: 1-20 min
            if (gap < 1 || gap > 20) continue;

            // Get the last stop name of the current trip
            const stopNames = Object.keys(current.trip.stops);
            const lastStopName = stopNames[stopNames.length - 1];
            if (!lastStopName) continue;

            // Only set if terminal has no recovery (or 0)
            const existingRecovery = current.trip.recoveryTimes?.[lastStopName] ?? 0;
            if (existingRecovery > 0) continue;

            // Apply the interline recovery
            if (!current.trip.recoveryTimes) current.trip.recoveryTimes = {};
            current.trip.recoveryTimes[lastStopName] = gap;
            current.trip.recoveryTime = Object.values(current.trip.recoveryTimes)
                .reduce((sum, r) => sum + r, 0);
            fixCount++;
        }
    }

    return fixCount;
}

/**
 * Coordinate block numbering across interlined routes using GTFS block continuity.
 *
 * When 8A and 8B share a GTFS block_id (same physical bus), their per-route
 * block assignments are independent — 8A-1 might be the same bus as 8B-3.
 * This function renumbers so shared blocks use the same suffix (e.g., 8A-1 ↔ 8B-1).
 *
 * Algorithm:
 * 1. Group all trips by GTFS block_id
 * 2. For shared blocks, pick a canonical block number (from the route with the
 *    earliest trip in that block)
 * 3. Renumber all routes' trips in that block to use the canonical suffix
 */
function coordinateInterlineBlocks(systemRoutes: SystemDraftRoute[]): number {
    // Collect all trips tagged with route number
    const allTrips: { trip: MasterTrip; routeNumber: string }[] = [];
    for (const route of systemRoutes) {
        for (const trip of route.northTable.trips) {
            allTrips.push({ trip, routeNumber: route.routeNumber });
        }
        for (const trip of route.southTable.trips) {
            allTrips.push({ trip, routeNumber: route.routeNumber });
        }
    }

    // Group by GTFS block ID
    const blockMap = new Map<string, { trip: MasterTrip; routeNumber: string }[]>();
    for (const entry of allTrips) {
        const gtfsBlockId = entry.trip.gtfsBlockId?.trim();
        if (!gtfsBlockId) continue;
        if (!blockMap.has(gtfsBlockId)) blockMap.set(gtfsBlockId, []);
        blockMap.get(gtfsBlockId)!.push(entry);
    }

    let renumberCount = 0;

    for (const [, blockTrips] of blockMap) {
        // Only process blocks shared across multiple routes
        const routeNumbers = new Set(blockTrips.map(e => e.routeNumber));
        if (routeNumbers.size < 2) continue;

        // Find the canonical block number: use the suffix from the route whose
        // first trip in this block starts earliest (the "primary" route for this bus)
        blockTrips.sort((a, b) =>
            getOperationalSortTime(a.trip.startTime) - getOperationalSortTime(b.trip.startTime)
        );

        const primaryBlockId = blockTrips[0].trip.blockId; // e.g., "8A-1"
        const canonicalSuffix = primaryBlockId.replace(/^[^-]+-/, ''); // e.g., "1"

        // Renumber all trips in this shared block to use the canonical suffix
        for (const entry of blockTrips) {
            const expectedBlockId = `${entry.routeNumber}-${canonicalSuffix}`;
            if (entry.trip.blockId !== expectedBlockId) {
                entry.trip.blockId = expectedBlockId;
                renumberCount++;
            }
        }
    }

    return renumberCount;
}

// ============ SYSTEM-WIDE IMPORT ============

/**
 * Result of importing all routes for a day type into a system draft.
 */
export interface SystemImportResult {
    success: boolean;
    systemDraftId?: string;
    dayType?: DayType;
    routeCount?: number;
    totalTrips?: number;
    routeNumbers?: string[];
    warnings?: string[];
    error?: string;
}

/**
 * Import ALL routes for a specific day type from GTFS feed into a single system draft.
 * This enables interline logic by having all routes (e.g., 8A and 8B) loaded together.
 *
 * @param feed - The parsed GTFS feed
 * @param dayType - The day type to import (Weekday, Saturday, Sunday)
 * @param userId - The user's ID
 * @param draftName - Optional custom name for the system draft
 * @param config - Optional GTFS import config
 * @param options - Import options (timepointsOnly, etc.)
 * @returns Result containing the system draft ID and statistics
 */
export async function importAllRoutesFromGTFS(
    feed: ParsedGTFSFeed,
    dayType: DayType,
    userId: string,
    draftName?: string,
    config?: GTFSImportConfig,
    options: GTFSImportOptions = { timepointsOnly: true }
): Promise<SystemImportResult> {
    console.log(`🚌 importAllRoutesFromGTFS started for ${dayType}`, { userId, options });

    try {
        // Get all routes for this day type
        const allRoutes = getAvailableRoutes(feed, config);
        const dayTypeRoutes = allRoutes.filter(r => r.dayType === dayType);

        if (dayTypeRoutes.length === 0) {
            return {
                success: false,
                error: `No routes found for ${dayType} in GTFS feed`,
            };
        }

        console.log(`📊 Found ${dayTypeRoutes.length} routes for ${dayType}`);

        // Process each route
        const systemRoutes: SystemDraftRoute[] = [];
        const warnings: string[] = [];
        let totalTrips = 0;

        for (const routeOption of dayTypeRoutes) {
            console.log(`  Processing Route ${routeOption.routeShortName}...`);

            try {
                let content: MasterScheduleContent;

                if (routeOption.isMergedRoute) {
                    // Handle merged A/B direction routes (2A+2B, 7A+7B, 12A+12B)
                    const northTrips = processTripsForRoute(
                        feed,
                        routeOption.northRouteId!,
                        routeOption.northServiceId!,
                        config,
                        options
                    );
                    northTrips.forEach(t => { t.direction = 'North'; });

                    const southTrips = processTripsForRoute(
                        feed,
                        routeOption.southRouteId!,
                        routeOption.southServiceId!,
                        config,
                        options
                    );
                    southTrips.forEach(t => { t.direction = 'South'; });

                    const allTrips = [...northTrips, ...southTrips];
                    if (allTrips.length === 0) {
                        warnings.push(`Route ${routeOption.routeShortName}: No trips found`);
                        continue;
                    }

                    content = convertToMasterSchedule(
                        allTrips,
                        routeOption.routeShortName,
                        dayType
                    );
                } else {
                    // Handle regular routes
                    const trips = processTripsForRoute(
                        feed,
                        routeOption.routeId,
                        routeOption.serviceId,
                        config,
                        options
                    );

                    if (trips.length === 0) {
                        warnings.push(`Route ${routeOption.routeShortName}: No trips found`);
                        continue;
                    }

                    content = convertToMasterSchedule(
                        trips,
                        routeOption.routeShortName,
                        dayType
                    );
                }

                // Create SystemDraftRoute
                const routeTripCount = content.northTable.trips.length + content.southTable.trips.length;
                totalTrips += routeTripCount;

                systemRoutes.push({
                    routeNumber: routeOption.routeShortName,
                    northTable: content.northTable,
                    southTable: content.southTable,
                });

                console.log(`    ✓ Route ${routeOption.routeShortName}: ${routeTripCount} trips`);
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : 'Unknown error';
                warnings.push(`Route ${routeOption.routeShortName}: ${errMsg}`);
                console.error(`    ✗ Route ${routeOption.routeShortName}: ${errMsg}`);
            }
        }

        if (systemRoutes.length === 0) {
            return {
                success: false,
                error: `Failed to process any routes for ${dayType}`,
                warnings,
            };
        }

        // Apply interline recovery across routes (e.g., 8A→8B at Allandale)
        const interlineFixes = applyInterlineRecovery(systemRoutes);
        if (interlineFixes > 0) {
            console.log(`🔗 Applied ${interlineFixes} interline recovery time(s) across routes`);
        }

        // Coordinate block numbering across interlined routes (e.g., 8A-1 ↔ 8B-1)
        const blockFixes = coordinateInterlineBlocks(systemRoutes);
        if (blockFixes > 0) {
            console.log(`🔗 Renumbered ${blockFixes} trip(s) for consistent interline block IDs`);
        }

        // Sort routes by route number
        systemRoutes.sort((a, b) =>
            a.routeNumber.localeCompare(b.routeNumber, undefined, { numeric: true })
        );

        // Create system draft
        const systemDraftInput: SystemDraftInput = {
            name: draftName || generateSystemDraftName(dayType),
            dayType,
            routes: systemRoutes,
            status: 'draft',
            createdBy: userId,
            basedOn: {
                type: 'gtfs',
                importedAt: new Date(),
                gtfsFeedUrl: config?.feedUrl || DEFAULT_GTFS_URL,
            },
        };

        console.log(`💾 Saving system draft with ${systemRoutes.length} routes...`);
        const systemDraftId = await saveSystemDraft(userId, systemDraftInput);
        console.log(`✅ System draft saved with ID: ${systemDraftId}`);

        return {
            success: true,
            systemDraftId,
            dayType,
            routeCount: systemRoutes.length,
            totalTrips,
            routeNumbers: systemRoutes.map(r => r.routeNumber),
            warnings: warnings.length > 0 ? warnings : undefined,
        };
    } catch (error) {
        console.error('❌ importAllRoutesFromGTFS error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during system import',
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
