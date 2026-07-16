/**
 * Time Cascade Utility
 * When a segment time changes, shift all subsequent trips in the same block.
 */

import { MasterRouteTable, MasterTrip } from '../../../utils/parsers/masterScheduleParser';
import { parseRouteInfo } from '../../../utils/config/routeDirectionConfig';
import { getOperationalSortTime } from '../../../utils/blocks/blockAssignmentCore';

const OPERATIONAL_DAY_START = 240; // 4:00 AM

const getServiceDay = (routeName: string): string | null =>
    routeName.match(/\((Weekday|Saturday|Sunday)\)/i)?.[1]?.toLowerCase() ?? null;

const getRouteScope = (routeName: string): string => {
    const stripped = routeName
        .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
        .replace(/\s*\((North|South)\)/gi, '')
        .replace(/\s+(North|South)\s*$/i, '')
        .trim();
    const parsed = parseRouteInfo(stripped);
    return (parsed.suffixIsDirection ? parsed.baseRoute : stripped).toLowerCase();
};

const tableMatchesScope = (table: MasterRouteTable, sourceTable: MasterRouteTable): boolean =>
    getRouteScope(table.routeName) === getRouteScope(sourceTable.routeName)
    && getServiceDay(table.routeName) === getServiceDay(sourceTable.routeName);

const getOrderedScopedBlockTrips = (
    tables: MasterRouteTable[],
    sourceTable: MasterRouteTable,
    blockId: string,
): MasterTrip[] => tables
    .filter(table => tableMatchesScope(table, sourceTable))
    .flatMap(table => table.trips)
    .filter(trip => trip.blockId === blockId)
    .sort((a, b) => (
        getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime)
        || getOperationalSortTime(a.endTime) - getOperationalSortTime(b.endTime)
        || a.tripNumber - b.tripNumber
        || a.id.localeCompare(b.id)
    ));

