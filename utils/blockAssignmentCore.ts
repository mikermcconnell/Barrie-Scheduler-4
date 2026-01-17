/**
 * Block Assignment Core - Unified Module
 *
 * Shared helpers and trip matching logic used by:
 * - gtfsImportService.ts (GTFS import)
 * - ScheduleEditor.tsx (runtime block reassignment)
 * - blockAssignment.ts (master schedule parsing)
 *
 * This module eliminates 3 duplicate implementations of block assignment logic.
 */

import type { MasterTrip, MasterRouteTable } from './masterScheduleParser';

// --- Shared Types ---

export interface TripForMatching {
    id: string;
    blockId: string;
    tripNumber: number;
    direction: 'North' | 'South' | 'Loop' | string;
    startTime: number;
    endTime: number;
    firstStopName: string;
    lastStopName: string;
    recoveryTimes?: Record<string, number>;
    routeName?: string;
}

export interface MatchConfig {
    /** Time tolerance in minutes (1 for exact match, 5 for GTFS data) */
    timeTolerance: number;
    /** Whether to verify start/end locations match */
    checkLocation: boolean;
    /** Maximum gap between trips in minutes (for merged route block assignment) */
    maxGap?: number;
}

export interface AssignedBlock {
    blockId: string;
    trips: TripForMatching[];
    startTime: number;
    endTime: number;
}

// --- Shared Helpers (eliminate 3 copies) ---

/**
 * Extracts the base stop name by removing duplicate suffixes like (2), (3)
 * "Barrie South GO (3)" -> "Barrie South GO"
 * "Park Place (2)" -> "Park Place"
 */
export const getBaseStopName = (stopName: string): string => {
    return stopName.replace(/\s*\(\d+\)\s*$/, '').trim();
};

/**
 * Adjusts time for Operational Day sorting.
 * Day starts at 4:00 AM (240 min).
 * Trips before 4:00 AM are considered "Late Night" (end of previous day)
 * and are pushed to the end of the sort order (time + 24h).
 */
export const getOperationalSortTime = (minutes: number): number => {
    const DAY_START = 240; // 4:00 AM
    return minutes < DAY_START ? minutes + 1440 : minutes;
};

/**
 * Get opposite direction for bidirectional routes.
 */
export const getOppositeDirection = (dir: string): 'North' | 'South' => {
    return dir === 'North' ? 'South' : 'North';
};

/**
 * Format minutes to display time (e.g., 450 -> "7:30 AM")
 */
export const formatTime = (minutes: number): string => {
    let normalized = minutes % 1440;
    if (normalized < 0) normalized += 1440;

    let h = Math.floor(normalized / 60);
    const m = normalized % 60;
    const period = h >= 12 && h < 24 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
};

// --- Core Trip Matching ---

/**
 * Find the next trip that can link to the current trip.
 *
 * Matching criteria:
 * 1. Start time matches expected start (current end time + recovery) within tolerance
 * 2. If checkLocation is true, start location must match current end location
 * 3. Candidate must not already be assigned
 * 4. Candidate must not be reserved (someone else's tight pair)
 *
 * @param current The current trip that just ended
 * @param candidates All available trips to match against
 * @param config Matching configuration
 * @param assignedSet Set of already-assigned trip IDs
 * @param reservedSet Optional set of trip IDs reserved as tight pairs (skip these)
 * @returns The best matching trip, or undefined if no match
 */
export function findNextTrip(
    current: TripForMatching,
    candidates: TripForMatching[],
    config: MatchConfig,
    assignedSet: Set<string>,
    reservedSet?: Set<string>
): TripForMatching | undefined {
    const currentEndLocation = getBaseStopName(current.lastStopName);

    let bestMatch: TripForMatching | undefined;
    let bestGap = Infinity;

    // Determine matching mode:
    // - If maxGap is specified (merged routes): use gap-based matching
    // - Otherwise: use expectedStart-based matching with recoveryAtEnd
    const useGapBasedMatching = config.maxGap !== undefined;

    // For expectedStart-based matching, calculate expected start time
    // Try exact stop name first, then base name (handles loop routes with "(2)" suffix)
    const baseLastStop = getBaseStopName(current.lastStopName);
    const recoveryAtEnd = current.recoveryTimes?.[current.lastStopName]
        ?? current.recoveryTimes?.[baseLastStop]
        ?? 0;
    const expectedStart = current.endTime + recoveryAtEnd;

    for (const candidate of candidates) {
        // Skip already assigned
        if (assignedSet.has(candidate.id)) continue;

        // Skip reserved trips (someone else's tight pair)
        if (reservedSet?.has(candidate.id)) continue;

        // Check location if required
        if (config.checkLocation) {
            const nextStartLocation = getBaseStopName(candidate.firstStopName);
            if (nextStartLocation !== currentEndLocation) continue;
        }

        if (useGapBasedMatching) {
            // Gap-based matching for merged routes (e.g., 2A+2B)
            // Uses direct time gap instead of unreliable recoveryAtEnd
            // This handles cases where GTFS doesn't have terminal layover data
            const gap = candidate.startTime - current.endTime;
            if (gap < 0 || gap > config.maxGap!) continue;

            // Keep the closest match (smallest gap)
            if (gap < bestGap) {
                bestGap = gap;
                bestMatch = candidate;
            }
        } else {
            // ExpectedStart-based matching for standard routes
            // Uses recoveryAtEnd to calculate when next trip should start
            const timeDiff = Math.abs(candidate.startTime - expectedStart);
            if (timeDiff > config.timeTolerance) continue;

            // Keep the closest match
            if (timeDiff < bestGap) {
                bestGap = timeDiff;
                bestMatch = candidate;
            }
        }
    }

    return bestMatch;
}

