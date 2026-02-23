import { describe, it, expect } from 'vitest';
import { addDaysToISODate, getISOWeekStartMonday } from '../utils/performanceDateUtils';

describe('performanceDateUtils weekly helpers', () => {
  it('computes Monday week start using UTC-safe calendar math', () => {
    expect(getISOWeekStartMonday('2026-01-04')).toBe('2025-12-29'); // Sunday
    expect(getISOWeekStartMonday('2026-01-05')).toBe('2026-01-05'); // Monday
  });

  it('adds days to ISO date without timezone drift', () => {
    expect(addDaysToISODate('2026-01-05', 6)).toBe('2026-01-11');
    expect(addDaysToISODate('2026-03-01', -1)).toBe('2026-02-28');
  });
});
