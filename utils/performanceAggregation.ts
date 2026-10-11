import type { DailySummary, DayType } from './performanceDataTypes';

export type PerformanceAggregationMode = 'sum' | 'average';
export interface PerformanceAggregation {
    mode: PerformanceAggregationMode;
    divisor: number;
    unit: string;
    coveredDays: number;
    expectedDays: number;
    label: string;
}

/** Missing reports are excluded from the divisor, never imputed as zero. */
export function getPerformanceAggregation(
    mode: PerformanceAggregationMode,
    days: Pick<DailySummary, 'date' | 'dayType'>[],
    dayType: DayType | 'all',
    window: { start: string; end: string } | null,
): PerformanceAggregation {
    const coveredDays = new Set(days.map(day => day.date)).size;
    const unit = dayType === 'all' ? 'day' : dayType === 'weekday' ? 'weekday' : dayType === 'saturday' ? 'Saturday' : 'Sunday';
    let expectedDays = 0;
    if (window) {
        const end = Date.parse(`${window.end}T00:00:00Z`);
        for (let date = Date.parse(`${window.start}T00:00:00Z`); date <= end; date += 86400000) {
            const dow = new Date(date).getUTCDay();
            if (dayType === 'all' || (dayType === 'weekday' && dow >= 1 && dow <= 5)
                || (dayType === 'saturday' && dow === 6) || (dayType === 'sunday' && dow === 0)) expectedDays++;
        }
    }
    const coverage = `${coveredDays}${expectedDays > coveredDays ? ` of ${expectedDays}` : ''} ${unit}${expectedDays === 1 && coveredDays === 1 ? '' : 's'} with data`;
    return {
        mode, divisor: mode === 'average' ? Math.max(1, coveredDays) : 1,
        unit, coveredDays, expectedDays,
        label: coveredDays === 0 ? 'No data' : `${mode === 'average' ? `Average per ${unit}` : 'Sum'} · Based on ${coverage}`,
    };
}
