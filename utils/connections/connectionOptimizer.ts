/**
 * Connection Optimizer
 *
 * Algorithms for optimizing schedule times to meet connection targets.
 * Supports three modes: shift (global), individual, and hybrid.
 */

import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    RouteConnectionConfig,
    RouteConnection,
    OptimizationMode,
    OptimizationResult,
    ConnectionReportEntry,
    OptimizationSummary,
    ExternalConnection,
    ConnectionTime
} from './connectionTypes';

// ============ TYPES ============

/**
 * Result of checking connection status (without optimization).
 * Used by ConnectionStatusPanel to display current state.
 */
export interface ConnectionCheckResult {
    totalConnections: number;
    connectionsMet: number;
    connectionsMissed: number;
    gaps: Array<{
        targetName: string;
        stopCode: string;
        stopName?: string;              // For display (derived from stopCode)
        targetTime: number;
        tripTime: number;
        gapMinutes: number;
        meetsConnection: boolean;
        direction: string;
        tripId: string;
        bufferRequired: number;
    }>;
}

interface TripConnectionPair {
    trip: MasterTrip;
    tableIndex: number;
    tripIndex: number;
    connection: RouteConnection;
    target: ConnectionTarget;
    targetTimes: number[]; // All applicable target times
    stopTime: number; // Trip's time at the connection stop
}

interface GapAnalysis {
    tripId: string;
    connectionId: string;
    targetId: string;
    targetName: string;
    targetTime: number;
    tripTime: number;
    gap: number; // targetTime - tripTime (positive = early, negative = late)
    bufferRequired: number;
    meetsConnection: boolean;
    priority: number;
}

const MIDNIGHT_ROLLOVER_THRESHOLD = 210; // 3:30 AM

// ============ CONNECTION STATUS CHECK ============

/**
 * Check connection status without optimizing.
 * Returns current state of all configured connections.
 */
export function checkConnections(
    schedules: MasterRouteTable[],
    config: RouteConnectionConfig,
    library: ConnectionLibrary
): ConnectionCheckResult {
    // Get enabled connections
    const enabledConnections = config.connections.filter(c => c.enabled);

    if (enabledConnections.length === 0) {
        return {
            totalConnections: 0,
            connectionsMet: 0,
            connectionsMissed: 0,
            gaps: []
        };
    }

    // Build connection pairs
    const pairs = buildConnectionPairs(schedules, enabledConnections, library);

    if (pairs.length === 0) {
        return {
            totalConnections: 0,
            connectionsMet: 0,
            connectionsMissed: 0,
            gaps: []
        };
    }

    // Calculate gaps
    const gapAnalyses = calculateGaps(pairs);

    // Transform to ConnectionCheckResult format
    const gaps = gapAnalyses.map(gap => {
        const pair = pairs.find(p =>
            p.trip.id === gap.tripId &&
            p.connection.id === gap.connectionId
        );
        return {
            targetName: gap.targetName,
            stopCode: pair?.connection.stopCode || '',
            stopName: pair?.connection.stopName,
            targetTime: gap.targetTime,
            tripTime: gap.tripTime,
            gapMinutes: gap.gap,
            meetsConnection: gap.meetsConnection,
            direction: pair?.trip.direction || 'North',
            tripId: gap.tripId,
            bufferRequired: gap.bufferRequired
        };
    });

    const met = gaps.filter(g => g.meetsConnection).length;
    const missed = gaps.filter(g => !g.meetsConnection).length;

    return {
        totalConnections: gaps.length,
        connectionsMet: met,
        connectionsMissed: missed,
        gaps
    };
}

// ============ MAIN OPTIMIZER ============

/**
 * Main optimization entry point.
 */
export function optimizeForConnections(
    schedules: MasterRouteTable[],
    config: RouteConnectionConfig,
    library: ConnectionLibrary,
    mode: OptimizationMode
): OptimizationResult {
    // Get enabled connections
    const enabledConnections = config.connections.filter(c => c.enabled);

    if (enabledConnections.length === 0) {
        return {
            originalSchedules: schedules,
            optimizedSchedules: schedules,
            connectionReport: [],
            summary: createEmptySummary()
        };
    }

    // Build connection pairs
    const pairs = buildConnectionPairs(schedules, enabledConnections, library);

    if (pairs.length === 0) {
        return {
            originalSchedules: schedules,
            optimizedSchedules: schedules,
            connectionReport: [],
            summary: createEmptySummary()
        };
    }

    // Calculate initial gaps
    const initialGaps = calculateGaps(pairs);

    // Run optimization based on mode
    switch (mode) {
        case 'shift':
            return optimizeByShift(schedules, pairs, initialGaps, config);

        case 'individual':
            return optimizeIndividualTrips(schedules, pairs, initialGaps, config);

        case 'hybrid':
            // First shift, then fine-tune
            const shiftResult = optimizeByShift(schedules, pairs, initialGaps, config);
            const shiftedPairs = buildConnectionPairs(
                shiftResult.optimizedSchedules,
                enabledConnections,
                library
            );
            const shiftedGaps = calculateGaps(shiftedPairs);
            return optimizeIndividualTrips(
                shiftResult.optimizedSchedules,
                shiftedPairs,
                shiftedGaps,
                config,
                shiftResult.shiftApplied
            );

        default:
            return {
                originalSchedules: schedules,
                optimizedSchedules: schedules,
                connectionReport: [],
                summary: createEmptySummary()
            };
    }
}

