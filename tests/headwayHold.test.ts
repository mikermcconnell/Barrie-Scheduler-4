import { describe, expect, it } from 'vitest';
import { buildRoundTripView } from '../utils/parsers/masterScheduleParser';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import {
    estimateRoundTripHeadwayTargets,
    holdRoundTripHeadways,
    orderRoundTripRowsByTime,
    snapToStandardHeadway,
} from '../utils/schedule/headwayHold';
import { getRoundTripDisplayedHeadways, getRoundTripRowKey } from '../utils/schedule/roundTripSortUtils';
import { TimeUtils } from '../utils/timeUtils';

const NB = ['Park Place', 'Downtown'];
const SB = ['Downtown', 'Park Place'];

const makeTrip = (
    id: string,
    blockId: string,
    direction: 'North' | 'South',
    startTime: number,
    travelTime: number,
    recoveryTime: number
): MasterTrip => {
    const [first, last] = direction === 'North' ? NB : SB;
    const arrival = startTime + travelTime;
    const departure = arrival + recoveryTime;
    return {
        id,
        blockId,
        direction,
        tripNumber: 1,
        rowId: 0,
        startTime,
        endTime: departure,
        recoveryTime,
        travelTime,
        cycleTime: travelTime + recoveryTime,
        stops: { [first]: TimeUtils.fromMinutes(startTime), [last]: TimeUtils.fromMinutes(departure) },
        stopMinutes: { [first]: startTime, [last]: departure },
        arrivalTimes: { [first]: TimeUtils.fromMinutes(startTime), [last]: TimeUtils.fromMinutes(arrival) },
        recoveryTimes: { [last]: recoveryTime },
    } as MasterTrip;
};

// Three blocks 30 min apart. Each round trip: 30 min north, 5 min turn,
// south travel by band (30, or 38 after 2 PM), then a fixed 26 min recovery,
// so the headway drifts as soon as the run time changes.
const buildRoute = (lastStart = 18 * 60): MasterRouteTable[] => {
    const north: MasterTrip[] = [];
    const south: MasterTrip[] = [];
    ['2-1', '2-2', '2-3'].forEach((blockId, blockIndex) => {
        let start = 360 + blockIndex * 30;
        let n = 0;
        while (start <= lastStart) {
            const southTravel = start >= 14 * 60 ? 38 : 30;
            north.push(makeTrip(`${blockId}-n${n}`, blockId, 'North', start, 30, 5));
            const southTrip = makeTrip(`${blockId}-s${n}`, blockId, 'South', start + 35, southTravel, 26);
            south.push(southTrip);
            start = southTrip.endTime;
            n += 1;
        }
    });
    return [
        { routeName: '2 (Weekday) (North)', stops: NB, stopIds: {}, trips: north },
        { routeName: '2 (Weekday) (South)', stops: SB, stopIds: {}, trips: south },
    ];
};

const displayedHeadways = (schedules: MasterRouteTable[]) => {
    const combined = buildRoundTripView(schedules[0], schedules[1]);
    const rows = orderRoundTripRowsByTime(combined);
    const headways = getRoundTripDisplayedHeadways(rows, combined);
    return rows.map(row => ({ key: getRoundTripRowKey(row), blockId: row.blockId, headway: headways[getRoundTripRowKey(row)] }));
};

describe('snapToStandardHeadway', () => {
    it.each([[56, 60], [46, 45], [36, 30], [28, 30], [20, 15], [12, 10]])('rounds %i to %i', (input, expected) => {
        expect(snapToStandardHeadway(input)).toBe(expected);
    });
});

describe('estimateRoundTripHeadwayTargets', () => {
    it('rounds each gap and smooths a lone odd value', () => {
        const [north, south] = buildRoute();
        const combined = buildRoundTripView(north, south);
        const estimates = estimateRoundTripHeadwayTargets(combined);
        const values = Object.values(estimates);
        expect(values.length).toBeGreaterThan(10);
        expect(values.every(value => value === 30)).toBe(true);
    });
});

