/**
 * Ranked connections (Guided Schedule Step 4).
 *
 * The planner ranks connections. The optimizer fixes misses from rank #1 down
 * by moving single trips, and only makes a move when it keeps every
 * connection of the same or higher rank that is already met. Each trip move
 * is taken from the previous trip's end recovery and given back to the moved
 * trip's own end recovery, so the rest of the block does not move.
 *
 * The search runs on per-trip minute shifts; schedules change only in
 * applyTripShifts().
 */

import type { DayType, MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { validateRouteTable } from '../parsers/masterScheduleParser';
import type { ConnectionLibrary, ConnectionTarget, RouteConnection } from './connectionTypes';
import { TimeUtils } from '../timeUtils';
import { deepCloneSchedules } from '../schedule/scheduleEditorUtils';
import {
    compareBlockTripOrder,
    getTripStopValue,
    recalculateTrip,
    setTripStopValue,
    shiftTripTimes,
} from '../../hooks/useScheduleEditing';

export type ConnectionStatus = 'met' | 'tight' | 'long' | 'missed';

export interface ConnectionWindow {
    min: number;
    max: number;
}

/** A target event (one train, one bus) paired with the trip that serves it. */
export interface ConnectionEvent {
    connectionId: string;
    targetTime: number;
    tripId: string;
    blockId: string;
    stopName: string;
    /** Bus arrival (bus to the service) or departure (service to the bus) at the stop, before shifts. */
    baseBusTime: number;
}

export interface EvaluatedEvent extends ConnectionEvent {
    busTime: number;
    /** Minutes the rider waits; negative means the connection is missed. */
    gap: number;
    status: ConnectionStatus;
    /** Met on paper, but a late bus (lateness model) would leave under 1 minute. */
    atRisk: boolean;
    lateness: number;
}

export interface ConnectionTotals {
    met: number;
    atRisk: number;
    tight: number;
    long: number;
    missed: number;
    total: number;
    /** Target events with no trip of this route close enough to serve them. */
    unserved: number;
}

export interface ConnectionEvaluation {
    connection: RouteConnection;
    target: ConnectionTarget | null;
    rank: number;
    events: EvaluatedEvent[];
    totals: ConnectionTotals;
}

interface TripNode {
    trip: MasterTrip;
    tableIndex: number;
    terminalStop: string | null;
    terminalRecovery: number;
    terminalArrival: number | null;
    prevId: string | null;
    nextId: string | null;
}

export interface RankedConnectionModel {
    dayType: DayType;
    /** Enabled connections in rank order (index 0 = rank #1). */
    connections: RouteConnection[];
    targets: Map<string, ConnectionTarget>;
    events: ConnectionEvent[];
    eventsByConnection: Map<string, ConnectionEvent[]>;
    eventsByTrip: Map<string, ConnectionEvent[]>;
    unservedByConnection: Map<string, number>;
    trips: Map<string, TripNode>;
}

/** Minutes late (80th percentile) of a trip at a stop around a time. */
export type LatenessModel = (tripId: string, stopName: string, busTime: number) => number;

export type TripShifts = Record<string, number>;

export interface EvaluateOptions {
    lateness?: LatenessModel;
}

export const DEFAULT_MAX_WAIT_MINUTES = 15;
const PAIRING_EARLY_SLACK = 15;
const PAIRING_LATE_SLACK = 15;

export const getConnectionWindow = (connection: Pick<RouteConnection, 'bufferMinutes' | 'maxWaitMinutes'>): ConnectionWindow => {
    const min = Math.max(0, connection.bufferMinutes ?? 0);
    const max = connection.maxWaitMinutes !== undefined
        ? Math.max(min, connection.maxWaitMinutes)
        : Math.max(DEFAULT_MAX_WAIT_MINUTES, min + 10);
    return { min, max };
};

export const classifyGap = (gap: number, window: ConnectionWindow): ConnectionStatus => {
    if (gap < 0) return 'missed';
    if (gap < window.min) return 'tight';
    if (gap > window.max) return 'long';
    return 'met';
};

/** Target times that run on this day type (times without days run every day). */
export const getTargetTimesForDay = (target: ConnectionTarget, dayType: DayType): number[] => (
    (target.times || [])
        .filter(time => time.enabled && (!time.daysActive?.length || time.daysActive.includes(dayType)))
        .map(time => time.time)
        .sort((a, b) => a - b)
);

const inActiveHours = (connection: RouteConnection, targetTime: number): boolean => {
    const start = connection.timeFilterStart;
    const end = connection.timeFilterEnd;
    if (start === undefined || end === undefined) return true;
    const t = targetTime % 1440;
    return start <= end ? t >= start && t < end : t >= start || t < end;
};

// ---------- trip times at a stop ----------

const OPERATIONAL_DAY_START = 240;

const normalizeTripMinutes = (raw: number, tripStart: number): number => {
    if (raw >= 1440) return raw;
    if (tripStart >= 1440 || tripStart < OPERATIONAL_DAY_START) return raw + 1440;
    return raw;
};

const toTripMinutes = (value: string | undefined, trip: MasterTrip): number | null => {
    if (!value) return null;
    const raw = TimeUtils.toMinutes(value);
    return raw === null ? null : normalizeTripMinutes(raw, trip.startTime);
};

const getDeparture = (trip: MasterTrip, stopName: string): number | null => {
    const minutes = getTripStopValue(trip.stopMinutes, stopName);
    if (typeof minutes === 'number') return minutes;
    return toTripMinutes(getTripStopValue(trip.stops, stopName), trip);
};

const getArrival = (trip: MasterTrip, stopName: string): number | null => {
    const arrival = toTripMinutes(getTripStopValue(trip.arrivalTimes, stopName), trip);
    if (arrival !== null) return arrival;
    const departure = getDeparture(trip, stopName);
    if (departure === null) return null;
    return departure - (getTripStopValue(trip.recoveryTimes, stopName) ?? 0);
};

const getServedStops = (trip: MasterTrip, table: MasterRouteTable): string[] => (
    table.stops.filter(stop => {
        const value = getTripStopValue(trip.stops, stop);
        return value !== undefined && value !== null && value !== '';
    })
);

const findStopNameByCode = (table: MasterRouteTable, stopCode: string): string | null => {
    const code = stopCode.trim();
    if (!code) return null;
    return Object.entries(table.stopIds || {}).find(([, value]) => (value || '').trim() === code)?.[0] ?? null;
};

/**
 * Bus time used for a connection: the arrival when the bus feeds the service
 * (skipped where the trip starts, since no one arrives on it there), and the
 * departure when the bus takes riders from the service (skipped where the
 * trip ends).
 */
const getBusTimeForConnection = (
    trip: MasterTrip,
    table: MasterRouteTable,
    stopName: string,
    connection: RouteConnection
): number | null => {
    const served = getServedStops(trip, table);
    if (!served.includes(stopName)) return null;
    if (connection.connectionType === 'meet_departing') {
        if (served[0] === stopName && served.length > 1) return null;
        return getArrival(trip, stopName);
    }
    if (served[served.length - 1] === stopName && served.length > 1) return null;
    return getDeparture(trip, stopName);
};

const gapFor = (connection: RouteConnection, targetTime: number, busTime: number): number => (
    connection.connectionType === 'meet_departing' ? targetTime - busTime : busTime - targetTime
);

// ---------- model ----------

const buildTripNodes = (schedules: MasterRouteTable[]): Map<string, TripNode> => {
    const nodes = new Map<string, TripNode>();
    const byBlock = new Map<string, Array<{ trip: MasterTrip; table: MasterRouteTable; tableIndex: number }>>();
    schedules.forEach((table, tableIndex) => table.trips.forEach(trip => {
        const served = getServedStops(trip, table);
        const terminalStop = served[served.length - 1] ?? null;
        nodes.set(trip.id, {
            trip,
            tableIndex,
            terminalStop,
            terminalRecovery: terminalStop ? (getTripStopValue(trip.recoveryTimes, terminalStop) ?? 0) : 0,
            terminalArrival: terminalStop ? getArrival(trip, terminalStop) : null,
            prevId: null,
            nextId: null,
        });
        const list = byBlock.get(trip.blockId) ?? [];
        list.push({ trip, table, tableIndex });
        byBlock.set(trip.blockId, list);
    }));
    byBlock.forEach(list => {
        list.sort(compareBlockTripOrder);
        list.forEach((item, index) => {
            const node = nodes.get(item.trip.id)!;
            node.prevId = index > 0 ? list[index - 1].trip.id : null;
            node.nextId = index < list.length - 1 ? list[index + 1].trip.id : null;
        });
    });
    return nodes;
};

/**
 * Pairs every active target event with the trip whose wait is closest to the
 * middle of the connection's window. Connections are taken in the given order
 * (rank order); disabled ones are left out.
 */
export const buildRankedConnectionModel = (
    schedules: MasterRouteTable[],
    connections: RouteConnection[],
    library: Pick<ConnectionLibrary, 'targets'>,
    dayType: DayType
): RankedConnectionModel => {
    const enabled = connections.filter(connection => connection.enabled);
    const targets = new Map(library.targets.map(target => [target.id, target] as const));
    const events: ConnectionEvent[] = [];
    const eventsByConnection = new Map<string, ConnectionEvent[]>();
    const eventsByTrip = new Map<string, ConnectionEvent[]>();
    const unservedByConnection = new Map<string, number>();

    for (const connection of enabled) {
        const target = targets.get(connection.targetId);
        const list: ConnectionEvent[] = [];
        eventsByConnection.set(connection.id, list);
        unservedByConnection.set(connection.id, 0);
        if (!target) continue;

        const window = getConnectionWindow(connection);
        const mid = (window.min + window.max) / 2;
        const candidates: Array<{ trip: MasterTrip; stopName: string; busTime: number }> = [];
        schedules.forEach(table => {
            const stopName = findStopNameByCode(table, connection.stopCode);
            if (!stopName) return;
            table.trips.forEach(trip => {
                const busTime = getBusTimeForConnection(trip, table, stopName, connection);
                if (busTime !== null) candidates.push({ trip, stopName, busTime });
            });
        });

        for (const targetTime of getTargetTimesForDay(target, dayType)) {
            if (!inActiveHours(connection, targetTime)) continue;
            let best: { trip: MasterTrip; stopName: string; busTime: number } | null = null;
            let bestScore = Infinity;
            for (const candidate of candidates) {
                const gap = gapFor(connection, targetTime, candidate.busTime);
                if (gap < -PAIRING_LATE_SLACK || gap > window.max + PAIRING_EARLY_SLACK) continue;
                const score = Math.abs(gap - mid);
                if (score < bestScore) {
                    bestScore = score;
                    best = candidate;
                }
            }
            if (!best) {
                unservedByConnection.set(connection.id, (unservedByConnection.get(connection.id) ?? 0) + 1);
                continue;
            }
            const event: ConnectionEvent = {
                connectionId: connection.id,
                targetTime,
                tripId: best.trip.id,
                blockId: best.trip.blockId,
                stopName: best.stopName,
                baseBusTime: best.busTime,
            };
            list.push(event);
            events.push(event);
            const byTrip = eventsByTrip.get(event.tripId) ?? [];
            byTrip.push(event);
            eventsByTrip.set(event.tripId, byTrip);
        }
    }

    return {
        dayType,
        connections: enabled,
        targets,
        events,
        eventsByConnection,
        eventsByTrip,
        unservedByConnection,
        trips: buildTripNodes(schedules),
    };
};

// ---------- evaluation ----------

const evaluateEvent = (
    model: RankedConnectionModel,
    event: ConnectionEvent,
    shifts: TripShifts,
    options: EvaluateOptions
): EvaluatedEvent => {
    const connection = model.connections.find(item => item.id === event.connectionId)!;
    const window = getConnectionWindow(connection);
    const busTime = event.baseBusTime + (shifts[event.tripId] ?? 0);
    const gap = gapFor(connection, event.targetTime, busTime);
    const status = classifyGap(gap, window);
    const lateness = connection.connectionType === 'meet_departing' && options.lateness
        ? Math.max(0, options.lateness(event.tripId, event.stopName, busTime))
        : 0;
    return { ...event, busTime, gap, status, atRisk: status === 'met' && lateness > 0 && gap - lateness < 1, lateness };
};

const isOk = (event: EvaluatedEvent, planForLateness: boolean): boolean => (
    event.status === 'met' && !(planForLateness && event.atRisk)
);

export const evaluateRankedConnections = (
    model: RankedConnectionModel,
    shifts: TripShifts = {},
    options: EvaluateOptions = {}
): ConnectionEvaluation[] => model.connections.map((connection, rank) => {
    const events = (model.eventsByConnection.get(connection.id) ?? []).map(event => evaluateEvent(model, event, shifts, options));
    const totals: ConnectionTotals = {
        met: events.filter(event => event.status === 'met').length,
        atRisk: events.filter(event => event.atRisk).length,
        tight: events.filter(event => event.status === 'tight').length,
        long: events.filter(event => event.status === 'long').length,
        missed: events.filter(event => event.status === 'missed').length,
        total: events.length,
        unserved: model.unservedByConnection.get(connection.id) ?? 0,
    };
    return { connection, target: model.targets.get(connection.targetId) ?? null, rank: rank + 1, events, totals };
});

// ---------- optimizer ----------

export interface RankedOptimizeOptions extends EvaluateOptions {
    /** Largest total move of one trip from where it is now, in minutes. */
    maxShiftMinutes: number;
    /** Keep each end recovery at least this share of the trip's travel time (0.1 = 10%). */
    minRecoveryRatio?: number;
    /** Treat "at risk" events as missed (needs a lateness model). */
    planForLateness?: boolean;
}

export type UnfixedReason =
    | { kind: 'protected'; blockerConnectionId: string; blockerTargetTime: number }
    | { kind: 'limit'; neededMinutes: number }
    | { kind: 'recovery'; neededMinutes: number };

export interface UnfixedEvent {
    connectionId: string;
    rank: number;
    targetTime: number;
    tripId: string;
    blockId: string;
    reason: UnfixedReason;
}

export interface RankedOptimizeResult {
    shifts: TripShifts;
    movedTripIds: string[];
    before: ConnectionEvaluation[];
    after: ConnectionEvaluation[];
    unfixed: UnfixedEvent[];
}

const minRecoveryFor = (node: TripNode, ratio: number): number => (
    Math.ceil(Math.max(0, node.trip.travelTime || 0) * ratio)
);

/** Layover between a trip's end arrival and the next trip's start, after shifts. */
const layoverAfter = (model: RankedConnectionModel, node: TripNode, shifts: TripShifts): number | null => {
    if (!node.nextId || node.terminalArrival === null) return null;
    const next = model.trips.get(node.nextId);
    if (!next) return null;
    return (next.trip.startTime + (shifts[next.trip.id] ?? 0)) - (node.terminalArrival + (shifts[node.trip.id] ?? 0));
};

/** A trip's shift is allowed if neither its own end layover nor the previous trip's drops below the minimum (or below where it already was). */
const recoveryAllows = (
    model: RankedConnectionModel,
    tripId: string,
    shifts: TripShifts,
    trial: TripShifts,
    ratio: number
): boolean => {
    const node = model.trips.get(tripId);
    if (!node) return true;
    const checks = [node, node.prevId ? model.trips.get(node.prevId) : undefined];
    return checks.every(check => {
        if (!check) return true;
        const before = layoverAfter(model, check, shifts);
        const after = layoverAfter(model, check, trial);
        if (before === null || after === null) return true;
        return after >= Math.min(minRecoveryFor(check, ratio), before);
    });
};

/** Total shifts (relative to now) that would put this event inside its window. */
const shiftRangeToMeet = (
    connection: RouteConnection,
    event: ConnectionEvent,
    window: ConnectionWindow,
    minGap: number
): [number, number] => {
    const base = event.targetTime - event.baseBusTime;
    return connection.connectionType === 'meet_departing'
        ? [base - window.max, base - minGap]
        : [minGap - base, window.max - base];
};

export const optimizeRankedConnections = (
    model: RankedConnectionModel,
    options: RankedOptimizeOptions
): RankedOptimizeResult => {
    const maxShift = Math.max(0, Math.round(options.maxShiftMinutes));
    const ratio = options.minRecoveryRatio ?? 0;
    const planForLateness = !!options.planForLateness && !!options.lateness;
    const evalOptions: EvaluateOptions = { lateness: options.lateness };
    const shifts: TripShifts = {};
    const unfixed: UnfixedEvent[] = [];
    const rankOf = new Map(model.connections.map((connection, index) => [connection.id, index] as const));
    const okAt = (event: ConnectionEvent, state: TripShifts) => isOk(evaluateEvent(model, event, state, evalOptions), planForLateness);

    model.connections.forEach((connection, rank) => {
        const window = getConnectionWindow(connection);
        for (const event of model.eventsByConnection.get(connection.id) ?? []) {
            if (okAt(event, shifts)) continue;
            const current = shifts[event.tripId] ?? 0;
            const protectedEvents = (model.eventsByTrip.get(event.tripId) ?? [])
                .filter(other => other !== event && (rankOf.get(other.connectionId) ?? Infinity) <= rank && okAt(other, shifts));

            const candidates: number[] = [];
            for (let d = -maxShift; d <= maxShift; d++) if (d !== current) candidates.push(d);
            candidates.sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || Math.abs(a) - Math.abs(b));

            let blocker: ConnectionEvent | null = null;
            let recoveryBlocked = false;
            let fixedAt: number | null = null;
            for (const d of candidates) {
                const trial = { ...shifts, [event.tripId]: d };
                if (!okAt(event, trial)) continue;
                if (!recoveryAllows(model, event.tripId, shifts, trial, ratio)) {
                    recoveryBlocked = true;
                    continue;
                }
                const broken = protectedEvents.find(other => !okAt(other, trial));
                if (broken) {
                    blocker = blocker ?? broken;
                    continue;
                }
                fixedAt = d;
                break;
            }

            if (fixedAt !== null) {
                if (fixedAt === 0) delete shifts[event.tripId];
                else shifts[event.tripId] = fixedAt;
                continue;
            }

            const evaluated = evaluateEvent(model, event, shifts, evalOptions);
            const minGap = planForLateness ? Math.max(window.min, Math.ceil(evaluated.lateness) + 1) : window.min;
            const [low, high] = shiftRangeToMeet(connection, event, window, minGap);
            const needed = low <= 0 && high >= 0 ? 0 : (Math.abs(low) < Math.abs(high) ? low : high);
            unfixed.push({
                connectionId: connection.id,
                rank: rank + 1,
                targetTime: event.targetTime,
                tripId: event.tripId,
                blockId: event.blockId,
                reason: blocker
                    ? { kind: 'protected', blockerConnectionId: blocker.connectionId, blockerTargetTime: blocker.targetTime }
                    : recoveryBlocked
                        ? { kind: 'recovery', neededMinutes: needed }
                        : { kind: 'limit', neededMinutes: needed },
            });
        }
    });

    return {
        shifts,
        movedTripIds: Object.keys(shifts),
        before: evaluateRankedConnections(model, {}, evalOptions),
        after: evaluateRankedConnections(model, shifts, evalOptions),
        unfixed,
    };
};

