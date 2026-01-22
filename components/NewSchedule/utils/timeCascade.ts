/**
 * Time Cascade Utility
 * When a segment time changes, shift all subsequent trips in the same block.
 */

import { MasterRouteTable, MasterTrip } from '../../../utils/masterScheduleParser';

/**
 * Cascade time changes to all subsequent trips in the same block.
 * @param schedules Current schedule state
 * @param tripId Trip being edited
 * @param deltaMinutes Change in minutes (+/-)
 * @returns Updated schedules with cascaded times
 */
export function cascadeTripTimes(
    schedules: MasterRouteTable[],
    tripId: string,
    deltaMinutes: number
): MasterRouteTable[] {
    // Deep clone to avoid mutation
    const cloned: MasterRouteTable[] = JSON.parse(JSON.stringify(schedules));

    // Find the edited trip and its block
    let editedTrip: MasterTrip | null = null;
    let editedBlockId: string | null = null;

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            editedTrip = found;
            editedBlockId = found.blockId;
            break;
        }
    }

    if (!editedTrip || !editedBlockId) return cloned;

    // Find all trips in the same block with higher tripNumber
    for (const table of cloned) {
        for (const trip of table.trips) {
            if (trip.blockId === editedBlockId && trip.tripNumber > editedTrip.tripNumber) {
                // Shift all times
                trip.startTime += deltaMinutes;
                trip.endTime += deltaMinutes;

                // Shift stop times
                if (trip.stops) {
                    for (const [stop, timeStr] of Object.entries(trip.stops)) {
                        const mins = parseTimeToMinutes(timeStr);
                        if (mins !== null) {
                            trip.stops[stop] = formatMinutesToTime(mins + deltaMinutes);
                        }
                    }
                }

                // Shift arrival times
                if (trip.arrivalTimes) {
                    for (const [stop, timeStr] of Object.entries(trip.arrivalTimes)) {
                        const mins = parseTimeToMinutes(timeStr);
                        if (mins !== null) {
                            trip.arrivalTimes[stop] = formatMinutesToTime(mins + deltaMinutes);
                        }
                    }
                }
            }
        }
    }

    return cloned;
}

/**
 * Update a single trip's segment time and cascade changes.
 * @param schedules Current schedule state
 * @param tripId Trip being edited
 * @param stopName Stop whose time is being changed
 * @param deltaMinutes Change in minutes (+/-)
 * @returns Updated schedules with all times adjusted
 */
export function updateSegmentTime(
    schedules: MasterRouteTable[],
    tripId: string,
    stopName: string,
    deltaMinutes: number
): MasterRouteTable[] {
    const cloned: MasterRouteTable[] = JSON.parse(JSON.stringify(schedules));

    // Find the trip
    let editedTrip: MasterTrip | null = null;
    let stopIndex = -1;
    let allStops: string[] = [];

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            editedTrip = found;
            allStops = table.stops;
            stopIndex = allStops.indexOf(stopName);
            break;
        }
    }

    if (!editedTrip || stopIndex === -1) return cloned;

    // Update this stop and all subsequent stops in the same trip
    for (let i = stopIndex; i < allStops.length; i++) {
        const stop = allStops[i];

        if (editedTrip.stops[stop]) {
            const mins = parseTimeToMinutes(editedTrip.stops[stop]);
            if (mins !== null) {
                editedTrip.stops[stop] = formatMinutesToTime(mins + deltaMinutes);
            }
        }

        if (editedTrip.arrivalTimes?.[stop]) {
            const mins = parseTimeToMinutes(editedTrip.arrivalTimes[stop]);
            if (mins !== null) {
                editedTrip.arrivalTimes[stop] = formatMinutesToTime(mins + deltaMinutes);
            }
        }
    }

    // Update trip endTime
    editedTrip.endTime += deltaMinutes;

    // Cascade to subsequent trips in block
    return cascadeTripTimes(cloned, tripId, deltaMinutes);
}

/**
 * Remove all trips after a given trip in the same block.
 * Used for "End Block Here" functionality.
 */
export function endBlockAtTrip(
    schedules: MasterRouteTable[],
    tripId: string
): MasterRouteTable[] {
    const cloned: MasterRouteTable[] = JSON.parse(JSON.stringify(schedules));

    // Find the trip
    let editedTrip: MasterTrip | null = null;
    let editedBlockId: string | null = null;

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            editedTrip = found;
            editedBlockId = found.blockId;
            break;
        }
    }

    if (!editedTrip || !editedBlockId) return cloned;

    // Remove all trips with same blockId and higher tripNumber
    for (const table of cloned) {
        table.trips = table.trips.filter(trip =>
            trip.blockId !== editedBlockId ||
            trip.tripNumber <= editedTrip!.tripNumber
        );
    }

    return cloned;
}

/**
 * Set the start stop for a trip (partial trip - starts mid-route).
 */
export function setTripStartStop(
    schedules: MasterRouteTable[],
    tripId: string,
    startStopIndex: number
): MasterRouteTable[] {
    const cloned: MasterRouteTable[] = JSON.parse(JSON.stringify(schedules));

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            found.startStopIndex = startStopIndex;

            // Clean up orphaned stops before the new start index
            const stops = table.stops;
            if (startStopIndex > 0) {
                const stopsToRemove = stops.slice(0, startStopIndex);
                stopsToRemove.forEach(s => {
                    delete found.stops[s];
                    if (found.arrivalTimes) delete found.arrivalTimes[s];
                    if (found.recoveryTimes) delete found.recoveryTimes[s];
                });
            }

            // Recalculate startTime based on new first stop
            if (startStopIndex < stops.length) {
                const newFirstStop = stops[startStopIndex];
                const newStartTime = parseTimeToMinutes(found.stops[newFirstStop] || '');
                if (newStartTime !== null) {
                    found.startTime = newStartTime;
                }
            }
            break;
        }
    }

    return cloned;
}

/**
 * Set the end stop for a trip (partial trip - ends mid-route).
 */
export function setTripEndStop(
    schedules: MasterRouteTable[],
    tripId: string,
    endStopIndex: number
): MasterRouteTable[] {
    const cloned: MasterRouteTable[] = JSON.parse(JSON.stringify(schedules));

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            found.endStopIndex = endStopIndex;

            // Clean up orphaned stops after the new end index
            const stops = table.stops;
            if (endStopIndex < stops.length - 1) {
                const stopsToRemove = stops.slice(endStopIndex + 1);
                stopsToRemove.forEach(s => {
                    delete found.stops[s];
                    if (found.arrivalTimes) delete found.arrivalTimes[s];
                    if (found.recoveryTimes) delete found.recoveryTimes[s];
                });
            }

            // Recalculate endTime based on new last stop
            if (endStopIndex < stops.length) {
                const newLastStop = stops[endStopIndex];
                const newEndTime = parseTimeToMinutes(found.stops[newLastStop] || '');
                if (newEndTime !== null) {
                    found.endTime = newEndTime;
                }
            }
            break;
        }
    }

    return cloned;
}

// --- Helper Functions ---

function parseTimeToMinutes(timeStr: string): number | null {
    if (!timeStr) return null;

    const str = timeStr.trim().toLowerCase();
    const match = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);

    if (!match) return null;

    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const period = match[3]?.toLowerCase();

    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;

    return h * 60 + m;
}

function formatMinutesToTime(minutes: number): string {
    // Normalize to 0-1439 range (handles negative and overflow)
    let normalized = minutes % 1440;
    if (normalized < 0) normalized += 1440;

    const h = Math.floor(normalized / 60);
    const m = Math.round(normalized % 60);

    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;

    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}
