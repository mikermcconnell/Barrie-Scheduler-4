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
import {
    getOperationalSortTime,
    reassignBlocksForTables,
    MatchConfigPresets,
} from '../utils/blocks/blockAssignmentCore';
import { getRouteConfig, parseRouteInfo } from '../utils/config/routeDirectionConfig';
import { TimeUtils } from '../utils/timeUtils';
import { deepCloneSchedules } from '../utils/schedule/scheduleEditorUtils';
import { resolveGridSegmentTimes } from '../utils/schedule/travelTimeGridUtils';
import { summarizeScheduleEditImpact, type ScheduleEditImpact } from '../utils/schedule/scheduleEditImpact';

export interface UseTravelTimeGridResult {
    handleBulkAdjustTravelTime: (fromStop: string, toStop: string, delta: number, routeName: string) => void;
    handleSingleTripTravelAdjust: (tripId: string, toStop: string, delta: number, routeName: string) => void;
    handleBulkAdjustRecoveryTime: (stopName: string, delta: number, routeName: string) => void;
    handleSingleRecoveryAdjust: (tripId: string, stopName: string, delta: number, routeName: string) => void;
}

/**
 * Recalculate trip times based on stop values
 */
const MIDNIGHT_ROLLOVER_THRESHOLD = 240; // 4:00 AM operational day boundary

const getServiceDay = (routeName: string): string | null =>
    routeName.match(/\((Weekday|Saturday|Sunday)\)/i)?.[1]?.toLowerCase() ?? null;

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
    const serviceDay = getServiceDay(routeName);
    const relatedTables = tables.filter(table =>
        getTrueBaseRoute(table.routeName) === baseName
        && getServiceDay(table.routeName) === serviceDay
    );
    if (relatedTables.length === 0) return;

    const routeConfig = getRouteConfig(baseName);
    const directions = new Set(
        relatedTables.flatMap(table => table.trips.map(trip => trip.direction))
    );
    const hasBidirectionalService = directions.has('North') && directions.has('South');
    const reassignmentConfig =
        routeConfig?.segments.length === 2 && hasBidirectionalService
            ? MatchConfigPresets.merged
            : MatchConfigPresets.editor;

    reassignBlocksForTables(relatedTables, baseName, reassignmentConfig);
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

const shiftTripTimes = (trip: MasterTrip, cols: string[], delta: number) => {
    cols.forEach(stop => {
        const departure = TimeUtils.toMinutes(trip.stops[stop]);
        if (departure !== null) {
            trip.stops[stop] = TimeUtils.fromMinutes(departure + delta);
        }

        const arrival = trip.arrivalTimes?.[stop];
        if (arrival) {
            const arrivalMinutes = TimeUtils.toMinutes(arrival);
            if (arrivalMinutes !== null) {
                if (!trip.arrivalTimes) trip.arrivalTimes = {};
                trip.arrivalTimes[stop] = TimeUtils.fromMinutes(arrivalMinutes + delta);
            }
        }

        if (trip.stopMinutes?.[stop] !== undefined) {
            trip.stopMinutes[stop] += delta;
        }
    });
    recalculateTrip(trip, cols);
};

const getOrderedBlockTrips = (
    tables: MasterRouteTable[],
    routeName: string,
    blockId: string,
): Array<{ trip: MasterTrip; table: MasterRouteTable }> => {
    const baseName = getTrueBaseRoute(routeName);
    const serviceDay = getServiceDay(routeName);
    const relatedTables = tables.filter(table =>
        getTrueBaseRoute(table.routeName) === baseName
        && getServiceDay(table.routeName) === serviceDay
    );

    const allBlockTrips: Array<{ trip: MasterTrip; table: MasterRouteTable }> = [];
    relatedTables.forEach(table => {
        table.trips
            .filter(trip => trip.blockId === blockId)
            .forEach(trip => {
                allBlockTrips.push({ trip, table });
            });
    });

    return allBlockTrips.sort((a, b) =>
        getOperationalSortTime(a.trip.startTime) - getOperationalSortTime(b.trip.startTime)
        || getOperationalSortTime(a.trip.endTime) - getOperationalSortTime(b.trip.endTime)
        || a.trip.tripNumber - b.trip.tripNumber
        || a.trip.id.localeCompare(b.trip.id)
    );
};

