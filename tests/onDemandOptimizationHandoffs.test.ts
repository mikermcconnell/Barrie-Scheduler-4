import { describe, expect, it } from 'vitest';
import { Zone, type Shift } from '../utils/demandTypes';
import {
  carryForwardOptimizationHandoffs,
  countExplicitShiftHandoffPairs,
} from '../utils/onDemandOptimizationHandoffs';

const makeShift = (
  id: string,
  zone: Zone,
  startSlot: number,
  endSlot: number,
  overrides: Partial<Shift> = {},
): Shift => ({
  id,
  driverName: id,
  zone,
  startSlot,
  endSlot,
  breakStartSlot: 0,
  breakDurationSlots: 0,
  ...overrides,
});

describe('on-demand optimization handoff carry-forward', () => {
  it('counts explicit reciprocal handoff pairs once', () => {
    const shifts = [
      makeShift('a', Zone.NORTH, 20, 40, { handoffToShiftId: 'b' }),
      makeShift('b', Zone.NORTH, 41, 61, { handoffFromShiftId: 'a', handoffToShiftId: 'c' }),
      makeShift('c', Zone.SOUTH, 62, 82, { handoffFromShiftId: 'b' }),
    ];

    expect(countExplicitShiftHandoffPairs(shifts)).toBe(2);
  });

  it('preserves valid handoff pairs for surviving refined shifts', () => {
    const current = [
      makeShift('a', Zone.NORTH, 20, 40, { handoffToShiftId: 'b' }),
      makeShift('b', Zone.NORTH, 41, 61, { handoffFromShiftId: 'a' }),
    ];
    const optimized = [
      makeShift('a', Zone.NORTH, 21, 41),
      makeShift('b', Zone.NORTH, 42, 62),
    ];

    const result = carryForwardOptimizationHandoffs(current, optimized);

    expect(result.originalPairCount).toBe(1);
    expect(result.preservedPairCount).toBe(1);
    expect(result.droppedPairCount).toBe(0);
    expect(result.shifts.find((shift) => shift.id === 'a')?.handoffToShiftId).toBe('b');
    expect(result.shifts.find((shift) => shift.id === 'b')?.handoffFromShiftId).toBe('a');
  });

  it('drops handoff pairs when a linked shift no longer survives refine', () => {
    const current = [
      makeShift('a', Zone.NORTH, 20, 40, { handoffToShiftId: 'b' }),
      makeShift('b', Zone.NORTH, 41, 61, { handoffFromShiftId: 'a' }),
    ];
    const optimized = [
      makeShift('a', Zone.NORTH, 21, 41),
      makeShift('c', Zone.NORTH, 42, 62),
    ];

    const result = carryForwardOptimizationHandoffs(current, optimized);

    expect(result.preservedPairCount).toBe(0);
    expect(result.droppedPairCount).toBe(1);
    expect(result.shifts.every((shift) => !shift.handoffFromShiftId && !shift.handoffToShiftId)).toBe(true);
  });

  it('drops handoff pairs when refined timing no longer lines up', () => {
    const current = [
      makeShift('a', Zone.NORTH, 20, 40, { handoffToShiftId: 'b' }),
      makeShift('b', Zone.NORTH, 41, 61, { handoffFromShiftId: 'a' }),
    ];
    const optimized = [
      makeShift('a', Zone.NORTH, 21, 41),
      makeShift('b', Zone.NORTH, 44, 64),
    ];

    const result = carryForwardOptimizationHandoffs(current, optimized);

    expect(result.preservedPairCount).toBe(0);
    expect(result.droppedPairCount).toBe(1);
    expect(result.shifts.find((shift) => shift.id === 'a')?.handoffToShiftId).toBeUndefined();
    expect(result.shifts.find((shift) => shift.id === 'b')?.handoffFromShiftId).toBeUndefined();
  });
});