const recalculateTripDerivedValues = (trip: MasterTrip, stops: string[]) => {
    let offset = 0;
    let lastAdjusted: number | null = null;
    const stopMinutes: Record<string, number> = {};

    stops.forEach(stop => {
        const raw = parseTimeToMinutes(trip.stops[stop] || '');
        if (raw === null) return;

        if (lastAdjusted === null && raw < OPERATIONAL_DAY_START) offset = 1440;
        if (lastAdjusted !== null && raw + offset < lastAdjusted - 60) offset += 1440;
        const adjusted = raw + offset;
        stopMinutes[stop] = adjusted;
        lastAdjusted = adjusted;
    });

    const values = Object.values(stopMinutes);
    if (values.length === 0) return;

    trip.stopMinutes = stopMinutes;
    trip.startTime = values[0];
    trip.endTime = values[values.length - 1];
    trip.recoveryTime = Object.values(trip.recoveryTimes || {}).reduce(
        (sum, value) => sum + (value || 0),
        0,
    );
    trip.cycleTime = Math.max(0, trip.endTime - trip.startTime);
    trip.travelTime = Math.max(0, trip.cycleTime - trip.recoveryTime);
    trip.endTimeIncludesRecovery = true;
};

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
    const cloned: MasterRouteTable[] = structuredClone(schedules);

    // Find the edited trip and its block
    let editedTrip: MasterTrip | null = null;
    let editedBlockId: string | null = null;
    let editedTable: MasterRouteTable | null = null;

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            editedTrip = found;
            editedBlockId = found.blockId;
            editedTable = table;
            break;
        }
    }

    if (!editedTrip || !editedBlockId || !editedTable) return cloned;

    const orderedBlockTrips = getOrderedScopedBlockTrips(cloned, editedTable, editedBlockId);
    const editedIndex = orderedBlockTrips.findIndex(trip => trip.id === editedTrip.id);
    if (editedIndex === -1) return cloned;
    const followingTrips = new Set(orderedBlockTrips.slice(editedIndex + 1));

    for (const table of cloned) {
        if (!tableMatchesScope(table, editedTable)) continue;
        for (const trip of table.trips) {
            if (followingTrips.has(trip)) {
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

                if (trip.stopMinutes) {
                    for (const [stop, minutes] of Object.entries(trip.stopMinutes)) {
                        trip.stopMinutes[stop] = minutes + deltaMinutes;
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
    const cloned: MasterRouteTable[] = structuredClone(schedules);

    // Find the trip
    let editedTrip: MasterTrip | null = null;
    let stopIndex = -1;
    let allStops: string[] = [];
    let editedTable: MasterRouteTable | null = null;

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            editedTrip = found;
            allStops = table.stops;
            stopIndex = allStops.indexOf(stopName);
            editedTable = table;
            break;
        }
    }

    if (!editedTrip || !editedTable || stopIndex === -1) return cloned;

    // Update this stop and all subsequent stops in the same trip
    for (let i = stopIndex; i < allStops.length; i++) {
        const stop = allStops[i];

        if (editedTrip.stops[stop]) {
            const mins = parseTimeToMinutes(editedTrip.stops[stop]);
            if (mins !== null) {
                editedTrip.stops[stop] = formatMinutesToTime(mins + deltaMinutes);
            }
        }

        if (editedTrip.stopMinutes && editedTrip.stopMinutes[stop] !== undefined) {
            editedTrip.stopMinutes[stop] = editedTrip.stopMinutes[stop] + deltaMinutes;
        } else if (editedTrip.stopMinutes && editedTrip.stops[stop]) {
            const mins = parseTimeToMinutes(editedTrip.stops[stop]);
            if (mins !== null) {
                editedTrip.stopMinutes[stop] = mins + deltaMinutes;
            }
        }

        if (editedTrip.arrivalTimes?.[stop]) {
            const mins = parseTimeToMinutes(editedTrip.arrivalTimes[stop]);
            if (mins !== null) {
                editedTrip.arrivalTimes[stop] = formatMinutesToTime(mins + deltaMinutes);
            }
        }
    }

    const oldEndTime = editedTrip.endTime;
    recalculateTripDerivedValues(editedTrip, allStops);
    const actualEndDelta = editedTrip.endTime - oldEndTime;

    // Cascade to subsequent trips in block
    return cascadeTripTimes(cloned, tripId, actualEndDelta);
}

/**
 * Remove all trips after a given trip in the same block.
 * Used for "End Block Here" functionality.
 */
export function endBlockAtTrip(
    schedules: MasterRouteTable[],
    tripId: string
): MasterRouteTable[] {
    const cloned: MasterRouteTable[] = structuredClone(schedules);

    // Find the trip
    let editedTrip: MasterTrip | null = null;
    let editedBlockId: string | null = null;
    let editedTable: MasterRouteTable | null = null;

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            editedTrip = found;
            editedBlockId = found.blockId;
            editedTable = table;
            break;
        }
    }

    if (!editedTrip || !editedBlockId || !editedTable) return cloned;

    const orderedBlockTrips = getOrderedScopedBlockTrips(cloned, editedTable, editedBlockId);
    const editedIndex = orderedBlockTrips.findIndex(trip => trip.id === editedTrip.id);
    if (editedIndex === -1) return cloned;
    const tripsToRemove = new Set(orderedBlockTrips.slice(editedIndex + 1));

    for (const table of cloned) {
        if (!tableMatchesScope(table, editedTable)) continue;
        table.trips = table.trips.filter(trip => !tripsToRemove.has(trip));
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
    const cloned: MasterRouteTable[] = structuredClone(schedules);

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            if (startStopIndex < 0 || startStopIndex >= table.stops.length) return cloned;
            if (parseTimeToMinutes(found.stops[table.stops[startStopIndex]] || '') === null) return cloned;
            found.startStopIndex = startStopIndex;

            // Clean up orphaned stops before the new start index
            const stops = table.stops;
            if (startStopIndex > 0) {
                const stopsToRemove = stops.slice(0, startStopIndex);
                stopsToRemove.forEach(s => {
                    delete found.stops[s];
                    if (found.arrivalTimes) delete found.arrivalTimes[s];
                    if (found.recoveryTimes) delete found.recoveryTimes[s];
                    if (found.stopMinutes) delete found.stopMinutes[s];
                });
            }

            recalculateTripDerivedValues(found, stops.slice(startStopIndex));
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
    const cloned: MasterRouteTable[] = structuredClone(schedules);

    for (const table of cloned) {
        const found = table.trips.find(t => t.id === tripId);
        if (found) {
            if (endStopIndex < 0 || endStopIndex >= table.stops.length) return cloned;
            if (parseTimeToMinutes(found.stops[table.stops[endStopIndex]] || '') === null) return cloned;
            found.endStopIndex = endStopIndex;

            // Clean up orphaned stops after the new end index
            const stops = table.stops;
            if (endStopIndex < stops.length - 1) {
                const stopsToRemove = stops.slice(endStopIndex + 1);
                stopsToRemove.forEach(s => {
                    delete found.stops[s];
                    if (found.arrivalTimes) delete found.arrivalTimes[s];
                    if (found.recoveryTimes) delete found.recoveryTimes[s];
                    if (found.stopMinutes) delete found.stopMinutes[s];
                });
            }

            recalculateTripDerivedValues(found, stops.slice(0, endStopIndex + 1));
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
