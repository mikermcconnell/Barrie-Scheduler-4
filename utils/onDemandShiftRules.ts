import {
  BREAK_DURATION_SLOTS,
  MAX_HOURS_WITHOUT_BREAK,
  MAX_SHIFT_HOURS,
  MIN_SHIFT_HOURS,
  SHIFT_DURATION_SLOTS,
  TIME_SLOTS_PER_DAY,
  hoursToSlots,
  minutesToSlotsCeil,
  slotDurationToHours,
  slotToMinutes,
} from './demandConstants';
import type { Shift } from './demandTypes';
import { Zone } from './demandTypes';

export const MIN_SHIFT_SLOTS = hoursToSlots(MIN_SHIFT_HOURS);
export const MAX_SHIFT_SLOTS = hoursToSlots(MAX_SHIFT_HOURS);
export const MIN_LUNCH_BREAK_SLOTS = minutesToSlotsCeil(15);

export type OnDemandShiftRuleViolationKind =
  | 'shift_out_of_bounds'
  | 'duration_too_short'
  | 'duration_too_long'
  | 'break_too_short'
  | 'break_out_of_bounds'
  | 'max_driving_without_lunch';

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
  durationSlots = DEFAULT_DURATION_SLOTS,
  breakDurationSlots = BREAK_DURATION_SLOTS,
): number {
  const maxDrivingSlots = hoursToSlots(MAX_HOURS_WITHOUT_BREAK);
  const endSlot = startSlot + durationSlots;
  const numericValue = roundFiniteNumber(value, startSlot + Math.min(maxDrivingSlots, Math.floor(durationSlots / 2)));
  const minBreakSlot = Math.max(startSlot, endSlot - breakDurationSlots - maxDrivingSlots);
  const maxBreakSlot = Math.min(endSlot - breakDurationSlots, startSlot + maxDrivingSlots);
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
  const requiresBreak = slotDurationToHours(durationSlots) > MAX_HOURS_WITHOUT_BREAK;
  const breakStartSlot = requiresBreak
    ? normalizeRequiredBreakStartSlot(startSlot, shift.breakStartSlot, durationSlots, requiredBreakDurationSlots)
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
    if (shift.isPlaceholder) {
      return;
    }

    const durationSlots = shift.endSlot - shift.startSlot;
    const durationHours = slotDurationToHours(durationSlots);

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

    if (!shift.isStraightShift && durationHours > MAX_HOURS_WITHOUT_BREAK) {
      if (shift.breakDurationSlots < MIN_LUNCH_BREAK_SLOTS) {
        violations.push({
          shiftId,
          driverName,
          kind: 'break_too_short',
          message: `${driverName} needs a lunch break of at least ${slotToMinutes(MIN_LUNCH_BREAK_SLOTS)} minutes.`,
        });
      }

      const breakEndSlot = shift.breakStartSlot + shift.breakDurationSlots;

      if (
        shift.breakStartSlot < shift.startSlot
        || breakEndSlot > shift.endSlot
      ) {
        violations.push({
          shiftId,
          driverName,
          kind: 'break_out_of_bounds',
          message: `${driverName} has a break outside the shift.`,
        });
      }

      const maxDrivingSlots = hoursToSlots(MAX_HOURS_WITHOUT_BREAK);
      const preLunchDrivingSlots = shift.breakStartSlot - shift.startSlot;
      const postLunchDrivingSlots = shift.endSlot - breakEndSlot;

      if (
        preLunchDrivingSlots > maxDrivingSlots
        || postLunchDrivingSlots > maxDrivingSlots
      ) {
        violations.push({
          shiftId,
          driverName,
          kind: 'max_driving_without_lunch',
          message: `${driverName} has more than ${MAX_HOURS_WITHOUT_BREAK} consecutive driving hours without lunch.`,
        });
      }
    }
  });

  return violations;
}
