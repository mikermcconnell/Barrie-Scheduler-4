import { getAvailableRuntimeRoutes, type AvailableRuntimeRoute } from '../../utils/performanceRuntimeComputer';
import type { DailySummary, DayType as PerfDayType } from '../../utils/performanceDataTypes';
import type { GuidedDateRange, GuidedDayType } from './runtimeReview/guidedRuntimeReviewTypes';

export const GUIDED_DAY_TYPES: GuidedDayType[] = ['Weekday', 'Saturday', 'Sunday'];

export interface GuidedSelection {
    routeId: string | null;
    dayTypes: GuidedDayType[];
    dateRange: GuidedDateRange | null;
}

export const EMPTY_GUIDED_SELECTION: GuidedSelection = { routeId: null, dayTypes: [], dateRange: null };

/** Picking a route selects all three day types; the planner can untick any of them. */
export const selectGuidedRoute = (selection: GuidedSelection, routeId: string): GuidedSelection => ({
    ...selection,
    routeId,
    dayTypes: [...GUIDED_DAY_TYPES],
});

export const toggleGuidedDayType = (selection: GuidedSelection, dayType: GuidedDayType): GuidedSelection => {
    const next = selection.dayTypes.includes(dayType)
        ? selection.dayTypes.filter(entry => entry !== dayType)
        : [...selection.dayTypes, dayType];
    return { ...selection, dayTypes: GUIDED_DAY_TYPES.filter(entry => next.includes(entry)) };
};

/** Stable key for "has this exact selection been analyzed?". */
export const guidedSelectionKey = (selection: GuidedSelection): string => JSON.stringify([
    selection.routeId?.trim() ?? null,
    GUIDED_DAY_TYPES.filter(dayType => selection.dayTypes.includes(dayType)),
    selection.dateRange?.start ?? null,
    selection.dateRange?.end ?? null,
]);

export interface DayTypeReadiness {
    dayType: GuidedDayType;
    route: AvailableRuntimeRoute | undefined;
    /** Clean-history days with stop-level runtimes, which Step 2 needs. */
    stopLevelDayCount: number;
    status: 'ready' | 'coarse-only' | 'no-data';
}

const matchesRoute = (route: AvailableRuntimeRoute, routeId: string): boolean => {
    const id = routeId.trim().toUpperCase();
    return route.routeId.toUpperCase() === id || route.memberRouteIds.some(member => member.toUpperCase() === id);
};

export const buildDayTypeReadiness = (
    dailySummaries: DailySummary[] | undefined,
    routeId: string | null,
    dateRange: GuidedDateRange | null
): DayTypeReadiness[] => GUIDED_DAY_TYPES.map(dayType => {
    const route = dailySummaries && routeId
        ? getAvailableRuntimeRoutes(dailySummaries, dayType.toLowerCase() as PerfDayType, dateRange ?? undefined)
            .find(entry => matchesRoute(entry, routeId))
        : undefined;
    const stopLevelDayCount = route?.stopLevelDayCount ?? 0;
    return {
        dayType,
        route,
        stopLevelDayCount,
        status: !route ? 'no-data' : stopLevelDayCount === 0 ? 'coarse-only' : 'ready',
    };
});
