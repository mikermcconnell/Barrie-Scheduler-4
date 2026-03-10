import { describe, expect, it } from 'vitest';
import { calculateSchedule } from '../utils/dataGenerator';
import { Zone, type Requirement, type Shift } from '../utils/demandTypes';

function makeRequirements(): Requirement[] {
  return Array.from({ length: 96 }, (_, slotIndex) => ({
    slotIndex,
    north: 2,
    south: 1,
    floater: 1,
    total: 4,
  }));
}

function makeShift(
  id: string,
  zone: Zone,
  breakStartSlot = 0,
  breakDurationSlots = 0,
): Shift {
  return {
    id,
    driverName: id,
    zone,
    startSlot: 0,
    endSlot: 96,
    breakStartSlot,
    breakDurationSlots,
  };
}

describe('on-demand coverage', () => {
  it('counts zone deficits toward effective floater requirement', () => {
    const slots = calculateSchedule([
      makeShift('north-1', Zone.NORTH),
      makeShift('south-1', Zone.SOUTH),
      makeShift('floater-1', Zone.FLOATER),
      makeShift('floater-2', Zone.FLOATER),
    ], makeRequirements());

    const slot = slots[53];
    expect(slot.timeLabel).toBe('13:15');
    expect(slot.northCoverage).toBe(1);
    expect(slot.floaterCoverage).toBe(2);
    expect(slot.floaterRequirement).toBe(1);
    expect(slot.floaterEffectiveRequirement).toBe(2);
    expect(slot.netDifference).toBe(0);
  });

  it('shows the floater gap starting at the exact break slot', () => {
    const slots = calculateSchedule([
      makeShift('north-1', Zone.NORTH),
      makeShift('south-1', Zone.SOUTH),
      makeShift('floater-1', Zone.FLOATER),
      makeShift('floater-2', Zone.FLOATER, 53, 3),
    ], makeRequirements());

    expect(slots[52].timeLabel).toBe('13:00');
    expect(slots[52].floaterCoverage).toBe(2);
    expect(slots[52].floaterEffectiveRequirement).toBe(2);
    expect(slots[52].netDifference).toBe(0);

    expect(slots[53].timeLabel).toBe('13:15');
    expect(slots[53].floaterCoverage).toBe(1);
    expect(slots[53].floaterBreaks).toBe(1);
    expect(slots[53].floaterEffectiveRequirement).toBe(2);
    expect(slots[53].netDifference).toBe(-1);
  });
});
