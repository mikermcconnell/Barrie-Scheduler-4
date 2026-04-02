/**
 * useScheduleEditing Hook
 *
 * Extracted from ScheduleEditor.tsx to handle:
 * - Cell editing with time cascade
 * - Recovery time editing
 * - Trip deletion and duplication
 * - Direction changes
 * - Block reassignment after edits
 */

import { useCallback } from 'react';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import { validateRouteTable } from '../utils/parsers/masterScheduleParser';
import { TimeUtils } from '../utils/timeUtils';
import { deepCloneSchedules, findTableAndTrip } from '../utils/schedule/scheduleEditorUtils';
import { reassignBlocksForTables, MatchConfigPresets } from '../utils/blocks/blockAssignmentCore';
import { parseRouteInfo } from '../utils/config/routeDirectionConfig';
import { createTripLineageId } from '../utils/schedule/tripLineage';

export type CascadeMode = 'always' | 'within-trip' | 'none';

export interface UseScheduleEditingOptions {
    cascadeMode?: CascadeMode;
    logAction?: (type: string, message: string, details: object) => void;
    showSuccessToast?: (msg: string) => void;
}

export interface UseScheduleEditingResult {
    handleCellEdit: (tripId: string, col: string, val: string) => void;
    handleRecoveryEdit: (tripId: string, stopName: string, delta: number) => void;
    handleTimeAdjust: (tripId: string, stopName: string, delta: number) => void;
    handleDeleteTrip: (tripId: string) => void;
    handleDuplicateTrip: (tripId: string) => void;
    handleDirectionChange: (tableRouteName: string, direction: 'North' | 'South') => void;
}

/**
 * Extract the true base route name (handles 2A/2B direction variants)
 */
const getTrueBaseRoute = (routeName: string): string => {
    const stripped = routeName
        .replace(/\s*\((North|South)\)/gi, '')
        .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
        .trim();
    const parsed = parseRouteInfo(stripped);
    return parsed.suffixIsDirection ? parsed.baseRoute : stripped;
};

/**
 * Recalculate trip times based on stop values
 */
const MIDNIGHT_ROLLOVER_THRESHOLD = 210; // 3:30 AM

const recalculateTrip = (trip: MasterTrip, cols: string[]) => {
    let start: number | null = null;
    let end: number | null = null;
    let offset = 0;
    let lastAdjusted: number | null = null;
    const stopMinutes: Record<string, number> = {};

    cols.forEach(col => {
        const raw = TimeUtils.toMinutes(trip.stops[col]);
        if (raw !== null) {
            let adjusted = raw;
            if (raw >= 1440) {
                adjusted = raw;
                offset = Math.floor(raw / 1440) * 1440;
            } else {
                if (lastAdjusted !== null && raw + offset < lastAdjusted - 60) {
                    offset += 1440;
                }
                adjusted = raw + offset;
            }

            if (start === null) start = adjusted;
            end = adjusted;
            lastAdjusted = adjusted;
            stopMinutes[col] = adjusted;
        }
    });

    if (start !== null && end !== null) {
        if (start < MIDNIGHT_ROLLOVER_THRESHOLD && !Object.values(stopMinutes).some(v => v >= 1440)) {
            start += 1440;
            end += 1440;
            for (const key of Object.keys(stopMinutes)) {
                stopMinutes[key] += 1440;
            }
        }
        trip.startTime = start;
        trip.endTime = end;
        trip.stopMinutes = stopMinutes;
        trip.cycleTime = end - start;
        trip.travelTime = Math.max(0, trip.cycleTime - trip.recoveryTime);
    }
};

