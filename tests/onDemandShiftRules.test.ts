import { describe, expect, it } from 'vitest';
import type { Shift } from '../utils/demandTypes';
import { Zone } from '../utils/demandTypes';
import {
  sanitizeOptimizerShift,
  validateOnDemandShiftRules,
} from '../utils/onDemandShiftRules';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    driverName: 'Driver 1',
    zone: Zone.FLOATER,
    startSlot: 0,
    endSlot: 32,
    breakStartSlot: 0,
    breakDurationSlots: 0,
    ...overrides,
  };
}

describe('on-demand shift rules', () => {
  it('clamps optimizer output to the 11-hour hard maximum', () => {
    const shift = sanitizeOptimizerShift({
      startSlot: 2,
      durationSlots: 47,
      breakStartSlot: 30,
      zone: Zone.NORTH,
    }, 3);

    expect(shift.startSlot).toBe(2);
    expect(shift.endSlot).toBe(46);
    expect(shift.breakStartSlot).toBe(26);
    expect(shift.breakDurationSlots).toBe(3);
    expect(shift.zone).toBe(Zone.NORTH);
  });

  it('moves an out-of-bounds late shift back inside the planning day', () => {
    const shift = sanitizeOptimizerShift({
      startSlot: 90,
      durationSlots: 44,
      breakStartSlot: 120,
      zone: 'Invalid' as unknown as Zone,
    }, 3);

    expect(shift.startSlot).toBe(52);
    expect(shift.endSlot).toBe(96);
    expect(shift.breakStartSlot).toBe(76);
    expect(shift.zone).toBe(Zone.FLOATER);
  });

  it('reports break rule violations for long shifts', () => {
    const violations = validateOnDemandShiftRules([
      makeShift({
        endSlot: 44,
        breakStartSlot: 10,
        breakDurationSlots: 1,
      }),
    ], 3);

    expect(violations).toContainEqual(
      expect.objectContaining({
        kind: 'break_too_short',
      }),
    );
    expect(violations).toContainEqual(
      expect.objectContaining({
        kind: 'break_window',
      }),
    );
  });
});
