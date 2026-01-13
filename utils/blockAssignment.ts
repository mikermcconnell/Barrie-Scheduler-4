/**
 * Block Assignment Utility
 * 
 * Assigns block IDs to trips by matching terminus times.
 * A block represents all trips served by a single bus throughout the day.
 * 
 * Matching Criteria:
 * - Trip N endTime @ lastStop === Trip N+1 startTime @ firstStop (exact, 0-min tolerance)
 * - For bidirectional routes: N→S→N→S alternation
 * - Blocks span both directions as a unified sequence
 */

import { ParsedSection, ParsedTrip, ParsedRoute, StopInfo } from './masterScheduleParserV2';
import { inferDirectionFromTerminus, type Direction } from './routeDirectionConfig';

// --- Types ---

export interface BlockedTrip extends ParsedTrip {
    blockId: string;
    tripNumber: number;      // Sequential trip number within the block
    direction: string;       // Inferred direction (e.g., "North", "South", or stop name for loops)
    firstStopName: string;
    lastStopName: string;
    routeName: string;       // Added for interline tracking
    interlineNext?: { route: string; time: number; stopName?: string };
    interlinePrev?: { route: string; time: number; stopName?: string };
}

export interface Block {
    blockId: string;
    trips: BlockedTrip[];
    startTime: number;       // Minutes from midnight
    endTime: number;         // Minutes from midnight
    totalTravelTime: number;
    totalRecoveryTime: number;
}

export interface BlockAssignmentResult {
    blocks: Block[];
    unassignedTrips: ParsedTrip[];
    stats: {
        totalTrips: number;
        assignedTrips: number;
        blockCount: number;
        avgTripsPerBlock: number;
    };
}

// --- Helpers ---

/**
 * Get the first non-recovery stop from the stops array
 */
const getFirstStop = (stops: StopInfo[]): StopInfo | null => {
    return stops.find(s => !s.isRecovery) || null;
};

/**
 * Get the last non-recovery stop from the stops array
 */
const getLastStop = (stops: StopInfo[]): StopInfo | null => {
    const nonRecoveryStops = stops.filter(s => !s.isRecovery);
    return nonRecoveryStops[nonRecoveryStops.length - 1] || null;
};

/**
 * Calculate total recovery time for a trip from its recovery columns
 */
const getTotalRecovery = (trip: ParsedTrip): number => {
    return Object.values(trip.recoveryTimes).reduce((sum, r) => sum + r, 0);
};

/**
 * Infer direction from stop pattern.
 * For bidirectional routes, uses routeDirectionConfig to compare terminus stops.
 * Falls back to firstStop name for loops or unknown routes.
 */
const inferDirection = (
    firstStop: string,
    lastStop: string,
    routeName?: string
): Direction | string => {
    // Try to infer from config if route name is provided
    if (routeName) {
        // Extract base route number (e.g., "12" from "12-Weekday")
        const baseRoute = routeName.split('-')[0].replace(/[AB]$/i, '');
        const configDirection = inferDirectionFromTerminus(baseRoute, firstStop, lastStop);
        if (configDirection) {
            return configDirection;
        }
    }
    // Default: use first stop as direction indicator (for loops or unknown routes)
    return firstStop;
};

/**
 * Extracts the base stop name by removing duplicate suffixes like (2), (3)
 * "Barrie South GO (3)" -> "Barrie South GO"
 * "Park Place (2)" -> "Park Place"
 * "Georgian Mall" -> "Georgian Mall"
 */
const getBaseStopName = (stopName: string): string => {
    return stopName.replace(/\s*\(\d+\)\s*$/, '').trim();
};