// ---------- applying shifts ----------

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
};

/**
 * Moves each shifted trip and rebalances end recoveries so the block chain
 * holds: the previous trip's end recovery changes by the move, and the moved
 * trip's own end recovery changes the other way.
 */
export const applyTripShifts = (
    schedules: MasterRouteTable[],
    model: RankedConnectionModel,
    shifts: TripShifts
): MasterRouteTable[] => {
    const moved = Object.entries(shifts).filter(([, minutes]) => minutes !== 0);
    if (moved.length === 0) return schedules;
    const next = deepCloneSchedules(schedules);
    const find = (tripId: string) => {
        for (const table of next) {
            const trip = table.trips.find(item => item.id === tripId);
            if (trip) return { trip, table };
        }
        return null;
    };

    moved.forEach(([tripId, minutes]) => {
        const found = find(tripId);
        if (found) shiftTripTimes(found.trip, found.table, minutes);
    });

    const affected = new Set<string>();
    moved.forEach(([tripId]) => {
        affected.add(tripId);
        const prevId = model.trips.get(tripId)?.prevId;
        if (prevId) affected.add(prevId);
    });
    affected.forEach(tripId => {
        const node = model.trips.get(tripId);
        if (!node?.nextId || !node.terminalStop) return;
        const delta = (shifts[node.nextId] ?? 0) - (shifts[tripId] ?? 0);
        if (delta === 0) return;
        const found = find(tripId);
        if (found) setTerminalRecovery(found.trip, found.table, node.terminalStop, Math.max(0, node.terminalRecovery + delta));
    });

    next.forEach(table => validateRouteTable(table));
    return next;
};

