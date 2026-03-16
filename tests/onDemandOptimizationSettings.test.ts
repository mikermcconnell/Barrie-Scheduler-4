import { describe, expect, it } from 'vitest';
import {
  breakDurationMinutesToSlots,
  buildShiftCountCapInstruction,
  BREAK_DURATION_MINUTES_LIMITS,
  createDefaultShiftCountCaps,
  DEFAULT_BREAK_DURATION_MINUTES,
  getShiftCountCapForDay,
  normalizeOnDemandOptimizationSettings,
  normalizeBreakDurationMinutes,
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

  it('normalizes break duration to valid 15-minute increments', () => {
    expect(normalizeBreakDurationMinutes(61)).toBe(60);
    expect(normalizeBreakDurationMinutes(7)).toBe(BREAK_DURATION_MINUTES_LIMITS.min);
    expect(normalizeBreakDurationMinutes(120)).toBe(BREAK_DURATION_MINUTES_LIMITS.max);
    expect(normalizeBreakDurationMinutes(undefined)).toBe(DEFAULT_BREAK_DURATION_MINUTES);
  });

  it('converts break duration minutes into schedule slots', () => {
    expect(breakDurationMinutesToSlots(60)).toBe(4);
    expect(breakDurationMinutesToSlots(45)).toBe(3);
  });

  it('normalizes saved optimization settings snapshots', () => {
    const settings = normalizeOnDemandOptimizationSettings(
      {
        maxFleetVehicles: 9,
        shiftCountCaps: {
          Weekday: 12,
          Saturday: 11,
          Sunday: 10,
        },
        targetCoveragePercent: 97,
        breakDurationMinutes: 60,
        shiftCountCapMode: 'guide',
        minorGapTolerance: 'none',
        breakProtection: 'balanced',
        costPriority: 'efficiency',
      },
      {
        maxFleetVehicles: 6,
        shiftCountCaps: createDefaultShiftCountCaps(),
        targetCoveragePercent: 100,
        breakDurationMinutes: 45,
        shiftCountCapMode: 'hard',
        minorGapTolerance: 'rare',
        breakProtection: 'strict',
        costPriority: 'balanced',
      },
      {
        maxFleetVehicles: { min: 1, max: 12 },
        targetCoveragePercent: { min: 90, max: 100 },
        shiftCountCaps: { min: 1, max: 40 },
      },
    );

    expect(settings.maxFleetVehicles).toBe(9);
    expect(settings.shiftCountCaps).toEqual({
      Weekday: 12,
      Saturday: 11,
      Sunday: 10,
    });
    expect(settings.targetCoveragePercent).toBe(97);
    expect(settings.breakDurationMinutes).toBe(60);
    expect(settings.shiftCountCapMode).toBe('guide');
    expect(settings.minorGapTolerance).toBe('none');
    expect(settings.breakProtection).toBe('balanced');
    expect(settings.costPriority).toBe('efficiency');
  });
});
