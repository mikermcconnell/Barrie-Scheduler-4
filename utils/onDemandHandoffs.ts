import {
  Shift,
  Zone,
  type OnDemandChangeoffSettings,
} from './demandTypes';
import { changeoffMinutesToSlots } from './onDemandOptimizationSettings';
import { getShiftDayType } from './onDemandShiftUtils';

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

export const MAX_MANUAL_HANDOFF_GAP_SLOTS = 1;

export type ShiftHandoffViolationKind =
  | 'handoff_missing_target'
  | 'handoff_non_service_shift'
  | 'handoff_self_reference'
  | 'handoff_cross_day'
  | 'handoff_not_reciprocated'
  | 'handoff_time_window'
  | 'handoff_cycle';

export interface ShiftHandoffViolation {
  shiftId: string;
  driverName: string;
  kind: ShiftHandoffViolationKind;
  message: string;
  linkedShiftId?: string;
  linkedDriverName?: string;
}

const isServiceShift = (shift: Shift | undefined): shift is Shift =>
  !!shift && (shift.zone === Zone.NORTH || shift.zone === Zone.SOUTH);

const getHandoffGapSlots = (fromShift: Shift, toShift: Shift): number =>
  toShift.startSlot - fromShift.endSlot;

export const isManualHandoffTimingValid = (fromShift: Shift, toShift: Shift): boolean => {
  const gapSlots = getHandoffGapSlots(fromShift, toShift);
  return gapSlots >= 0 && gapSlots <= MAX_MANUAL_HANDOFF_GAP_SLOTS;
};

const isExplicitHandoffPair = (
  fromShift: Shift,
  toShift: Shift | undefined,
): toShift is Shift => {
  if (!isServiceShift(fromShift) || !isServiceShift(toShift)) {
    return false;
  }

  if (fromShift.id === toShift.id) {
    return false;
  }

  if (getShiftDayType(fromShift) !== getShiftDayType(toShift)) {
    return false;
  }

  if (fromShift.handoffToShiftId !== toShift.id || toShift.handoffFromShiftId !== fromShift.id) {
    return false;
  }

  return isManualHandoffTimingValid(fromShift, toShift);
};

const compareShiftsForHandoffPairing = (left: Shift, right: Shift): number => {
  if (left.zone !== right.zone) {
    return left.zone.localeCompare(right.zone);
  }

  const nameComparison = left.driverName.localeCompare(
    right.driverName,
    undefined,
    { numeric: true, sensitivity: 'base' },
  );
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' });
};

const pairShiftsAtSlot = (
  endingShifts: Shift[],
  startingShifts: Shift[],
): Array<[Shift, Shift]> => {
  const remainingEnds = [...endingShifts].sort(compareShiftsForHandoffPairing);
  const remainingStarts = [...startingShifts].sort(compareShiftsForHandoffPairing);
  const pairs: Array<[Shift, Shift]> = [];

  [Zone.NORTH, Zone.SOUTH].forEach((zone) => {
    const zoneEnds = remainingEnds.filter((shift) => shift.zone === zone);
    const zoneStarts = remainingStarts.filter((shift) => shift.zone === zone);
    const pairCount = Math.min(zoneEnds.length, zoneStarts.length);

    for (let index = 0; index < pairCount; index += 1) {
      pairs.push([zoneEnds[index], zoneStarts[index]]);
      remainingEnds.splice(remainingEnds.indexOf(zoneEnds[index]), 1);
      remainingStarts.splice(remainingStarts.indexOf(zoneStarts[index]), 1);
    }
  });

  const fallbackPairCount = Math.min(remainingEnds.length, remainingStarts.length);
  for (let index = 0; index < fallbackPairCount; index += 1) {
    pairs.push([remainingEnds[index], remainingStarts[index]]);
  }

  return pairs;
};

const addHandoffPair = (
  handoffMap: Map<string, ShiftHandoffLinks>,
  endingShift: Shift,
  startingShift: Shift,
) => {
  handoffMap.get(endingShift.id)?.outbound.push(startingShift);
  handoffMap.get(startingShift.id)?.inbound.push(endingShift);
};

