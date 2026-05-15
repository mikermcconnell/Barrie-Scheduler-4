import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { TimeUtils } from '../timeUtils';

export interface HeadwayRegularizationOptions {
    targetHeadwayMinutes: number;
    minRecoveryMinutes?: number;
}

export interface HeadwayStats {
    totalHeadways: number;
    offTargetHeadways: number;
    worstDeviationMinutes: number;
    averageHeadwayMinutes: number | null;
}

export interface HeadwayRegularizationSummary {
    targetHeadwayMinutes: number;
    adjustedTripCount: number;
    changedRecoveryCount: number;
    maxTripShiftMinutes: number;
    tightRecoveryCount: number;
    overlapCount: number;
    before: HeadwayStats;
    after: HeadwayStats;
}

export interface HeadwayRegularizationResult {
    schedules: MasterRouteTable[];
    summary: HeadwayRegularizationSummary;
}

type TripRef = {
    trip: MasterTrip;
    table: MasterRouteTable;
};

const DEFAULT_MIN_RECOVERY_MINUTES = 5;

const cloneSchedules = (schedules: MasterRouteTable[]): MasterRouteTable[] => (
    JSON.parse(JSON.stringify(schedules)) as MasterRouteTable[]
);

const forwardDuration = (start: number, end: number): number => {
    if (end >= start) return end - start;
    return end + 1440 - start;
};

const sumRecoveryTimes = (recoveryTimes: Record<string, number> | undefined): number => (
    Object.values(recoveryTimes || {}).reduce((sum, value) => (
        sum + (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)
    ), 0)
);

const getServedStops = (trip: MasterTrip, tableStops: string[]): string[] => {
    const served = tableStops.filter(stop => (
        trip.stopMinutes?.[stop] !== undefined
        || trip.stops?.[stop] !== undefined
        || trip.arrivalTimes?.[stop] !== undefined
    ));

    if (served.length > 0) return served;
    return Object.keys(trip.stopMinutes || trip.stops || trip.arrivalTimes || {});
};

const getLastServedStop = (trip: MasterTrip, tableStops: string[]): string | null => {
    const servedStops = getServedStops(trip, tableStops);
    return servedStops.length > 0 ? servedStops[servedStops.length - 1] : null;
};

const getStopMinute = (
    trip: MasterTrip,
    stopName: string,
    displayRecord: Record<string, string> | undefined
): number | null => {
    const numeric = trip.stopMinutes?.[stopName];
    if (typeof numeric === 'number' && Number.isFinite(numeric)) return numeric;

    const displayValue = displayRecord?.[stopName];
    const parsed = displayValue ? TimeUtils.toMinutes(displayValue) : null;
    if (parsed === null) return null;

    const parsedOperational = getOperationalSortTime(parsed);
    const tripOperational = getOperationalSortTime(trip.startTime);
    const delta = parsedOperational - tripOperational;
    return trip.startTime + delta;
};

const updateDisplayRecordsFromStopMinutes = (trip: MasterTrip): void => {
    const stopMinutes = trip.stopMinutes || {};
    const recoveryTimes = trip.recoveryTimes || {};

    Object.entries(stopMinutes).forEach(([stopName, departureMinute]) => {
        if (!trip.stops) trip.stops = {};
        trip.stops[stopName] = TimeUtils.fromMinutes(departureMinute);

        if (!trip.arrivalTimes) trip.arrivalTimes = {};
        const recovery = recoveryTimes[stopName] || 0;
        trip.arrivalTimes[stopName] = TimeUtils.fromMinutes(departureMinute - recovery);
    });
};

const shiftDisplayOnlyRecord = (
    record: Record<string, string> | undefined,
    deltaMinutes: number
): Record<string, string> | undefined => {
    if (!record) return undefined;

    return Object.fromEntries(
        Object.entries(record).map(([stopName, value]) => {
            const parsed = TimeUtils.toMinutes(value);
            return [stopName, parsed === null ? value : TimeUtils.fromMinutes(parsed + deltaMinutes)];
        })
    );
};

const shiftTrip = (trip: MasterTrip, deltaMinutes: number): void => {
    if (deltaMinutes === 0) return;

    trip.startTime += deltaMinutes;
    trip.endTime += deltaMinutes;

    if (trip.stopMinutes) {
        trip.stopMinutes = Object.fromEntries(
            Object.entries(trip.stopMinutes).map(([stopName, minute]) => [stopName, minute + deltaMinutes])
        );
        updateDisplayRecordsFromStopMinutes(trip);
    } else {
        trip.stops = shiftDisplayOnlyRecord(trip.stops, deltaMinutes) || {};
        trip.arrivalTimes = shiftDisplayOnlyRecord(trip.arrivalTimes, deltaMinutes);
    }
};

