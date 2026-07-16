import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';

export interface ScheduleEditImpact {
    changedTripCount: number;
    changedTimepointCount: number;
    reassignedTripCount: number;
    blockIds: string[];
}

const recordValuesEqual = (
    left: Record<string, string | number> | undefined,
    right: Record<string, string | number> | undefined,
): boolean => {
    const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
    return [...keys].every(key => (left?.[key] ?? null) === (right?.[key] ?? null));
};

const tripChanged = (before: MasterTrip, after: MasterTrip): boolean => (
    before.startTime !== after.startTime
    || before.endTime !== after.endTime
    || before.travelTime !== after.travelTime
    || before.recoveryTime !== after.recoveryTime
    || before.cycleTime !== after.cycleTime
    || before.blockId !== after.blockId
    || !recordValuesEqual(before.stops, after.stops)
    || !recordValuesEqual(before.arrivalTimes, after.arrivalTimes)
    || !recordValuesEqual(before.recoveryTimes, after.recoveryTimes)
);

const countChangedTimepoints = (before: MasterTrip, after: MasterTrip): number => {
    const keys = new Set([
        ...Object.keys(before.stops ?? {}),
        ...Object.keys(after.stops ?? {}),
        ...Object.keys(before.arrivalTimes ?? {}),
        ...Object.keys(after.arrivalTimes ?? {}),
        ...Object.keys(before.recoveryTimes ?? {}),
        ...Object.keys(after.recoveryTimes ?? {}),
    ]);

    return [...keys].filter(key => (
        (before.stops?.[key] ?? null) !== (after.stops?.[key] ?? null)
        || (before.arrivalTimes?.[key] ?? null) !== (after.arrivalTimes?.[key] ?? null)
        || (before.recoveryTimes?.[key] ?? null) !== (after.recoveryTimes?.[key] ?? null)
    )).length;
};

const indexTrips = (tables: MasterRouteTable[]): Map<string, MasterTrip> => {
    const trips = new Map<string, MasterTrip>();
    tables.forEach(table => table.trips.forEach(trip => trips.set(trip.id, trip)));
    return trips;
};

export const summarizeScheduleEditImpact = (
    beforeTables: MasterRouteTable[],
    afterTables: MasterRouteTable[],
): ScheduleEditImpact => {
    const beforeTrips = indexTrips(beforeTables);
    const afterTrips = indexTrips(afterTables);
    const blockIds = new Set<string>();
    let changedTripCount = 0;
    let changedTimepointCount = 0;
    let reassignedTripCount = 0;

    beforeTrips.forEach((before, tripId) => {
        if (afterTrips.has(tripId)) return;
        changedTripCount += 1;
        changedTimepointCount += new Set([
            ...Object.keys(before.stops ?? {}),
            ...Object.keys(before.arrivalTimes ?? {}),
            ...Object.keys(before.recoveryTimes ?? {}),
        ]).size;
        if (before.blockId) blockIds.add(before.blockId);
    });

    afterTrips.forEach((after, tripId) => {
        const before = beforeTrips.get(tripId);
        if (!before) {
            changedTripCount += 1;
            changedTimepointCount += new Set([
                ...Object.keys(after.stops ?? {}),
                ...Object.keys(after.arrivalTimes ?? {}),
                ...Object.keys(after.recoveryTimes ?? {}),
            ]).size;
            if (after.blockId) blockIds.add(after.blockId);
            return;
        }
        if (!tripChanged(before, after)) return;

        changedTripCount += 1;
        changedTimepointCount += countChangedTimepoints(before, after);
        if (before.blockId !== after.blockId) reassignedTripCount += 1;
        if (after.blockId) blockIds.add(after.blockId);
        else if (before.blockId) blockIds.add(before.blockId);
    });

    return {
        changedTripCount,
        changedTimepointCount,
        reassignedTripCount,
        blockIds: [...blockIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    };
};

export const formatScheduleEditImpact = (impact: ScheduleEditImpact): string => {
    const tripLabel = `${impact.changedTripCount} trip${impact.changedTripCount === 1 ? '' : 's'}`;
    const parts = [`Updated ${tripLabel}`];
    if (impact.changedTimepointCount > 0) {
        parts.push(`${impact.changedTimepointCount} timepoint${impact.changedTimepointCount === 1 ? '' : 's'}`);
    }
    if (impact.reassignedTripCount > 0) {
        parts.push(`reassigned ${impact.reassignedTripCount}`);
    }
    return parts.join(' · ');
};