const formatTime = (minutes: number): string => {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 && h < 24 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, '0')}${period.charAt(0).toLowerCase()}`;
};

const parseTimeStr = (timeStr: string, tripStartMin: number): number | null => {
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return null;
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const period = match[3]?.toUpperCase();

    if (period === 'PM' && h < 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;

    let minutes = h * 60 + m;

    // Adjust for late night trips crossing midnight
    if (minutes < tripStartMin - 720) {
        minutes += 1440;
    }
    if (tripStartMin >= 1440 && minutes < 1440) {
        if (minutes + 1440 >= tripStartMin) minutes += 1440;
    }

    return minutes;
};

/**
 * Adjusts time for Operational Day sorting.
 * Day starts at 4:00 AM (240 min).
 * Trips before 4:00 AM are considered "Late Night" (end of previous day)
 * and are pushed to the end of the sort order (time + 24h).
 */
const getOperationalSortTime = (minutes: number): number => {
    // 4:00 AM = 240 minutes
    if (minutes < 240) {
        return minutes + 1440;
    }
    return minutes;
};

// --- Core Block Assignment ---

/**
 * Assigns block IDs to trips within a section.
 * Uses greedy matching: for each unassigned trip, find a trip whose endTime
 * matches this trip's startTime exactly.
 */
export const assignBlocksToSection = (
    section: ParsedSection,
    routeName: string
): BlockAssignmentResult => {
    const result: BlockAssignmentResult = {
        blocks: [],
        unassignedTrips: [],
        stats: {
            totalTrips: section.trips.length,
            assignedTrips: 0,
            blockCount: 0,
            avgTripsPerBlock: 0
        }
    };

    if (section.trips.length === 0) return result;

    const sectionFirstStopName = getFirstStop(section.stops)?.name || '';
    const sectionLastStopName = getLastStop(section.stops)?.name || '';

    // Create working copy of trips with metadata
    // Compute each trip's ACTUAL first and last stops based on which stops have times
    const workingTrips: (BlockedTrip & { assigned: boolean })[] = section.trips.map((trip, idx) => {
        // Find actual first stop (first stop in section order that has a time)
        let actualFirstStop = sectionFirstStopName;
        let actualLastStop = sectionLastStopName;

        for (const stop of section.stops) {
            if (!stop.isRecovery && trip.times[stop.name]) {
                actualFirstStop = stop.name;
                break;
            }
        }

        // Find actual last stop (last stop in section order that has a time)
        for (let i = section.stops.length - 1; i >= 0; i--) {
            const stop = section.stops[i];
            if (!stop.isRecovery && trip.times[stop.name]) {
                actualLastStop = stop.name;
                break;
            }
        }

        return {
            ...trip,
            blockId: '',
            tripNumber: 0,
            direction: inferDirection(sectionFirstStopName, sectionLastStopName, routeName),
            firstStopName: actualFirstStop,
            lastStopName: actualLastStop,
            routeName,
            assigned: false
        };
    });

    // Sort by chronological order (End Time for first trips), respecting Operational Day
    // This ensures blocks are numbered naturally by when they become available/finished with their first run
    workingTrips.sort((a, b) => getOperationalSortTime(a.endTime ?? 0) - getOperationalSortTime(b.endTime ?? 0));

    let blockCounter = 1;

    for (const trip of workingTrips) {
        if (trip.assigned) continue;

        const blockId = `${routeName}-${blockCounter}`;
        const block: Block = {
            blockId,
            trips: [],
            startTime: trip.startTime ?? 0,
            endTime: trip.endTime ?? 0,
            totalTravelTime: 0,
            totalRecoveryTime: 0
        };

        let currentTrip: typeof trip | undefined = trip;
        let tripNumberInBlock = 1;

        while (currentTrip) {
            currentTrip.assigned = true;
            currentTrip.blockId = blockId;
            currentTrip.tripNumber = tripNumberInBlock++;

            block.trips.push(currentTrip);
            block.endTime = currentTrip.endTime ?? block.endTime;
            block.totalTravelTime += currentTrip.travelTime;
            block.totalRecoveryTime += getTotalRecovery(currentTrip);

            // Find next trip (greedy match: exact time AND location for loop routes)
            // The next trip must:
            // 1. Start at the same time the current trip ends (within 1 minute tolerance)
            // 2. For loop routes: Start at the same terminal (base name match, ignoring suffixes)
            // This prevents impossible chains like: Trip ending at 12:01 AM @ Barrie South GO 
            // matching a positioning trip starting at 12:01 AM @ Georgian Mall
            const currentEndTime = currentTrip.endTime;
            const currentEndLocation = getBaseStopName(currentTrip.lastStopName);

            // Expected start time calculation:
            // - The bus starts the next trip after completing the current trip and its recovery.
            // - recoveryAtEnd is the recovery time specifically after the last stop.
            const recoveryAtEnd = currentTrip.recoveryTimes?.[currentTrip.lastStopName] ?? 0;
            const expectedStart = (currentEndTime ?? 0) + recoveryAtEnd;

            // Debug log
            console.log(`Checking link for Trip ${currentTrip.rowIndex}: End ${currentEndTime} @ ${currentTrip.lastStopName} + Rec ${recoveryAtEnd} = Exp ${expectedStart}`);

            currentTrip = workingTrips.find(t => {
                if (t.assigned || t.startTime === null) return false;

                // Check if start time matches expected start (with 1 min tolerance)
                const timeDiff = Math.abs(t.startTime - expectedStart);
                if (timeDiff > 1) {
                    console.log(`  Candidate Trip ${t.rowIndex}: Start ${t.startTime} diff ${timeDiff} > 1. Reject.`);
                    return false;
                }

                // Location check: Bus must be at the same location as it ended
                const nextStartLocation = getBaseStopName(t.firstStopName);
                const expectedLocation = getBaseStopName(currentTrip.lastStopName);
                if (nextStartLocation !== expectedLocation) {
                    console.log(`  Candidate Trip ${t.rowIndex}: Loc ${nextStartLocation} != ${expectedLocation}. Reject.`);
                    return false;
                }

                console.log(`  Candidate Trip ${t.rowIndex}: MATCH!`);
                return true;
            });
        }

        result.blocks.push(block);
        blockCounter++;
    }

    // Gather stats
    const assignedTrips = workingTrips.filter(t => t.assigned);
    result.stats.assignedTrips = assignedTrips.length;
    result.stats.blockCount = result.blocks.length;
    result.stats.avgTripsPerBlock = result.blocks.length > 0
        ? assignedTrips.length / result.blocks.length
        : 0;

    // Any unassigned trips
    result.unassignedTrips = workingTrips
        .filter(t => !t.assigned)
        .map(({ assigned, ...trip }) => trip);

    return result;
};

/**
 * Assigns blocks for bidirectional routes where trips alternate N→S→N→S.
 * This merges two sections (North and South) into unified blocks.
 */
export const assignBlocksBidirectional = (
    northSection: ParsedSection,
    southSection: ParsedSection,
    routeName: string
): BlockAssignmentResult => {
    const result: BlockAssignmentResult = {
        blocks: [],
        unassignedTrips: [],
        stats: {
            totalTrips: northSection.trips.length + southSection.trips.length,
            assignedTrips: 0,
            blockCount: 0,
            avgTripsPerBlock: 0
        }
    };

    // Pool trips
    // Helper to find actual stops
    const enrichTrip = (t: ParsedTrip, dir: string, sectionStops: StopInfo[]): (BlockedTrip & { assigned: boolean }) => {
        let actualFirstStop = getFirstStop(sectionStops)?.name || '';
        let actualLastStop = getLastStop(sectionStops)?.name || '';

        // Find actual first stop
        for (const stop of sectionStops) {
            if (!stop.isRecovery && t.times[stop.name]) {
                actualFirstStop = stop.name;
                break;
            }
        }
        // Find actual last stop
        for (let i = sectionStops.length - 1; i >= 0; i--) {
            const stop = sectionStops[i];
            if (!stop.isRecovery && t.times[stop.name]) {
                actualLastStop = stop.name;
                break;
            }
        }

        return {
            ...t,
            blockId: '',
            tripNumber: 0,
            direction: dir,
            firstStopName: actualFirstStop,
            lastStopName: actualLastStop,
            routeName,
            assigned: false
        };
    };

    const northTrips = northSection.trips.map(t => enrichTrip(t, 'North', northSection.stops));
    const southTrips = southSection.trips.map(t => enrichTrip(t, 'South', southSection.stops));

    const allTrips = [...northTrips, ...southTrips];

    // Sort all by time (End Time), respecting Operational Day
    allTrips.sort((a, b) => getOperationalSortTime(a.endTime ?? 0) - getOperationalSortTime(b.endTime ?? 0));

    let blockCounter = 1;

    for (const trip of allTrips) {
        if (trip.assigned) continue;

        const blockId = `${routeName}-${blockCounter}`;
        const block: Block = {
            blockId,
            trips: [],
            startTime: trip.startTime ?? 0,
            endTime: trip.endTime ?? 0,
            totalTravelTime: 0,
            totalRecoveryTime: 0
        };

        let currentTrip: typeof trip | undefined = trip;
        let tripNumberInBlock = 1;

        while (currentTrip) {
            currentTrip.assigned = true;
            currentTrip.blockId = blockId;
            currentTrip.tripNumber = tripNumberInBlock++;

            block.trips.push(currentTrip);
            block.endTime = currentTrip.endTime ?? block.endTime;
            block.totalTravelTime += currentTrip.travelTime;
            block.totalRecoveryTime += getTotalRecovery(currentTrip);

            // Find next matching trip in OPPOSITE direction
            // Current endTime === next startTime (exact match)
            // Find next matching trip in OPPOSITE direction
            // Current endTime + Recovery at terminal === next startTime (exact match)
            const currentEndTime = currentTrip.endTime;
            const recoveryAtEnd = currentTrip.recoveryTimes?.[currentTrip.lastStopName] ?? 0;
            const expectedStart = (currentEndTime ?? 0) + recoveryAtEnd;

            const oppositeDirection = currentTrip.direction === 'North' ? 'South' : 'North';

            currentTrip = allTrips.find(t =>
                !t.assigned &&
                t.direction === oppositeDirection &&
                t.startTime !== null &&
                Math.abs(t.startTime - expectedStart) <= 1
            );
        }

        result.blocks.push(block);
        blockCounter++;
    }

    // Stats
    const assignedTrips = allTrips.filter(t => t.assigned);
    result.stats.assignedTrips = assignedTrips.length;
    result.stats.blockCount = result.blocks.length;
    result.stats.avgTripsPerBlock = result.blocks.length > 0
        ? assignedTrips.length / result.blocks.length
        : 0;

    result.unassignedTrips = allTrips
        .filter(t => !t.assigned)
        .map(({ assigned, ...trip }) => trip);

    return result;
};

/**
 * Assigns blocks across multiple interlined routes (e.g. 8A and 8B).
 * Pooled trips are sorted by time and linked regardless of route.
 */
export const assignBlocksInterlined = (
    sections: { section: ParsedSection, routeName: string }[]
): BlockAssignmentResult => {
    // 1. Pool all trips
    const allTrips: (BlockedTrip & { assigned: boolean })[] = sections.flatMap(({ section, routeName }) =>
        section.trips.map(trip => {
            const firstStop = getFirstStop(section.stops);
            const lastStop = getLastStop(section.stops);
            return {
                ...trip,
                blockId: '',
                tripNumber: 0,
                direction: inferDirection(firstStop?.name || '', lastStop?.name || '', routeName), // Direction from config
                firstStopName: firstStop?.name || '',
                lastStopName: lastStop?.name || '',
                routeName, // Track ability to split back later
                assigned: false
            };
        })
    );

    // 2. Sort by End Time, respecting Operational Day
    allTrips.sort((a, b) => getOperationalSortTime(a.endTime ?? 0) - getOperationalSortTime(b.endTime ?? 0));

    // 3. Initialize Result
    const result: BlockAssignmentResult = {
        blocks: [],
        unassignedTrips: [],
        stats: {
            totalTrips: allTrips.length,
            assignedTrips: 0,
            blockCount: 0,
            avgTripsPerBlock: 0
        }
    };

    if (allTrips.length === 0) return result;

    let blockCounter = 1;
    // Use a shared prefix derived from the first route's base name (e.g. "8")?
    const baseName = sections[0].routeName.replace(/[A-Z]$/, ''); // "8A" -> "8"
    const dayChar = sections[0].section.dayType.charAt(0); // "W"

    for (const trip of allTrips) {
        if (trip.assigned) continue;

        // Start Block
        const blockId = `${baseName}-${dayChar}${blockCounter}`;
        const block: Block = {
            blockId,
            trips: [],
            startTime: trip.startTime ?? 0,
            endTime: trip.endTime ?? 0,
            totalTravelTime: 0,
            totalRecoveryTime: 0
        };

        let currentTrip: typeof trip | undefined = trip;
        let tripNumberInBlock = 1;

        while (currentTrip) {
            currentTrip.assigned = true;
            currentTrip.blockId = blockId;
            currentTrip.tripNumber = tripNumberInBlock++;

            block.trips.push(currentTrip);
            block.endTime = currentTrip.endTime ?? block.endTime;
            block.totalTravelTime += currentTrip.travelTime;
            block.totalRecoveryTime += getTotalRecovery(currentTrip);

            // Find match: 
            // 1. Standard End-of-Trip Match (Recovery at Last Stop)
            const currentEndTime = currentTrip.endTime;
            const currentEndLoc = currentTrip.lastStopName;

            let bestNextTrip: (BlockedTrip & { assigned: boolean }) | undefined = undefined;
            let bestNextStopName = currentEndLoc;

            const recoveryAtEnd = currentTrip.recoveryTimes?.[currentEndLoc] ?? 0;
            const expectedStartTimeEnd = (currentEndTime ?? 0) + recoveryAtEnd;

            // Strict match first
            bestNextTrip = allTrips.find(t =>
                !t.assigned &&
                t.startTime !== null &&
                Math.abs(t.startTime - expectedStartTimeEnd) <= 1 &&
                t.firstStopName === currentEndLoc
            );

            // 2. If no match, Try MID-ROUTE Match (Recovery at any intermediate stop)
            if (!bestNextTrip && currentTrip.recoveryTimes) {
                // Iterate all stops with recovery
                for (const [stopName, recMin] of Object.entries(currentTrip.recoveryTimes)) {
                    if (stopName === currentEndLoc) continue; // Already checked

                    const timeStr = currentTrip.times[stopName];
                    if (!timeStr) continue;

                    const timeMin = parseTimeStr(timeStr, currentTrip.startTime ?? 0);
                    if (timeMin === null) continue;

                    const expectedStart = timeMin + recMin;

                    const candidate = allTrips.find(t =>
                        !t.assigned &&
                        t.startTime !== null &&
                        t.firstStopName === stopName &&
                        Math.abs(t.startTime - expectedStart) <= 1
                    );

                    if (candidate) {
                        bestNextTrip = candidate;
                        bestNextStopName = stopName;
                        break;
                    }
                }
            }

            if (bestNextTrip && bestNextTrip.routeName !== currentTrip.routeName) {
                // Link them
                currentTrip.interlineNext = {
                    route: bestNextTrip.routeName,
                    time: bestNextTrip.startTime!,
                    stopName: bestNextStopName
                };
                bestNextTrip.interlinePrev = {
                    route: currentTrip.routeName,
                    // FIXED: Safe access to times with fallback to endTime
                    time: (() => {
                        const timeStr = currentTrip.times?.[bestNextStopName];
                        if (timeStr) {
                            const parsed = parseTimeStr(timeStr, currentTrip.startTime ?? 0);
                            if (parsed !== null) return parsed;
                        }
                        return currentTrip.endTime!;
                    })(),
                    stopName: bestNextStopName
                };
            }

            currentTrip = bestNextTrip; // Use the found one for block chaining
        }

        result.blocks.push(block);
        blockCounter++;
    }

    // 4. Finalize Stats
    const assigned = allTrips.filter(t => t.assigned);
    result.stats.assignedTrips = assigned.length;
    result.stats.blockCount = result.blocks.length;
    result.stats.avgTripsPerBlock = result.blocks.length > 0 ? assigned.length / result.blocks.length : 0;

    result.unassignedTrips = allTrips.filter(t => !t.assigned);

    return result;
};

/**
 * Assigns blocks across an entire route (all sections/day types)
 */
export const assignBlocksToRoute = (route: ParsedRoute): Map<string, BlockAssignmentResult> => {
    const results = new Map<string, BlockAssignmentResult>();

    for (const section of route.sections) {
        const key = `${route.routeName}-${section.dayType}`;
        results.set(key, assignBlocksToSection(section, route.routeName));
    }

    return results;
};

// --- Renumbering Helper ---

/**
 * Renumbers blocks based on the chronological order of their first departure
 * from the Primary Terminal (primaryStopName).
 * If a block never serves the primary terminal, it falls back to its absolute start time.
 */
const renumberBlocks = (blocks: Block[], primaryStopName: string): void => {
    if (blocks.length === 0) return;

    // Calculate "Primary Sort Time" for each block
    const blockSortInfo = blocks.map(block => {
        // Find the earliest time this block departs from primaryStopName
        let terminalTime: number | null = null;

        for (const trip of block.trips) {
            // Check if this trip has a time for primaryStopName
            const timeStr = trip.times[primaryStopName];
            if (timeStr) {
                const t = parseTimeStr(timeStr, trip.startTime ?? 0);
                if (t !== null) {
                    terminalTime = t;
                    break; // Found the first trips time!
                }
            }
        }

        return {
            block,
            // If terminalTime found, use it. Otherwise use start time + 24h to move to end?
            // Actually, if a block never touches the terminal, we should just sort it by its start time.
            // But we want terminal blocks to be 1, 2, 3... so non-terminal blocks should arguably come AFTER or BEFORE?
            // Let's assume they come after partial blocks that do hit terminal? No, time is king.
            // Using terminalTime ensures Sequence at Terminal is 1,2,3.
            sortTime: terminalTime !== null ? terminalTime : (block.startTime + 0.1)
        };
    });

    // Sort blocks
    blockSortInfo.sort((a, b) => a.sortTime - b.sortTime);

    // Apply new IDs
    const firstId = blocks[0].blockId;
    const prefixMatch = firstId.match(/^(.*?)(\d+)$/);
    const prefix = prefixMatch ? prefixMatch[1] : (firstId + '-');

    blockSortInfo.forEach((info, index) => {
        const newId = `${prefix}${index + 1}`;
        info.block.blockId = newId;

        // Propagate to trips
        for (const trip of info.block.trips) {
            trip.blockId = newId;
        }
    });

    // Re-order the blocks array in place to match sort
    blocks.sort((a, b) => {
        const infoA = blockSortInfo.find(i => i.block === a)!;
        const infoB = blockSortInfo.find(i => i.block === b)!;
        return infoA.sortTime - infoB.sortTime;
    });
};

// --- Debug Helper ---

export const debugBlockAssignment = (result: BlockAssignmentResult): void => {
    console.log('\n=== BLOCK ASSIGNMENT RESULT ===');
    console.log(`Total Trips: ${result.stats.totalTrips}`);
    console.log(`Assigned: ${result.stats.assignedTrips}`);
    console.log(`Blocks: ${result.stats.blockCount}`);
    console.log(`Avg Trips/Block: ${result.stats.avgTripsPerBlock.toFixed(1)}`);

    if (result.unassignedTrips.length > 0) {
        console.log(`⚠️ Unassigned: ${result.unassignedTrips.length}`);
    }

    console.log('\n--- Blocks ---');
    for (const block of result.blocks) {
        const tripTimes = block.trips.map(t =>
            `${t.direction.charAt(0)} ${t.startTime ? formatTime(t.startTime) : '?'}`
        ).join(' → ');
        console.log(`[${block.blockId}] ${block.trips.length} trips: ${tripTimes}`);
    }
};
