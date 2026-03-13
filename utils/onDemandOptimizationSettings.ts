import type { OnDemandDayType } from './onDemandShiftUtils';

export type ShiftCountCapMode = 'hard' | 'guide';

export interface DayTypeShiftCountCaps {
  Weekday: number;
  Saturday: number;
  Sunday: number;
}

export interface OptimizeRequestOptions {
  dayType?: OnDemandDayType;
  maxShiftCount?: number;
  shiftCountCapMode?: ShiftCountCapMode;
  breakDurationMinutes?: number;
}

export const DEFAULT_SHIFT_COUNT_CAP = 18;
export const DEFAULT_BREAK_DURATION_MINUTES = 45;
export const BREAK_DURATION_MINUTES_LIMITS = {
  min: 15,
  max: 90,
  step: 15,
} as const;

const clampBreakDurationMinutes = (value: number): number =>
  Math.min(
    BREAK_DURATION_MINUTES_LIMITS.max,
    Math.max(BREAK_DURATION_MINUTES_LIMITS.min, value),
  );

export const normalizeBreakDurationMinutes = (
  value: unknown,
  fallback = DEFAULT_BREAK_DURATION_MINUTES,
): number => {
  const normalizedFallback = clampBreakDurationMinutes(
    Number.isFinite(fallback) ? fallback : DEFAULT_BREAK_DURATION_MINUTES,
  );
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return normalizedFallback;
  }

  const snappedValue = Math.round(
    numericValue / BREAK_DURATION_MINUTES_LIMITS.step,
  ) * BREAK_DURATION_MINUTES_LIMITS.step;

  return clampBreakDurationMinutes(snappedValue);
};

export const breakDurationMinutesToSlots = (minutes: number): number =>
  Math.round(
    normalizeBreakDurationMinutes(minutes, DEFAULT_BREAK_DURATION_MINUTES) / 15,
  );

export const createDefaultShiftCountCaps = (
  fallback = DEFAULT_SHIFT_COUNT_CAP,
): DayTypeShiftCountCaps => ({
  Weekday: fallback,
  Saturday: fallback,
  Sunday: fallback,
});

export const normalizeShiftCountCaps = (
  value: unknown,
  min: number,
  max: number,
  fallback = DEFAULT_SHIFT_COUNT_CAP,
): DayTypeShiftCountCaps => {
  const defaults = createDefaultShiftCountCaps(
    Math.min(max, Math.max(min, fallback)),
  );

  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.min(max, Math.max(min, value));
    return createDefaultShiftCountCaps(normalized);
  }

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const caps = { ...defaults };

  (Object.keys(defaults) as OnDemandDayType[]).forEach((dayType) => {
    const rawValue = (value as Partial<Record<OnDemandDayType, unknown>>)[dayType];
    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue)) {
      caps[dayType] = Math.min(max, Math.max(min, numericValue));
    }
  });

  return caps;
};

export const getShiftCountCapForDay = (
  caps: DayTypeShiftCountCaps,
  dayType: OnDemandDayType,
): number => caps[dayType] ?? caps.Weekday;

export const buildShiftCountCapInstruction = (
  maxShiftCount: number | undefined,
  shiftCountCapMode: ShiftCountCapMode | undefined,
  dayType?: OnDemandDayType,
): string | null => {
  if (!maxShiftCount) {
    return null;
  }

  const dayContext = dayType ? ` for ${dayType}` : '';
  if (shiftCountCapMode === 'guide') {
    return `Treat ${maxShiftCount} total shifts as a guide${dayContext} and only go over that if coverage or break relief clearly requires it.`;
  }

  return `Do not produce more than ${maxShiftCount} total shifts${dayContext}.`;
};
