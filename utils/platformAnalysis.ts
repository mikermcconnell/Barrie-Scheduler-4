/**
 * Platform Analysis
 *
 * Aggregates schedule data to analyze platform utilization at transit hubs.
 * Detects overlaps (conflicts) when multiple buses occupy the same platform.
 */

import type { MasterTrip, MasterRouteTable } from './masterScheduleParser';
import type { MasterScheduleContent, DayType } from './masterScheduleTypes';
import { HUBS, matchStopToHub, getPlatformForRoute, type HubConfig, type PlatformAssignment } from './platformConfig';

// Default dwell time when arrivalTimes not available (minutes)
const DEFAULT_DWELL_MINUTES = 2;

export interface DwellEvent {
    tripId: string;
    route: string;
    direction: 'North' | 'South';
    arrivalMin: number;      // Minutes from midnight
    departureMin: number;
    blockId: string;
    stopName: string;
}

export interface ConflictWindow {
    startMin: number;
    endMin: number;
    busCount: number;
    events: DwellEvent[];
}

export interface PlatformAnalysis {
    platformId: string;
    routes: string[];
    capacity: number;
    events: DwellEvent[];
    peakCount: number;
    peakWindows: ConflictWindow[];
    totalVisits: number;
    hasConflict: boolean;    // buses > capacity at same time
    conflictWindows: ConflictWindow[];
}

export interface HubAnalysis {
    hubName: string;
    platforms: PlatformAnalysis[];
    totalDailyVisits: number;
    conflictCount: number;   // Total platforms with conflicts
    totalConflictWindows: number;
}

/**
 * Parse time string to minutes from midnight.
 * Handles multiple formats:
 * - 12-hour with AM/PM: "6:30 AM", "11:45 PM"
 * - 24-hour: "06:30", "23:45"
 * - Excel day fractions: 0.5 = 12:00 PM, 1.02 = 12:30 AM (next day)
 */
function parseTimeToMinutes(timeStr: string): number {
    if (!timeStr) return -1;

    const str = timeStr.trim();

    // Handle Excel numeric format (day fractions)
    const numVal = parseFloat(str);
    if (!isNaN(numVal) && !str.includes(':')) {
        // Excel stores times as fractions of a day
        // Values >= 1.0 are post-midnight (next day)
        const fractional = numVal >= 1 ? numVal - Math.floor(numVal) : numVal;
        const totalMinutes = Math.round(fractional * 24 * 60);
        return totalMinutes;
    }

    // Handle string time formats
    const lowerStr = str.toLowerCase();
    const [hStr, mStr] = str.split(':');
    let h = parseInt(hStr);
    let m = parseInt(mStr?.replace(/\D+/g, '') || '0');

    if (isNaN(h) || isNaN(m)) return -1;

    // Check for AM/PM
    const hasAm = lowerStr.includes('am');
    const hasPm = lowerStr.includes('pm');

    if (hasPm && h !== 12) h += 12;
    if (hasAm && h === 12) h = 0;

    // If no AM/PM marker and hour > 12, assume 24-hour format (already correct)
    // If no AM/PM and hour <= 12, we assume it's already in correct format

    return (h * 60) + m;
}

/**
 * Format minutes to time string
 */
export function formatMinutesToTime(minutes: number): string {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
}

/**
 * Get arrival time for a trip at a stop.
 * Falls back to departure - dwell if arrivalTimes not available.
 */
function getArrivalTime(trip: MasterTrip, stopName: string): number {
    // Try arrivalTimes first
    if (trip.arrivalTimes?.[stopName]) {
        return parseTimeToMinutes(trip.arrivalTimes[stopName]);
    }

    // Fallback: departure - recovery time
    const departure = parseTimeToMinutes(trip.stops[stopName]);
    const dwell = trip.recoveryTimes?.[stopName] || DEFAULT_DWELL_MINUTES;
    return departure - dwell;
}

/**
 * Calculate platform metrics including peak counts and conflict detection
 */