const cascadeFollowingBlockTrips = (
    tables: MasterRouteTable[],
    routeName: string,
    tripId: string,
    blockId: string,
    delta: number
) => {
    if (delta === 0 || !blockId) return;

    const allBlockTrips = getOrderedBlockTrips(tables, routeName, blockId);
    const startIdx = allBlockTrips.findIndex(item => item.trip.id === tripId);
    if (startIdx === -1) return;

    allBlockTrips.slice(startIdx + 1).forEach(({ trip, table }) => {
        shiftTripTimes(trip, table.stops, delta);
    });
};

const applyTravelAdjustment = (
    trip: MasterTrip,
    table: MasterRouteTable,
    fromStop: string,
    toStop: string,
    delta: number,
) => {
    const toIdx = table.stops.indexOf(toStop);
    if (toIdx === -1) return;
    const segment = resolveGridSegmentTimes(trip, fromStop, toStop);
    if (!segment) return;
    const acceptedDelta = Math.max(
        -segment.travelMinutes,
        Math.min(240 - segment.travelMinutes, delta),
    );
    if (acceptedDelta === 0) return;

    for (let i = toIdx; i < table.stops.length; i++) {
        const stop = table.stops[i];
        const departure = TimeUtils.toMinutes(trip.stops[stop]);
        if (departure !== null) trip.stops[stop] = TimeUtils.fromMinutes(departure + acceptedDelta);

        const arrival = TimeUtils.toMinutes(trip.arrivalTimes?.[stop]);
        if (arrival !== null && trip.arrivalTimes) {
            trip.arrivalTimes[stop] = TimeUtils.fromMinutes(arrival + acceptedDelta);
        }
    }
    recalculateTrip(trip, table.stops);
};

const applyRecoveryAdjustment = (
    trip: MasterTrip,
    table: MasterRouteTable,
    stopName: string,
    delta: number,
) => {
    const stopIdx = table.stops.indexOf(stopName);
    if (stopIdx === -1) return;

    const oldRec = trip.recoveryTimes?.[stopName] || 0;
    const maxRec = Math.max(0, trip.travelTime - 1);
    const newRec = Math.max(0, Math.min(oldRec + delta, maxRec));
    const actualDelta = newRec - oldRec;
    if (!trip.recoveryTimes) trip.recoveryTimes = {};
    trip.recoveryTimes[stopName] = newRec;
    trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, value) => sum + (value || 0), 0);

    const arrivalAtStop = TimeUtils.toMinutes(trip.arrivalTimes?.[stopName]);
    const departureAtStop = TimeUtils.toMinutes(trip.stops[stopName]);
    if (arrivalAtStop !== null) {
        trip.stops[stopName] = TimeUtils.fromMinutes(arrivalAtStop + newRec);
    } else if (departureAtStop !== null) {
        trip.stops[stopName] = TimeUtils.fromMinutes(departureAtStop + actualDelta);
    }
    if (stopIdx === table.stops.length - 1) trip.endTimeIncludesRecovery = true;

    for (let i = stopIdx + 1; i < table.stops.length; i++) {
        const stop = table.stops[i];
        const departure = TimeUtils.toMinutes(trip.stops[stop]);
        if (departure !== null) trip.stops[stop] = TimeUtils.fromMinutes(departure + actualDelta);

        const arrival = TimeUtils.toMinutes(trip.arrivalTimes?.[stop]);
        if (arrival !== null && trip.arrivalTimes) {
            trip.arrivalTimes[stop] = TimeUtils.fromMinutes(arrival + actualDelta);
        }
    }
    recalculateTrip(trip, table.stops);
};

const applyBulkAdjustmentsInBlockOrder = (
    tables: MasterRouteTable[],
    routeName: string,
    targetTripIds: Set<string>,
    applyAdjustment: (trip: MasterTrip, table: MasterRouteTable) => void,
) => {
    const targetTable = tables.find(table => table.routeName === routeName);
    if (!targetTable) return;

    const blockIds = new Set(
        targetTable.trips
            .filter(trip => targetTripIds.has(trip.id) && trip.blockId)
            .map(trip => trip.blockId)
    );
    const processed = new Set<string>();

    blockIds.forEach(blockId => {
        let accumulatedDelta = 0;
        getOrderedBlockTrips(tables, routeName, blockId).forEach(({ trip, table }) => {
            if (accumulatedDelta !== 0) shiftTripTimes(trip, table.stops, accumulatedDelta);
            if (!targetTripIds.has(trip.id)) return;

            const oldEndTime = trip.endTime;
            applyAdjustment(trip, table);
            accumulatedDelta += trip.endTime - oldEndTime;
            processed.add(trip.id);
        });
    });

    targetTable.trips.forEach(trip => {
        if (targetTripIds.has(trip.id) && !processed.has(trip.id)) {
            applyAdjustment(trip, targetTable);
        }
    });
};

