import type { Requirement, Shift } from './demandTypes';
import type { OnDemandOptimizationSettingsState } from './onDemandOptimizationSettings';
import type { OnDemandDayType } from './onDemandShiftUtils';

interface WorkspaceSignatureInput {
  draftName: string;
  selectedDayType: OnDemandDayType;
  requirements: Requirement[];
  allShifts: Shift[];
  schedules: Record<string, Requirement[]> | null;
  optimizationSettings: OnDemandOptimizationSettingsState;
}

export interface OnDemandShiftDiffSummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  totalChanges: number;
}

const normalizeRequirement = (requirement: Requirement) => ({
  slotIndex: requirement.slotIndex,
  north: requirement.north,
  south: requirement.south,
  floater: requirement.floater,
  total: requirement.total,
});

const normalizeShift = (shift: Shift) => ({
  id: shift.id,
  driverName: shift.driverName,
  zone: shift.zone,
  startSlot: shift.startSlot,
  endSlot: shift.endSlot,
  breakStartSlot: shift.breakStartSlot,
  breakDurationSlots: shift.breakDurationSlots,
  dayType: shift.dayType ?? 'Weekday',
  isPlaceholder: shift.isPlaceholder ?? false,
  handoffFromShiftId: shift.handoffFromShiftId ?? null,
  handoffToShiftId: shift.handoffToShiftId ?? null,
  handoffFromLocation: shift.handoffFromLocation ?? null,
  handoffToLocation: shift.handoffToLocation ?? null,
});

const normalizeSchedules = (schedules: Record<string, Requirement[]> | null) => {
  if (!schedules) return null;

  return Object.fromEntries(
    Object.entries(schedules)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, dayRequirements]) => [
        day,
        dayRequirements.map(normalizeRequirement),
      ]),
  );
};

const normalizeOptimizationSettings = (settings: OnDemandOptimizationSettingsState) => ({
  ...settings,
  shiftCountCaps: {
    Saturday: settings.shiftCountCaps.Saturday,
    Sunday: settings.shiftCountCaps.Sunday,
    Weekday: settings.shiftCountCaps.Weekday,
  },
});

export function buildOnDemandWorkspaceSignature(input: WorkspaceSignatureInput): string {
  return JSON.stringify({
    draftName: input.draftName,
    selectedDayType: input.selectedDayType,
    requirements: input.requirements.map(normalizeRequirement),
    allShifts: input.allShifts
      .map(normalizeShift)
      .sort((left, right) => left.id.localeCompare(right.id)),
    schedules: normalizeSchedules(input.schedules),
    optimizationSettings: normalizeOptimizationSettings(input.optimizationSettings),
  });
}

export function areOnDemandShiftsEquivalent(left: Shift, right: Shift): boolean {
  return JSON.stringify(normalizeShift(left)) === JSON.stringify(normalizeShift(right));
}

export function summarizeOnDemandShiftDiff(
  currentShifts: Shift[],
  optimizedShifts: Shift[],
): OnDemandShiftDiffSummary {
  const currentById = new Map(currentShifts.map(shift => [shift.id, shift]));
  const optimizedById = new Map(optimizedShifts.map(shift => [shift.id, shift]));

  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  currentShifts.forEach(currentShift => {
    const optimizedShift = optimizedById.get(currentShift.id);
    if (!optimizedShift) {
      removed += 1;
      return;
    }

    if (areOnDemandShiftsEquivalent(currentShift, optimizedShift)) {
      unchanged += 1;
    } else {
      modified += 1;
    }
  });

  const added = optimizedShifts.filter(shift => !currentById.has(shift.id)).length;

  return {
    added,
    removed,
    modified,
    unchanged,
    totalChanges: added + removed + modified,
  };
}
