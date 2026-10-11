import type { PerformanceDataLoadOptions, PerformanceMetadata } from './performanceDataTypes';
import type { PerformanceDateWindow, TimeRange } from '../components/Performance/PerformanceFilterBar';
import { addDaysToISODate } from './performanceDateUtils';

export function resolveDetailDateRange(
    metadata: PerformanceMetadata | null | undefined,
    timeRange: TimeRange,
    selectedDate: string | null,
    customDateRange: PerformanceDateWindow | null,
    includeComparisonPeriod = false,
): PerformanceDataLoadOptions['dateRange'] | undefined {
    const end = metadata?.dateRange?.end;
    if (!end) return undefined;

    if (timeRange === 'all') return undefined;
    if (timeRange === 'year-to-date') {
        const start = `${end.slice(0, 4)}-01-01`;
        if (!includeComparisonPeriod) return { start, end };
        const startMs = Date.parse(`${start}T00:00:00Z`);
        const endMs = Date.parse(`${end}T00:00:00Z`);
        const calendarDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
        return {
            start: addDaysToISODate(start, -calendarDays) || start,
            end,
        };
    }
    if (timeRange === 'custom') {
        if (!customDateRange?.start || !customDateRange.end || customDateRange.start > customDateRange.end) {
            return undefined;
        }
        if (!includeComparisonPeriod) return customDateRange;
        const startMs = Date.parse(`${customDateRange.start}T00:00:00Z`);
        const endMs = Date.parse(`${customDateRange.end}T00:00:00Z`);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return customDateRange;
        const calendarDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
        return {
            start: addDaysToISODate(customDateRange.start, -calendarDays) || customDateRange.start,
            end: customDateRange.end,
        };
    }
    if (timeRange === 'single-day') {
        const date = selectedDate || end;
        return {
            start: includeComparisonPeriod ? (addDaysToISODate(date, -7) || date) : date,
            end: date,
        };
    }
    if (timeRange === 'yesterday') {
        const start = addDaysToISODate(end, includeComparisonPeriod ? -8 : -7) || end;
        return { start, end };
    }

    const currentDaysBack = timeRange === 'past-week'
        ? 6
        : timeRange === 'past-month'
            ? 29
            : 89;
    const daysBack = includeComparisonPeriod
        ? ((currentDaysBack + 1) * 2) - 1
        : currentDaysBack;
    return { start: addDaysToISODate(end, -daysBack) || end, end };
}
