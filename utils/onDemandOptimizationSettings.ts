import type { OnDemandChangeoffSettings } from './demandTypes';
import type { OnDemandDayType } from './onDemandShiftUtils';

export type ShiftCountCapMode = 'hard' | 'guide';
export type MinorGapTolerance = 'none' | 'rare';
export type BreakProtectionMode = 'strict' | 'balanced';
export type CostPriority = 'service' | 'balanced' | 'efficiency';

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
  northChangeoffMinutes?: number;
  southChangeoffMinutes?: number;
}

export interface OnDemandOptimizationSettingsState extends OnDemandChangeoffSettings {
  maxFleetVehicles: number;
  shiftCountCaps: DayTypeShiftCountCaps;
  targetCoveragePercent: number;
  breakDurationMinutes: number;
  shiftCountCapMode: ShiftCountCapMode;
  minorGapTolerance: MinorGapTolerance;
  breakProtection: BreakProtectionMode;
  costPriority: CostPriority;
}

export interface OnDemandOptimizationSettingsSnapshot extends Partial<OnDemandOptimizationSettingsState> {
  maxShiftCount?: number;
}

export const DEFAULT_SHIFT_COUNT_CAP = 18;
export const DEFAULT_BREAK_DURATION_MINUTES = 45;
export const DEFAULT_NORTH_CHANGEOFF_MINUTES = 10;
export const DEFAULT_SOUTH_CHANGEOFF_MINUTES = 8;
export const BREAK_DURATION_MINUTES_LIMITS = {
  min: 15,
  max: 90,
  step: 15,
} as const;
export const CHANGEOFF_MINUTES_LIMITS = {
  min: 0,
  max: 30,
  step: 1,
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

export const normalizeChangeoffMinutes = (
  value: unknown,
  fallback: number,
): number => {
  const normalizedFallback = Math.min(
    CHANGEOFF_MINUTES_LIMITS.max,
    Math.max(CHANGEOFF_MINUTES_LIMITS.min, Math.round(Number(fallback) || 0)),
  );
  const numericValue = Math.round(Number(value));

  if (!Number.isFinite(numericValue)) {
    return normalizedFallback;
  }

  return Math.min(
    CHANGEOFF_MINUTES_LIMITS.max,
    Math.max(CHANGEOFF_MINUTES_LIMITS.min, numericValue),
  );
};

export const changeoffMinutesToSlots = (minutes: number): number =>
  Math.ceil(normalizeChangeoffMinutes(minutes, 0) / 15);

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

export const normalizeOnDemandOptimizationSettings = (
  value: OnDemandOptimizationSettingsSnapshot | null | undefined,
  defaults: OnDemandOptimizationSettingsState,
  limits: {
    maxFleetVehicles: { min: number; max: number };
    targetCoveragePercent: { min: number; max: number };
    shiftCountCaps: { min: number; max: number };
  },
): OnDemandOptimizationSettingsState => {
  const normalized: OnDemandOptimizationSettingsState = {
    ...defaults,
    shiftCountCaps: { ...defaults.shiftCountCaps },
  };

  if (!value || typeof value !== 'object') {
    return normalized;
  }

  const maxFleetVehicles = Number(value.maxFleetVehicles);
  if (Number.isFinite(maxFleetVehicles)) {
    normalized.maxFleetVehicles = Math.min(
      limits.maxFleetVehicles.max,
      Math.max(limits.maxFleetVehicles.min, maxFleetVehicles),
    );
  }

  const targetCoveragePercent = Number(value.targetCoveragePercent);
  if (Number.isFinite(targetCoveragePercent)) {
    normalized.targetCoveragePercent = Math.min(
      limits.targetCoveragePercent.max,
      Math.max(limits.targetCoveragePercent.min, targetCoveragePercent),
    );
  }

  normalized.breakDurationMinutes = normalizeBreakDurationMinutes(
    value.breakDurationMinutes,
    defaults.breakDurationMinutes,
  );
  normalized.northChangeoffMinutes = normalizeChangeoffMinutes(
    value.northChangeoffMinutes,
    defaults.northChangeoffMinutes,
  );
  normalized.southChangeoffMinutes = normalizeChangeoffMinutes(
    value.southChangeoffMinutes,
    defaults.southChangeoffMinutes,
  );

  normalized.shiftCountCaps = normalizeShiftCountCaps(
    value.shiftCountCaps ?? value.maxShiftCount,
    limits.shiftCountCaps.min,
    limits.shiftCountCaps.max,
    defaults.shiftCountCaps.Weekday,
  );

  if (value.shiftCountCapMode === 'hard' || value.shiftCountCapMode === 'guide') {
    normalized.shiftCountCapMode = value.shiftCountCapMode;
  }
  if (value.minorGapTolerance === 'none' || value.minorGapTolerance === 'rare') {
    normalized.minorGapTolerance = value.minorGapTolerance;
  }
  if (value.breakProtection === 'strict' || value.breakProtection === 'balanced') {
    normalized.breakProtection = value.breakProtection;
  }
  if (value.costPriority === 'service' || value.costPriority === 'balanced' || value.costPriority === 'efficiency') {
    normalized.costPriority = value.costPriority;
  }

  return normalized;
};
