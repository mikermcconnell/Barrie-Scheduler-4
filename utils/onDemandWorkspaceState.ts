import type { Requirement, Shift } from './demandTypes';
import type { OnDemandOptimizationSettingsSnapshot } from './onDemandOptimizationSettings';
import type { OnDemandScheduleValidation } from './onDemandValidation';
import {
  filterShiftsByDay,
  normalizeOnDemandShifts,
  type OnDemandDayType,
} from './onDemandShiftUtils';

export interface OnDemandScheduleSnapshot {
  shiftData?: Shift[];
  schedulesData?: Record<string, Requirement[]>;
  masterScheduleData: Requirement[];
  optimizationSettings?: OnDemandOptimizationSettingsSnapshot;
}

export interface OnDemandResolvedDay {
  selectedDayType: OnDemandDayType;
  requirements: Requirement[];
}

export interface OnDemandResolvedScheduleState {
  allShifts: Shift[];
  shifts: Shift[];
  schedules: Record<string, Requirement[]> | null;
  selectedDayType: OnDemandDayType;
  requirements: Requirement[];
  optimizationSettings: OnDemandOptimizationSettingsSnapshot | null;
}

export interface OnDemandValidationSummary {
  isValid: boolean;
  blockingIssueCount: number;
  coverageViolationCount: number;
  fleetViolationCount: number;
  breakCoverageViolationCount: number;
  shiftRuleViolationCount: number;
  handoffViolationCount: number;
  message: string;
}

export function normalizeRideCoImport(
  shifts: Shift[],
  fallbackDayType: OnDemandDayType,
): Shift[] {
  return normalizeOnDemandShifts(shifts, fallbackDayType);
}

export function resolveOnDemandDay(
  schedules: Record<string, Requirement[]>,
  preferredDayType: OnDemandDayType,
): OnDemandResolvedDay | null {
  const availableDays = Object.keys(schedules) as OnDemandDayType[];
  if (availableDays.length === 0) {
    return null;
  }

  const selectedDayType = availableDays.includes(preferredDayType)
    ? preferredDayType
    : availableDays.includes('Weekday')
      ? 'Weekday'
      : availableDays[0];

  return {
    selectedDayType,
    requirements: schedules[selectedDayType],
  };
}

export function resolveOnDemandScheduleState(
  schedule: OnDemandScheduleSnapshot,
  preferredDayType: OnDemandDayType,
): OnDemandResolvedScheduleState {
  const allShifts = schedule.shiftData
    ? normalizeOnDemandShifts(schedule.shiftData, preferredDayType)
    : [];

  if (schedule.schedulesData) {
    const resolvedDay = resolveOnDemandDay(schedule.schedulesData, preferredDayType);
    if (resolvedDay) {
      return {
        allShifts,
        shifts: filterShiftsByDay(allShifts, resolvedDay.selectedDayType),
        schedules: schedule.schedulesData,
        selectedDayType: resolvedDay.selectedDayType,
        requirements: resolvedDay.requirements,
        optimizationSettings: schedule.optimizationSettings ?? null,
      };
    }
  }

  return {
    allShifts,
    shifts: filterShiftsByDay(allShifts, preferredDayType),
    schedules: schedule.schedulesData ?? null,
    selectedDayType: preferredDayType,
    requirements: schedule.masterScheduleData,
    optimizationSettings: schedule.optimizationSettings ?? null,
  };
}

export function summarizeOnDemandValidation(
  validation: OnDemandScheduleValidation,
): OnDemandValidationSummary {
  const coverageViolationCount = validation.coverageViolations.length;
  const fleetViolationCount = validation.fleetViolations.length;
  const breakCoverageViolationCount = validation.breakCoverageViolations.length;
  const shiftRuleViolationCount = validation.shiftRuleViolations.length;
  const handoffViolationCount = validation.handoffViolations.length;
  const blockingIssueCount = new Set(
    [
      ...validation.coverageViolations.map((issue) => `coverage:${issue.slotIndex}:${issue.timeLabel}`),
      ...validation.fleetViolations.map((issue) => `fleet:${issue.slotIndex}:${issue.timeLabel}`),
      ...validation.breakCoverageViolations.map((issue) => `break:${issue.slotIndex}:${issue.timeLabel}`),
      ...validation.shiftRuleViolations.map((issue) => `shift:${issue.shiftId}:${issue.kind}`),
      ...validation.handoffViolations.map((issue) => `handoff:${issue.shiftId}:${issue.kind}:${issue.linkedShiftId ?? 'none'}`),
    ],
  ).size;

  if (blockingIssueCount === 0) {
    return {
      isValid: true,
      blockingIssueCount,
      coverageViolationCount,
      fleetViolationCount,
      breakCoverageViolationCount,
      shiftRuleViolationCount,
      handoffViolationCount,
      message: 'No coverage gaps, fleet breaches, shift-rule violations, handoff issues, or uncovered break shortfalls.',
    };
  }

  const issueParts: string[] = [];
  if (coverageViolationCount > 0) {
    issueParts.push(`${coverageViolationCount} coverage gap${coverageViolationCount === 1 ? '' : 's'}`);
  }
  if (fleetViolationCount > 0) {
    issueParts.push(`${fleetViolationCount} fleet cap breach${fleetViolationCount === 1 ? '' : 'es'}`);
  }
  if (breakCoverageViolationCount > 0) {
    issueParts.push(`${breakCoverageViolationCount} uncovered break shortfall${breakCoverageViolationCount === 1 ? '' : 's'}`);
  }
  if (shiftRuleViolationCount > 0) {
    issueParts.push(`${shiftRuleViolationCount} shift rule violation${shiftRuleViolationCount === 1 ? '' : 's'}`);
  }
  if (handoffViolationCount > 0) {
    issueParts.push(`${handoffViolationCount} handoff issue${handoffViolationCount === 1 ? '' : 's'}`);
  }

  return {
    isValid: false,
    blockingIssueCount,
    coverageViolationCount,
    fleetViolationCount,
    breakCoverageViolationCount,
    shiftRuleViolationCount,
    handoffViolationCount,
    message: `Resolve ${issueParts.join(', ')} before exporting this schedule.`,
  };
}