// ---------- small helpers for the UI ----------

export const sumTotals = (evaluations: ConnectionEvaluation[]): ConnectionTotals => evaluations.reduce<ConnectionTotals>((sum, item) => ({
    met: sum.met + item.totals.met,
    atRisk: sum.atRisk + item.totals.atRisk,
    tight: sum.tight + item.totals.tight,
    long: sum.long + item.totals.long,
    missed: sum.missed + item.totals.missed,
    total: sum.total + item.totals.total,
    unserved: sum.unserved + item.totals.unserved,
}), { met: 0, atRisk: 0, tight: 0, long: 0, missed: 0, total: 0, unserved: 0 });

/** Renumbers priorities to match list order (index 0 = priority 1). */
export const withRankPriorities = (connections: RouteConnection[]): RouteConnection[] => (
    connections.map((connection, index) => (
        connection.priority === index + 1 ? connection : { ...connection, priority: index + 1 }
    ))
);

/** Connections sorted by priority (stable for ties). */
export const sortByRank = (connections: RouteConnection[]): RouteConnection[] => (
    connections
        .map((connection, index) => ({ connection, index }))
        .sort((a, b) => (a.connection.priority ?? Infinity) - (b.connection.priority ?? Infinity) || a.index - b.index)
        .map(item => item.connection)
);