describe('estimate smoothing', () => {
    // Rows of one block-less sequence: start times give the gaps directly.
    const combinedFromGaps = (gaps: number[]) => {
        const starts = gaps.reduce<number[]>((acc, gap) => [...acc, acc[acc.length - 1] + gap], [360]);
        const north = starts.map((start, index) => makeTrip(`b${index}-n`, `2-${index + 1}`, 'North', start, 30, 5));
        return buildRoundTripView(
            { routeName: '2 (Weekday) (North)', stops: NB, stopIds: {}, trips: north },
            { routeName: '2 (Weekday) (South)', stops: SB, stopIds: {}, trips: [] },
        );
    };

    it('smooths a lone odd gap inside a steady run', () => {
        expect(Object.values(estimateRoundTripHeadwayTargets(combinedFromGaps([30, 30, 20, 30, 30])))).toEqual([30, 30, 30, 30, 30]);
    });

    it('keeps an alternating pattern that follows a steady run', () => {
        expect(Object.values(estimateRoundTripHeadwayTargets(combinedFromGaps([30, 30, 30, 59, 35, 59, 35]))))
            .toEqual([30, 30, 30, 60, 30, 60, 30]);
    });

    it('keeps an alternating pattern so 56 shows 60 and 36 shows 30', () => {
        expect(Object.values(estimateRoundTripHeadwayTargets(combinedFromGaps([36, 56, 36, 56, 36])))).toEqual([30, 60, 30, 60, 30]);
    });
});

describe('holdRoundTripHeadways', () => {
    it('sets last recoveries so every row after the pull-outs hits its target', () => {
        const original = buildRoute();
        expect(displayedHeadways(original).some(row => row.headway !== undefined && row.headway !== 30)).toBe(true);

        const result = holdRoundTripHeadways(original);
        const after = displayedHeadways(result.schedules);

        after.slice(1).forEach(row => expect(row.headway).toBe(30));
        expect(result.flags).toEqual([]);
        expect(result.changedRecoveryCount).toBeGreaterThan(0);
    });

    it('changes recoveries only: same trips, same blocks, pull-outs fixed, travel and mid recovery unchanged', () => {
        const original = buildRoute();
        const result = holdRoundTripHeadways(original);
        const before = new Map(original.flatMap(table => table.trips.map(trip => [trip.id, trip] as const)));
        const afterTrips = result.schedules.flatMap(table => table.trips);

        expect(afterTrips).toHaveLength(before.size);
        afterTrips.forEach(trip => {
            const old = before.get(trip.id)!;
            expect(trip.blockId).toBe(old.blockId);
            expect(trip.travelTime).toBe(old.travelTime);
            if (trip.direction === 'North') expect(trip.recoveryTimes?.Downtown).toBe(5);
        });
        ['2-1-n0', '2-2-n0', '2-3-n0'].forEach(id => {
            expect(afterTrips.find(trip => trip.id === id)?.startTime).toBe(before.get(id)?.startTime);
        });
        // The input is not mutated.
        expect(original[1].trips[0].recoveryTimes?.['Park Place']).toBe(26);
    });

    it('uses a typed target instead of the estimate', () => {
        const original = buildRoute();
        const rows = displayedHeadways(original);
        const target = rows[6];
        const result = holdRoundTripHeadways(original, { [target.key]: 45 });
        const after = displayedHeadways(result.schedules);
        expect(after.find(row => row.key === target.key)?.headway).toBe(45);
    });

    it('flags a recovery that would fall below the minimum', () => {
        const original = buildRoute();
        const rows = displayedHeadways(original);
        const target = rows[6];
        const result = holdRoundTripHeadways(original, { [target.key]: 5 });
        const flag = result.flags.find(candidate => candidate.targetRowKey === target.key);
        expect(flag).toMatchObject({ blockId: target.blockId });
        expect(flag!.recoveryMinutes).toBeLessThan(5);
    });
});