const setTerminalRecovery = (
    trip: MasterTrip,
    terminalStop: string,
    terminalArrivalMinute: number,
    recoveryMinutes: number,
    minRecoveryMinutes: number
): boolean => {
    const roundedRecovery = Math.max(0, Math.round(recoveryMinutes));
    const previousRecovery = trip.recoveryTimes?.[terminalStop] || 0;
    const changed = previousRecovery !== roundedRecovery;

    trip.recoveryTimes = {
        ...(trip.recoveryTimes || {}),
        [terminalStop]: roundedRecovery,
    };
    trip.recoveryTime = sumRecoveryTimes(trip.recoveryTimes);

    if (!trip.stopMinutes) trip.stopMinutes = {};
    trip.stopMinutes[terminalStop] = terminalArrivalMinute + roundedRecovery;
    if (!trip.stops) trip.stops = {};
    trip.stops[terminalStop] = TimeUtils.fromMinutes(trip.stopMinutes[terminalStop]);
    if (!trip.arrivalTimes) trip.arrivalTimes = {};
    trip.arrivalTimes[terminalStop] = TimeUtils.fromMinutes(terminalArrivalMinute);

    trip.endTime = trip.stopMinutes[terminalStop];
    trip.endTimeIncludesRecovery = true;
    trip.cycleTime = forwardDuration(trip.startTime, trip.endTime);
    trip.isTightRecovery = roundedRecovery < minRecoveryMinutes;
    trip.isOverlap = false;

    return changed;
};

const buildTripRefs = (schedules: MasterRouteTable[]): TripRef[] => (
    schedules.flatMap(table => table.trips.map(trip => ({ table, trip })))
);

const sortByOperationalStart = <T extends { startTime: number; tripNumber?: number; id?: string }>(items: T[]): T[] => (
    [...items].sort((a, b) => (
        getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime)
        || (a.tripNumber || 0) - (b.tripNumber || 0)
        || (a.id || '').localeCompare(b.id || '', undefined, { numeric: true, sensitivity: 'base' })
    ))
);

const getHeadwayGroups = (schedules: MasterRouteTable[]): MasterTrip[][] => {
    const groups: MasterTrip[][] = [];

    schedules.forEach(table => {
        const tripsByDirection = new Map<string, MasterTrip[]>();
        table.trips.forEach(trip => {
            const direction = trip.direction || 'Loop';
            const trips = tripsByDirection.get(direction) || [];
            trips.push(trip);
            tripsByDirection.set(direction, trips);
        });

        tripsByDirection.forEach(trips => {
            if (trips.length > 1) groups.push(sortByOperationalStart(trips));
        });
    });

    return groups;
};

export const calculateHeadwayRegularizationStats = (
    schedules: MasterRouteTable[],
    targetHeadwayMinutes: number
): HeadwayStats => {
    const headways = getHeadwayGroups(schedules).flatMap(trips => (
        trips.slice(1).map((trip, index) => (
            getOperationalSortTime(trip.startTime) - getOperationalSortTime(trips[index].startTime)
        ))
    ));

    if (headways.length === 0) {
        return {
            totalHeadways: 0,
            offTargetHeadways: 0,
            worstDeviationMinutes: 0,
            averageHeadwayMinutes: null,
        };
    }

    const deviations = headways.map(headway => Math.abs(headway - targetHeadwayMinutes));
    const total = headways.reduce((sum, headway) => sum + headway, 0);

    return {
        totalHeadways: headways.length,
        offTargetHeadways: deviations.filter(deviation => deviation !== 0).length,
        worstDeviationMinutes: Math.max(...deviations),
        averageHeadwayMinutes: Math.round(total / headways.length),
    };
};

