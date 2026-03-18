import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import { buildMasterComparison } from '../utils/schedule/masterComparison';

const makeTrip = (
    id: string,
    direction: 'North' | 'South',
    startTime: number
): MasterTrip => ({
    id,
    blockId: direction === 'North' ? 'B1' : 'B2',
    tripNumber: 1,
    rowId: 1,
    direction,
    startTime,
    endTime: startTime + 30,
    cycleTime: 30,
    travelTime: 30,
    recoveryTime: 0,
    stops: { Terminal: '6:00 AM' },
    arrivalTimes: { Terminal: '6:00 AM' },
    recoveryTimes: {}
});

const makeTable = (
    routeName: string,
    trips: MasterTrip[]
): MasterRouteTable => ({
    routeName,
    stops: ['Terminal'],
    stopIds: {},
    trips
});

describe('buildMasterComparison', () => {
    it('prefers exact same-direction trip IDs even when times drift outside fallback threshold', () => {
        const current = [
            makeTable('10 (North)', [makeTrip('1001', 'North', 380)]),
            makeTable('10 (South)', [makeTrip('2001', 'South', 420)])
        ];
        const master = [
            makeTable('10 (North)', [makeTrip('1001', 'North', 360)]),
            makeTable('10 (South)', [makeTrip('2001', 'South', 400)])
        ];

        const result = buildMasterComparison(current, master);

        expect(result.masterMatchMap.get('North::1001')?.id).toBe('1001');
        expect(result.masterMatchMap.get('South::2001')?.id).toBe('2001');
        expect(result.unmatchedMasterTrips).toHaveLength(0);
        expect(result.masterShiftByDir.North).toBeUndefined();
        expect(result.masterShiftByDir.South).toBeUndefined();
    });

    it('falls back to shift-aware time matching when trip IDs do not line up', () => {
        const current = [
            makeTable('10 (North)', [
                makeTrip('draft-a', 'North', 365),
                makeTrip('draft-b', 'North', 425)
            ])
        ];
        const master = [
            makeTable('10 (North)', [
                makeTrip('master-a', 'North', 360),
                makeTrip('master-b', 'North', 420)
            ])
        ];

        const result = buildMasterComparison(current, master);

        expect(result.masterMatchMap.get('North::draft-a')?.id).toBe('master-a');
        expect(result.masterMatchMap.get('North::draft-b')?.id).toBe('master-b');
        expect(result.masterShiftByDir.North).toBe(5);
        expect(result.unmatchedMasterTrips).toHaveLength(0);
    });

    it('keeps north and south trip IDs isolated during exact matching', () => {
        const current = [
            makeTable('10 (North)', [makeTrip('shared-trip', 'North', 360)]),
            makeTable('10 (South)', [makeTrip('shared-trip', 'South', 480)])
        ];
        const master = [
            makeTable('10 (North)', [makeTrip('shared-trip', 'North', 300)]),
            makeTable('10 (South)', [makeTrip('shared-trip', 'South', 540)])
        ];

        const result = buildMasterComparison(current, master);

        expect(result.masterMatchMap.get('North::shared-trip')?.startTime).toBe(300);
        expect(result.masterMatchMap.get('South::shared-trip')?.startTime).toBe(540);
        expect(result.unmatchedMasterTrips).toHaveLength(0);
    });
});
