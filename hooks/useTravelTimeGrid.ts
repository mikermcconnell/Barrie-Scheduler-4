/**
 * useTravelTimeGrid Hook
 *
 * Extracted from ScheduleEditor.tsx to handle:
 * - Bulk travel time adjustments
 * - Single trip travel time adjustments
 * - Bulk recovery time adjustments
 * - Single trip recovery time adjustments
 */

import { useCallback } from 'react';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import { validateRouteTable } from '../utils/parsers/masterScheduleParser';
import { reassignBlocksForTables, MatchConfigPresets } from '../utils/blocks/blockAssignmentCore';
import { parseRouteInfo } from '../utils/config/routeDirectionConfig';
import { TimeUtils } from '../utils/timeUtils';
import { deepCloneSchedules } from '../utils/schedule/scheduleEditorUtils';

export interface UseTravelTimeGridResult {
    handleBulkAdjustTravelTime: (fromStop: string, toStop: string, delta: number, routeName: string) => void;
    handleSingleTripTravelAdjust: (tripId: string, fromStop: string, delta: number, routeName: string) => void;
    handleBulkAdjustRecoveryTime: (stopName: string, delta: number, routeName: string) => void;
    handleSingleRecoveryAdjust: (tripId: string, stopName: string, delta: number, routeName: string) => void;
}

/**
 * Recalculate trip times based on stop values
 */
const MIDNIGHT_ROLLOVER_THRESHOLD = 210; // 3:30 AM

const getTrueBaseRoute = (routeName: string): string => {
    const stripped = routeName
        .replace(/\s*\((North|South)\)/gi, '')
        .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
        .trim();

    const parsed = parseRouteInfo(stripped);
    return parsed.suffixIsDirection ? parsed.baseRoute : stripped;
};

const reassignBlocksForRelatedTables = (tables: MasterRouteTable[], routeName: string) => {
    const baseName = getTrueBaseRoute(routeName);
    const relatedTables = tables.filter(table => getTrueBaseRoute(table.routeName) === baseName);
    if (relatedTables.length === 0) return;

    reassignBlocksForTables(relatedTables, baseName, MatchConfigPresets.editor);
};

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

