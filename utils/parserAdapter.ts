
import { ParseResult, ParsedRoute, ParsedTrip, StopInfo, parseTimeToMinutes } from './masterScheduleParserV2';
import { MasterRouteTable, MasterTrip } from './masterScheduleParser';
import { assignBlocksToRoute, assignBlocksBidirectional, assignBlocksToSection, BlockAssignmentResult, BlockedTrip, Block } from './blockAssignment';

/**
 * Adapts V2 Parser output to V1 MasterRouteTable format
 * so it can be used by the existing FixedRouteWorkspace UI.
 */
export const adaptV2ToV1 = (v2Result: ParseResult): MasterRouteTable[] => {
    const tables: MasterRouteTable[] = [];

    // Process each route
    for (const route of v2Result.routes) {

        // Group sections by day type
        const sectionsByDay: Record<string, typeof route.sections> = {
            'Weekday': [],
            'Saturday': [],
            'Sunday': []
        };

        for (const section of route.sections) {
            sectionsByDay[section.dayType].push(section);
        }

        // Process each day
        for (const [dayType, sections] of Object.entries(sectionsByDay)) {
            if (sections.length === 0) continue;

            if (sections.length === 2) {
                // BIDIRECTIONAL CASE CHECK
                // IMPORTANT: Sometimes a sheet has a "Ghost" section (copied header from another route)
                // If the stops are completely different, it is NOT North/South. It implies one is garbage.

                const s1 = sections[0];
                const s2 = sections[1];

                const stops1 = new Set(s1.stops.map(s => s.name));
                const stops2 = new Set(s2.stops.map(s => s.name));

                // Calculate Jaccard Similarity (Intersection / Union)
                const intersection = s1.stops.filter(s => stops2.has(s.name)).length;
                const union = new Set([...stops1, ...stops2]).size;
                const similarity = union === 0 ? 0 : intersection / union;

                // Threshold: If overlap is less than 20%, treat as distinct/conflict
                if (similarity < 0.2) {
                    console.warn(`[Adapter] Conflict in ${route.routeName} (${dayType}): Sections contain disjoint stops (similarity ${similarity.toFixed(2)}). Keeping only the larger section.`);

                    // Pick the "winner" - mostly trips count, fallback to stops count
                    const winner = s1.trips.length > s2.trips.length ? s1
                        : s2.trips.length > s1.trips.length ? s2
                            : s1.stops.length >= s2.stops.length ? s1 : s2; // fallback

                    // Proceed as Unidirectional with Winner
                    const blockResult = assignBlocksToSection(winner, route.routeName);
                    const directionLabel = 'Loop'; // Or 'Single'
                    const trips = blockResult.blocks.flatMap(b => b.trips.map(t => convertTrip(t, winner.stops)));
                    tables.push(createTable(route.routeName, dayType, directionLabel, winner.stops, trips));

                } else {
                    // Normal Bidirectional Logic

                    // Run bidirectional block assignment (chains N->S->N)
                    // We pass s1 as "North" and s2 as "South" primarily for labeling; 
                    // the algo matches based on time regardless.
                    const blockResult = assignBlocksBidirectional(s1, s2, route.routeName);

                    // Split back into two tables for the UI
                    const northTrips = blockResult.blocks.flatMap(b => b.trips.filter(t => t.direction === 'North').map(t => convertTrip(t, s1.stops)));
                    const southTrips = blockResult.blocks.flatMap(b => b.trips.filter(t => t.direction === 'South').map(t => convertTrip(t, s2.stops)));

                    if (northTrips.length > 0) {
                        tables.push(createTable(route.routeName, dayType, 'North', s1.stops, northTrips));
                    }
                    if (southTrips.length > 0) {
                        tables.push(createTable(route.routeName, dayType, 'South', s2.stops, southTrips));
                    }
                }

            } else {
                // UNIDIRECTIONAL / LOOP CASE (or fallback for abnormal section counts)
                for (const section of sections) {
                    const blockResult = assignBlocksToSection(section, route.routeName);

                    // Determine direction label
                    const directionLabel = sections.length === 1 ? 'Loop' : 'Variant';

                    const trips = blockResult.blocks.flatMap(b =>
                        b.trips.map(t => convertTrip(t, section.stops))
                    );

                    tables.push(createTable(route.routeName, dayType, directionLabel, section.stops, trips));
                }
            }
        }
    }

    return tables;
};

