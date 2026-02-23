import { describe, expect, it } from 'vitest';
import {
  getPerformanceScopeLabel,
  resolveFilteredScope,
  resolveOverviewScope,
} from '../utils/performanceDataScope';

describe('performanceDataScope', () => {
  it('maps filtered time range to yesterday vs combined scope', () => {
    expect(resolveFilteredScope('yesterday')).toBe('yesterday');
    expect(resolveFilteredScope('all')).toBe('combined');
    expect(resolveFilteredScope('past-week')).toBe('combined');
    expect(resolveFilteredScope('past-month')).toBe('combined');
  });

  it('marks overview latest selected date as yesterday scope', () => {
    expect(resolveOverviewScope('2026-02-19', '2026-02-19')).toBe('yesterday');
    expect(resolveOverviewScope('all', '2026-02-19')).toBe('combined');
    expect(resolveOverviewScope('2026-02-18', '2026-02-19')).toBe('combined');
    expect(resolveOverviewScope('2026-02-19', null)).toBe('combined');
  });

  it('formats scope label text', () => {
    expect(getPerformanceScopeLabel('yesterday')).toBe("Yesterday's Data");
    expect(getPerformanceScopeLabel('combined')).toBe('Combined Days');
  });
});
