import { describe, expect, it } from 'vitest';
import {
  averagePerDayLabel,
  formatPerDayAverage,
  selectedDayScopeLabel,
} from '../utils/performanceMetricDisplay';

describe('performance metric display labels', () => {
  it('describes the selected scope without implying every metric is an average', () => {
    expect(selectedDayScopeLabel(5, 'weekday')).toBe('5 weekdays selected');
    expect(selectedDayScopeLabel(1, 'saturday')).toBe('1 Saturday selected');
    expect(selectedDayScopeLabel(7, 'all')).toBe('7 days selected');
    expect(selectedDayScopeLabel(0, 'all')).toBe('No data');
  });

  it('uses the selected service-day type in average labels', () => {
    expect(averagePerDayLabel('weekday')).toBe('Average per weekday');
    expect(averagePerDayLabel('weekday', true)).toBe('Avg / Weekday');
    expect(averagePerDayLabel('all')).toBe('Average per included day');
  });

  it('formats per-day averages without hiding fractional results', () => {
    expect(formatPerDayAverage(52, 5)).toBe('10.4');
    expect(formatPerDayAverage(50, 5)).toBe('10');
    expect(formatPerDayAverage(50, 0)).toBe('0');
  });
});
