import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import { validateMergedRouteBlockContinuity } from '../utils/schedule/mergedRouteContinuity';

const makeTrip = (
    id: string,
    direction: 'North' | 'South',
    startTime: number,
    endTime: number,
    blockId = '2-1',
): MasterTrip => ({
    id,
    blockId,
    direction,
    tripNumber: 1,
    rowId: startTime,
    startTime,
    endTime,
    travelTime: endTime - startTime,
    cycleTime: endTime - startTime,
    recoveryTime: 0,
    recoveryTimes: {},
    stops: { Terminal: '7:00 AM' },
    arrivalTimes: { Terminal: '7:00 AM' },
});

const makeTable = (routeName: string, trips: MasterTrip[]): MasterRouteTable => ({
    routeName,
    stops: ['Terminal'],
    stopIds: {},
    trips,
});

describe('merged route continuity validation', () => {
    it('allows alternating Route 2 A/B trips with a reasonable handoff gap', () => {
        const issues = validateMergedRouteBlockContinuity([
            makeTable('2A Dunlop (Weekday) (North)', [
                makeTrip('n1', 'North', 420, 450),
                makeTrip('n2', 'North', 490, 520),
            ]),
            makeTable('2B Dunlop (Weekday) (South)', [
                makeTrip('s1', 'South', 455, 485),
            ]),
        ]);

        expect(issues).toEqual([]);
    });

    it('flags same-direction trips inside one merged-route block', () => {
        const issues = validateMergedRouteBlockContinuity([
            makeTable('2A Dunlop (Weekday) (North)', [
                makeTrip('n1', 'North', 420, 450),
                makeTrip('n2', 'North', 455, 485),
            ]),
        ]);

        expect(issues[0]?.message).toContain('instead of alternating A/B service');
    });

    it('flags disconnected A/B handoffs before upload', () => {
        const issues = validateMergedRouteBlockContinuity([
            makeTable('2A Dunlop (Weekday) (North)', [
                makeTrip('n1', 'North', 420, 450),
            ]),
            makeTable('2B Dunlop (Weekday) (South)', [
                makeTrip('s1', 'South', 500, 530),
            ]),
        ]);

        expect(issues[0]?.message).toContain('disconnected');
    });

    it('does not apply merged A/B validation to non-merged routes', () => {
        const issues = validateMergedRouteBlockContinuity([
            makeTable('10 (Weekday) (North)', [
                makeTrip('n1', 'North', 420, 450, '10-1'),
                makeTrip('n2', 'North', 455, 485, '10-1'),
            ]),
        ]);

        expect(issues).toEqual([]);
    });
});
