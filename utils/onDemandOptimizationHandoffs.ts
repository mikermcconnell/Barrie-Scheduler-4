import type { Shift } from './demandTypes';
import { Zone } from './demandTypes';
import {
  getShiftDayType,
} from './onDemandShiftUtils';
import {
  isManualHandoffTimingValid,
  validateShiftHandoffs,
} from './onDemandHandoffs';

export interface ExplicitShiftHandoffPair {
  fromShiftId: string;
  toShiftId: string;
}

export interface OptimizationHandoffCarryForwardResult {
  shifts: Shift[];
  originalPairCount: number;
  preservedPairCount: number;
  droppedPairCount: number;
}

const isServiceShift = (shift: Shift | undefined): shift is Shift =>
  !!shift && (shift.zone === Zone.NORTH || shift.zone === Zone.SOUTH);

export const getExplicitShiftHandoffPairs = (shifts: Shift[]): ExplicitShiftHandoffPair[] => {
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
  const pairs: ExplicitShiftHandoffPair[] = [];

  shifts.forEach((shift) => {
    const linkedShiftId = shift.handoffToShiftId;
    if (!linkedShiftId) {
      return;
    }

    const linkedShift = shiftById.get(linkedShiftId);
    if (linkedShift?.handoffFromShiftId !== shift.id) {
      return;
    }

    pairs.push({
      fromShiftId: shift.id,
      toShiftId: linkedShiftId,
    });
  });

  return pairs;
};

export const countExplicitShiftHandoffPairs = (shifts: Shift[]): number =>
  getExplicitShiftHandoffPairs(shifts).length;

export const carryForwardOptimizationHandoffs = (
  currentShifts: Shift[],
  optimizedShifts: Shift[],
): OptimizationHandoffCarryForwardResult => {
  const reconciledShifts: Shift[] = optimizedShifts.map((shift): Shift => ({
    ...shift,
    handoffFromShiftId: undefined,
    handoffToShiftId: undefined,
  }));
  const optimizedById = new Map(reconciledShifts.map((shift) => [shift.id, shift]));
  const currentViolationsByShiftId = new Set(
    validateShiftHandoffs(currentShifts).map((violation) => violation.shiftId),
  );
  const originalPairs = getExplicitShiftHandoffPairs(currentShifts);

  let preservedPairCount = 0;
  let droppedPairCount = 0;

  originalPairs.forEach(({ fromShiftId, toShiftId }) => {
    if (currentViolationsByShiftId.has(fromShiftId) || currentViolationsByShiftId.has(toShiftId)) {
      droppedPairCount += 1;
      return;
    }

    const fromShift = optimizedById.get(fromShiftId);
    const toShift = optimizedById.get(toShiftId);

    if (!isServiceShift(fromShift) || !isServiceShift(toShift)) {
      droppedPairCount += 1;
      return;
    }

    if (getShiftDayType(fromShift) !== getShiftDayType(toShift)) {
      droppedPairCount += 1;
      return;
    }

    if (!isManualHandoffTimingValid(fromShift, toShift)) {
      droppedPairCount += 1;
      return;
    }

    fromShift.handoffToShiftId = toShift.id;
    toShift.handoffFromShiftId = fromShift.id;
    preservedPairCount += 1;
  });

  return {
    shifts: reconciledShifts,
    originalPairCount: originalPairs.length,
    preservedPairCount,
    droppedPairCount,
  };
};
