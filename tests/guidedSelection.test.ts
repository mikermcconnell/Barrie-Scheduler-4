import { describe, expect, it } from 'vitest';
import {
    buildDayTypeReadiness,
    EMPTY_GUIDED_SELECTION,
    getAvailableHistoryRange,
    guidedSelectionKey,
    setGuidedTimeFrame,
    selectGuidedRoute,
    toggleGuidedDayType,
} from '../components/GuidedSchedule/guidedSelection';
import { buildPresetRange } from '../components/GuidedSchedule/GuidedStep1';

describe('guided Step 1 selection', () => {
    it('starts with nothing selected', () => {
        expect(EMPTY_GUIDED_SELECTION).toEqual({ routeId: null, dayTypes: [], dateRange: null, timeFrameSet: false });
    });

    it('selects Weekday, Saturday and Sunday when a route is picked', () => {
        const picked = selectGuidedRoute(EMPTY_GUIDED_SELECTION, '10');
        expect(picked.routeId).toBe('10');
        expect(picked.dayTypes).toEqual(['Weekday', 'Saturday', 'Sunday']);
    });

    it('re-selects all three day types when switching routes', () => {
        const withoutSunday = toggleGuidedDayType(selectGuidedRoute(EMPTY_GUIDED_SELECTION, '10'), 'Sunday');
        expect(selectGuidedRoute(withoutSunday, '8A').dayTypes).toEqual(['Weekday', 'Saturday', 'Sunday']);
    });

    it('toggles day types and keeps them in Weekday, Saturday, Sunday order', () => {
        const picked = selectGuidedRoute(EMPTY_GUIDED_SELECTION, '10');
        const noSaturday = toggleGuidedDayType(picked, 'Saturday');
        expect(noSaturday.dayTypes).toEqual(['Weekday', 'Sunday']);
        expect(toggleGuidedDayType(noSaturday, 'Saturday').dayTypes).toEqual(['Weekday', 'Saturday', 'Sunday']);
    });

    it('treats a changed route, day type or date range as a new selection', () => {
        const base = selectGuidedRoute(EMPTY_GUIDED_SELECTION, '10');
        const key = guidedSelectionKey(base);
        expect(guidedSelectionKey(selectGuidedRoute(base, '10'))).toBe(key);
        expect(guidedSelectionKey(toggleGuidedDayType(base, 'Sunday'))).not.toBe(key);
        expect(guidedSelectionKey({ ...base, dateRange: { start: '2026-09-01', end: '2026-09-30' } })).not.toBe(key);
        expect(guidedSelectionKey(selectGuidedRoute(base, '11'))).not.toBe(key);
    });

    it('records the chosen time frame, with null meaning all data', () => {
        const picked = selectGuidedRoute(EMPTY_GUIDED_SELECTION, '10');
        expect(picked.timeFrameSet).toBe(false);
        expect(setGuidedTimeFrame(picked, null)).toMatchObject({ timeFrameSet: true, dateRange: null });
        const week = setGuidedTimeFrame(picked, { start: '2026-10-04', end: '2026-10-10' });
        expect(week).toMatchObject({ timeFrameSet: true, dateRange: { start: '2026-10-04', end: '2026-10-10' } });
        expect(selectGuidedRoute(week, '8A').dateRange).toEqual({ start: '2026-10-04', end: '2026-10-10' });
    });

    it('limits the available range to clean history using metadata alone', () => {
        expect(getAvailableHistoryRange({ dateRange: { start: '2026-06-01', end: '2026-10-10' }, cleanHistoryStartDate: '2026-08-15' }))
            .toEqual({ start: '2026-08-15', end: '2026-10-10' });
        expect(getAvailableHistoryRange({ dateRange: { start: '2026-06-01', end: '2026-10-10' } }))
            .toEqual({ start: '2026-06-01', end: '2026-10-10' });
        expect(getAvailableHistoryRange(null)).toBeUndefined();
    });

    it('reports no data for every day type before a route is loaded', () => {
        expect(buildDayTypeReadiness(undefined, '10', null).map(entry => entry.status)).toEqual(['no-data', 'no-data', 'no-data']);
    });

    it('builds preset date ranges that end on the latest day and stay inside the history', () => {
        const available = { start: '2026-09-15', end: '2026-10-10' };
        expect(buildPresetRange(available, 7)).toEqual({ start: '2026-10-04', end: '2026-10-10' });
        expect(buildPresetRange(available, 90)).toEqual({ start: '2026-09-15', end: '2026-10-10' });
    });
});