const createTable = (routeName: string, dayType: string, direction: string, stops: StopInfo[], trips: MasterTrip[]): MasterRouteTable => {
    const stopNames = stops.filter(s => !s.isRecovery).map(s => s.name);
    const stopIds = stops.reduce((acc, s) => {
        if (s.id) acc[s.name] = s.id;
        return acc;
    }, {} as Record<string, string>);

    // Construct Name: "400 (Weekday) (North)"
    let name = `${routeName}`;
    // Add day type if not already in name
    if (!name.includes(dayType)) name += ` (${dayType})`;
    // Add direction if specific
    if (direction && direction !== 'Variant' && direction !== 'Loop') name += ` (${direction})`;
    // Note: For "Loop", we might NOT normally append (Loop) unless desired.
    // FixedRouteWorkspace filtering looks for "(North)" and "(South)".
    // If we want "Loop" to be visible, we just need a name.

    return {
        routeName: name,
        stops: stopNames,
        stopIds: stopIds,
        trips: smartSortTrips(trips)
    };
};

/**
 * Normalizes a time value for sorting purposes.
 * Times between 12:00 AM (0 minutes) and 3:30 AM (210 minutes) are treated as 
 * "next day" times by adding 1440 minutes (24 hours), ensuring they sort 
 * AFTER late-night times like 11:51 PM.
 * 
 * This fixes the issue where after-midnight trips were being sorted before
 * late-night trips (e.g., Route 7 ending at 12:29 AM appearing before 11:51 PM).
 */
const MIDNIGHT_THRESHOLD = 210; // 3:30 AM in minutes
const MINUTES_IN_DAY = 1440; // 24 * 60

export const normalizeTimeForSort = (minutes: number | null): number => {
    if (minutes === null) return 0;
    // Times from 12:00 AM (0) to 3:30 AM (210) are considered "next day"
    if (minutes <= MIDNIGHT_THRESHOLD) {
        return minutes + MINUTES_IN_DAY;
    }
    return minutes;
};

/**
 * Sorts trips logically to ensure chronological flow down columns,
 * handling cases where trips start at different stops (overlap sorting).
 * Also handles midnight-crossing times correctly.
 */
// Export for testing
export const smartSortTrips = (trips: MasterTrip[]): MasterTrip[] => {
    // 1. Initial rough sort by startTime (normalized for midnight crossing)
    let sorted = [...trips].sort((a, b) =>
        normalizeTimeForSort(a.startTime) - normalizeTimeForSort(b.startTime)
    );

    // 2. Overlap Refinement (Bubble Sort approach for stability and simplicity on small datasets)
    // We swap adjacent trips if they are "out of order" relative to overlapping stops.
    let changed = true;
    let loops = 0;
    while (changed && loops < sorted.length * 2) { // Safety break
        changed = false;
        loops++;
        for (let i = 0; i < sorted.length - 1; i++) {
            const t1 = sorted[i];
            const t2 = sorted[i + 1];

            // If Start Times are very different, trust start time? 
            // NO, implicit overtaking is possible if one is Express, but rare in this system.
            // But usually we just check the FIRST SHARED STOP.

            const result = compareTripsByOverlap(t1, t2);
            if (result > 0) {
                // t1 should come AFTER t2
                sorted[i] = t2;
                sorted[i + 1] = t1;
                changed = true;
            }
        }
    }
    return sorted;
};

const compareTripsByOverlap = (t1: MasterTrip, t2: MasterTrip): number => {
    // Find shared stops
    const stops1 = Object.keys(t1.stops);

    // We need to iterate stops in a defined order? 
    // Ideally yes, but `Object.keys` might not be ordered.
    // However, MasterTrip structure puts stops in a map. 
    // We really need the Route definition to know Stop Order.
    // But lacking that, just finding *any* shared stop with a time is a good heuristic.
    // Let's rely on the fact that these are usually linear schedules.

    for (const stop of stops1) {
        if (t2.stops[stop]) {
            const time1Raw = parseTimeToMinutes(t1.stops[stop]);
            const time2Raw = parseTimeToMinutes(t2.stops[stop]);

            if (time1Raw !== null && time2Raw !== null) {
                // Normalize times to handle midnight crossing
                const time1 = normalizeTimeForSort(time1Raw);
                const time2 = normalizeTimeForSort(time2Raw);

                // If t1 arrives LATER than t2 at the same stop, t1 should be AFTER t2.
                // Comparison: Return positive if t1 > t2
                if (time1 > time2) return 1;
                if (time1 < time2) return -1;
                // If equal, continue to next stop?
            }
        }
    }

    // If no shared stops or all times equal comparison, fallback to normalized startTime
    return normalizeTimeForSort(t1.startTime) - normalizeTimeForSort(t2.startTime);
};

