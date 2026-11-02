import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import {
    alignBlockToPreviousTripHeadway,
    calculateHeadwayRegularizationStats,
    regularizeScheduleHeadways,
} from '../utils/schedule/headwayRegularization';
import { TimeUtils } from '../utils/timeUtils';

const makeTrip = (
    id: string,
    blockId: string,
    direction: 'North' | 'South',
    startTime: number,
    travelTime: number,
    recoveryTime: number,
    stops: [string, string]
): MasterTrip => {
    const arrivalAtEnd = startTime + travelTime;
    const departureAtEnd = arrivalAtEnd + recoveryTime;

    return {
        id,
        blockId,
        direction,
        tripNumber: Number(id.replace(/\D+/g, '')) || 1,
        rowId: 0,
        startTime,
        endTime: departureAtEnd,
        recoveryTime,
        travelTime,
        cycleTime: travelTime + recoveryTime,
        stops: {
            [stops[0]]: TimeUtils.fromMinutes(startTime),
            [stops[1]]: TimeUtils.fromMinutes(departureAtEnd),
        },
        stopMinutes: {
            [stops[0]]: startTime,
            [stops[1]]: departureAtEnd,
        },
        arrivalTimes: {
            [stops[0]]: TimeUtils.fromMinutes(startTime),
            [stops[1]]: TimeUtils.fromMinutes(arrivalAtEnd),
        },
        recoveryTimes: {
            [stops[1]]: recoveryTime,
        },
    } as MasterTrip;
};

const buildRouteTables = (): MasterRouteTable[] => ([
    {
        routeName: '2 (Weekday) (North)',
        stops: ['Park Place', 'Downtown'],
        stopIds: {},
        trips: [
            makeTrip('n1', '2-1', 'North', 360, 20, 10, ['Park Place', 'Downtown']),
            makeTrip('n2', '2-2', 'North', 383, 20, 10, ['Park Place', 'Downtown']),
            makeTrip('n3', '2-1', 'North', 440, 20, 10, ['Park Place', 'Downtown']),
        ],
    },
    {
        routeName: '2 (Weekday) (South)',
        stops: ['Downtown', 'Park Place'],
        stopIds: {},
        trips: [
            makeTrip('s1', '2-1', 'South', 390, 20, 30, ['Downtown', 'Park Place']),
            makeTrip('s2', '2-2', 'South', 413, 20, 10, ['Downtown', 'Park Place']),
            makeTrip('s3', '2-1', 'South', 470, 20, 10, ['Downtown', 'Park Place']),
        ],
    },
]);

describe('regularizeScheduleHeadways', () => {
    it('snaps each direction to the target headway without changing travel times', () => {
        const original = buildRouteTables();

        const result = regularizeScheduleHeadways(original, {
            targetHeadwayMinutes: 30,
            minRecoveryMinutes: 5,
        });

        const [north, south] = result.schedules;
        expect(north.trips.map(trip => trip.startTime)).toEqual([360, 390, 420]);
        expect(south.trips.map(trip => trip.startTime)).toEqual([390, 420, 450]);
        expect(north.trips.map(trip => trip.travelTime)).toEqual([20, 20, 20]);
        expect(south.trips.map(trip => trip.travelTime)).toEqual([20, 20, 20]);

        expect(calculateHeadwayRegularizationStats(result.schedules, 30)).toMatchObject({
            totalHeadways: 4,
            offTargetHeadways: 0,
            worstDeviationMinutes: 0,
        });
        expect(result.summary.before.offTargetHeadways).toBe(4);
        expect(result.summary.after.offTargetHeadways).toBe(0);
    });

    it('rebalances terminal recovery to connect trips within a block', () => {
        const result = regularizeScheduleHeadways(buildRouteTables(), {
            targetHeadwayMinutes: 30,
            minRecoveryMinutes: 5,
        });

        const southTrip = result.schedules[1].trips.find(trip => trip.id === 's1');
        expect(southTrip?.arrivalTimes?.['Park Place']).toBe('6:50 AM');
        expect(southTrip?.stops['Park Place']).toBe('7:00 AM');
        expect(southTrip?.stopMinutes?.['Park Place']).toBe(420);
        expect(southTrip?.recoveryTimes?.['Park Place']).toBe(10);
        expect(southTrip?.endTime).toBe(420);
        expect(southTrip?.cycleTime).toBe(30);
    });

    it('does not mutate the source schedules', () => {
        const original = buildRouteTables();

        regularizeScheduleHeadways(original, {
            targetHeadwayMinutes: 30,
            minRecoveryMinutes: 5,
        });

        expect(original[0].trips.map(trip => trip.startTime)).toEqual([360, 383, 440]);
        expect(original[1].trips.find(trip => trip.id === 's1')?.recoveryTimes?.['Park Place']).toBe(30);
    });

    it('flags overlaps when the target headway is infeasible for the runtime', () => {
        const schedules: MasterRouteTable[] = [
            {
                routeName: '2 (Weekday) (North)',
                stops: ['Park Place', 'Downtown'],
                stopIds: {},
                trips: [
                    makeTrip('n1', '2-1', 'North', 360, 40, 5, ['Park Place', 'Downtown']),
                    makeTrip('n2', '2-1', 'North', 390, 40, 5, ['Park Place', 'Downtown']),
                ],
            },
        ];

        const result = regularizeScheduleHeadways(schedules, {
            targetHeadwayMinutes: 30,
            minRecoveryMinutes: 5,
        });

        expect(result.summary.overlapCount).toBe(1);
        expect(result.schedules[0].trips[0].isOverlap).toBe(true);
        expect(result.schedules[0].trips[1].isOverlap).toBe(true);
    });
});

