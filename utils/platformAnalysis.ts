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
 * Parse time string to minutes from midnight
 */
function parseTimeToMinutes(timeStr: string): number {
    if (!timeStr) return 0;

    const str = timeStr.trim().toLowerCase();
    const [hStr, mStr] = str.split(':');
    let h = parseInt(hStr);
    let m = parseInt(mStr?.replace(/\D+/g, '') || '0');

    if (str.includes('pm') && h !== 12) h += 12;
    if (str.includes('am') && h === 12) h = 0;

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

    // Sort by time, arrivals before departures at same time
    changes.sort((a, b) => a.time - b.time || b.delta - a.delta);

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
    const peakEvents: DwellEvent[] = [];

    for (const change of changes) {
        if (change.delta === 1) {
            currentCount++;
            if (currentCount === peakCount && !inPeak) {
                inPeak = true;
                peakWindowStart = change.time;
            }
            if (currentCount === peakCount) {
                peakEvents.push(change.event);
            }
        } else {
            if (currentCount === peakCount && inPeak) {
                peakWindows.push({
                    startMin: peakWindowStart,
                    endMin: change.time,
                    busCount: peakCount,
                    events: [...peakEvents]
                });
                peakEvents.length = 0;
            }
            currentCount--;
            if (currentCount < peakCount) {
                inPeak = false;
            }
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

    // Debug: Log input data
    console.log('[PlatformAnalysis] Processing', scheduleContents.length, 'schedules for routes:', routeNumbers);

    // Track unique events to detect duplicates
    const seenEvents = new Set<string>();

    // Process each schedule's trips
    for (let i = 0; i < scheduleContents.length; i++) {
        const content = scheduleContents[i];
        const routeNumber = routeNumbers[i] || content.metadata?.routeNumber || 'Unknown';

        for (const table of [content.northTable, content.southTable]) {
            if (!table?.trips) continue;

            const direction = table === content.northTable ? 'North' : 'South';

            // Debug: Log stop names and IDs from first trip
            if (table.trips.length > 0) {
                const firstTrip = table.trips[0];
                const stopNames = Object.keys(firstTrip.stops);
                const stopIdsInfo = stopNames.map(s => `${s}=${table.stopIds?.[s] || '?'}`).join(', ');
                console.log(`[PlatformAnalysis] Route ${routeNumber} ${direction} has ${table.trips.length} trips`);
                console.log(`  Stops with IDs: ${stopIdsInfo}`);
            }

            for (const trip of table.trips) {
                // For each stop in the trip
                for (const [stopName, departureTime] of Object.entries(trip.stops)) {
                    if (!departureTime) continue;

                    // Get stop ID for precise matching
                    const stopId = table.stopIds?.[stopName];
                    const hub = matchStopToHub(stopName, stopId);
                    if (!hub) continue;

                    const platformAssignment = getPlatformForRoute(hub, routeNumber);
                    if (!platformAssignment) {
                        console.log(`[PlatformAnalysis] Route ${routeNumber} matched hub "${hub.name}" (stop ${stopId || stopName}) but no platform assignment`);
                        continue;
                    }

                    // Create unique key to detect duplicates
                    const eventKey = `${routeNumber}-${trip.blockId}-${direction}-${stopName}-${departureTime}`;
                    if (seenEvents.has(eventKey)) {
                        console.warn(`[PlatformAnalysis] DUPLICATE event detected:`, eventKey);
                        continue;
                    }
                    seenEvents.add(eventKey);

                    const hubAnalysis = hubAnalyses.get(hub.name);
                    if (!hubAnalysis) continue;

                    const platform = hubAnalysis.platforms.find(p => p.platformId === platformAssignment.platformId);
                    if (!platform) continue;

                    // Calculate times
                    const arrivalMin = getArrivalTime(trip, stopName);
                    const departureMin = parseTimeToMinutes(departureTime);

                    // Skip invalid times (but allow midnight = 0)
                    if (departureMin < 0 || arrivalMin < 0) continue;

                    platform.events.push({
                        tripId: trip.id,
                        route: routeNumber,
                        direction: trip.direction,
                        arrivalMin,
                        departureMin,
                        blockId: trip.blockId,
                        stopName
                    });
                }
            }
        }
    }

    // Calculate metrics for each platform
    for (const hubAnalysis of hubAnalyses.values()) {
        for (const platform of hubAnalysis.platforms) {
            calculatePlatformMetrics(platform);

            // Debug: Log platform results
            if (platform.events.length > 0) {
                console.log(`[PlatformAnalysis] ${hubAnalysis.hubName} ${platform.platformId}: ${platform.events.length} events, peak=${platform.peakCount}, conflicts=${platform.conflictWindows.length}`);

                // Show sample of events if there are conflicts
                if (platform.peakCount > 1) {
                    const sampleEvents = platform.events.slice(0, 5).map(e =>
                        `${e.route} block ${e.blockId} ${e.direction}: ${formatMinutesToTime(e.arrivalMin)}-${formatMinutesToTime(e.departureMin)}`
                    );
                    console.log(`  Sample events:`, sampleEvents);
                }
            }
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
