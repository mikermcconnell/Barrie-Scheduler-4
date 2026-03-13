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
}

export const DEFAULT_SHIFT_COUNT_CAP = 18;

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