describe('alignBlockToPreviousTripHeadway', () => {
    const NB_STOPS = ['Park Place', 'Sproule', 'Downtown'];
    const SB_STOPS = ['Downtown', 'Sproule', 'Park Place'];

    // Times are [stop, minute] pairs; the last stop is the trip's end.
    const makeChainTrip = (
        id: string,
        blockId: string,
        direction: 'North' | 'South',
        times: Array<[string, number]>
    ): MasterTrip => ({
        id,
        blockId,
        direction,
        tripNumber: 1,
        rowId: 0,
        startTime: times[0][1],
        endTime: times[times.length - 1][1],
        recoveryTime: 0,
        travelTime: times[times.length - 1][1] - times[0][1],
        cycleTime: times[times.length - 1][1] - times[0][1],
        stops: Object.fromEntries(times.map(([stop, minute]) => [stop, TimeUtils.fromMinutes(minute)])),
        stopMinutes: Object.fromEntries(times),
        arrivalTimes: Object.fromEntries(times.map(([stop, minute]) => [stop, TimeUtils.fromMinutes(minute)])),
        recoveryTimes: {},
    } as MasterTrip);

    // Mirrors the Route 2 case: 2-1 and 2-2 start mid-route at Sproule,
    // 2-3 starts upstream at Park Place 30 min after 2-2 but reaches Sproule 51 min after.
    const buildTables = (): MasterRouteTable[] => ([
        {
            routeName: '2 (Weekday) (North)',
            stops: NB_STOPS,
            stopIds: {},
            trips: [
                makeChainTrip('n1', '2-1', 'North', [['Sproule', 326], ['Downtown', 338]]),
                makeChainTrip('n2', '2-2', 'North', [['Sproule', 356], ['Downtown', 368]]),
                makeChainTrip('n3', '2-3', 'North', [['Park Place', 386], ['Sproule', 407], ['Downtown', 419]]),
            ],
        },
        {
            routeName: '2 (Weekday) (South)',
            stops: SB_STOPS,
            stopIds: {},
            trips: [
                makeChainTrip('s3', '2-3', 'South', [['Downtown', 428], ['Sproule', 443], ['Park Place', 466]]),
            ],
        },
    ]);

    it('moves the whole block so the trip runs the headway after the previous trip at the first shared stop', () => {
        const original = buildTables();
        const result = alignBlockToPreviousTripHeadway(original, 'n3', 30);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.anchorStop).toBe('Sproule');
        expect(result.previousBlockId).toBe('2-2');
        expect(result.shiftMinutes).toBe(-21);
        expect(result.shiftedTripCount).toBe(2);

        const n3 = result.schedules[0].trips.find(trip => trip.id === 'n3')!;
        expect(n3.stopMinutes?.['Park Place']).toBe(365);
        expect(n3.stopMinutes?.Sproule).toBe(386);
        expect(n3.stops.Sproule).toBe(TimeUtils.fromMinutes(386));
        expect(result.schedules[1].trips[0].startTime).toBe(407);
        // Other blocks and the input stay unchanged.
        expect(result.schedules[0].trips.find(trip => trip.id === 'n2')?.startTime).toBe(356);
        expect(original[0].trips.find(trip => trip.id === 'n3')?.startTime).toBe(386);
    });

    it('only shifts tables inside the block scope', () => {
        const result = alignBlockToPreviousTripHeadway(buildTables(), 'n3', 30, table => table.routeName.includes('North'));
        expect(result.ok && result.shiftedTripCount).toBe(1);
    });

    it('reports when no earlier trip shares a stop', () => {
        const result = alignBlockToPreviousTripHeadway(buildTables(), 'n1', 30);
        expect(result).toEqual({ ok: false, message: 'No earlier trip shares a stop with block 2-1.' });
    });
});