export function useTravelTimeGrid(
    schedules: MasterRouteTable[],
    onSchedulesChange: (schedules: MasterRouteTable[]) => void,
    logAction?: (type: string, message: string, details: object) => void,
    onEditImpact?: (impact: ScheduleEditImpact) => void,
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

        const targetTripIds = new Set(
            targetTable.trips
                .filter(trip => {
                    const segment = resolveGridSegmentTimes(trip, fromStop, toStop);
                    if (!segment) return false;
                    const acceptedDelta = Math.max(
                        -segment.travelMinutes,
                        Math.min(240 - segment.travelMinutes, delta),
                    );
                    return acceptedDelta !== 0;
                })
                .map(trip => trip.id)
        );
        if (targetTripIds.size === 0) return;
        applyBulkAdjustmentsInBlockOrder(
            newScheds,
            routeName,
            targetTripIds,
            (trip, table) => applyTravelAdjustment(trip, table, fromStop, toStop, delta),
        );

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, routeName);
        onSchedulesChange(newScheds);
        onEditImpact?.(summarizeScheduleEditImpact(schedules, newScheds));
    }, [schedules, onSchedulesChange, logAction, onEditImpact]);

    /**
     * Adjust travel time for a single trip
     * Shifts the destination stop and all subsequent stops by delta minutes
     */
    const handleSingleTripTravelAdjust = useCallback((
        tripId: string,
        toStop: string,
        delta: number,
        routeName: string
    ) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const trip = targetTable.trips.find(t => t.id === tripId);
        if (!trip) return;

        const toIdx = targetTable.stops.indexOf(toStop);
        if (toIdx === -1) return;

        const fromStop = targetTable.stops[toIdx - 1];
        if (!fromStop) return;
        const segment = resolveGridSegmentTimes(trip, fromStop, toStop);
        if (!segment) return;
        const acceptedDelta = Math.max(
            -segment.travelMinutes,
            Math.min(240 - segment.travelMinutes, delta),
        );
        if (acceptedDelta === 0) return;
        const oldEndTime = trip.endTime;
        applyTravelAdjustment(trip, targetTable, fromStop, toStop, delta);
        const deltaEnd = trip.endTime - oldEndTime;
        cascadeFollowingBlockTrips(newScheds, routeName, trip.id, trip.blockId, deltaEnd);

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, routeName);
        onSchedulesChange(newScheds);
        onEditImpact?.(summarizeScheduleEditImpact(schedules, newScheds));
    }, [schedules, onSchedulesChange, onEditImpact]);

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
        if (stopIdx === -1) return;

        const targetTripIds = new Set(
            targetTable.trips
                .filter(trip => TimeUtils.toMinutes(trip.arrivalTimes?.[stopName] ?? trip.stops[stopName]) !== null)
                .map(trip => trip.id)
        );
        if (targetTripIds.size === 0) return;
        applyBulkAdjustmentsInBlockOrder(
            newScheds,
            routeName,
            targetTripIds,
            (trip, table) => applyRecoveryAdjustment(trip, table, stopName, delta),
        );

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, routeName);
        onSchedulesChange(newScheds);
        onEditImpact?.(summarizeScheduleEditImpact(schedules, newScheds));
    }, [schedules, onSchedulesChange, onEditImpact]);

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
        if (stopIdx === -1) return;

        const oldEndTime = trip.endTime;
        applyRecoveryAdjustment(trip, targetTable, stopName, delta);
        const deltaEnd = trip.endTime - oldEndTime;
        cascadeFollowingBlockTrips(newScheds, routeName, trip.id, trip.blockId, deltaEnd);

        newScheds.forEach(t => validateRouteTable(t));
        reassignBlocksForRelatedTables(newScheds, routeName);
        onSchedulesChange(newScheds);
        onEditImpact?.(summarizeScheduleEditImpact(schedules, newScheds));
    }, [schedules, onSchedulesChange, onEditImpact]);

    return {
        handleBulkAdjustTravelTime,
        handleSingleTripTravelAdjust,
        handleBulkAdjustRecoveryTime,
        handleSingleRecoveryAdjust
    };
}
