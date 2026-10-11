import type { DayType } from './performanceDataTypes';

export type PerformanceDayTypeFilter = DayType | 'all';

const DAY_TYPE_NOUNS: Record<DayType, string> = {
    weekday: 'weekday',
    saturday: 'Saturday',
    sunday: 'Sunday',
};

export function selectedDayScopeLabel(dayCount: number, dayType: PerformanceDayTypeFilter): string {
    if (dayCount === 0) return 'No data';
    if (dayType === 'all') return `${dayCount} day${dayCount === 1 ? '' : 's'} selected`;

    const noun = DAY_TYPE_NOUNS[dayType];
    return `${dayCount} ${noun}${dayCount === 1 ? '' : 's'} selected`;
}

export function averagePerDayLabel(dayType: PerformanceDayTypeFilter, compact = false): string {
    const noun = dayType === 'all' ? 'included day' : DAY_TYPE_NOUNS[dayType];
    if (!compact) return `Average per ${noun}`;

    const compactNoun = dayType === 'all'
        ? 'Selected Day'
        : noun.charAt(0).toUpperCase() + noun.slice(1);
    return `Avg / ${compactNoun}`;
}

export function formatPerDayAverage(total: number, dayCount: number): string {
    if (dayCount <= 0) return '0';
    return (total / dayCount).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    });
}
