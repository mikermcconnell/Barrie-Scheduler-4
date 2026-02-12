import type { DwellEvent, ConflictWindow, PlatformAnalysis } from './types';

function normalizeId(value?: string): string | null {
    const normalized = value?.trim().toUpperCase() || '';
    return normalized.length > 0 ? normalized : null;
}

// Prefer GTFS block continuity (physical vehicle), then fallback to blockId.
// This avoids false conflicts when the same bus interlines across route labels.
function getVehicleKey(event: DwellEvent): string {
    const gtfsKey = normalizeId(event.gtfsBlockId);
    if (gtfsKey) return `gtfs:${gtfsKey}`;

    const blockKey = normalizeId(event.blockId);
    if (blockKey) return `block:${blockKey}`;

    return `trip:${event.tripId}`;
}

// Helper: count unique physical buses in a list of active events.
function countUniqueVehicles(events: DwellEvent[]): number {
    const vehicles = new Set<string>();
    for (const e of events) {
        vehicles.add(getVehicleKey(e));
    }
    return vehicles.size;
}

/**
 * Calculate platform metrics including peak counts and conflict detection.
 */
export function calculatePlatformMetrics(platform: PlatformAnalysis): void {
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

    // Sort by time. At same time:
    //   - Same event: arrival before departure (so zero-dwell events work correctly)
    //   - Different events: departures before arrivals (prevents overcounting handoffs)
    changes.sort((a, b) => {
        if (a.time !== b.time) return a.time - b.time;
        const sameEvent = a.event.eventUid === b.event.eventUid;
        if (sameEvent) return b.delta - a.delta; // +1 (arrival) before -1 (departure)
        return a.delta - b.delta; // -1 (departure) before +1 (arrival)
    });

    // Sweep-line to find peaks and conflicts
    let peakBusCount = 0;
    const activeEvents: DwellEvent[] = [];
    const conflictWindows: ConflictWindow[] = [];
    const peakWindows: ConflictWindow[] = [];
    let conflictStart: number | null = null;

    for (const change of changes) {
        const prevBusCount = countUniqueVehicles(activeEvents);

        if (change.delta === 1) {
            activeEvents.push(change.event);
        } else {
            const idx = activeEvents.findIndex(e => e.eventUid === change.event.eventUid);
            if (idx !== -1) activeEvents.splice(idx, 1);
        }

        const currentBusCount = countUniqueVehicles(activeEvents);

        // Track peak
        if (currentBusCount > peakBusCount) {
            peakBusCount = currentBusCount;
        }

        // Detect conflict transitions (exceeds capacity)
        if (currentBusCount > platform.capacity && prevBusCount <= platform.capacity) {
            conflictStart = change.time;
        }
        if (currentBusCount <= platform.capacity && prevBusCount > platform.capacity && conflictStart !== null) {
            // Ignore instantaneous spikes (start === end). These usually come from
            // same-minute handoffs/zero-dwell points and are not actionable conflicts.
            if (change.time > conflictStart) {
                const overlappingEvents = platform.events.filter(e =>
                    e.arrivalMin < change.time && e.departureMin > conflictStart!
                );

                if (overlappingEvents.length > 0) {
                    conflictWindows.push({
                        startMin: conflictStart,
                        endMin: change.time,
                        busCount: prevBusCount,
                        events: [...overlappingEvents]
                    });
                }
            }
            conflictStart = null;
        }
    }

    platform.peakCount = peakBusCount;
    platform.hasConflict = conflictWindows.length > 0;
    platform.conflictWindows = conflictWindows;

    // Identify peak windows (times when unique bus count equals peak)
    const activePeakEvents: DwellEvent[] = [];

    for (const change of changes) {
        const prevBuses = countUniqueVehicles(activePeakEvents);

        if (change.delta === 1) {
            activePeakEvents.push(change.event);
        } else {
            const idx = activePeakEvents.findIndex(e => e.eventUid === change.event.eventUid);
            if (idx !== -1) activePeakEvents.splice(idx, 1);
        }

        const currentBuses = countUniqueVehicles(activePeakEvents);

        if (currentBuses === peakBusCount && prevBuses < peakBusCount) {
            // Entering a peak window
            peakWindows.push({
                startMin: change.time,
                endMin: change.time, // placeholder, updated on exit
                busCount: peakBusCount,
                events: [...activePeakEvents]
            });
        }
        if (currentBuses < peakBusCount && prevBuses === peakBusCount && peakWindows.length > 0) {
            // Exiting a peak window — update end time of last window
            peakWindows[peakWindows.length - 1].endMin = change.time;
        }
    }

    platform.peakWindows = peakWindows;
}