export function useTravelTimeGrid(
    schedules: MasterRouteTable[],
    onSchedulesChange: (schedules: MasterRouteTable[]) => void,
    logAction?: (type: string, message: string, details: object) => void
): UseTravelTimeGridResult {

    /**
     * Bulk adjust travel time for all trips in a route
     * Shifts all stops from toStop onwards by delta minutes
     */
    const handleBulkAdjustTravelTime = useCallback((
        fromStop: string,
        toStop: string,
        delta: number,
        routeName: string
    ) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const toIdx = targetTable.stops.indexOf(toStop);
        if (toIdx === -1) return;

        // Log bulk adjustment
        logAction?.('bulk_adjust', `Bulk travel time ${delta > 0 ? '+' : ''}${delta} min`, {
            field: `${fromStop} → ${toStop}`,
            newValue: delta,
            count: targetTable.trips.length
        });

        targetTable.trips.forEach(trip => {
            for (let i = toIdx; i < targetTable.stops.length; i++) {
                const stop = targetTable.stops[i];
                const t = TimeUtils.toMinutes(trip.stops[stop]);
                if (t !== null) {
                    trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
                }
                if (trip.arrivalTimes?.[stop] !== undefined) {
                    const arr = TimeUtils.toMinutes(trip.arrivalTimes[stop]);
                    if (arr !== null) trip.arrivalTimes[stop] = TimeUtils.fromMinutes(arr + delta);
                }
                if (trip.stopMinutes?.[stop] !== undefined) {
                    trip.stopMinutes[stop] += delta;
                }
            }
            recalculateTrip(trip, targetTable.stops);
        });

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, routeName);
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange, logAction]);

    /**
     * Adjust travel time for a single trip
     * Shifts all stops from fromStop onwards by delta minutes
     */
    const handleSingleTripTravelAdjust = useCallback((
        tripId: string,
        fromStop: string,
        delta: number,
        routeName: string
    ) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const trip = targetTable.trips.find(t => t.id === tripId);
        if (!trip) return;

        const fromIdx = targetTable.stops.indexOf(fromStop);
        if (fromIdx === -1) return;

        // Adjust this stop and all subsequent stops for this trip only
        for (let i = fromIdx; i < targetTable.stops.length; i++) {
            const stop = targetTable.stops[i];
            const t = TimeUtils.toMinutes(trip.stops[stop]);
            if (t !== null) {
                trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
            }
            if (trip.arrivalTimes?.[stop] !== undefined) {
                const arr = TimeUtils.toMinutes(trip.arrivalTimes[stop]);
                if (arr !== null) trip.arrivalTimes[stop] = TimeUtils.fromMinutes(arr + delta);
            }
            if (trip.stopMinutes?.[stop] !== undefined) {
                trip.stopMinutes[stop] += delta;
            }
        }
        recalculateTrip(trip, targetTable.stops);

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, routeName);
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange]);

    /**
     * Bulk adjust recovery time for all trips at a specific stop
     */
    const handleBulkAdjustRecoveryTime = useCallback((
        stopName: string,
        delta: number,
        routeName: string
    ) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const stopIdx = targetTable.stops.indexOf(stopName);

        targetTable.trips.forEach(trip => {
            const oldRec = trip.recoveryTimes?.[stopName] || 0;
            const maxRec = Math.max(0, trip.travelTime - 1);
            const newRec = Math.max(0, Math.min(oldRec + delta, maxRec));
            const actualDelta = newRec - oldRec;
            if (!trip.recoveryTimes) trip.recoveryTimes = {};
            trip.recoveryTimes[stopName] = newRec;
            trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, v) => sum + (v || 0), 0);

            if (stopIdx !== -1) {
                const arrivalAtStop = trip.arrivalTimes?.[stopName];
                if (arrivalAtStop) {
                    const arr = TimeUtils.toMinutes(arrivalAtStop);
                    if (arr !== null) {
                        trip.stops[stopName] = TimeUtils.fromMinutes(arr + newRec);
                    }
                }

                for (let i = stopIdx + 1; i < targetTable.stops.length; i++) {
                    const s = targetTable.stops[i];
                    const t = TimeUtils.toMinutes(trip.stops[s]);
                    if (t !== null) trip.stops[s] = TimeUtils.fromMinutes(t + actualDelta);
                    if (trip.arrivalTimes?.[s]) {
                        const arr = TimeUtils.toMinutes(trip.arrivalTimes[s]);
                        if (arr !== null) trip.arrivalTimes[s] = TimeUtils.fromMinutes(arr + actualDelta);
                    }
                    if (trip.stopMinutes?.[s] !== undefined) {
                        trip.stopMinutes[s] += actualDelta;
                    }
                }
            }
            recalculateTrip(trip, targetTable.stops);
        });

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, routeName);
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange]);

    /**
     * Adjust recovery time for a single trip at a specific stop
     */
    const handleSingleRecoveryAdjust = useCallback((
        tripId: string,
        stopName: string,
        delta: number,
        routeName: string
    ) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const trip = targetTable.trips.find(t => t.id === tripId);
        if (!trip) return;

        const stopIdx = targetTable.stops.indexOf(stopName);

        // Adjust recovery for this trip
        const oldRec = trip.recoveryTimes?.[stopName] || 0;
        const maxRec = Math.max(0, trip.travelTime - 1);
        const newRec = Math.max(0, Math.min(oldRec + delta, maxRec));
        const actualDelta = newRec - oldRec;
        if (!trip.recoveryTimes) trip.recoveryTimes = {};
        trip.recoveryTimes[stopName] = newRec;
        trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, v) => sum + (v || 0), 0);

        // Cascade time changes to subsequent stops
        if (stopIdx !== -1) {
            const arrivalAtStop = trip.arrivalTimes?.[stopName];
            if (arrivalAtStop) {
                const arr = TimeUtils.toMinutes(arrivalAtStop);
                if (arr !== null) trip.stops[stopName] = TimeUtils.fromMinutes(arr + newRec);
            }

            for (let i = stopIdx + 1; i < targetTable.stops.length; i++) {
                const s = targetTable.stops[i];
                const t = TimeUtils.toMinutes(trip.stops[s]);
                if (t !== null) trip.stops[s] = TimeUtils.fromMinutes(t + actualDelta);
                if (trip.arrivalTimes?.[s]) {
                    const arr = TimeUtils.toMinutes(trip.arrivalTimes[s]);
                    if (arr !== null) trip.arrivalTimes[s] = TimeUtils.fromMinutes(arr + actualDelta);
                }
                if (trip.stopMinutes?.[s] !== undefined) {
                    trip.stopMinutes[s] += actualDelta;
                }
            }
        }
        recalculateTrip(trip, targetTable.stops);

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, routeName);
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange]);

    return {
        handleBulkAdjustTravelTime,
        handleSingleTripTravelAdjust,
        handleBulkAdjustRecoveryTime,
        handleSingleRecoveryAdjust
    };
}
