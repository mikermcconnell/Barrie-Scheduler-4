import React from 'react';
import type { DailySummary, DayType } from '../../utils/performanceDataTypes';
import { addDaysToISODate, compareDateStrings, toDateSortKey } from '../../utils/performanceDateUtils';

export type TimeRange = 'all' | 'yesterday' | 'past-week' | 'past-month' | 'past-three-months' | 'single-day';

export interface PerformanceDateWindow {
    start: string;
    end: string;
}

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
    all: 'All Data',
    'past-three-months': 'Past 3 Months',
    'past-month': 'Past Month',
    'past-week': 'Past Week',
    yesterday: 'Prior Day',
    'single-day': 'Single Day',
};

const DAY_TYPE_LABELS: Record<DayType, string> = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' };

interface PerformanceFilterBarProps {
    timeRange: TimeRange;
    onTimeRangeChange: (tr: TimeRange) => void;
    selectedDate: string | null;
    onSelectedDateChange: (d: string | null) => void;
    availableDates: string[];
    dayTypeFilter: DayType | 'all';
    onDayTypeChange: (dt: DayType | 'all') => void;
    availableDayTypes: DayType[];
    filteredDayCount?: number;
    allowedTimeRanges?: TimeRange[];
}

export const PerformanceFilterBar: React.FC<PerformanceFilterBarProps> = ({
    timeRange, onTimeRangeChange, selectedDate, onSelectedDateChange, availableDates,
    dayTypeFilter, onDayTypeChange, availableDayTypes, filteredDayCount,
    allowedTimeRanges,
}) => (
    <div className="flex items-center gap-6 flex-wrap px-1 py-3">
        <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Time Range:</span>
            <div className="flex gap-1">
                {(allowedTimeRanges ?? (Object.keys(TIME_RANGE_LABELS) as TimeRange[])).map(tr => (
                    <FilterPill key={tr} active={timeRange === tr} onClick={() => onTimeRangeChange(tr)}>
                        {TIME_RANGE_LABELS[tr]}
                    </FilterPill>
                ))}
            </div>
            {timeRange === 'single-day' && availableDates.length > 0 && (
                <select
                    value={selectedDate ?? ''}
                    onChange={e => onSelectedDateChange(e.target.value || null)}
                    className="ml-1 text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                    <option value="">Select date…</option>
                    {[...availableDates].sort((a, b) => b.localeCompare(a)).map(d => (
                        <option key={d} value={d}>{d}</option>
                    ))}
                </select>
            )}
        </div>
        <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Day Type:</span>
            <div className="flex gap-1">
                <FilterPill active={dayTypeFilter === 'all'} onClick={() => onDayTypeChange('all')}>All</FilterPill>
                {availableDayTypes.map(dt => (
                    <FilterPill key={dt} active={dayTypeFilter === dt} onClick={() => onDayTypeChange(dt)}>
                        {DAY_TYPE_LABELS[dt]}
                    </FilterPill>
                ))}
            </div>
            {dayTypeFilter !== 'all' && filteredDayCount !== undefined && (
                <span className="text-xs text-gray-500">
                    {filteredDayCount} {DAY_TYPE_LABELS[dayTypeFilter as DayType].toLowerCase()}{filteredDayCount !== 1 ? 's' : ''}
                </span>
            )}
        </div>
    </div>
);

export const FilterPill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
            active ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        }`}
    >
        {children}
    </button>
);

export function getPerformanceDateWindow(
    summaries: DailySummary[],
    timeRange: TimeRange,
    selectedDate?: string | null,
): PerformanceDateWindow | null {
    const dates = [...new Set(summaries.map(summary => summary.date))].sort(compareDateStrings);
    const latestDate = dates.at(-1);
    if (!latestDate) return null;

    if (timeRange === 'all') return { start: dates[0], end: latestDate };
    if (timeRange === 'single-day') {
        const date = selectedDate ?? latestDate;
        return { start: date, end: date };
    }
    if (timeRange === 'yesterday') {
        const priorDate = dates.at(-2);
        return priorDate ? { start: priorDate, end: priorDate } : null;
    }

    const daysBack = timeRange === 'past-week'
        ? 6
        : timeRange === 'past-month'
            ? 29
            : 89;
    return {
        start: addDaysToISODate(latestDate, -daysBack) ?? latestDate,
        end: latestDate,
    };
}

export function filterDailySummaries(
    summaries: DailySummary[],
    timeRange: TimeRange,
    dayType: DayType | 'all',
    selectedDate?: string | null,
): DailySummary[] {
    const window = getPerformanceDateWindow(summaries, timeRange, selectedDate);
    if (!window) return [];
    const startKey = toDateSortKey(window.start);
    const endKey = toDateSortKey(window.end);
    let result = summaries.filter(day => {
        const dayKey = toDateSortKey(day.date);
        return Number.isFinite(dayKey) && dayKey >= startKey && dayKey <= endKey;
    });

    if (dayType !== 'all') {
        result = result.filter(d => d.dayType === dayType);
    }

    return result;
}
