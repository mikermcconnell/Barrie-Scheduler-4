import { describe, expect, it } from 'vitest';
import {
    applyTripShifts,
    buildRankedConnectionModel,
    classifyGap,
    evaluateRankedConnections,
    getConnectionWindow,
    getTargetTimesForDay,
    optimizeRankedConnections,
    sortByRank,
    withRankPriorities,
} from '../utils/connections/rankedConnections';
import type { ConnectionLibrary, ConnectionTarget, RouteConnection } from '../utils/connections/connectionTypes';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import { recalculateTrip } from '../hooks/useScheduleEditing';
import { TimeUtils } from '../utils/timeUtils';

const t = (h: number, m: number) => h * 60 + m;
const fmt = (minutes: number) => TimeUtils.fromMinutes(minutes);

const NORTH_STOPS = ['Park Place', 'Downtown Hub'];
const SOUTH_STOPS = ['Downtown Hub', 'Park Place'];
const STOP_IDS = { 'Park Place': '777', 'Downtown Hub': '1' };

/** One trip: departs the first stop at `start`, arrives the last stop after `run` minutes, then waits `recovery`. */
const makeTrip = (id: string, blockId: string, direction: 'North' | 'South', start: number, run: number, recovery: number, tripNumber: number): MasterTrip => {
    const stops = direction === 'North' ? NORTH_STOPS : SOUTH_STOPS;
    const [first, last] = stops;
    const trip: MasterTrip = {
        id, blockId, direction, tripNumber, rowId: tripNumber,
        startTime: start, endTime: start + run + recovery,
        recoveryTime: recovery, recoveryTimes: { [last]: recovery },
        travelTime: run, cycleTime: run + recovery,
        stops: { [first]: fmt(start), [last]: fmt(start + run + recovery) },
        arrivalTimes: { [last]: fmt(start + run) },
    };
    recalculateTrip(trip, stops);
    return trip;
};

/**
 * Block 2-1 runs N1 → S1 → N2 → S2 → N3.
 * N trips: Park Place → Downtown Hub, 30 min run, 8 min recovery at the Hub.
 * S trips: Downtown Hub → Park Place, 32 min run, 10 min recovery at Park Place.
 *   N1 6:00–6:30 (dep Hub 6:38)   S1 6:38–7:10 (dep PP 7:20)
 *   N2 7:20–7:50 (dep Hub 7:58)   S2 7:58–8:30 (dep PP 8:40)   N3 8:40–9:10
 */
const buildSchedules = (): MasterRouteTable[] => [
    {
        routeName: '2 (Saturday) (North)', stops: NORTH_STOPS, stopIds: STOP_IDS,
        trips: [
            makeTrip('N1', '2-1', 'North', t(6, 0), 30, 8, 1),
            makeTrip('N2', '2-1', 'North', t(7, 20), 30, 8, 3),
            makeTrip('N3', '2-1', 'North', t(8, 40), 30, 8, 5),
        ],
    },
    {
        routeName: '2 (Saturday) (South)', stops: SOUTH_STOPS, stopIds: STOP_IDS,
        trips: [
            makeTrip('S1', '2-1', 'South', t(6, 38), 32, 10, 2),
            makeTrip('S2', '2-1', 'South', t(7, 58), 32, 10, 4),
        ],
    },
];

const target = (id: string, stopCode: string, times: Array<{ time: number; days?: Array<'Weekday' | 'Saturday' | 'Sunday'> }>): ConnectionTarget => ({
    id, name: id, type: 'manual', stopCode,
    times: times.map((entry, index) => ({ id: `${id}-${index}`, time: entry.time, daysActive: entry.days ?? ['Saturday'], enabled: true })),
    createdAt: '', updatedAt: '',
});

const connection = (id: string, targetId: string, stopCode: string, type: RouteConnection['connectionType'], min: number, max: number, extra: Partial<RouteConnection> = {}): RouteConnection => ({
    id, targetId, stopCode, connectionType: type, bufferMinutes: min, maxWaitMinutes: max, priority: 1, enabled: true, ...extra,
});

const library = (...targets: ConnectionTarget[]): ConnectionLibrary => ({ targets, updatedAt: '', updatedBy: '' });

describe('connection windows and statuses', () => {
    it('reads the window from buffer and longest wait, with a default longest wait', () => {
        expect(getConnectionWindow({ bufferMinutes: 3, maxWaitMinutes: 10 })).toEqual({ min: 3, max: 10 });
        expect(getConnectionWindow({ bufferMinutes: 5 })).toEqual({ min: 5, max: 15 });
        expect(getConnectionWindow({ bufferMinutes: 12 })).toEqual({ min: 12, max: 22 });
    });

    it('classifies waits as missed, tight, met, or long', () => {
        const window = { min: 3, max: 10 };
        expect(classifyGap(-1, window)).toBe('missed');
        expect(classifyGap(2, window)).toBe('tight');
        expect(classifyGap(3, window)).toBe('met');
        expect(classifyGap(10, window)).toBe('met');
        expect(classifyGap(11, window)).toBe('long');
    });

    it('keeps only target times that run on the day type', () => {
        const go = target('go', '777', [{ time: 400, days: ['Weekday'] }, { time: 500, days: ['Saturday'] }, { time: 450, days: [] }]);
        expect(getTargetTimesForDay(go, 'Saturday')).toEqual([450, 500]);
        expect(getTargetTimesForDay(go, 'Weekday')).toEqual([400, 450]);
    });
});

