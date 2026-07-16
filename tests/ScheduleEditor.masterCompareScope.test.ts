import { describe, expect, it } from 'vitest';
import { resolveActiveScheduleDay, tableMatchesActiveCompareScope } from '../components/ScheduleEditor';
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

    it('does not pull same-direction baseline tables from other routes into the active route compare', () => {
        expect(tableMatchesActiveCompareScope(
            makeTable('7 (Weekday) (North)'),
            [makeTable('2 (Weekday) (North)'), makeTable('2 (Weekday) (South)')]
        )).toBe(false);
    });

    it('does not pull a baseline from another service day into the active comparison', () => {
        expect(tableMatchesActiveCompareScope(
            makeTable('10 (Saturday) (North)'),
            [makeTable('10 (Weekday) (North)')]
        )).toBe(false);

        // Older baselines without a day suffix remain compatible with a day-scoped draft.
        expect(tableMatchesActiveCompareScope(
            makeTable('10 (North)'),
            [makeTable('10 (Weekday) (North)')]
        )).toBe(true);
    });

    it('resolves stale day state to the day whose route tables are actually rendered', () => {
        expect(resolveActiveScheduleDay({ Saturday: {} }, 'Weekday')).toBe('Saturday');
        expect(resolveActiveScheduleDay({ Weekday: {}, Saturday: {} }, 'Weekday')).toBe('Weekday');
    });

    it('keeps directionless loop or single-table baselines in scope', () => {
        expect(tableMatchesActiveCompareScope(
            makeTable('10 (Weekday)'),
            [makeTable('10 (Weekday) (North)')]
        )).toBe(true);

        expect(tableMatchesActiveCompareScope(
            makeTable('11 (Weekday)'),
            [makeTable('10 (Weekday) (North)')]
        )).toBe(false);
    });
});
