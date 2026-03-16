import { Shift, Zone } from './demandTypes';

export interface ShiftHandoffLinks {
  inbound: Shift[];
  outbound: Shift[];
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