export function useScheduleEditing(
    schedules: MasterRouteTable[],
    onSchedulesChange: (schedules: MasterRouteTable[]) => void,
    options: UseScheduleEditingOptions = {}
): UseScheduleEditingResult {
    const {
        cascadeMode = 'always',
        logAction,
        showSuccessToast
    } = options;

    /**
     * Re-assign blocks for related tables after time changes
     */
    const reassignBlocksForRelatedTables = useCallback((
        tables: MasterRouteTable[],
        baseName: string
    ) => {
        const relatedTables = tables.filter(t => {
            const tBase = getTrueBaseRoute(t.routeName);
            return tBase === baseName;
        });

        if (relatedTables.length === 0) return;

        reassignBlocksForTables(relatedTables, baseName, MatchConfigPresets.editor);
    }, []);

    /**
     * Handle cell edit with time cascade
     */
    const handleCellEdit = useCallback((tripId: string, col: string, val: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;

        const isArrivalEdit = col.endsWith('__ARR');
        const stopName = isArrivalEdit ? col.replace('__ARR', '') : col;

        const oldValue = trip.stops[stopName];
        const oldTime = TimeUtils.toMinutes(oldValue);
        const newTime = TimeUtils.toMinutes(val);
        const colIdx = table.stops.indexOf(stopName);

        // Log the edit
        if (logAction && oldValue !== val) {
            logAction('edit', `Edited ${stopName}${isArrivalEdit ? ' (arrival)' : ''} time`, {
                tripId,
                blockId: trip.blockId,
                field: stopName,
                oldValue: oldValue || '-',
                newValue: val || '-'
            });
        }

        trip.stops[stopName] = val;

        // Cascade within trip if enabled
        if (cascadeMode !== 'none' && oldTime !== null && newTime !== null && colIdx !== -1) {
            const delta = newTime - oldTime;
            if (delta !== 0) {
                for (let i = colIdx + 1; i < table.stops.length; i++) {
                    const nextStop = table.stops[i];
                    const nextTime = TimeUtils.toMinutes(trip.stops[nextStop]);
                    if (nextTime !== null) {
                        const proposedTime = nextTime + delta;
                        // Validate: don't let time go before previous stop (would create negative segment)
                        const prevStop = table.stops[i - 1];
                        const prevTime = TimeUtils.toMinutes(trip.stops[prevStop]);
                        if (prevTime !== null && proposedTime <= prevTime) {
                            // Skip cascade - would create invalid timing
                            break;
                        }
                        trip.stops[nextStop] = TimeUtils.fromMinutes(proposedTime);
                    }
                }
            }
        }

        const oldEndTime = trip.endTime;
        recalculateTrip(trip, table.stops);
        const newEndTime = trip.endTime;
        const deltaEnd = newEndTime - oldEndTime;

        // Cascade to block if 'always' mode
        if (cascadeMode === 'always' && deltaEnd !== 0) {
            const baseName = getTrueBaseRoute(table.routeName);
            const relatedTables = newScheds.filter(t => {
                const tBase = getTrueBaseRoute(t.routeName);
                return tBase === baseName;
            });

            // Collect all trips in this block from all related tables
            const allBlockTrips: { trip: MasterTrip; table: MasterRouteTable }[] = [];
            relatedTables.forEach(t => {
                t.trips.filter(tr => tr.blockId === trip.blockId).forEach(tr => {
                    allBlockTrips.push({ trip: tr, table: t });
                });
            });

            allBlockTrips.sort((a, b) => a.trip.tripNumber - b.trip.tripNumber);

            const startIdx = allBlockTrips.findIndex(item => item.trip.id === trip.id);

            if (startIdx !== -1) {
                for (let i = startIdx + 1; i < allBlockTrips.length; i++) {
                    const { trip: nextTrip, table: nextTable } = allBlockTrips[i];
                    nextTable.stops.forEach(s => {
                        const stopTime = nextTrip.stops[s];
                        if (stopTime) {
                            nextTrip.stops[s] = TimeUtils.addMinutes(stopTime, deltaEnd);
                        }
                    });
                    recalculateTrip(nextTrip, nextTable.stops);
                }
            }
        }

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, getTrueBaseRoute(table.routeName));
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange, cascadeMode, logAction, reassignBlocksForRelatedTables]);

    /**
     * Handle recovery time edit
     */
    const handleRecoveryEdit = useCallback((tripId: string, stopName: string, delta: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;
        const stopIdx = table.stops.indexOf(stopName);
        if (stopIdx === -1) return;

        const oldRec = trip.recoveryTimes?.[stopName] || 0;
        // Bound recovery: can't be negative, and can't exceed travel time - 1 (to avoid negative runtime)
        const maxRec = Math.max(0, trip.travelTime - 1);
        const newRec = Math.max(0, Math.min(oldRec + delta, maxRec));
        const actualDelta = newRec - oldRec; // May differ from requested delta if bounds were hit

        if (!trip.recoveryTimes) trip.recoveryTimes = {};
        trip.recoveryTimes[stopName] = newRec;
        trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, v) => sum + (v || 0), 0);

        // Cascade time changes to subsequent stops (both stops and arrivalTimes)
        for (let i = stopIdx + 1; i < table.stops.length; i++) {
            const nextStop = table.stops[i];
            const t = TimeUtils.toMinutes(trip.stops[nextStop]);
            if (t !== null) trip.stops[nextStop] = TimeUtils.fromMinutes(t + actualDelta);
            // Also update arrivalTimes
            if (trip.arrivalTimes?.[nextStop]) {
                const arr = TimeUtils.toMinutes(trip.arrivalTimes[nextStop]);
                if (arr !== null) trip.arrivalTimes[nextStop] = TimeUtils.fromMinutes(arr + actualDelta);
            }
        }
        recalculateTrip(trip, table.stops);
        validateRouteTable(table);

        reassignBlocksForRelatedTables(newScheds, getTrueBaseRoute(table.routeName));
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange, reassignBlocksForRelatedTables]);

    /**
     * Handle time adjustment (wrapper for cell edit)
     */
    const handleTimeAdjust = useCallback((tripId: string, stopName: string, delta: number) => {
        const result = findTableAndTrip(schedules, tripId);
        if (!result) return;
        const { trip } = result;

        const currentTime = trip.stops[stopName];
        if (!currentTime) return;

        const newTime = TimeUtils.addMinutes(currentTime, delta);
        handleCellEdit(tripId, stopName, newTime);
    }, [schedules, handleCellEdit]);

    /**
     * Handle trip deletion
     */
    const handleDeleteTrip = useCallback((tripId: string) => {
        if (!confirm("Delete trip?")) return;

        const newScheds = deepCloneSchedules(schedules);
        for (const t of newScheds) {
            const tripToDelete = t.trips.find(x => x.id === tripId);
            if (tripToDelete) {
                if (logAction) {
                    logAction('delete', `Deleted trip from Block ${tripToDelete.blockId}`, {
                        tripId,
                        blockId: tripToDelete.blockId,
                        field: 'trip'
                    });
                }
                t.trips = t.trips.filter(x => x.id !== tripId);
                validateRouteTable(t);
                break;
            }
        }
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange, logAction]);

    /**
     * Handle trip duplication
     */
    const handleDuplicateTrip = useCallback((tripId: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;

        const { table, trip } = result;

        const newTrip: MasterTrip = {
            ...JSON.parse(JSON.stringify(trip)),
            id: `${trip.id}-dup-${Date.now()}`,
            lineageId: createTripLineageId(),
            tripNumber: 0, // Will be set by renumbering after sort
            blockId: '', // Clear blockId - let block reassignment handle it
            startTime: trip.startTime + 1,
            endTime: trip.endTime + 1,
        };

        // Shift all stop times and arrival times by 1 minute
        Object.keys(newTrip.stops).forEach(stop => {
            if (newTrip.stops[stop]) {
                newTrip.stops[stop] = TimeUtils.addMinutes(newTrip.stops[stop], 1);
            }
            if (newTrip.arrivalTimes?.[stop]) {
                newTrip.arrivalTimes[stop] = TimeUtils.addMinutes(newTrip.arrivalTimes[stop], 1);
            }
        });

        // Insert after source trip
        const tripIndex = table.trips.findIndex(t => t.id === tripId);
        table.trips.splice(tripIndex + 1, 0, newTrip);

        // Re-sort and renumber
        table.trips.sort((a, b) => a.startTime - b.startTime);
        table.trips.forEach((t, i) => { t.tripNumber = i + 1; });

        validateRouteTable(table);

        // Reassign blocks to assign proper blockId to the new trip
        reassignBlocksForRelatedTables(newScheds, getTrueBaseRoute(table.routeName));

        if (logAction) {
            logAction('add', `Duplicated trip from Block ${newTrip.blockId || 'new'}`, {
                tripId: newTrip.id,
                blockId: newTrip.blockId,
                field: 'trip'
            });
        }

        onSchedulesChange(newScheds);
        showSuccessToast?.('Trip duplicated');
    }, [schedules, onSchedulesChange, logAction, showSuccessToast]);

    /**
     * Handle direction change
     */
    const handleDirectionChange = useCallback((tableRouteName: string, direction: 'North' | 'South') => {
        const newScheds = deepCloneSchedules(schedules);
        const table = newScheds.find(t => t.routeName === tableRouteName);
        if (!table) return;

        let newName = table.routeName
            .replace(/\s*\((North|South)\)/gi, '')
            .trim();
        newName = `${newName} (${direction})`;

        table.routeName = newName;
        table.trips.forEach(trip => {
            trip.direction = direction;
        });

        if (logAction) {
            logAction('edit', `Set direction to ${direction}`, {
                field: 'direction',
                oldValue: tableRouteName,
                newValue: newName
            });
        }

        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange, logAction]);

    return {
        handleCellEdit,
        handleRecoveryEdit,
        handleTimeAdjust,
        handleDeleteTrip,
        handleDuplicateTrip,
        handleDirectionChange
    };
}
