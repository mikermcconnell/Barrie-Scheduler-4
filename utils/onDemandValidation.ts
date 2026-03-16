import { calculateSchedule } from './dataGenerator';
import type { Requirement, Shift } from './demandTypes';
import {
  validateOnDemandShiftRules,
  type OnDemandShiftRuleViolation,
} from './onDemandShiftRules';

export interface OnDemandValidationIssue {
  slotIndex: number;
  timeLabel: string;
  requirement: number;
  activeCoverage: number;
  overlappingShifts: number;
  driversOnBreak: number;
  shortfall: number;
}

export interface OnDemandScheduleValidation {
  maxActiveVehicles: number;
  maxOverlappingShifts: number;
  coverageViolations: OnDemandValidationIssue[];
  fleetViolations: OnDemandValidationIssue[];
  breakCoverageViolations: OnDemandValidationIssue[];
  shiftRuleViolations: OnDemandShiftRuleViolation[];
}

export function validateOnDemandSchedule(
  shifts: Shift[],
  requirements: Requirement[],
  maxFleetVehicles = 6,
  requiredBreakDurationSlots?: number,
): OnDemandScheduleValidation {
  const slots = calculateSchedule(shifts, requirements);
  const coverageViolations: OnDemandValidationIssue[] = [];
  const fleetViolations: OnDemandValidationIssue[] = [];
  const breakCoverageViolations: OnDemandValidationIssue[] = [];
  const shiftRuleViolations = validateOnDemandShiftRules(
    shifts,
    requiredBreakDurationSlots,
  );
  let maxActiveVehicles = 0;
  let maxOverlappingShifts = 0;

  slots.forEach((slot, slotIndex) => {
    const overlappingShifts = slot.totalOverlappingShifts;
    const shortfall = Math.max(0, slot.totalRequirement - slot.totalEffectiveCoverage);

    maxActiveVehicles = Math.max(maxActiveVehicles, slot.totalActiveCoverage);
    maxOverlappingShifts = Math.max(maxOverlappingShifts, overlappingShifts);

    const issue: OnDemandValidationIssue = {
      slotIndex,
      timeLabel: slot.timeLabel,
      requirement: slot.totalRequirement,
      activeCoverage: slot.totalActiveCoverage,
      overlappingShifts,
      driversOnBreak: slot.driversOnBreak,
      shortfall,
    };

    if (slot.totalActiveCoverage > maxFleetVehicles) {
      fleetViolations.push(issue);
    }

    if (shortfall > 0) {
      coverageViolations.push(issue);
    }

    if (
      shortfall > 0
      && slot.driversOnBreak > 0
      && overlappingShifts >= slot.totalRequirement
    ) {
      breakCoverageViolations.push(issue);
    }
  });

  return {
    maxActiveVehicles,
    maxOverlappingShifts,
    coverageViolations,
    fleetViolations,
    breakCoverageViolations,
    shiftRuleViolations,
  };
}
