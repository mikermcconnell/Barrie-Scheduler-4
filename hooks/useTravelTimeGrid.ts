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
import type { MasterRouteTable, MasterTrip } from '../utils/masterScheduleParser';
import { validateRouteTable } from '../utils/masterScheduleParser';
import { TimeUtils } from '../utils/timeUtils';
import { deepCloneSchedules } from '../utils/scheduleEditorUtils';

export interface UseTravelTimeGridResult {
    handleBulkAdjustTravelTime: (fromStop: string, toStop: string, delta: number, routeName: string) => void;
    handleSingleTripTravelAdjust: (tripId: string, fromStop: string, delta: number, routeName: string) => void;
    handleBulkAdjustRecoveryTime: (stopName: string, delta: number, routeName: string) => void;
    handleSingleRecoveryAdjust: (tripId: string, stopName: string, delta: number, routeName: string) => void;
}

/**
 * Recalculate trip times based on stop values
 */
const recalculateTrip = (trip: MasterTrip, cols: string[]) => {
    let start: number | null = null;
    let end: number | null = null;
    cols.forEach(col => {
        const m = TimeUtils.toMinutes(trip.stops[col]);
        if (m !== null) {
            if (start === null) start = m;
            end = m;
        }
    });
    if (start !== null && end !== null) {
        trip.startTime = start;
        trip.endTime = end;
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
            }
            recalculateTrip(trip, targetTable.stops);
        });

        newScheds.forEach(t => validateRouteTable(t));
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
        }
        recalculateTrip(trip, targetTable.stops);

        newScheds.forEach(t => validateRouteTable(t));
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
            const newRec = Math.max(0, oldRec + delta);
            if (!trip.recoveryTimes) trip.recoveryTimes = {};
            trip.recoveryTimes[stopName] = newRec;

            if (stopIdx !== -1) {
                for (let i = stopIdx + 1; i < targetTable.stops.length; i++) {
                    const s = targetTable.stops[i];
                    const t = TimeUtils.toMinutes(trip.stops[s]);
                    if (t !== null) trip.stops[s] = TimeUtils.fromMinutes(t + delta);
                }
            }
            recalculateTrip(trip, targetTable.stops);
        });

        newScheds.forEach(t => validateRouteTable(t));
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
        const newRec = Math.max(0, oldRec + delta);
        if (!trip.recoveryTimes) trip.recoveryTimes = {};
        trip.recoveryTimes[stopName] = newRec;

        // Cascade time changes to subsequent stops
        if (stopIdx !== -1) {
            for (let i = stopIdx + 1; i < targetTable.stops.length; i++) {
                const s = targetTable.stops[i];
                const t = TimeUtils.toMinutes(trip.stops[s]);
                if (t !== null) trip.stops[s] = TimeUtils.fromMinutes(t + delta);
            }
        }
        recalculateTrip(trip, targetTable.stops);

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange]);

    return {
        handleBulkAdjustTravelTime,
        handleSingleTripTravelAdjust,
        handleBulkAdjustRecoveryTime,
        handleSingleRecoveryAdjust
    };
}
