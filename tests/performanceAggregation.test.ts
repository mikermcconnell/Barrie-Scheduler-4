import { describe, expect, it } from 'vitest';
import { getPerformanceAggregation } from '../utils/performanceAggregation';

describe('dashboard aggregation coverage', () => {
    const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
    const days = dates.map(date => ({ date, dayType: 'weekday' as const }));
    const window = { start: '2026-09-14', end: '2026-09-20' };
    it('averages weekdays over five covered dates, not seven calendar days', () => {
        const result = getPerformanceAggregation('average', days, 'weekday', window);
        expect(50000 / result.divisor).toBe(10000);
        expect(result.expectedDays).toBe(5);
        expect(result.label).toBe('Average per weekday · Based on 5 weekdays with data');
        expect(getPerformanceAggregation('sum', days, 'weekday', window).divisor).toBe(1);
    });
    it('discloses missing reports and counts a date once across branches', () => {
        const result = getPerformanceAggregation('average', [...days.slice(1), days[1]], 'weekday', window);
        expect(result.divisor).toBe(4);
        expect(result.label).toContain('4 of 5 weekdays with data');
    });
    it('handles single dates, no data and weekend coverage', () => {
        expect(getPerformanceAggregation('average', [], 'all', window).label).toBe('No data');
        expect(getPerformanceAggregation('average', [], 'all', window).divisor).toBe(1);
        expect(getPerformanceAggregation('average', days.slice(0, 1), 'weekday', { start: dates[0], end: dates[0] }).divisor).toBe(1);
        expect(getPerformanceAggregation('average', [], 'saturday', window).expectedDays).toBe(1);
        expect(getPerformanceAggregation('average', [], 'sunday', window).expectedDays).toBe(1);
    });
});
