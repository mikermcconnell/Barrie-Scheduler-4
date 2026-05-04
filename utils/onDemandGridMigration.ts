import type { Requirement, Shift } from './demandTypes';
import { SLOT_MINUTES, type SlotGranularityMinutes } from './demandConstants';
import type { OnDemandOptimizationSettingsSnapshot } from './onDemandOptimizationSettings';

export interface OnDemandGridSchedulePayload {
  shiftData?: Shift[];
  schedulesData?: Record<string, Requirement[]>;
  masterScheduleData: Requirement[];
  optimizationSettings?: OnDemandOptimizationSettingsSnapshot;
  slotGranularityMinutes?: SlotGranularityMinutes;
}

function convertSlotValue(
  value: number | undefined,
  sourceSlotMinutes: SlotGranularityMinutes,
  targetSlotMinutes: SlotGranularityMinutes,
): number | undefined {
  if (value === undefined) return undefined;
  if (sourceSlotMinutes === targetSlotMinutes) return value;

  return Math.round((value * sourceSlotMinutes) / targetSlotMinutes);
}

export function expandRequirementsToGrid(
  requirements: Requirement[],
  sourceSlotMinutes: SlotGranularityMinutes,
  targetSlotMinutes: SlotGranularityMinutes,
): Requirement[] {
  if (sourceSlotMinutes === targetSlotMinutes) {
    return requirements.map((requirement, index) => ({
      ...requirement,
      slotIndex: index,
    }));
  }

  if (sourceSlotMinutes < targetSlotMinutes) {
    throw new Error('Collapsing on-demand requirements to a coarser grid is not supported.');
  }

  const expansionFactor = sourceSlotMinutes / targetSlotMinutes;
  if (!Number.isInteger(expansionFactor)) {
    throw new Error('On-demand grid conversion requires evenly divisible slot sizes.');
  }

  return requirements.flatMap((requirement) => (
    Array.from({ length: expansionFactor }, (_, offset) => ({
      ...requirement,
      slotIndex: requirement.slotIndex * expansionFactor + offset,
    }))
  ));
}

export function convertShiftsToGrid(
  shifts: Shift[] | undefined,
  sourceSlotMinutes: SlotGranularityMinutes,
  targetSlotMinutes: SlotGranularityMinutes,
): Shift[] {
  if (!shifts) return [];

  return shifts.map((shift) => ({
    ...shift,
    startSlot: convertSlotValue(shift.startSlot, sourceSlotMinutes, targetSlotMinutes) ?? shift.startSlot,
    endSlot: convertSlotValue(shift.endSlot, sourceSlotMinutes, targetSlotMinutes) ?? shift.endSlot,
    breakStartSlot: convertSlotValue(shift.breakStartSlot, sourceSlotMinutes, targetSlotMinutes) ?? shift.breakStartSlot,
    breakDurationSlots: convertSlotValue(shift.breakDurationSlots, sourceSlotMinutes, targetSlotMinutes) ?? shift.breakDurationSlots,
  }));
}

function inferSlotGranularity(schedule: OnDemandGridSchedulePayload): SlotGranularityMinutes {
  if (schedule.slotGranularityMinutes === 5 || schedule.slotGranularityMinutes === 15) {
    return schedule.slotGranularityMinutes;
  }

  // Missing metadata means legacy saved TOD draft. Legacy drafts used 96
  // 15-minute rows. New 5-minute schedules carry explicit metadata.
  const requirementSets = [
    schedule.masterScheduleData,
    ...Object.values(schedule.schedulesData ?? {}),
  ];

  return requirementSets.some((requirements) => requirements.length === 96) ? 15 : SLOT_MINUTES;
}

export function convertOnDemandScheduleGrid(
  schedule: OnDemandGridSchedulePayload,
  targetSlotMinutes: SlotGranularityMinutes = SLOT_MINUTES,
): OnDemandGridSchedulePayload {
  const sourceSlotMinutes = inferSlotGranularity(schedule);

  if (sourceSlotMinutes === targetSlotMinutes) {
    return {
      ...schedule,
      slotGranularityMinutes: targetSlotMinutes,
      shiftData: schedule.shiftData ? convertShiftsToGrid(schedule.shiftData, targetSlotMinutes, targetSlotMinutes) : [],
      masterScheduleData: expandRequirementsToGrid(schedule.masterScheduleData, targetSlotMinutes, targetSlotMinutes),
      schedulesData: schedule.schedulesData
        ? Object.fromEntries(
          Object.entries(schedule.schedulesData).map(([day, requirements]) => [
            day,
            expandRequirementsToGrid(requirements, targetSlotMinutes, targetSlotMinutes),
          ]),
        )
        : undefined,
    };
  }

  return {
    ...schedule,
    slotGranularityMinutes: targetSlotMinutes,
    shiftData: convertShiftsToGrid(schedule.shiftData, sourceSlotMinutes, targetSlotMinutes),
    masterScheduleData: expandRequirementsToGrid(schedule.masterScheduleData, sourceSlotMinutes, targetSlotMinutes),
    schedulesData: schedule.schedulesData
      ? Object.fromEntries(
        Object.entries(schedule.schedulesData).map(([day, requirements]) => [
          day,
          expandRequirementsToGrid(requirements, sourceSlotMinutes, targetSlotMinutes),
        ]),
      )
      : undefined,
  };
}
