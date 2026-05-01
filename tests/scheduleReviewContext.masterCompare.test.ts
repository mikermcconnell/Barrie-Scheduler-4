import { describe, expect, it } from 'vitest';
import { buildScheduleReviewSnapshot } from '../utils/ai/scheduleReviewContext';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';

const makeTrip = (
    id: string,
    direction: 'North' | 'South',
    startTime: number,
    overrides: Partial<MasterTrip> = {},
): MasterTrip => ({
    id,
    blockId: '10-1',
    tripNumber: 1,
    rowId: startTime,
    direction,
    startTime,
    endTime: startTime + 30,
    cycleTime: 30,
    travelTime: 30,
    recoveryTime: 0,
    stops: { Terminal: '6:00 AM' },
    arrivalTimes: { Terminal: '6:00 AM' },
    recoveryTimes: {},
    ...overrides,
});

const makeTable = (routeName: string, trips: MasterTrip[]): MasterRouteTable => ({
    routeName,
    stops: ['Terminal'],
    stopIds: { Terminal: 'STOP-1' },
    trips,
});

describe('schedule review compare-to-master context', () => {
    it('uses the matching route baseline even when display names differ', () => {
        const snapshot = buildScheduleReviewSnapshot({
            draftName: 'Draft',
            routeGroupName: '10',
            dayType: 'Weekday',
            routeIdentity: '10-Weekday',
            routeTables: [
                makeTable('10 (Weekday) (North)', [makeTrip('draft-a', 'North', 365)]),
            ],
            masterBaseline: [
                makeTable('10 (North)', [makeTrip('master-a', 'North', 360)]),
                makeTable('11 (North)', [makeTrip('other-route', 'North', 360)]),
            ],
        });

        expect(snapshot.compareToMaster).toEqual(expect.objectContaining({
            matchedCount: 1,
            newCount: 0,
            removedCount: 0,
        }));
    });
});