function calculatePlatformMetrics(platform: PlatformAnalysis): void {
    if (platform.events.length === 0) {
        platform.totalVisits = 0;
        platform.peakCount = 0;
        return;
    }

    platform.totalVisits = platform.events.length;

    // Create time-based events for sweep-line algorithm
    type TimeEvent = { time: number; delta: 1 | -1; event: DwellEvent };
    const changes: TimeEvent[] = [];

    for (const event of platform.events) {
        changes.push({ time: event.arrivalMin, delta: 1, event });
        changes.push({ time: event.departureMin, delta: -1, event });
    }

    // Sort by time, departures before arrivals at same time
    // This prevents overcounting when one bus departs exactly as another arrives
    changes.sort((a, b) => a.time - b.time || a.delta - b.delta);

    // Sweep-line to find peaks and conflicts
    let currentCount = 0;
    let peakCount = 0;
    const activeEvents: DwellEvent[] = [];
    const conflictWindows: ConflictWindow[] = [];
    const peakWindows: ConflictWindow[] = [];
    let conflictStart: number | null = null;
    let peakStart: number | null = null;

    for (const change of changes) {
        const prevCount = currentCount;

        if (change.delta === 1) {
            // Arrival
            currentCount++;
            activeEvents.push(change.event);

            // Track peak
            if (currentCount > peakCount) {
                peakCount = currentCount;
                peakStart = change.time;
            }

            // Detect conflict start (exceeds capacity)
            if (currentCount > platform.capacity && prevCount <= platform.capacity) {
                conflictStart = change.time;
            }
        } else {
            // Departure
            currentCount--;
            const idx = activeEvents.findIndex(e => e.tripId === change.event.tripId);
            if (idx !== -1) activeEvents.splice(idx, 1);

            // Record conflict window end
            if (currentCount <= platform.capacity && prevCount > platform.capacity && conflictStart !== null) {
                conflictWindows.push({
                    startMin: conflictStart,
                    endMin: change.time,
                    busCount: prevCount,
                    events: [...platform.events.filter(e =>
                        e.arrivalMin < change.time && e.departureMin > conflictStart!
                    )]
                });
                conflictStart = null;
            }
        }
    }

    platform.peakCount = peakCount;
    platform.hasConflict = conflictWindows.length > 0;
    platform.conflictWindows = conflictWindows;

    // Identify peak windows (times when count equals peak)
    // Re-scan to find all peak periods
    currentCount = 0;
    let inPeak = false;
    let peakWindowStart = 0;
    const activePeakEvents: DwellEvent[] = [];

    for (const change of changes) {
        if (change.delta === 1) {
            // Arrival - add to active events
            currentCount++;
            activePeakEvents.push(change.event);

            if (currentCount === peakCount && !inPeak) {
                inPeak = true;
                peakWindowStart = change.time;
            }
        } else {
            // Departure - check if ending a peak window before removing
            if (currentCount === peakCount && inPeak) {
                peakWindows.push({
                    startMin: peakWindowStart,
                    endMin: change.time,
                    busCount: peakCount,
                    events: [...activePeakEvents]
                });
                inPeak = false;
            }

            // Remove departing event from active list
            currentCount--;
            const idx = activePeakEvents.findIndex(e => e.tripId === change.event.tripId);
            if (idx !== -1) activePeakEvents.splice(idx, 1);
        }
    }

    platform.peakWindows = peakWindows;
}

/**
 * Main analysis function.
 * Aggregates all schedule data into platform utilization metrics.
 */