/**
 * Find the next trip in opposite direction (for bidirectional routes).
 */
export function findNextTripOppositeDirection(
    current: TripForMatching,
    candidates: TripForMatching[],
    config: MatchConfig,
    assignedSet: Set<string>,
    reservedSet?: Set<string>
): TripForMatching | undefined {
    const oppositeDirection = getOppositeDirection(current.direction);
    const oppositeCandidates = candidates.filter(c => c.direction === oppositeDirection);
    return findNextTrip(current, oppositeCandidates, config, assignedSet, reservedSet);
}

// --- Block Building ---

/**
 * Build blocks from a list of trips using greedy matching.
 *
 * Algorithm:
 * 1. Sort trips by operational end time
 * 2. For each unassigned trip, start a new block
 * 3. Chain trips that match (time + location) until no match found
 * 4. Blocks are numbered sequentially
 *
 * @param trips All trips to assign to blocks
 * @param routeName Base route name for block ID prefix
 * @param config Matching configuration
 * @returns Array of assigned blocks
 */
export function buildBlocks(
    trips: TripForMatching[],
    routeName: string,
    config: MatchConfig
): AssignedBlock[] {
    if (trips.length === 0) return [];

    const blocks: AssignedBlock[] = [];
    const assignedSet = new Set<string>();

    // Sort by operational end time
    const sortedTrips = [...trips].sort((a, b) =>
        getOperationalSortTime(a.endTime) - getOperationalSortTime(b.endTime)
    );

    let blockCounter = 1;

    for (const trip of sortedTrips) {
        if (assignedSet.has(trip.id)) continue;

        const blockId = `${routeName}-${blockCounter}`;
        const block: AssignedBlock = {
            blockId,
            trips: [],
            startTime: trip.startTime,
            endTime: trip.endTime
        };

        let currentTrip: TripForMatching | undefined = trip;
        let tripNumberInBlock = 1;

        while (currentTrip) {
            assignedSet.add(currentTrip.id);
            currentTrip.blockId = blockId;
            currentTrip.tripNumber = tripNumberInBlock++;

            block.trips.push(currentTrip);
            block.endTime = currentTrip.endTime;

            // Find next matching trip
            currentTrip = findNextTrip(currentTrip, sortedTrips, config, assignedSet);
        }

        blocks.push(block);
        blockCounter++;
    }

    return blocks;
}

/**
 * Build blocks for bidirectional routes (N->S->N pattern).
 * Alternates between North and South directions.
 *
 * Uses two-pass matching to prevent early trips from "stealing" tight matches:
 * 1. First pass: Match only tight pairs (gap <= 5 min) - these are almost certainly the same bus
 * 2. Second pass: Build blocks using remaining unmatched trips with wider tolerance
 */