describe('pairing and evaluation', () => {
    it('pairs each target event with the trip that serves it and ignores other day types', () => {
        const r12 = target('r12', '777', [{ time: t(7, 15) }, { time: t(8, 31) }, { time: t(7, 15), days: ['Weekday'] }]);
        const model = buildRankedConnectionModel(buildSchedules(), [connection('c1', 'r12', '777', 'meet_departing', 3, 10)], library(r12), 'Saturday');
        const [evaluation] = evaluateRankedConnections(model);
        expect(evaluation.events.map(event => [event.tripId, event.gap, event.status])).toEqual([
            ['S1', 5, 'met'],
            ['S2', 1, 'tight'],
        ]);
        expect(evaluation.totals).toMatchObject({ met: 1, tight: 1, total: 2 });
    });

    it('does not use a trip that starts at the stop for a bus-to-service connection', () => {
        // N1 departs Park Place at 6:00 but nobody arrives on it there.
        const r12 = target('r12', '777', [{ time: t(6, 5) }]);
        const model = buildRankedConnectionModel(buildSchedules(), [connection('c1', 'r12', '777', 'meet_departing', 3, 10)], library(r12), 'Saturday');
        const [evaluation] = evaluateRankedConnections(model);
        expect(evaluation.events).toHaveLength(0);
        expect(evaluation.totals.unserved).toBe(1);
    });

    it('uses departures for a service-to-bus connection and skips trips that end at the stop', () => {
        // Target arrives at the Hub 6:33; S1 leaves the Hub 6:38. N1 ends at the Hub and is not a departure.
        const r7 = target('r7', '1', [{ time: t(6, 33) }]);
        const model = buildRankedConnectionModel(buildSchedules(), [connection('c1', 'r7', '1', 'feed_arriving', 2, 6)], library(r7), 'Saturday');
        const [evaluation] = evaluateRankedConnections(model);
        expect(evaluation.events.map(event => [event.tripId, event.gap, event.status])).toEqual([['S1', 5, 'met']]);
    });

    it('leaves out target events outside the active hours', () => {
        const r12 = target('r12', '777', [{ time: t(7, 15) }, { time: t(8, 31) }]);
        const model = buildRankedConnectionModel(
            buildSchedules(),
            [connection('c1', 'r12', '777', 'meet_departing', 3, 10, { timeFilterStart: t(8, 0), timeFilterEnd: t(9, 0) })],
            library(r12),
            'Saturday'
        );
        expect(evaluateRankedConnections(model)[0].events.map(event => event.targetTime)).toEqual([t(8, 31)]);
    });

    it('flags a met connection as at risk when the lateness model says the bus is often late', () => {
        const r12 = target('r12', '777', [{ time: t(7, 15) }]);
        const model = buildRankedConnectionModel(buildSchedules(), [connection('c1', 'r12', '777', 'meet_departing', 3, 10)], library(r12), 'Saturday');
        const [evaluation] = evaluateRankedConnections(model, {}, { lateness: () => 5 });
        expect(evaluation.events[0]).toMatchObject({ status: 'met', atRisk: true, lateness: 5 });
        expect(evaluation.totals.atRisk).toBe(1);
    });
});

