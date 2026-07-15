import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import { formatScheduleEditImpact, summarizeScheduleEditImpact } from '../utils/schedule/scheduleEditImpact';

const trip = (id: string, blockId: string, startTime: number): MasterTrip => ({
    id,
    rowId: 1,
    tripNumber: 1,
    blockId,
    direction: 'North',
    startTime,
    endTime: startTime + 20,
    travelTime: 20,
    recoveryTime: 5,
    cycleTime: 25,
    stops: { A: '6:00 AM', B: '6:20 AM' },
});

const table = (trips: MasterTrip[]): MasterRouteTable => ({
    routeName: '400 (North)',
    stops: ['A', 'B'],
    stopIds: {},
    trips,
});

describe('schedule edit impact', () => {
    it('counts cascaded trip, timepoint, and block changes', () => {
        const before = [table([trip('a', '1', 360), trip('b', '1', 390)])];
        const changedA = { ...trip('a', '1', 360), stops: { A: '6:01 AM', B: '6:21 AM' } };
        const changedB = { ...trip('b', '2', 391), stops: { A: '6:31 AM', B: '6:51 AM' } };

        const impact = summarizeScheduleEditImpact(before, [table([changedA, changedB])]);

        expect(impact).toEqual({
            changedTripCount: 2,
            changedTimepointCount: 4,
            reassignedTripCount: 1,
            blockIds: ['1', '2'],
        });
        expect(formatScheduleEditImpact(impact)).toBe('Updated 2 trips · 4 timepoints · reassigned 1');
    });

    it('counts added and removed trips so structural edits surface an impact notice', () => {
        const before = [table([trip('removed', '1', 360)])];
        const after = [table([trip('added', '2', 390)])];

        expect(summarizeScheduleEditImpact(before, after)).toEqual({
            changedTripCount: 2,
            changedTimepointCount: 4,
            reassignedTripCount: 0,
            blockIds: ['1', '2'],
        });
    });
});