// ============ SHIFT OPTIMIZATION ============

/**
 * Find optimal global shift and apply it.
 */
function optimizeByShift(
    schedules: MasterRouteTable[],
    pairs: TripConnectionPair[],
    gaps: GapAnalysis[],
    config: RouteConnectionConfig
): OptimizationResult {
    // Search for optimal shift (-30 to +30 minutes)
    let bestShift = 0;
    let bestScore = calculateShiftScore(gaps, 0);

    for (let shift = -30; shift <= 30; shift++) {
        const score = calculateShiftScore(gaps, shift);
        if (score < bestScore) {
            bestScore = score;
            bestShift = shift;
        }
    }

    // Apply the shift
    const optimizedSchedules = applyGlobalShift(schedules, bestShift);

    // Recalculate gaps after shift
    const newPairs = buildConnectionPairs(
        optimizedSchedules,
        config.connections.filter(c => c.enabled),
        { targets: pairs.map(p => p.target), updatedAt: '', updatedBy: '' }
    );
    const newGaps = calculateGaps(newPairs);

    // Build report
    const report = buildReport(gaps, newGaps);
    const summary = buildSummary(newGaps, bestShift);

    // Add external connections to trips
    const schedulesWithConnections = addConnectionsToTrips(optimizedSchedules, newPairs, newGaps);

    return {
        originalSchedules: schedules,
        optimizedSchedules: schedulesWithConnections,
        shiftApplied: bestShift,
        connectionReport: report,
        summary
    };
}

/**
 * Calculate score for a given shift amount.
 * Lower score is better.
 */
function calculateShiftScore(gaps: GapAnalysis[], shift: number): number {
    let totalScore = 0;

    for (const gap of gaps) {
        const adjustedGap = gap.gap + shift;
        const buffer = gap.bufferRequired;
        const priority = gap.priority || 1;
        const priorityWeight = 1 / priority; // Higher priority = lower number = higher weight

        if (adjustedGap >= buffer) {
            // Connection met - small penalty for excessive wait (>15 min)
            const excessWait = Math.max(0, adjustedGap - buffer - 15);
            totalScore += excessWait * 0.1 * priorityWeight;
        } else {
            // Connection missed - heavy penalty
            const missAmount = buffer - adjustedGap;
            totalScore += Math.pow(missAmount, 2) * priorityWeight;
        }
    }

    return totalScore;
}

// ============ INDIVIDUAL OPTIMIZATION ============

/**
 * Adjust individual trips to meet their connections.
 */