describe('ranked optimizer', () => {
    const r12 = target('r12', '777', [{ time: t(8, 31) }]);   // S2 arrives PP 8:30 → 1 min, needs 3
    const hub = target('hub', '1', [{ time: t(7, 53) }]);     // S2 leaves Hub 7:58 → 5 min wait

    it('fixes a tight connection by moving the trip, within recovery', () => {
        const model = buildRankedConnectionModel(buildSchedules(), [connection('c1', 'r12', '777', 'meet_departing', 3, 10)], library(r12), 'Saturday');
        const result = optimizeRankedConnections(model, { maxShiftMinutes: 4, minRecoveryRatio: 0.1 });
        expect(result.shifts).toEqual({ S2: -2 });
        expect(result.after[0].totals.met).toBe(1);
        expect(result.unfixed).toHaveLength(0);
    });

    it('keeps a higher-ranked connection that is already met and says why', () => {
        const model = buildRankedConnectionModel(
            buildSchedules(),
            [
                connection('hubFirst', 'hub', '1', 'feed_arriving', 4, 6),
                connection('ppSecond', 'r12', '777', 'meet_departing', 3, 10),
            ],
            library(r12, hub),
            'Saturday'
        );
        const result = optimizeRankedConnections(model, { maxShiftMinutes: 4 });
        expect(result.shifts).toEqual({});
        expect(result.unfixed).toEqual([
            expect.objectContaining({
                connectionId: 'ppSecond', rank: 2, tripId: 'S2',
                reason: { kind: 'protected', blockerConnectionId: 'hubFirst', blockerTargetTime: t(7, 53) },
            }),
        ]);
    });

    it('lets the ranking decide the trade-off', () => {
        const model = buildRankedConnectionModel(
            buildSchedules(),
            [
                connection('ppFirst', 'r12', '777', 'meet_departing', 3, 10),
                connection('hubSecond', 'hub', '1', 'feed_arriving', 4, 6),
            ],
            library(r12, hub),
            'Saturday'
        );
        const result = optimizeRankedConnections(model, { maxShiftMinutes: 4 });
        expect(result.shifts).toEqual({ S2: -2 });
        expect(result.after.map(item => item.totals.met)).toEqual([1, 0]);
        expect(result.before.map(item => item.totals.met)).toEqual([0, 1]);
    });

    it('reports a miss that needs more than the move limit', () => {
        const model = buildRankedConnectionModel(buildSchedules(), [connection('c1', 'r12', '777', 'meet_departing', 3, 10)], library(r12), 'Saturday');
        const result = optimizeRankedConnections(model, { maxShiftMinutes: 1 });
        expect(result.unfixed[0].reason).toEqual({ kind: 'limit', neededMinutes: -2 });
    });

    it('does not cut recovery below the minimum', () => {
        // N2's 8 min Hub layover may not shrink: the minimum (30% of 30 = 9) is above it.
        const model = buildRankedConnectionModel(buildSchedules(), [connection('c1', 'r12', '777', 'meet_departing', 3, 10)], library(r12), 'Saturday');
        const result = optimizeRankedConnections(model, { maxShiftMinutes: 4, minRecoveryRatio: 0.3 });
        expect(result.shifts).toEqual({});
        expect(result.unfixed[0].reason).toEqual({ kind: 'recovery', neededMinutes: -2 });
    });

    it('can plan for late buses by treating at-risk connections as missed', () => {
        const ok = target('ok', '777', [{ time: t(8, 34) }]); // 4 min wait, met
        const model = buildRankedConnectionModel(buildSchedules(), [connection('c1', 'ok', '777', 'meet_departing', 3, 10)], library(ok), 'Saturday');
        const lateness = () => 4;
        expect(optimizeRankedConnections(model, { maxShiftMinutes: 4, lateness }).shifts).toEqual({});
        const planned = optimizeRankedConnections(model, { maxShiftMinutes: 4, lateness, planForLateness: true });
        expect(planned.shifts).toEqual({ S2: -1 });
        expect(planned.after[0].totals).toMatchObject({ met: 1, atRisk: 0 });
    });
});

describe('applying trip shifts', () => {
    it('moves the trip and rebalances the end recoveries around it', () => {
        const schedules = buildSchedules();
        const r12 = target('r12', '777', [{ time: t(8, 31) }]);
        const model = buildRankedConnectionModel(schedules, [connection('c1', 'r12', '777', 'meet_departing', 3, 10)], library(r12), 'Saturday');
        const next = applyTripShifts(schedules, model, { S2: -2 });

        const s2 = next[1].trips.find(trip => trip.id === 'S2')!;
        expect(s2.stops['Downtown Hub']).toBe('7:56 AM');
        expect(s2.arrivalTimes?.['Park Place']).toBe('8:28 AM');
        expect(s2.recoveryTimes?.['Park Place']).toBe(12);
        expect(s2.stops['Park Place']).toBe('8:40 AM');   // N3 still leaves at 8:40

        const n2 = next[0].trips.find(trip => trip.id === 'N2')!;
        expect(n2.recoveryTimes?.['Downtown Hub']).toBe(6);
        expect(n2.stops['Downtown Hub']).toBe('7:56 AM');

        const n3 = next[0].trips.find(trip => trip.id === 'N3')!;
        expect(n3.stops['Park Place']).toBe('8:40 AM');
        // The input is not changed.
        expect(schedules[1].trips.find(trip => trip.id === 'S2')!.stops['Downtown Hub']).toBe('7:58 AM');

        const [after] = evaluateRankedConnections(buildRankedConnectionModel(next, model.connections, library(r12), 'Saturday'));
        expect(after.events[0]).toMatchObject({ gap: 3, status: 'met' });
    });
});

describe('rank helpers', () => {
    it('sorts by priority and renumbers to list order', () => {
        const a = connection('a', 't', '1', 'meet_departing', 0, 5, { priority: 2 });
        const b = connection('b', 't', '1', 'meet_departing', 0, 5, { priority: 1 });
        const c = connection('c', 't', '1', 'meet_departing', 0, 5, { priority: 2 });
        expect(sortByRank([a, b, c]).map(item => item.id)).toEqual(['b', 'a', 'c']);
        expect(withRankPriorities([a, b, c]).map(item => item.priority)).toEqual([1, 2, 3]);
    });
});
