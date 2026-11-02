/**
 * Hold a target headway per round-trip row by changing only the last recovery
 * of each block's previous round trip (Step 4 "Fix headways").
 *
 * - Never adds, deletes, or reassigns trips.
 * - Each block's first row (pull-out) stays where it is.
 * - Headway is measured exactly as the HDWY column measures it.
 */

import { buildRoundTripView, validateRouteTable } from '../parsers/masterScheduleParser';
import type { MasterRouteTable, MasterTrip, RoundTripRow, RoundTripTable } from '../parsers/masterScheduleParser';
import { extractDirectionFromName, parseRouteInfo } from '../config/routeDirectionConfig';
import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import { TimeUtils } from '../timeUtils';
import { deepCloneSchedules, findTableAndTrip } from './scheduleEditorUtils';
import {
    getRoundTripDisplayedHeadways,
    getRoundTripRowKey,
    getRoundTripStartSortTime,
} from './roundTripSortUtils';
import {
    compareBlockTripOrder,
    getServiceDay,
    getTripStopValue,
    getTrueBaseRoute,
    recalculateTrip,
    setTripStopValue,
    shiftTripTimes,
} from '../../hooks/useScheduleEditing';

export const STANDARD_HEADWAYS = [10, 15, 30, 45, 60];
export const DEFAULT_MIN_HOLD_RECOVERY_MINUTES = 5;

/** Nearest standard headway by ratio, so 56 → 60, 46 → 45, 36 → 30. */
export const snapToStandardHeadway = (minutes: number): number => (
    STANDARD_HEADWAYS.reduce((best, candidate) => (
        Math.abs(Math.log(candidate / minutes)) < Math.abs(Math.log(best / minutes)) ? candidate : best
    ))
);

type RoundTripPair = {
    key: string;
    north: MasterRouteTable;
    south: MasterRouteTable;
    combined: RoundTripTable;
};

const emptyTable = (routeName: string): MasterRouteTable => ({ routeName, stops: [], stopIds: {}, trips: [] });

// Same North/South grouping RoundTripTableView uses.
const buildRoundTripPairs = (schedules: MasterRouteTable[]): RoundTripPair[] => {
    const groups: Record<string, { north?: MasterRouteTable; south?: MasterRouteTable }> = {};
    schedules.forEach(table => {
        const routeVariant = table.routeName.replace(/ \(North\).*$/, '').replace(/ \(South\).*$/, '').trim();
        const parsed = parseRouteInfo(routeVariant);
        const baseName = parsed.suffixIsDirection ? parsed.baseRoute : routeVariant;
        if (!groups[baseName]) groups[baseName] = {};

        let direction = extractDirectionFromName(table.routeName);
        if (!direction && parsed.suffixIsDirection) direction = parsed.direction;

        if (direction === 'North') groups[baseName].north = table;
        else if (direction === 'South') groups[baseName].south = table;
        else if (!groups[baseName].north) groups[baseName].north = table;
        else groups[baseName].south = table;
    });

    return Object.entries(groups)
        .filter(([, group]) => group.north || group.south)
        .map(([key, group]) => {
            const north = group.north || emptyTable(`${key} (North)`);
            const south = group.south || emptyTable(`${key} (South)`);
            return { key, north, south, combined: buildRoundTripView(north, south) };
        });
};

/** Rows in time order: the order the HDWY column reads them in. */
export const orderRoundTripRowsByTime = (combined: RoundTripTable): RoundTripRow[] => (
    [...combined.rows].sort((a, b) => (
        getOperationalSortTime(getRoundTripStartSortTime(a, combined))
        - getOperationalSortTime(getRoundTripStartSortTime(b, combined))
        || a.blockId.localeCompare(b.blockId, undefined, { numeric: true })
    ))
);

/**
 * First-estimate target headway per row: round the current gap to a standard
 * headway, then a lone value inside a steady run takes the run's value.
 */
