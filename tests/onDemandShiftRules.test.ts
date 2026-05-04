import { describe, expect, it } from 'vitest';
import type { Shift } from '../utils/demandTypes';
import { Zone } from '../utils/demandTypes';
import {
  MAX_SHIFT_SLOTS,
  sanitizeOptimizerShift,
  validateOnDemandShiftRules,
} from '../utils/onDemandShiftRules';
import { TIME_SLOTS_PER_DAY, hoursToSlots } from '../utils/demandConstants';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    driverName: 'Driver 1',
    zone: Zone.FLOATER,
    startSlot: 0,
    endSlot: hoursToSlots(8),
    breakStartSlot: 0,
    breakDurationSlots: 0,
    ...overrides,
  };
}

describe('on-demand shift rules', () => {
  it('clamps optimizer output to the 11-hour hard maximum', () => {
    const shift = sanitizeOptimizerShift({
      startSlot: 2,
      durationSlots: hoursToSlots(12),
      breakStartSlot: 999,
      zone: Zone.NORTH,
    }, 9);

    expect(shift.startSlot).toBe(2);
    expect(shift.endSlot).toBe(2 + MAX_SHIFT_SLOTS);
    expect(shift.breakStartSlot).toBe(2 + hoursToSlots(6));
    expect(shift.breakDurationSlots).toBe(9);
    expect(shift.zone).toBe(Zone.NORTH);
  });

  it('moves an out-of-bounds late shift back inside the planning day', () => {
    const shift = sanitizeOptimizerShift({
      startSlot: TIME_SLOTS_PER_DAY - hoursToSlots(1),
      durationSlots: MAX_SHIFT_SLOTS,
      breakStartSlot: 999,
      zone: 'Invalid' as unknown as Zone,
    }, 9);

    expect(shift.startSlot).toBe(TIME_SLOTS_PER_DAY - MAX_SHIFT_SLOTS);
    expect(shift.endSlot).toBe(TIME_SLOTS_PER_DAY);
    expect(shift.breakStartSlot).toBe(TIME_SLOTS_PER_DAY - MAX_SHIFT_SLOTS + hoursToSlots(6));
    expect(shift.zone).toBe(Zone.FLOATER);
  });

  it('reports break rule violations for long shifts', () => {
    const violations = validateOnDemandShiftRules([
      makeShift({
        endSlot: hoursToSlots(8),
        breakStartSlot: 10,
        breakDurationSlots: 1,
      }),
    ], 9);

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
