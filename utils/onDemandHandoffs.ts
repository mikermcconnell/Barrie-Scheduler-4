import {
  Shift,
  Zone,
  type OnDemandChangeoffSettings,
} from './demandTypes';
import { changeoffMinutesToSlots } from './onDemandOptimizationSettings';

export interface ShiftHandoffLinks {
  inbound: Shift[];
  outbound: Shift[];
}

export interface ShiftServiceWindow {
  serviceStartSlot: number;
  serviceEndSlot: number;
  startChangeoffSlots: number;
  endChangeoffSlots: number;
}

export const buildShiftHandoffMap = (shifts: Shift[]): Map<string, ShiftHandoffLinks> => {
  const serviceShifts = shifts.filter(
    (shift) => shift.zone === Zone.NORTH || shift.zone === Zone.SOUTH,
  );
  const handoffMap = new Map<string, ShiftHandoffLinks>();

  const startsBySlot = new Map<number, Shift[]>();
  const endsBySlot = new Map<number, Shift[]>();

  serviceShifts.forEach((shift) => {
    const startsAtSlot = startsBySlot.get(shift.startSlot) ?? [];
    startsAtSlot.push(shift);
    startsBySlot.set(shift.startSlot, startsAtSlot);

    const endsAtSlot = endsBySlot.get(shift.endSlot) ?? [];
    endsAtSlot.push(shift);
    endsBySlot.set(shift.endSlot, endsAtSlot);
  });

  serviceShifts.forEach((shift) => {
    handoffMap.set(shift.id, {
      inbound: (endsBySlot.get(shift.startSlot) ?? []).filter((candidate) => candidate.id !== shift.id),
      outbound: (startsBySlot.get(shift.endSlot) ?? []).filter((candidate) => candidate.id !== shift.id),
    });
  });

  return handoffMap;
};

export const resolveShiftServiceWindow = (
  shift: Shift,
  handoffLinks: ShiftHandoffLinks | undefined,
  changeoffSettings: Partial<OnDemandChangeoffSettings> = {},
): ShiftServiceWindow => {
  const changeoffSlots = shift.zone === Zone.NORTH
    ? changeoffMinutesToSlots(changeoffSettings.northChangeoffMinutes ?? 0)
    : shift.zone === Zone.SOUTH
      ? changeoffMinutesToSlots(changeoffSettings.southChangeoffMinutes ?? 0)
      : 0;

  const startChangeoffSlots = (handoffLinks?.inbound.length ?? 0) > 0 ? changeoffSlots : 0;
  const endChangeoffSlots = (handoffLinks?.outbound.length ?? 0) > 0 ? changeoffSlots : 0;

  return {
    serviceStartSlot: Math.min(shift.endSlot, shift.startSlot + startChangeoffSlots),
    serviceEndSlot: Math.max(shift.startSlot, shift.endSlot - endChangeoffSlots),
    startChangeoffSlots,
    endChangeoffSlots,
  };
};

export const buildShiftServiceWindowMap = (
  shifts: Shift[],
  changeoffSettings: Partial<OnDemandChangeoffSettings> = {},
): Map<string, ShiftServiceWindow> => {
  const handoffMap = buildShiftHandoffMap(shifts);
  const serviceWindowMap = new Map<string, ShiftServiceWindow>();

  shifts.forEach((shift) => {
    serviceWindowMap.set(
      shift.id,
      resolveShiftServiceWindow(shift, handoffMap.get(shift.id), changeoffSettings),
    );
  });

  return serviceWindowMap;
};
