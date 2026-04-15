/**
 * useScheduleEditing Hook
 *
 * Runtime owner for Schedule Editor mutation behavior:
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
import { getRouteConfig, parseRouteInfo } from '../utils/config/routeDirectionConfig';
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
    handleDeleteTrips: (tripIds: string[], options?: { treatAsRoundTrip?: boolean }) => void;
    handleDeleteTrip: (tripId: string) => void;
    handleDuplicateTrip: (tripId: string) => void;
    handleDirectionChange: (tableRouteName: string, direction: 'North' | 'South') => void;
}

const getTrueBaseRoute = (routeName: string): string => {
    const stripped = routeName
        .replace(/\s*\((North|South)\)/gi, '')
        .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
        .trim();
    const parsed = parseRouteInfo(stripped);
    return parsed.suffixIsDirection ? parsed.baseRoute : stripped;
};

const MIDNIGHT_ROLLOVER_THRESHOLD = 210; // 3:30 AM

const stripNumberedStopSuffix = (stopName: string): string => stopName.replace(/\s*\(\d+\)\s*$/, '');

const resolveTripStopKey = <T,>(record: Record<string, T> | undefined, stopName: string): string | null => {
    if (!record) return null;
    if (record[stopName] !== undefined) return stopName;

    const baseName = stripNumberedStopSuffix(stopName);
    if (baseName !== stopName && record[baseName] !== undefined) return baseName;

    const normalizedStop = stopName.trim().toLowerCase();
    const normalizedBase = baseName.trim().toLowerCase();

    for (const key of Object.keys(record)) {
        const normalizedKey = key.trim().toLowerCase();
        const normalizedKeyBase = stripNumberedStopSuffix(key).trim().toLowerCase();
        if (
            normalizedKey === normalizedStop
            || normalizedKey === normalizedBase
            || normalizedKeyBase === normalizedBase
        ) {
            return key;
        }
    }

    return null;
};

const getTripStopValue = <T,>(record: Record<string, T> | undefined, stopName: string): T | undefined => {
    const resolvedKey = resolveTripStopKey(record, stopName);
    return resolvedKey ? record?.[resolvedKey] : undefined;
};

const setTripStopValue = <T,>(record: Record<string, T> | undefined, stopName: string, value: T): Record<string, T> => {
    const target = record ?? {};
    const resolvedKey = resolveTripStopKey(target, stopName) ?? stopName;
    target[resolvedKey] = value;
    return target;
};

const getDisplayedDepartureAtStop = (trip: MasterTrip, stopName: string): string => {
    const arrival = getTripStopValue(trip.arrivalTimes, stopName);
    const recoveryAtStop = getTripStopValue(trip.recoveryTimes, stopName);

    if (arrival !== undefined && arrival !== null && arrival !== '' && recoveryAtStop !== undefined) {
        return recoveryAtStop > 0 ? TimeUtils.addMinutes(arrival, recoveryAtStop) : arrival;
    }

    const dep = getTripStopValue(trip.stops, stopName);
    if (dep !== undefined && dep !== null && dep !== '') return dep;

    if (arrival !== undefined && arrival !== null && arrival !== '') {
        const recovery = recoveryAtStop || 0;
        return recovery > 0 ? TimeUtils.addMinutes(arrival, recovery) : arrival;
    }

    return '';
};

const recalculateTrip = (trip: MasterTrip, cols: string[]) => {
    let start: number | null = null;
    let end: number | null = null;
    let offset = 0;
    let lastAdjusted: number | null = null;
    const stopMinutes: Record<string, number> = {};

    cols.forEach(col => {
        const stopKey = resolveTripStopKey(trip.stops, col);
        const raw = stopKey ? TimeUtils.toMinutes(trip.stops[stopKey]) : null;
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
            stopMinutes[resolveTripStopKey(trip.stopMinutes, col) ?? stopKey ?? col] = adjusted;
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

        const runtime = Math.max(0, end - start);
        trip.startTime = start;
        trip.endTime = end;
        trip.stopMinutes = stopMinutes;
        trip.travelTime = runtime;
        trip.cycleTime = runtime + Math.max(0, trip.recoveryTime || 0);
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
        showSuccessToast,
    } = options;

    const reassignBlocksForRelatedTables = useCallback((
        tables: MasterRouteTable[],
        baseName: string,
    ) => {
        const relatedTables = tables.filter(t => {
            const tBase = getTrueBaseRoute(t.routeName);
            return tBase === baseName;
        });

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
    }, []);

    const handleCellEdit = useCallback((tripId: string, col: string, val: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;

        const isArrivalEdit = col.endsWith('__ARR');
        const stopName = isArrivalEdit ? col.replace('__ARR', '') : col;

        const oldValue = isArrivalEdit
            ? (getTripStopValue(trip.arrivalTimes, stopName) ?? getTripStopValue(trip.stops, stopName))
            : getDisplayedDepartureAtStop(trip, stopName);

        if (oldValue === val) return;

        const oldTime = TimeUtils.toMinutes(oldValue);
        const newTime = TimeUtils.toMinutes(val);
        const colIdx = table.stops.indexOf(stopName);

        if (logAction && oldValue !== val) {
            logAction('edit', `Edited ${stopName}${isArrivalEdit ? ' (arrival)' : ''} time`, {
                tripId,
                blockId: trip.blockId,
                field: stopName,
                oldValue: oldValue || '-',
                newValue: val || '-',
            });
        }

        if (isArrivalEdit) {
            trip.arrivalTimes = setTripStopValue(trip.arrivalTimes, stopName, val);
            trip.stops = setTripStopValue(trip.stops, stopName, val);
        } else {
            trip.stops = setTripStopValue(trip.stops, stopName, val);
            const existingArrival = getTripStopValue(trip.arrivalTimes, stopName);
            const existingRecovery = getTripStopValue(trip.recoveryTimes, stopName) || 0;
            if (trip.arrivalTimes && existingArrival !== undefined) {
                if (existingRecovery > 0) {
                    const arrivalMin = TimeUtils.toMinutes(existingArrival);
                    const depMin = TimeUtils.toMinutes(val);
                    if (arrivalMin !== null && depMin !== null) {
                        const maxRec = Math.max(0, trip.travelTime - 1);
                        const newRecovery = Math.max(0, Math.min(depMin - arrivalMin, maxRec));
                        trip.recoveryTimes = setTripStopValue(trip.recoveryTimes, stopName, newRecovery);
                        trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, v) => sum + (v || 0), 0);
                        trip.stops = setTripStopValue(trip.stops, stopName, TimeUtils.fromMinutes(arrivalMin + newRecovery));
                    }
                } else {
                    trip.arrivalTimes = setTripStopValue(trip.arrivalTimes, stopName, val);
                }
            }
        }

        if (cascadeMode !== 'none' && oldTime !== null && newTime !== null && colIdx !== -1) {
            const delta = newTime - oldTime;
            if (delta !== 0) {
                for (let i = colIdx + 1; i < table.stops.length; i++) {
                    const nextStop = table.stops[i];
                    const nextArrTime = TimeUtils.toMinutes(
                        getTripStopValue(trip.arrivalTimes, nextStop) ?? getTripStopValue(trip.stops, nextStop),
                    );
                    if (nextArrTime !== null) {
                        const proposedTime = nextArrTime + delta;
                        const depTime = TimeUtils.toMinutes(getTripStopValue(trip.stops, nextStop));
                        if (depTime !== null) {
                            trip.stops = setTripStopValue(trip.stops, nextStop, TimeUtils.fromMinutes(depTime + delta));
                        }
                        if (trip.arrivalTimes && getTripStopValue(trip.arrivalTimes, nextStop) !== undefined) {
                            trip.arrivalTimes = setTripStopValue(trip.arrivalTimes, nextStop, TimeUtils.fromMinutes(proposedTime));
                        }
                    }
                }
            }
        }

        const oldEndTime = trip.endTime;
        recalculateTrip(trip, table.stops);
        const newEndTime = trip.endTime;
        const deltaEnd = newEndTime - oldEndTime;

        if (cascadeMode === 'always' && deltaEnd !== 0) {
            const baseName = getTrueBaseRoute(table.routeName);
            const relatedTables = newScheds.filter(t => {
                const tBase = getTrueBaseRoute(t.routeName);
                return tBase === baseName;
            });

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
                        const stopTime = getTripStopValue(nextTrip.stops, s);
                        if (stopTime !== null && stopTime !== undefined && stopTime !== '') {
                            nextTrip.stops = setTripStopValue(nextTrip.stops, s, TimeUtils.addMinutes(stopTime, deltaEnd));
                        }
                        const arrivalTime = getTripStopValue(nextTrip.arrivalTimes, s);
                        if (nextTrip.arrivalTimes && arrivalTime !== undefined
                            && arrivalTime !== null && arrivalTime !== '') {
                            nextTrip.arrivalTimes = setTripStopValue(nextTrip.arrivalTimes, s, TimeUtils.addMinutes(arrivalTime, deltaEnd));
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

    const handleRecoveryEdit = useCallback((tripId: string, stopName: string, delta: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;
        const stopIdx = table.stops.indexOf(stopName);
        if (stopIdx === -1) return;
        const isTerminalRecoveryEdit = stopIdx === table.stops.length - 1;

        const oldRec = getTripStopValue(trip.recoveryTimes, stopName) || 0;
        const maxRec = Math.max(0, trip.travelTime - 1);
        const newRec = Math.max(0, Math.min(oldRec + delta, maxRec));
        const actualDelta = newRec - oldRec;

        trip.recoveryTimes = setTripStopValue(trip.recoveryTimes, stopName, newRec);
        trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, v) => sum + (v || 0), 0);

        if (!isTerminalRecoveryEdit) {
            for (let i = stopIdx + 1; i < table.stops.length; i++) {
                const nextStop = table.stops[i];
                const t = TimeUtils.toMinutes(getTripStopValue(trip.stops, nextStop));
                if (t !== null) trip.stops = setTripStopValue(trip.stops, nextStop, TimeUtils.fromMinutes(t + actualDelta));
                const arrivalTime = getTripStopValue(trip.arrivalTimes, nextStop);
                if (arrivalTime) {
                    const arr = TimeUtils.toMinutes(arrivalTime);
                    if (arr !== null) trip.arrivalTimes = setTripStopValue(trip.arrivalTimes, nextStop, TimeUtils.fromMinutes(arr + actualDelta));
                }
            }
        }
        recalculateTrip(trip, table.stops);
        validateRouteTable(table);

        if (!isTerminalRecoveryEdit && cascadeMode === 'always' && actualDelta !== 0) {
            const baseName = getTrueBaseRoute(table.routeName);
            const relatedTables = newScheds.filter(t => {
                const tBase = getTrueBaseRoute(t.routeName);
                return tBase === baseName;
            });

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
                        const stopTime = getTripStopValue(nextTrip.stops, s);
                        if (stopTime !== null && stopTime !== undefined && stopTime !== '') {
                            nextTrip.stops = setTripStopValue(nextTrip.stops, s, TimeUtils.addMinutes(stopTime, actualDelta));
                        }
                        const arrivalTime = getTripStopValue(nextTrip.arrivalTimes, s);
                        if (nextTrip.arrivalTimes && arrivalTime !== undefined
                            && arrivalTime !== null && arrivalTime !== '') {
                            nextTrip.arrivalTimes = setTripStopValue(nextTrip.arrivalTimes, s, TimeUtils.addMinutes(arrivalTime, actualDelta));
                        }
                    });
                    recalculateTrip(nextTrip, nextTable.stops);
                }
            }
        }

        if (!isTerminalRecoveryEdit) {
            reassignBlocksForRelatedTables(newScheds, getTrueBaseRoute(table.routeName));
        }
        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange, cascadeMode, reassignBlocksForRelatedTables]);

    const handleTimeAdjust = useCallback((tripId: string, stopName: string, delta: number) => {
        const result = findTableAndTrip(schedules, tripId);
        if (!result) return;
        const { trip } = result;

        const isArrivalAdjust = stopName.endsWith('__ARR');
        const baseStopName = isArrivalAdjust ? stopName.replace('__ARR', '') : stopName;
        const departureAtStop = getDisplayedDepartureAtStop(trip, baseStopName);
        const currentTime = isArrivalAdjust
            ? (getTripStopValue(trip.arrivalTimes, baseStopName) ?? getTripStopValue(trip.stops, baseStopName))
            : departureAtStop;
        if (!currentTime) return;

        const newTime = TimeUtils.addMinutes(currentTime, delta);
        handleCellEdit(tripId, isArrivalAdjust ? `${baseStopName}__ARR` : baseStopName, newTime);
    }, [schedules, handleCellEdit]);

    const handleDeleteTrips = useCallback((tripIds: string[], options?: { treatAsRoundTrip?: boolean }) => {
        const uniqueTripIds = Array.from(new Set(tripIds.filter(Boolean)));
        if (uniqueTripIds.length === 0) return;

        const confirmMessage = options?.treatAsRoundTrip || uniqueTripIds.length > 1
            ? 'Delete round trip?'
            : 'Delete trip?';
        if (!confirm(confirmMessage)) return;

        const newScheds = deepCloneSchedules(schedules);

        for (const tripId of uniqueTripIds) {
            for (const t of newScheds) {
                const tripToDelete = t.trips.find(x => x.id === tripId);
                if (tripToDelete) {
                    if (logAction) {
                        logAction('delete', `Deleted trip from Block ${tripToDelete.blockId}`, {
                            tripId,
                            blockId: tripToDelete.blockId,
                            field: 'trip',
                        });
                    }
                    t.trips = t.trips.filter(x => x.id !== tripId);
                    validateRouteTable(t);
                    break;
                }
            }
        }

        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange, logAction]);

    const handleDeleteTrip = useCallback((tripId: string) => {
        handleDeleteTrips([tripId], { treatAsRoundTrip: false });
    }, [handleDeleteTrips]);

    const handleDuplicateTrip = useCallback((tripId: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;

        const { table, trip } = result;

        const newTrip: MasterTrip = {
            ...JSON.parse(JSON.stringify(trip)),
            id: `${trip.id}-dup-${Date.now()}`,
            lineageId: createTripLineageId(),
            tripNumber: 0,
            blockId: '',
            startTime: trip.startTime + 1,
            endTime: trip.endTime + 1,
        };

        Object.keys(newTrip.stops).forEach(stop => {
            if (newTrip.stops[stop]) {
                newTrip.stops[stop] = TimeUtils.addMinutes(newTrip.stops[stop], 1);
            }
            if (newTrip.arrivalTimes?.[stop]) {
                newTrip.arrivalTimes[stop] = TimeUtils.addMinutes(newTrip.arrivalTimes[stop], 1);
            }
        });

        const tripIndex = table.trips.findIndex(t => t.id === tripId);
        table.trips.splice(tripIndex + 1, 0, newTrip);

        table.trips.sort((a, b) => a.startTime - b.startTime);
        table.trips.forEach((t, i) => { t.tripNumber = i + 1; });

        validateRouteTable(table);
        reassignBlocksForRelatedTables(newScheds, getTrueBaseRoute(table.routeName));

        if (logAction) {
            logAction('add', `Duplicated trip from Block ${newTrip.blockId || 'new'}`, {
                tripId: newTrip.id,
                blockId: newTrip.blockId,
                field: 'trip',
            });
        }

        onSchedulesChange(newScheds);
        showSuccessToast?.('Trip duplicated');
    }, [schedules, onSchedulesChange, logAction, showSuccessToast, reassignBlocksForRelatedTables]);

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
                newValue: newName,
            });
        }

        onSchedulesChange(newScheds);
    }, [schedules, onSchedulesChange, logAction]);

    return {
        handleCellEdit,
        handleRecoveryEdit,
        handleTimeAdjust,
        handleDeleteTrips,
        handleDeleteTrip,
        handleDuplicateTrip,
        handleDirectionChange,
    };
}