function optimizeIndividualTrips(
    schedules: MasterRouteTable[],
    pairs: TripConnectionPair[],
    gaps: GapAnalysis[],
    config: RouteConnectionConfig,
    previousShift?: number
): OptimizationResult {
    // Deep clone schedules
    const optimizedSchedules = JSON.parse(JSON.stringify(schedules)) as MasterRouteTable[];

    // Track adjustments made
    const adjustments: Map<string, number> = new Map();

    // Sort by priority (lowest number = highest priority)
    const sortedGaps = [...gaps].sort((a, b) => a.priority - b.priority);

    for (const gap of sortedGaps) {
        // Skip if already meets connection
        if (gap.meetsConnection) continue;

        // Calculate needed adjustment
        const neededAdjustment = gap.bufferRequired - gap.gap;

        // Limit adjustment to 15 minutes
        if (Math.abs(neededAdjustment) > 15) continue;

        // Find the trip
        const pair = pairs.find(p =>
            p.trip.id === gap.tripId &&
            p.connection.id === gap.connectionId
        );
        if (!pair) continue;

        // Apply adjustment
        const table = optimizedSchedules[pair.tableIndex];
        const trip = table.trips[pair.tripIndex];

        // Adjust times
        trip.startTime += neededAdjustment;
        trip.endTime += neededAdjustment;

        // Update stop times
        if (trip.stops) {
            if (trip.stopMinutes) {
                for (const [stopName, minutes] of Object.entries(trip.stopMinutes)) {
                    const adjusted = minutes + neededAdjustment;
                    trip.stopMinutes[stopName] = adjusted;
                    if (trip.stops[stopName]) {
                        trip.stops[stopName] = formatMinutesToTime(adjusted);
                    }
                }
            } else {
                for (const stopName of Object.keys(trip.stops)) {
                    const timeStr = trip.stops[stopName];
                    const rawMinutes = parseTimeToMinutes(timeStr);
                    if (rawMinutes !== null) {
                        const baseMinutes = normalizeTripMinutes(rawMinutes, trip.startTime);
                        trip.stops[stopName] = formatMinutesToTime(baseMinutes + neededAdjustment);
                    }
                }
            }
        }

        adjustments.set(trip.id, neededAdjustment);
    }

    // Recalculate gaps
    const newPairs = buildConnectionPairs(
        optimizedSchedules,
        config.connections.filter(c => c.enabled),
        { targets: pairs.map(p => p.target), updatedAt: '', updatedBy: '' }
    );
    const newGaps = calculateGaps(newPairs);

    // Build report
    const report = buildReport(gaps, newGaps);
    const summary = buildSummary(newGaps, previousShift);

    // Add external connections to trips
    const schedulesWithConnections = addConnectionsToTrips(optimizedSchedules, newPairs, newGaps);

    return {
        originalSchedules: schedules,
        optimizedSchedules: schedulesWithConnections,
        shiftApplied: previousShift,
        connectionReport: report,
        summary
    };
}

// ============ HELPER FUNCTIONS ============

/**
 * Build pairs of trips and their connection targets.
 */
function buildConnectionPairs(
    schedules: MasterRouteTable[],
    connections: RouteConnection[],
    library: ConnectionLibrary
): TripConnectionPair[] {
    const pairs: TripConnectionPair[] = [];

    for (const connection of connections) {
        const target = library.targets.find(t => t.id === connection.targetId);
        if (!target) continue;

        // Get target times
        const targetTimes = getTargetTimes(target);
        if (targetTimes.length === 0) continue;

        // Find trips that pass through the connection stop
        for (let tableIndex = 0; tableIndex < schedules.length; tableIndex++) {
            const table = schedules[tableIndex];

            for (let tripIndex = 0; tripIndex < table.trips.length; tripIndex++) {
                const trip = table.trips[tripIndex];

                // Check if trip has the connection stop (lookup by stop code)
                const stopTime = getTripStopTimeByCode(trip, connection.stopCode, table.stopIds || {});
                if (stopTime === null) continue;

                // Apply time filter if set
                if (connection.timeFilterStart !== undefined && connection.timeFilterEnd !== undefined) {
                    if (stopTime < connection.timeFilterStart || stopTime > connection.timeFilterEnd) {
                        continue;
                    }
                }

                pairs.push({
                    trip,
                    tableIndex,
                    tripIndex,
                    connection,
                    target,
                    targetTimes,
                    stopTime
                });
            }
        }
    }

    return pairs;
}

/**
 * Calculate gaps for all trip-connection pairs.
 */
function calculateGaps(pairs: TripConnectionPair[]): GapAnalysis[] {
    const gaps: GapAnalysis[] = [];

    for (const pair of pairs) {
        // Find the closest target time
        const closestTarget = findClosestTargetTime(pair.stopTime, pair.targetTimes, pair.connection.connectionType);
        if (closestTarget === null) continue;

        // Calculate gap based on connection type
        let gap: number;
        if (pair.connection.connectionType === 'meet_departing') {
            // Bus should arrive BEFORE target departs
            gap = closestTarget - pair.stopTime;
        } else {
            // Bus should depart AFTER target arrives
            gap = pair.stopTime - closestTarget;
        }

        const meetsConnection = gap >= pair.connection.bufferMinutes;

        gaps.push({
            tripId: pair.trip.id,
            connectionId: pair.connection.id,
            targetId: pair.target.id,
            targetName: pair.target.name,
            targetTime: closestTarget,
            tripTime: pair.stopTime,
            gap,
            bufferRequired: pair.connection.bufferMinutes,
            meetsConnection,
            priority: pair.connection.priority
        });
    }

    return gaps;
}

/**
 * Find the closest target time to a trip time.
 */
