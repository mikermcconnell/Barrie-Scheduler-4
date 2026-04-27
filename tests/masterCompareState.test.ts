import { describe, expect, it } from 'vitest';
import {
    createMasterCompareScope,
    extractMasterCompareBaseline,
    shouldClearMasterCompare,
} from '../components/NewSchedule/utils/masterCompareState';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const northTable: MasterRouteTable = {
    routeName: '10 (North)',
    stops: ['Terminal'],
    stopIds: {},
    trips: [],
};

const southTable: MasterRouteTable = {
    routeName: '10 (South)',
    stops: ['Terminal'],
    stopIds: {},
    trips: [],
};

const makeTable = (routeName: string): MasterRouteTable => ({
    routeName,
    stops: ['Terminal'],
    stopIds: {},
    trips: [],
});

describe('masterCompareState', () => {
    it('keeps compare active when route identity and session still match', () => {
        const scope = createMasterCompareScope('10-Weekday', 4);

        expect(shouldClearMasterCompare(scope, '10-Weekday', 4)).toBe(false);
    });

    it('clears compare when the configured route identity changes', () => {
        const scope = createMasterCompareScope('10-Weekday', 4);

        expect(shouldClearMasterCompare(scope, '11-Weekday', 4)).toBe(true);
        expect(shouldClearMasterCompare(scope, undefined, 4)).toBe(true);
    });

    it('clears compare when a new Step 4 editor session starts', () => {
        const scope = createMasterCompareScope('10-Weekday', 4);

        expect(shouldClearMasterCompare(scope, '10-Weekday', 5)).toBe(true);
    });

    it('returns a compare baseline when both North and South tables are available', () => {
        expect(extractMasterCompareBaseline({
            content: {
                northTable,
                southTable,
            },
        })).toEqual([northTable, southTable]);
    });

    it('accepts a single usable master table for loop or one-way schedules', () => {
        expect(extractMasterCompareBaseline({
            content: {
                northTable: makeTable('10 (Weekday)'),
            },
        })).toHaveLength(1);
    });

    it('returns null when no master tables are available', () => {
        expect(extractMasterCompareBaseline({ content: {} })).toBeNull();
        expect(extractMasterCompareBaseline(null)).toBeNull();
    });
});
