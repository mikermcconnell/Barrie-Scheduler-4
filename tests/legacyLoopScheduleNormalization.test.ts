import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import { normalizeLegacyLoopScheduleTable } from '../utils/schedule/legacyLoopScheduleNormalization';

const legacyTrip: MasterTrip = {
    id: '100-T-1',
    blockId: '100-1',
    direction: 'North',
    tripNumber: 1,
    rowId: 1,
    startTime: 460,
    endTime: 509,
    recoveryTime: 6,
    travelTime: 43,
    cycleTime: 49,
    stops: {
        Downtown: '7:40 AM',
        'Georgian Mall': '7:50 AM',
        'Georgian Mall (3)': '7:55 AM',
        'Downtown (2)': '8:24 AM',
        'Downtown (4)': '8:29 AM',
    },
    recoveryTimes: { 'Georgian Mall': 1, 'Downtown (2)': 5 },
};

const legacyTable: MasterRouteTable = {
    routeName: '100 (Saturday)',
    stops: ['Downtown', 'Georgian Mall', 'Georgian Mall (3)', 'Downtown (2)', 'Downtown (4)'],
    stopIds: {
        Downtown: '2',
        'Georgian Mall': '441',
        'Georgian Mall (3)': '441',
        'Downtown (2)': '2',
        'Downtown (4)': '2',
    },
    trips: [legacyTrip],
};

describe('normalizeLegacyLoopScheduleTable', () => {
    it('collapses duplicate recovery columns into canonical arrival and departure values', () => {
        const normalized = normalizeLegacyLoopScheduleTable('100', legacyTable);

        expect(normalized.stops).toEqual(['Downtown', 'Georgian Mall', 'Downtown (2)']);
        expect(normalized.stopIds).toEqual({ Downtown: '2', 'Georgian Mall': '441', 'Downtown (2)': '2' });
        expect(normalized.trips[0]).toMatchObject({
            stops: {
                Downtown: '7:40 AM',
                'Georgian Mall': '7:55 AM',
                'Downtown (2)': '8:29 AM',
            },
            arrivalTimes: {
                'Georgian Mall': '7:50 AM',
                'Downtown (2)': '8:24 AM',
            },
            recoveryTimes: { 'Georgian Mall': 1, 'Downtown (2)': 5 },
            endTimeIncludesRecovery: true,
        });
        expect(normalized.trips[0].stops).not.toHaveProperty('Georgian Mall (3)');
        expect(legacyTable.stops).toHaveLength(5);
        expect(legacyTrip.arrivalTimes).toBeUndefined();
    });

    it('leaves bidirectional schedules unchanged', () => {
        expect(normalizeLegacyLoopScheduleTable('400', legacyTable)).toBe(legacyTable);
    });
});