function findClosestTargetTime(
    tripTime: number,
    targetTimes: number[],
    connectionType: 'meet_departing' | 'feed_arriving'
): number | null {
    if (targetTimes.length === 0) return null;

    let closest: number | null = null;
    let minDiff = Infinity;

    for (const targetTime of targetTimes) {
        let diff: number;

        if (connectionType === 'meet_departing') {
            // Look for targets AFTER the trip time (bus arrives, then target departs)
            diff = targetTime - tripTime;
            // Only consider targets within reasonable range (0-60 min ahead)
            if (diff >= -10 && diff < 60 && Math.abs(diff) < minDiff) {
                minDiff = Math.abs(diff);
                closest = targetTime;
            }
        } else {
            // Look for targets BEFORE the trip time (target arrives, then bus departs)
            diff = tripTime - targetTime;
            // Only consider targets within reasonable range (0-60 min behind)
            if (diff >= -10 && diff < 60 && Math.abs(diff) < minDiff) {
                minDiff = Math.abs(diff);
                closest = targetTime;
            }
        }
    }

    return closest;
}

/**
 * Get all times from a connection target.
 */
function getTargetTimes(target: ConnectionTarget): number[] {
    if (target.times) {
        return target.times
            .filter(t => t.enabled)
            .map(t => t.time);
    }
    return [];
}

/**
 * Get the time a trip is at a specific stop by stop code.
 * Uses stopIds to reverse-lookup the stop name from the code.
 */
function getTripStopTimeByCode(
    trip: MasterTrip,
    stopCode: string,
    stopIds: Record<string, string>
): number | null {
    if (!trip.stops || !stopCode) return null;

    // Reverse lookup: find stop name from stop code
    const stopName = Object.entries(stopIds).find(([, code]) => code === stopCode)?.[0];
    if (!stopName) return null;

    const stopMinutes = trip.stopMinutes?.[stopName];
    if (stopMinutes !== undefined) {
        return stopMinutes;
    }
    if (!trip.stops[stopName]) return null;

    const timeStr = trip.stops[stopName];
    const parsed = parseTimeToMinutes(timeStr);
    if (parsed === null) return null;

    return normalizeTripMinutes(parsed, trip.startTime);
}

function normalizeTripMinutes(rawMinutes: number, tripStartTime: number): number {
    if (rawMinutes >= 1440) return rawMinutes;
    if (tripStartTime >= 1440) return rawMinutes + 1440;
    if (tripStartTime < MIDNIGHT_ROLLOVER_THRESHOLD) return rawMinutes + 1440;
    return rawMinutes;
}

/**
 * Get the time a trip is at a specific stop by name (legacy, for internal use).
 */
function getTripStopTime(trip: MasterTrip, stopName: string): number | null {
    if (!trip.stops || !trip.stops[stopName]) return null;

    const timeStr = trip.stops[stopName];
    const parsed = parseTimeToMinutes(timeStr);
    if (parsed === null) return null;
    return normalizeTripMinutes(parsed, trip.startTime);
}

/**
 * Apply a global shift to all schedules.
 */
function applyGlobalShift(schedules: MasterRouteTable[], shift: number): MasterRouteTable[] {
    return schedules.map(table => ({
        ...table,
        trips: table.trips.map(trip => {
            const newTrip = { ...trip };
            newTrip.startTime += shift;
            newTrip.endTime += shift;

            // Update stop times
            if (trip.stops) {
                newTrip.stops = {};
                for (const [stopName, timeStr] of Object.entries(trip.stops)) {
                    const rawMinutes = trip.stopMinutes?.[stopName] ?? parseTimeToMinutes(timeStr);
                    if (rawMinutes !== null && rawMinutes !== undefined) {
                        const baseMinutes = trip.stopMinutes?.[stopName] !== undefined
                            ? rawMinutes
                            : normalizeTripMinutes(rawMinutes, trip.startTime);
                        newTrip.stops[stopName] = formatMinutesToTime(baseMinutes + shift);
                    } else {
                        newTrip.stops[stopName] = timeStr;
                    }
                }
            }

            if (trip.stopMinutes) {
                newTrip.stopMinutes = {};
                for (const [stopName, minutes] of Object.entries(trip.stopMinutes)) {
                    newTrip.stopMinutes[stopName] = minutes + shift;
                }
            }

            return newTrip;
        })
    }));
}

/**
 * Add external connection metadata to trips.
 */