export function buildBlocksBidirectional(
    northTrips: TripForMatching[],
    southTrips: TripForMatching[],
    routeName: string,
    config: MatchConfig
): AssignedBlock[] {
    if (northTrips.length === 0 && southTrips.length === 0) return [];

    const blocks: AssignedBlock[] = [];
    const assignedSet = new Set<string>();

    // Pool all trips
    const allTrips = [...northTrips, ...southTrips];

    // Sort by operational end time
    allTrips.sort((a, b) =>
        getOperationalSortTime(a.endTime) - getOperationalSortTime(b.endTime)
    );

    // === PASS 1: Pre-match tight pairs ===
    // Find all trip pairs where gap <= 5 minutes (almost certainly same bus)
    // This prevents greedy matching from stealing obvious pairs
    const tightPairs = new Map<string, string>(); // endingTripId -> startingTripId
    const TIGHT_GAP = 5; // minutes

    for (const endingTrip of allTrips) {
        const oppositeDir = getOppositeDirection(endingTrip.direction);

        let bestMatch: TripForMatching | undefined;
        let bestGap = Infinity;

        for (const startingTrip of allTrips) {
            if (startingTrip.direction !== oppositeDir) continue;
            if (tightPairs.has(startingTrip.id)) continue; // Already matched as an ending trip
            if ([...tightPairs.values()].includes(startingTrip.id)) continue; // Already matched as a starting trip

            const gap = startingTrip.startTime - endingTrip.endTime;
            if (gap >= 0 && gap <= TIGHT_GAP && gap < bestGap) {
                bestGap = gap;
                bestMatch = startingTrip;
            }
        }

        if (bestMatch) {
            tightPairs.set(endingTrip.id, bestMatch.id);
        }
    }

    // === PASS 2: Build blocks using pre-matched pairs ===
    // Create a set of reserved trips (tight pair targets) that regular matching should skip
    const reservedSet = new Set<string>(tightPairs.values());

    let blockCounter = 1;

    for (const trip of allTrips) {
        if (assignedSet.has(trip.id)) continue;

        const blockId = `${routeName}-${blockCounter}`;
        const block: AssignedBlock = {
            blockId,
            trips: [],
            startTime: trip.startTime,
            endTime: trip.endTime
        };

        let currentTrip: TripForMatching | undefined = trip;
        let tripNumberInBlock = 1;

        while (currentTrip) {
            assignedSet.add(currentTrip.id);
            currentTrip.blockId = blockId;
            currentTrip.tripNumber = tripNumberInBlock++;

            block.trips.push(currentTrip);
            block.endTime = currentTrip.endTime;

            const lastTrip = currentTrip;

            // First check if there's a pre-matched tight pair
            const preMatchedId = tightPairs.get(lastTrip.id);
            if (preMatchedId && !assignedSet.has(preMatchedId)) {
                currentTrip = allTrips.find(t => t.id === preMatchedId);
            } else {
                // Fall back to regular matching for wider gaps (opposite direction only)
                // Bidirectional routes always alternate N→S→N→S, never same direction
                // Pass reservedSet so regular matching doesn't steal tight pair targets
                currentTrip = findNextTripOppositeDirection(lastTrip, allTrips, config, assignedSet, reservedSet);
            }
        }

        blocks.push(block);
        blockCounter++;
    }

    return blocks;
}

// --- MasterTrip Adapters ---

/**
 * Convert MasterTrip to TripForMatching for block assignment.
 */
export function masterTripToMatching(
    trip: MasterTrip,
    table: MasterRouteTable
): TripForMatching {
    return {
        id: trip.id,
        blockId: trip.blockId,
        tripNumber: trip.tripNumber,
        direction: trip.direction,
        startTime: trip.startTime,
        endTime: trip.endTime,
        firstStopName: table.stops[0] || '',
        lastStopName: table.stops[table.stops.length - 1] || '',
        recoveryTimes: trip.recoveryTimes,
        routeName: table.routeName
    };
}

/**
 * Apply block assignments back to MasterTrips.
 */
export function applyBlocksToMasterTrips(
    blocks: AssignedBlock[],
    tables: MasterRouteTable[]
): void {
    // Build a lookup from trip ID to block assignment
    const blockAssignments = new Map<string, { blockId: string; tripNumber: number }>();

    for (const block of blocks) {
        for (const trip of block.trips) {
            blockAssignments.set(trip.id, {
                blockId: block.blockId,
                tripNumber: trip.tripNumber
            });
        }
    }

    // Apply to all tables
    for (const table of tables) {
        for (const trip of table.trips) {
            const assignment = blockAssignments.get(trip.id);
            if (assignment) {
                trip.blockId = assignment.blockId;
                trip.tripNumber = assignment.tripNumber;
            }
        }
    }
}

// --- Convenience Functions ---

/**
 * Reassign blocks for a set of related tables (same route, different directions).
 * This is used by ScheduleEditor when times change.
 *
 * @param tables All tables to process
 * @param baseName Base route name to filter by
 * @param config Matching configuration (default: exact time, check location)
 */
export function reassignBlocksForTables(
    tables: MasterRouteTable[],
    baseName: string,
    config: MatchConfig = { timeTolerance: 1, checkLocation: true }
): void {
    // Collect all trips with their table reference
    const allTrips: TripForMatching[] = [];

    for (const table of tables) {
        for (const trip of table.trips) {
            allTrips.push(masterTripToMatching(trip, table));
        }
    }

    if (allTrips.length === 0) return;

    // Build blocks
    const blocks = buildBlocks(allTrips, baseName, config);

    // Apply back to tables
    applyBlocksToMasterTrips(blocks, tables);
}

/**
 * Get matching config presets for common scenarios.
 */
export const MatchConfigPresets = {
    /** Exact matching for generated schedules (±1 minute, check location) */
    exact: { timeTolerance: 1, checkLocation: true } as MatchConfig,

    /** Relaxed matching for GTFS import (±5 minutes, check location) */
    gtfs: { timeTolerance: 5, checkLocation: true } as MatchConfig,

    /** Merged route matching (time-based only, 30 min max gap) */
    merged: { timeTolerance: 5, checkLocation: false, maxGap: 30 } as MatchConfig,

    /** Editor reassignment (exact time, check location) */
    editor: { timeTolerance: 1, checkLocation: false } as MatchConfig
};