export const estimateRoundTripHeadwayTargets = (combined: RoundTripTable): Record<string, number> => {
    const rows = orderRoundTripRowsByTime(combined);
    const headways = getRoundTripDisplayedHeadways(rows, combined);
    const keys = rows.map(getRoundTripRowKey).filter(key => (headways[key] ?? 0) > 0);
    const raw = keys.map(key => snapToStandardHeadway(headways[key]));
    // Only a lone odd value inside a steady run is smoothed; an alternating
    // pattern (e.g. 60/30/60/30) is left for the planner to decide.
    const smoothed = raw.map((value, index) => {
        const previous = raw[index - 1];
        const next = raw[index + 1];
        const steadyBefore = index < 2 || raw[index - 2] === previous;
        const steadyAfter = index + 2 >= raw.length || raw[index + 2] === next;
        const isLoneOutlier = previous !== undefined
            && previous === next
            && value !== previous
            && steadyBefore
            && steadyAfter;
        return isLoneOutlier ? previous : value;
    });
    return Object.fromEntries(keys.map((key, index) => [key, smoothed[index]]));
};

export const estimateHeadwayTargets = (schedules: MasterRouteTable[]): Record<string, number> => (
    Object.assign({}, ...buildRoundTripPairs(schedules).map(pair => estimateRoundTripHeadwayTargets(pair.combined)))
);

export interface HeadwayHoldFlag {
    /** Row whose last recovery is too short (its Recovery cell turns red). */
    recoveryRowKey: string;
    /** Row whose target caused it. */
    targetRowKey: string;
    blockId: string;
    /** Departure of the target row (minutes), for messages. */
    departureMinutes: number;
    recoveryMinutes: number;
    targetMinutes: number;
    kind: 'short' | 'overlap';
}

export interface HeadwayHoldResult {
    schedules: MasterRouteTable[];
    changedRecoveryCount: number;
    movedTripCount: number;
    maxShiftMinutes: number;
    flags: HeadwayHoldFlag[];
    /** Rows off target that are a block's first trip, which stays fixed. */
    pullOutOffTarget: string[];
}

const getTerminalStop = (trip: MasterTrip, table: MasterRouteTable): string | null => (
    table.stops[trip.endStopIndex ?? table.stops.length - 1] ?? null
);

// Terminal-recovery edit, same as the editor's handleRecoveryEdit for a last stop.
const setTerminalRecovery = (trip: MasterTrip, table: MasterRouteTable, stopName: string, recovery: number): void => {
    const oldRecovery = getTripStopValue(trip.recoveryTimes, stopName) || 0;
    trip.recoveryTimes = setTripStopValue(trip.recoveryTimes, stopName, recovery);
    trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, value) => sum + (value || 0), 0);

    const arrival = TimeUtils.toMinutes(getTripStopValue(trip.arrivalTimes, stopName));
    if (arrival !== null) {
        trip.stops = setTripStopValue(trip.stops, stopName, TimeUtils.fromMinutes(arrival + recovery));
    } else {
        const departure = TimeUtils.toMinutes(getTripStopValue(trip.stops, stopName));
        if (departure !== null) {
            trip.stops = setTripStopValue(trip.stops, stopName, TimeUtils.fromMinutes(departure + recovery - oldRecovery));
        }
    }
    trip.endTimeIncludesRecovery = true;
    recalculateTrip(trip, table.stops);
    validateRouteTable(table);
};

const shiftLaterBlockTrips = (
    schedules: MasterRouteTable[],
    anchor: { trip: MasterTrip; table: MasterRouteTable },
    deltaMinutes: number
): void => {
    const baseName = getTrueBaseRoute(anchor.table.routeName);
    const serviceDay = getServiceDay(anchor.table.routeName);
    const blockTrips = schedules
        .filter(table => getTrueBaseRoute(table.routeName) === baseName && getServiceDay(table.routeName) === serviceDay)
        .flatMap(table => table.trips
            .filter(trip => trip.blockId === anchor.trip.blockId)
            .map(trip => ({ trip, table })))
        .sort(compareBlockTripOrder);
    const startIndex = blockTrips.findIndex(item => item.trip.id === anchor.trip.id);
    blockTrips.slice(startIndex + 1).forEach(item => shiftTripTimes(item.trip, item.table, deltaMinutes));
};