export const validateShiftHandoffs = (shifts: Shift[]): ShiftHandoffViolation[] => {
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
  const violations: ShiftHandoffViolation[] = [];
  const seenViolationKeys = new Set<string>();

  const addViolation = (
    shift: Shift,
    kind: ShiftHandoffViolationKind,
    message: string,
    linkedShift?: Shift,
    linkedShiftId?: string,
  ) => {
    const resolvedLinkedShiftId = linkedShift?.id ?? linkedShiftId;
    const violationKey = `${shift.id}:${kind}:${resolvedLinkedShiftId ?? 'none'}`;
    if (seenViolationKeys.has(violationKey)) {
      return;
    }

    seenViolationKeys.add(violationKey);
    violations.push({
      shiftId: shift.id,
      driverName: shift.driverName,
      kind,
      message,
      linkedShiftId: resolvedLinkedShiftId,
      linkedDriverName: linkedShift?.driverName,
    });
  };

  shifts.forEach((shift) => {
    const references = [
      {
        relation: 'from' as const,
        linkedShiftId: shift.handoffFromShiftId,
      },
      {
        relation: 'to' as const,
        linkedShiftId: shift.handoffToShiftId,
      },
    ];

    references.forEach(({ relation, linkedShiftId }) => {
      if (!linkedShiftId) {
        return;
      }

      if (linkedShiftId === shift.id) {
        addViolation(shift, 'handoff_self_reference', 'A shift cannot hand off to itself.', undefined, linkedShiftId);
        return;
      }

      const linkedShift = shiftById.get(linkedShiftId);
      if (!linkedShift) {
        addViolation(
          shift,
          'handoff_missing_target',
          'This handoff points to a shift that no longer exists.',
          undefined,
          linkedShiftId,
        );
        return;
      }

      if (!isServiceShift(shift) || !isServiceShift(linkedShift)) {
        addViolation(
          shift,
          'handoff_non_service_shift',
          'Shift handoffs are only valid between North and South service pieces.',
          linkedShift,
        );
        return;
      }

      if (getShiftDayType(shift) !== getShiftDayType(linkedShift)) {
        addViolation(
          shift,
          'handoff_cross_day',
          'Shift handoffs must stay within the same day type.',
          linkedShift,
        );
      }

      const isReciprocated = relation === 'from'
        ? linkedShift.handoffToShiftId === shift.id
        : linkedShift.handoffFromShiftId === shift.id;
      if (!isReciprocated) {
        addViolation(
          shift,
          'handoff_not_reciprocated',
          'This handoff is missing the matching return link on the paired shift.',
          linkedShift,
        );
      }

      const timingIsValid = relation === 'from'
        ? isManualHandoffTimingValid(linkedShift, shift)
        : isManualHandoffTimingValid(shift, linkedShift);
      if (!timingIsValid) {
        addViolation(
          shift,
          'handoff_time_window',
          `Shift handoffs must connect consecutive service pieces with no more than ${MAX_MANUAL_HANDOFF_GAP_SLOTS} planning slot gap.`,
          linkedShift,
        );
      }
    });
  });

  shifts.forEach((shift) => {
    const visitedShiftIds = new Set<string>([shift.id]);
    let currentShift: Shift | undefined = shift;

    while (currentShift?.handoffToShiftId) {
      const nextShift = shiftById.get(currentShift.handoffToShiftId);
      if (!nextShift) {
        break;
      }

      if (visitedShiftIds.has(nextShift.id)) {
        addViolation(
          shift,
          'handoff_cycle',
          'Shift handoffs cannot form a circular chain.',
          nextShift,
        );
        break;
      }

      visitedShiftIds.add(nextShift.id);
      currentShift = nextShift;
    }
  });

  return violations;
};

export const buildShiftHandoffMap = (shifts: Shift[]): Map<string, ShiftHandoffLinks> => {
  const serviceShifts = shifts.filter(
    (shift) => shift.zone === Zone.NORTH || shift.zone === Zone.SOUTH,
  );
  const handoffMap = new Map<string, ShiftHandoffLinks>();
  const serviceShiftById = new Map(serviceShifts.map((shift) => [shift.id, shift]));
  const pairedShiftIds = new Set<string>();

  serviceShifts.forEach((shift) => {
    handoffMap.set(shift.id, {
      inbound: [],
      outbound: [],
    });
  });

  [...serviceShifts]
    .sort((left, right) => {
      if (left.endSlot !== right.endSlot) {
        return left.endSlot - right.endSlot;
      }

      return compareShiftsForHandoffPairing(left, right);
    })
    .forEach((shift) => {
      if (pairedShiftIds.has(shift.id) || !shift.handoffToShiftId) {
        return;
      }

      const linkedShift = serviceShiftById.get(shift.handoffToShiftId);
      if (!isExplicitHandoffPair(shift, linkedShift) || pairedShiftIds.has(linkedShift.id)) {
        return;
      }

      addHandoffPair(handoffMap, shift, linkedShift);
      pairedShiftIds.add(shift.id);
      pairedShiftIds.add(linkedShift.id);
    });

  const startsBySlot = new Map<number, Shift[]>();
  const endsBySlot = new Map<number, Shift[]>();

  serviceShifts
    .filter((shift) => !pairedShiftIds.has(shift.id))
    .forEach((shift) => {
      const startsAtSlot = startsBySlot.get(shift.startSlot) ?? [];
      startsAtSlot.push(shift);
      startsBySlot.set(shift.startSlot, startsAtSlot);

      const endsAtSlot = endsBySlot.get(shift.endSlot) ?? [];
      endsAtSlot.push(shift);
      endsBySlot.set(shift.endSlot, endsAtSlot);
    });

  startsBySlot.forEach((startingShifts, slot) => {
    const endingShifts = endsBySlot.get(slot) ?? [];
    if (endingShifts.length === 0) {
      return;
    }

    pairShiftsAtSlot(endingShifts, startingShifts).forEach(([endingShift, startingShift]) => {
      addHandoffPair(handoffMap, endingShift, startingShift);
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
