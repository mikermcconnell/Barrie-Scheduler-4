import {
  BREAK_DURATION_SLOTS,
  BREAK_THRESHOLD_HOURS,
  MAX_SHIFT_HOURS,
  MIN_SHIFT_HOURS,
  SHIFT_DURATION_SLOTS,
  TIME_SLOTS_PER_DAY,
} from './demandConstants';
import type { Shift } from './demandTypes';
import { Zone } from './demandTypes';

export const MIN_SHIFT_SLOTS = MIN_SHIFT_HOURS * 4;
export const MAX_SHIFT_SLOTS = MAX_SHIFT_HOURS * 4;

export type OnDemandShiftRuleViolationKind =
  | 'shift_out_of_bounds'
  | 'duration_too_short'
  | 'duration_too_long'
  | 'break_too_short'
  | 'break_window';

export interface OnDemandShiftRuleViolation {
  shiftId: string;
  driverName: string;
  kind: OnDemandShiftRuleViolationKind;
  message: string;
}

const DEFAULT_DURATION_SLOTS = SHIFT_DURATION_SLOTS;

function roundFiniteNumber(value: unknown, fallback: number): number {
  const numericValue = Math.round(Number(value));
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

export function normalizeShiftDurationSlots(value: unknown): number {
  const numericValue = roundFiniteNumber(value, DEFAULT_DURATION_SLOTS);
  return Math.min(MAX_SHIFT_SLOTS, Math.max(MIN_SHIFT_SLOTS, numericValue));
}

export function normalizeShiftStartSlot(
  value: unknown,
  durationSlots: number,
): number {
  const numericValue = roundFiniteNumber(value, 0);
  return Math.min(
    Math.max(0, numericValue),
    TIME_SLOTS_PER_DAY - durationSlots,
  );
}

export function normalizeShiftZone(value: unknown): Zone {
  return value === Zone.NORTH || value === Zone.SOUTH || value === Zone.FLOATER
    ? value
    : Zone.FLOATER;
}

export function normalizeRequiredBreakStartSlot(
  startSlot: number,
  value: unknown,
): number {
  const numericValue = roundFiniteNumber(value, startSlot + 20);
  const minBreakSlot = startSlot + 16;
  const maxBreakSlot = startSlot + 24;
  return Math.min(Math.max(numericValue, minBreakSlot), maxBreakSlot);
}

export interface SanitizedOnDemandShift {
  startSlot: number;
  endSlot: number;
  durationSlots: number;
  breakStartSlot: number;
  breakDurationSlots: number;
  zone: Zone;
}

export function sanitizeOptimizerShift(
  shift: Partial<Shift> & { durationSlots?: unknown },
  requiredBreakDurationSlots = BREAK_DURATION_SLOTS,
): SanitizedOnDemandShift {
  const durationSlots = normalizeShiftDurationSlots(shift.durationSlots);
  const startSlot = normalizeShiftStartSlot(shift.startSlot, durationSlots);
  const requiresBreak = durationSlots / 4 > BREAK_THRESHOLD_HOURS;
  const breakStartSlot = requiresBreak
    ? normalizeRequiredBreakStartSlot(startSlot, shift.breakStartSlot)
    : 0;
  const breakDurationSlots = requiresBreak ? requiredBreakDurationSlots : 0;

  return {
    startSlot,
    endSlot: startSlot + durationSlots,
    durationSlots,
    breakStartSlot,
    breakDurationSlots,
    zone: normalizeShiftZone(shift.zone),
  };
}

export function validateOnDemandShiftRules(
  shifts: Shift[],
  requiredBreakDurationSlots = BREAK_DURATION_SLOTS,
): OnDemandShiftRuleViolation[] {
  const violations: OnDemandShiftRuleViolation[] = [];

  shifts.forEach((shift, index) => {
    const shiftId = shift.id || `shift-${index + 1}`;
    const driverName = shift.driverName || `Driver ${index + 1}`;
    const durationSlots = shift.endSlot - shift.startSlot;
    const durationHours = durationSlots / 4;

    if (
      shift.startSlot < 0
      || shift.endSlot > TIME_SLOTS_PER_DAY
      || shift.endSlot <= shift.startSlot
    ) {
      violations.push({
        shiftId,
        driverName,
        kind: 'shift_out_of_bounds',
        message: `${driverName} falls outside the 00:00-24:00 planning window.`,
      });
    }

    if (durationSlots < MIN_SHIFT_SLOTS) {
      violations.push({
        shiftId,
        driverName,
        kind: 'duration_too_short',
        message: `${driverName} is shorter than ${MIN_SHIFT_HOURS} hours.`,
      });
    }

    if (durationSlots > MAX_SHIFT_SLOTS) {
      violations.push({
        shiftId,
        driverName,
        kind: 'duration_too_long',
        message: `${driverName} exceeds the ${MAX_SHIFT_HOURS}-hour maximum.`,
      });
    }

    if (durationHours > BREAK_THRESHOLD_HOURS) {
      if (shift.breakDurationSlots < requiredBreakDurationSlots) {
        violations.push({
          shiftId,
          driverName,
          kind: 'break_too_short',
          message: `${driverName} needs a ${requiredBreakDurationSlots * 15}-minute break.`,
        });
      }

      const minBreakSlot = shift.startSlot + 16;
      const maxBreakSlot = shift.startSlot + 24;
      const breakEndSlot = shift.breakStartSlot + shift.breakDurationSlots;

      if (
        shift.breakStartSlot < minBreakSlot
        || shift.breakStartSlot > maxBreakSlot
        || shift.breakStartSlot < shift.startSlot
        || breakEndSlot > shift.endSlot
      ) {
        violations.push({
          shiftId,
          driverName,
          kind: 'break_window',
          message: `${driverName} has a break outside the 4th-6th hour window.`,
        });
      }
    }
  });

  return violations;
}