function addConnectionsToTrips(
    schedules: MasterRouteTable[],
    pairs: TripConnectionPair[],
    gaps: GapAnalysis[]
): MasterRouteTable[] {
    // Create a map of trip ID to gaps
    const tripGaps = new Map<string, GapAnalysis[]>();
    for (const gap of gaps) {
        const existing = tripGaps.get(gap.tripId) || [];
        existing.push(gap);
        tripGaps.set(gap.tripId, existing);
    }

    return schedules.map(table => ({
        ...table,
        trips: table.trips.map(trip => {
            const gapsForTrip = tripGaps.get(trip.id);
            if (!gapsForTrip || gapsForTrip.length === 0) {
                return trip;
            }

            // Find corresponding pairs for stop names
            const pairsForTrip = pairs.filter(p => p.trip.id === trip.id);

            const externalConnections: ExternalConnection[] = gapsForTrip.map(gap => {
                const pair = pairsForTrip.find(p => p.connection.id === gap.connectionId);
                return {
                    targetId: gap.targetId,
                    targetName: gap.targetName,
                    connectionType: pair?.connection.connectionType || 'meet_departing',
                    targetTime: gap.targetTime,
                    tripArrivalTime: gap.tripTime,
                    gapMinutes: gap.gap,
                    meetsConnection: gap.meetsConnection,
                    stopCode: pair?.connection.stopCode || '',
                    stopName: pair?.connection.stopName
                };
            });

            return {
                ...trip,
                externalConnections
            };
        })
    }));
}

/**
 * Build the connection report.
 */
function buildReport(originalGaps: GapAnalysis[], newGaps: GapAnalysis[]): ConnectionReportEntry[] {
    const report: ConnectionReportEntry[] = [];

    for (const newGap of newGaps) {
        const originalGap = originalGaps.find(g =>
            g.tripId === newGap.tripId && g.connectionId === newGap.connectionId
        );

        const originalGapValue = originalGap?.gap ?? newGap.gap;
        const wasMetBefore = originalGap ? originalGap.meetsConnection : false;
        const isMetNow = newGap.meetsConnection;

        let status: ConnectionReportEntry['status'];
        if (isMetNow && wasMetBefore) {
            status = 'met';
        } else if (isMetNow && !wasMetBefore) {
            status = 'improved';
        } else if (!isMetNow && wasMetBefore) {
            status = 'worsened';
        } else if (!isMetNow && newGap.gap > originalGapValue) {
            status = 'improved';
        } else if (!isMetNow && newGap.gap < originalGapValue) {
            status = 'worsened';
        } else {
            status = 'missed';
        }

        // Find direction from trip ID or gaps
        const direction: 'North' | 'South' = newGap.tripId.includes('N') ? 'North' : 'South';

        report.push({
            tripId: newGap.tripId,
            tripStartTime: newGap.tripTime,
            direction,
            targetName: newGap.targetName,
            targetTime: newGap.targetTime,
            originalGap: originalGapValue,
            newGap: newGap.gap,
            bufferRequired: newGap.bufferRequired,
            status
        });
    }

    return report;
}

/**
 * Build the optimization summary.
 */
function buildSummary(gaps: GapAnalysis[], shiftApplied?: number): OptimizationSummary {
    const met = gaps.filter(g => g.meetsConnection).length;
    const missed = gaps.filter(g => !g.meetsConnection).length;
    const avgGap = gaps.length > 0
        ? gaps.reduce((sum, g) => sum + g.gap, 0) / gaps.length
        : 0;

    return {
        totalConnections: gaps.length,
        connectionsMet: met,
        connectionsMissed: missed,
        connectionsImproved: 0, // Would need original gaps to calculate
        avgGapImprovement: avgGap,
        shiftApplied
    };
}

/**
 * Create an empty summary.
 */
function createEmptySummary(): OptimizationSummary {
    return {
        totalConnections: 0,
        connectionsMet: 0,
        connectionsMissed: 0,
        connectionsImproved: 0,
        avgGapImprovement: 0
    };
}

// ============ TIME UTILITIES ============

/**
 * Parse time string to minutes from midnight.
 */
function parseTimeToMinutes(timeStr: string): number | null {
    if (!timeStr) return null;

    // Try "HH:MM AM/PM" format
    const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*([ap]m?|[ap])$/i);
    if (match12) {
        let hours = parseInt(match12[1], 10);
        const mins = parseInt(match12[2], 10);
        const periodChar = match12[3].toLowerCase()[0];

        if (periodChar === 'p' && hours !== 12) hours += 12;
        if (periodChar === 'a' && hours === 12) hours = 0;

        return hours * 60 + mins;
    }

    // Try "HH:MM" 24-hour format
    const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        const hours = parseInt(match24[1], 10);
        const mins = parseInt(match24[2], 10);
        return hours * 60 + mins;
    }

    return null;
}

/**
 * Format minutes from midnight to time string.
 */
function formatMinutesToTime(minutes: number): string {
    // Handle negative or overflow
    while (minutes < 0) minutes += 1440;
    minutes = minutes % 1440;

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

    return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}
