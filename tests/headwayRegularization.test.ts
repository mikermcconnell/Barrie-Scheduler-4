import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import {
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
