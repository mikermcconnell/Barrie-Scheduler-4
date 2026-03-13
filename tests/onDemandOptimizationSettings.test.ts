import { describe, expect, it } from 'vitest';
import {
  buildShiftCountCapInstruction,
  createDefaultShiftCountCaps,
  getShiftCountCapForDay,
  normalizeShiftCountCaps,
} from '../utils/onDemandOptimizationSettings';

describe('on-demand optimization settings', () => {
  it('normalizes a legacy single shift cap across all day types', () => {
    expect(normalizeShiftCountCaps(14, 1, 40)).toEqual({
      Weekday: 14,
      Saturday: 14,
      Sunday: 14,
    });
  });

  it('resolves a different shift cap for each day type', () => {
    const caps = {
      Weekday: 18,
      Saturday: 12,
      Sunday: 10,
    };

    expect(getShiftCountCapForDay(caps, 'Weekday')).toBe(18);
    expect(getShiftCountCapForDay(caps, 'Saturday')).toBe(12);
    expect(getShiftCountCapForDay(caps, 'Sunday')).toBe(10);
  });

  it('builds day-specific shift cap instructions', () => {
    expect(buildShiftCountCapInstruction(18, 'hard', 'Weekday')).toContain('18 total shifts');
    expect(buildShiftCountCapInstruction(12, 'guide', 'Saturday')).toContain('guide for Saturday');
    expect(buildShiftCountCapInstruction(10, 'hard', 'Sunday')).toContain('10 total shifts for Sunday');
  });

  it('creates default shift caps for all day types', () => {
    expect(createDefaultShiftCountCaps()).toEqual({
      Weekday: 18,
      Saturday: 18,
      Sunday: 18,
    });
  });
});