export const holdRoundTripHeadways = (
    schedules: MasterRouteTable[],
    typedTargets: Record<string, number> = {},
    options: { minRecoveryMinutes?: number } = {}
): HeadwayHoldResult => {
    const minRecovery = options.minRecoveryMinutes ?? DEFAULT_MIN_HOLD_RECOVERY_MINUTES;
    const next = deepCloneSchedules(schedules);
    const estimates = estimateHeadwayTargets(schedules);
    const flags = new Map<string, HeadwayHoldFlag>();
    const pullOutOffTarget: string[] = [];

    buildRoundTripPairs(next).forEach(({ key: pairKey, combined: initial }) => {
        const done = new Set<string>();
        const guard = initial.rows.length * 3;

        for (let step = 0; step < guard; step += 1) {
            // Rebuild each step: earlier changes move later rows.
            const pair = buildRoundTripPairs(next).find(candidate => candidate.key === pairKey);
            if (!pair) break;
            const rows = orderRoundTripRowsByTime(pair.combined);
            const row = rows.find(candidate => !done.has(getRoundTripRowKey(candidate)));
            if (!row) break;
            const rowKey = getRoundTripRowKey(row);
            done.add(rowKey);

            const target = typedTargets[rowKey] ?? estimates[rowKey];
            const headway = getRoundTripDisplayedHeadways(rows, pair.combined)[rowKey];
            if (!target || headway === undefined || headway === target) continue;

            const blockRows = rows.filter(candidate => candidate.blockId === row.blockId);
            const previousRow = blockRows[blockRows.indexOf(row) - 1];
            if (!previousRow) {
                pullOutOffTarget.push(rowKey);
                continue;
            }

            const lastTrip = previousRow.trips[previousRow.trips.length - 1];
            const located = findTableAndTrip(next, lastTrip.id);
            if (!located) continue;
            const terminalStop = getTerminalStop(located.trip, located.table);
            if (!terminalStop) continue;

            const oldRecovery = getTripStopValue(located.trip.recoveryTimes, terminalStop) || 0;
            const wanted = oldRecovery + (target - headway);
            const recovery = Math.max(0, wanted);
            if (wanted < minRecovery) {
                flags.set(getRoundTripRowKey(previousRow), {
                    recoveryRowKey: getRoundTripRowKey(previousRow),
                    targetRowKey: rowKey,
                    blockId: row.blockId,
                    departureMinutes: getRoundTripStartSortTime(row, pair.combined),
                    recoveryMinutes: recovery,
                    targetMinutes: target,
                    kind: wanted < 0 ? 'overlap' : 'short',
                });
            } else {
                flags.delete(getRoundTripRowKey(previousRow));
            }

            const applied = recovery - oldRecovery;
            if (applied === 0) continue;
            setTerminalRecovery(located.trip, located.table, terminalStop, recovery);
            shiftLaterBlockTrips(next, located, applied);
        }
    });

    const before = new Map(schedules.flatMap(table => table.trips.map(trip => [trip.id, trip] as const)));
    let changedRecoveryCount = 0;
    let movedTripCount = 0;
    let maxShiftMinutes = 0;
    next.forEach(table => table.trips.forEach(trip => {
        const original = before.get(trip.id);
        if (!original) return;
        if ((original.recoveryTime || 0) !== (trip.recoveryTime || 0)) changedRecoveryCount += 1;
        const shift = trip.startTime - original.startTime;
        if (shift !== 0) {
            movedTripCount += 1;
            maxShiftMinutes = Math.max(maxShiftMinutes, Math.abs(shift));
        }
    }));

    return {
        schedules: next,
        changedRecoveryCount,
        movedTripCount,
        maxShiftMinutes,
        flags: [...flags.values()],
        pullOutOffTarget,
    };
};