export const regularizeScheduleHeadways = (
    schedules: MasterRouteTable[],
    options: HeadwayRegularizationOptions
): HeadwayRegularizationResult => {
    const targetHeadwayMinutes = Math.round(options.targetHeadwayMinutes);
    const minRecoveryMinutes = Math.max(0, Math.round(options.minRecoveryMinutes ?? DEFAULT_MIN_RECOVERY_MINUTES));
    const nextSchedules = cloneSchedules(schedules);
    const before = calculateHeadwayRegularizationStats(schedules, targetHeadwayMinutes);

    let adjustedTripCount = 0;
    let maxTripShiftMinutes = 0;
    let changedRecoveryCount = 0;
    let tightRecoveryCount = 0;
    let overlapCount = 0;

    if (!Number.isFinite(targetHeadwayMinutes) || targetHeadwayMinutes <= 0) {
        return {
            schedules: nextSchedules,
            summary: {
                targetHeadwayMinutes,
                adjustedTripCount,
                changedRecoveryCount,
                maxTripShiftMinutes,
                tightRecoveryCount,
                overlapCount,
                before,
                after: calculateHeadwayRegularizationStats(nextSchedules, targetHeadwayMinutes),
            },
        };
    }

    nextSchedules.forEach(table => {
        const tripsByDirection = new Map<string, MasterTrip[]>();
        table.trips.forEach(trip => {
            const direction = trip.direction || 'Loop';
            const trips = tripsByDirection.get(direction) || [];
            trips.push(trip);
            tripsByDirection.set(direction, trips);
        });

        tripsByDirection.forEach(directionTrips => {
            const orderedTrips = sortByOperationalStart(directionTrips);
            if (orderedTrips.length <= 1) return;

            const firstStart = getOperationalSortTime(orderedTrips[0].startTime);
            orderedTrips.forEach((trip, index) => {
                const desiredStart = firstStart + (index * targetHeadwayMinutes);
                const currentStart = getOperationalSortTime(trip.startTime);
                const delta = desiredStart - currentStart;
                if (delta === 0) return;

                shiftTrip(trip, delta);
                adjustedTripCount += 1;
                maxTripShiftMinutes = Math.max(maxTripShiftMinutes, Math.abs(delta));
            });
        });

        table.trips = sortByOperationalStart(table.trips);
    });

    const tripRefs = buildTripRefs(nextSchedules);
    const tripsByBlock = new Map<string, TripRef[]>();
    tripRefs.forEach(ref => {
        const blockTrips = tripsByBlock.get(ref.trip.blockId) || [];
        blockTrips.push(ref);
        tripsByBlock.set(ref.trip.blockId, blockTrips);
    });

    tripsByBlock.forEach(blockTrips => {
        const orderedRefs = [...blockTrips].sort((a, b) => (
            getOperationalSortTime(a.trip.startTime) - getOperationalSortTime(b.trip.startTime)
            || (a.trip.tripNumber || 0) - (b.trip.tripNumber || 0)
        ));

        for (let index = 0; index < orderedRefs.length - 1; index += 1) {
            const currentRef = orderedRefs[index];
            const nextRef = orderedRefs[index + 1];
            const terminalStop = getLastServedStop(currentRef.trip, currentRef.table.stops);
            if (!terminalStop) continue;

            const terminalDepartureMinute = getStopMinute(
                currentRef.trip,
                terminalStop,
                currentRef.trip.stops
            ) ?? currentRef.trip.endTime;
            const currentTerminalRecovery = currentRef.trip.recoveryTimes?.[terminalStop] || 0;
            const terminalArrivalMinute = terminalDepartureMinute - currentTerminalRecovery;
            const desiredRecovery = getOperationalSortTime(nextRef.trip.startTime)
                - getOperationalSortTime(terminalArrivalMinute);

            if (desiredRecovery < 0) {
                overlapCount += 1;
                if (setTerminalRecovery(currentRef.trip, terminalStop, terminalArrivalMinute, 0, minRecoveryMinutes)) {
                    changedRecoveryCount += 1;
                }
                currentRef.trip.isOverlap = true;
                currentRef.trip.isTightRecovery = true;
                nextRef.trip.isOverlap = true;
                continue;
            }

            if (desiredRecovery < minRecoveryMinutes) tightRecoveryCount += 1;
            if (setTerminalRecovery(
                currentRef.trip,
                terminalStop,
                terminalArrivalMinute,
                desiredRecovery,
                minRecoveryMinutes
            )) {
                changedRecoveryCount += 1;
            }
        }
    });

    const after = calculateHeadwayRegularizationStats(nextSchedules, targetHeadwayMinutes);

    return {
        schedules: nextSchedules,
        summary: {
            targetHeadwayMinutes,
            adjustedTripCount,
            changedRecoveryCount,
            maxTripShiftMinutes,
            tightRecoveryCount,
            overlapCount,
            before,
            after,
        },
    };
};

export const previewScheduleHeadwayRegularization = (
    schedules: MasterRouteTable[],
    options: HeadwayRegularizationOptions
): HeadwayRegularizationSummary => regularizeScheduleHeadways(schedules, options).summary;