export function aggregatePlatformData(
    scheduleContents: MasterScheduleContent[],
    routeNumbers: string[]
): HubAnalysis[] {
    // Initialize hub analyses
    const hubAnalyses: Map<string, HubAnalysis> = new Map();

    for (const hub of HUBS) {
        hubAnalyses.set(hub.name, {
            hubName: hub.name,
            platforms: hub.platforms
                .filter(p => p.routes.length > 0)  // Only platforms with Barrie Transit routes
                .map(p => ({
                    platformId: p.platformId,
                    routes: p.routes,
                    capacity: p.capacity || 1,
                    events: [],
                    peakCount: 0,
                    peakWindows: [],
                    totalVisits: 0,
                    hasConflict: false,
                    conflictWindows: []
                })),
            totalDailyVisits: 0,
            conflictCount: 0,
            totalConflictWindows: 0
        });
    }

    // Process each schedule's trips
    for (let i = 0; i < scheduleContents.length; i++) {
        const content = scheduleContents[i];
        const routeNumber = routeNumbers[i] || content.metadata?.routeNumber || 'Unknown';

        for (const table of [content.northTable, content.southTable]) {
            if (!table?.trips) continue;

            const direction = table === content.northTable ? 'North' : 'South';

            // Track merged events per trip per hub (to merge arrival/departure columns)
            // Key: `${tripId}-${hubName}-${platformId}` → event index in platform.events
            const tripHubEvents = new Map<string, { platformEvents: DwellEvent[], eventIndex: number }>();

            for (const trip of table.trips) {
                // For each stop in the trip
                for (const [stopName, departureTime] of Object.entries(trip.stops)) {
                    if (!departureTime) continue;

                    // Normalize stop name by removing suffixes like "(2)", " 1", etc.
                    // This merges "Park Place" and "Park Place (2)" into the same hub visit
                    const normalizedStopName = stopName
                        .replace(/\s*\(\d+\)\s*$/, '')  // Remove (1), (2) suffixes
                        .replace(/\s+\d+\s*$/, '')       // Remove trailing " 1", " 2"
                        .trim();

                    // Get stop ID for precise matching (try original name first, then normalized)
                    const stopId = table.stopIds?.[stopName] || table.stopIds?.[normalizedStopName];
                    const hub = matchStopToHub(normalizedStopName, stopId);
                    if (!hub) continue;

                    const platformAssignment = getPlatformForRoute(hub, routeNumber);
                    if (!platformAssignment) continue;

                    const hubAnalysis = hubAnalyses.get(hub.name);
                    if (!hubAnalysis) continue;

                    const platform = hubAnalysis.platforms.find(p => p.platformId === platformAssignment.platformId);
                    if (!platform) continue;

                    // Calculate times
                    let arrivalMin = getArrivalTime(trip, stopName);
                    let departureMin = parseTimeToMinutes(departureTime);

                    // Skip invalid times
                    if (departureMin < 0 || arrivalMin < 0) continue;

                    // Handle post-midnight trips
                    if (arrivalMin > departureMin && arrivalMin > 1200 && departureMin < 240) {
                        departureMin += 1440;
                    }
                    if (arrivalMin > departureMin) continue;

                    // Create key for merging arrival/departure at same hub
                    // One event per trip per hub per platform (merges "Park Place" + "Park Place (2)")
                    const mergeKey = `${trip.id}-${hub.name}-${platformAssignment.platformId}`;
                    const existing = tripHubEvents.get(mergeKey);

                    if (existing) {
                        // Merge: use earliest arrival, latest departure
                        const event = existing.platformEvents[existing.eventIndex];
                        event.arrivalMin = Math.min(event.arrivalMin, arrivalMin);
                        event.departureMin = Math.max(event.departureMin, departureMin);
                    } else {
                        // Create new event
                        const newEvent: DwellEvent = {
                            tripId: trip.id,
                            route: routeNumber,
                            direction,
                            arrivalMin,
                            departureMin,
                            blockId: trip.blockId,
                            stopName: normalizedStopName
                        };
                        const eventIndex = platform.events.length;
                        platform.events.push(newEvent);
                        tripHubEvents.set(mergeKey, { platformEvents: platform.events, eventIndex });
                    }
                }
            }
        }
    }

    // Calculate metrics for each platform
    for (const hubAnalysis of hubAnalyses.values()) {
        for (const platform of hubAnalysis.platforms) {
            calculatePlatformMetrics(platform);
        }

        // Aggregate hub totals
        hubAnalysis.totalDailyVisits = hubAnalysis.platforms.reduce((sum, p) => sum + p.totalVisits, 0);
        hubAnalysis.conflictCount = hubAnalysis.platforms.filter(p => p.hasConflict).length;
        hubAnalysis.totalConflictWindows = hubAnalysis.platforms.reduce((sum, p) => sum + p.conflictWindows.length, 0);
    }

    return Array.from(hubAnalyses.values());
}

/**
 * Get a summary of conflicts for display
 */
export function getConflictSummary(analysis: HubAnalysis[]): {
    totalHubsWithConflicts: number;
    totalConflicts: number;
    worstHub: string | null;
    worstPlatform: { hub: string; platform: string; peakCount: number } | null;
} {
    let totalHubsWithConflicts = 0;
    let totalConflicts = 0;
    let worstHub: string | null = null;
    let worstHubConflicts = 0;
    let worstPlatform: { hub: string; platform: string; peakCount: number } | null = null;

    for (const hub of analysis) {
        if (hub.conflictCount > 0) {
            totalHubsWithConflicts++;
            totalConflicts += hub.totalConflictWindows;

            if (hub.totalConflictWindows > worstHubConflicts) {
                worstHubConflicts = hub.totalConflictWindows;
                worstHub = hub.hubName;
            }
        }

        for (const platform of hub.platforms) {
            if (!worstPlatform || platform.peakCount > worstPlatform.peakCount) {
                worstPlatform = {
                    hub: hub.hubName,
                    platform: platform.platformId,
                    peakCount: platform.peakCount
                };
            }
        }
    }

    return { totalHubsWithConflicts, totalConflicts, worstHub, worstPlatform };
}