const convertTrip = (trip: BlockedTrip, stops: StopInfo[]): MasterTrip => {
    // Reconstruct stops record
    const stopRecord: Record<string, string> = {};

    // We need to map the times back. `trip.times` has "Stop Name" -> "Time Str"
    for (const [name, time] of Object.entries(trip.times)) {
        stopRecord[name] = time;
    }

    // Fix: Remap recovery times from "R" keys to the previous stop name
    const remappedRecovery: Record<string, number> = {};
    let lastStopName: string | null = null;

    for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        if (!stop.isRecovery) {
            lastStopName = stop.name;

            // CHECK FOR INFERRED RECOVERY (Arrival/Departure pair)
            // If this stop and the next stop map to the same base name (e.g. "Mall" and "Mall (2)"),
            // and there is NO explicit R column between them, we infer the gap as recovery.
            if (i < stops.length - 1) {
                const nextStop = stops[i + 1];
                if (!nextStop.isRecovery) {
                    // Check base names
                    const base1 = stop.name.replace(/\s\(\d+\)$/, '').trim();
                    const base2 = nextStop.name.replace(/\s\(\d+\)$/, '').trim();

                    if (base1 === base2) {
                        // Found a pair! Check if we already have an explicit recovery for this stop
                        // Explicit recovery usually comes from an "R" column that was mapped to 'lastStopName'
                        const existingRec = trip.recoveryTimes[stop.name];

                        if (existingRec === undefined) {
                            // No explicit recovery. Infer from time difference.
                            // We need value strings from the trip.times record
                            const t1Str = trip.times[stop.name];
                            const t2Str = trip.times[nextStop.name];

                            if (t1Str && t2Str) {
                                const t1 = parseTimeToMinutes(t1Str);
                                const t2 = parseTimeToMinutes(t2Str);

                                if (t1 !== null && t2 !== null) {
                                    // Handle midnight crossing for inferred recovery
                                    let diff = t2 - t1;
                                    if (diff < 0) diff += 1440;

                                    // Only trust reasonable recovery times (< 60 min)
                                    if (diff >= 0 && diff < 60) {
                                        remappedRecovery[stop.name] = diff;
                                    }
                                }
                            }
                        }
                    }
                }
            }

        } else {
            // It's a recovery column. Check if we have data for THIS column name (e.g. "R")
            const val = trip.recoveryTimes[stop.name];
            // FIXED: Only assign recovery if the stop itself has a time!
            if (val !== undefined && val >= 0 && lastStopName && trip.times[lastStopName]) {
                remappedRecovery[lastStopName] = val;
            }
        }
    }

    // FIXED: Handle midnight crossing for Cycle Time
    const start = trip.startTime ?? 0;
    let end = trip.endTime ?? 0;
    if (end < start) end += 1440; // Trip ends next day

    const cycleTime = end - start;

    // Use remappedRecovery to include both explicit and inferred recoveries
    const totalRecovery = Object.values(remappedRecovery).reduce((a, b) => a + b, 0);

    return {
        id: `${trip.routeName}-T-${trip.rowIndex}`,  // Include route name for unique IDs across routes
        blockId: trip.blockId,
        direction: (trip.direction as 'North' | 'South') || 'North', // Cast or default
        tripNumber: trip.tripNumber,
        rowId: trip.rowIndex,
        startTime: trip.startTime ?? 0,
        endTime: trip.endTime ?? 0,
        recoveryTime: totalRecovery,
        recoveryTimes: remappedRecovery,
        // Correction based on user feedback:
        // Cycle Time = Total Duration (End - Start)
        // Travel Time = Cycle Time - Recovery Time
        cycleTime: cycleTime,
        travelTime: cycleTime - totalRecovery,
        stops: stopRecord,
        isOverlap: false, // Calculated later if needed
        isTightRecovery: (totalRecovery < 5),
    };
};
