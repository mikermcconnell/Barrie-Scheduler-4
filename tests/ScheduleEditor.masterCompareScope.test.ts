import { describe, expect, it } from 'vitest';
import { tableMatchesActiveCompareScope } from '../components/ScheduleEditor';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const makeTable = (routeName: string): MasterRouteTable => ({
    routeName,
    stops: [],
    stopIds: {},
    trips: [],
});

describe('ScheduleEditor master compare scope matching', () => {
    it('matches generated and master tables by direction when display route names differ', () => {
        expect(tableMatchesActiveCompareScope(
            makeTable('10 (North)'),
            [makeTable('10 (Weekday) (North)')]
        )).toBe(true);

        expect(tableMatchesActiveCompareScope(
            makeTable('400 (Saturday) (South) (To Park Place)'),
            [makeTable('400 (Saturday) (North)')]
        )).toBe(false);
    });

    it('keeps directionless loop or single-table baselines in scope', () => {
        expect(tableMatchesActiveCompareScope(
            makeTable('10 (Weekday)'),
            [makeTable('10 (Weekday) (North)')]
        )).toBe(true);
    });
});
