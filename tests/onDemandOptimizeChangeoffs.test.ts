import { describe, expect, it } from 'vitest';
import { getSimultaneousChangeoffPenalty } from '../api/optimize';
import { Zone, type Requirement, type Shift } from '../utils/demandTypes';

function makeRequirement(total = 1): Requirement[] {
  return Array.from({ length: 96 }, (_, slotIndex) => ({
    slotIndex,
    north: total,
    south: 0,
    floater: 0,
    total,
  }));
}

function makeShift(
  id: string,
  startSlot: number,
  endSlot: number,
): Shift {
  return {
    id,
    driverName: id,
    zone: Zone.NORTH,
    startSlot,
    endSlot,
    breakStartSlot: 0,
    breakDurationSlots: 0,
  };
}

describe('on-demand optimize changeoff scoring', () => {
  it('penalizes simultaneous changeoffs more than staggered handoffs', () => {
    const requirements = makeRequirement();
    const simultaneousPenalty = getSimultaneousChangeoffPenalty(
      [
        makeShift('north-1', 32, 40),
        makeShift('north-2', 40, 48),
        makeShift('north-3', 32, 40),
        makeShift('north-4', 40, 48),
      ],
      requirements,
      { northChangeoffMinutes: 10, southChangeoffMinutes: 8 },
    );

    const staggeredPenalty = getSimultaneousChangeoffPenalty(
      [
        makeShift('north-1', 32, 40),
        makeShift('north-2', 40, 48),
        makeShift('north-3', 36, 44),
        makeShift('north-4', 44, 52),
      ],
      requirements,
      { northChangeoffMinutes: 10, southChangeoffMinutes: 8 },
    );

    expect(simultaneousPenalty).toBeGreaterThan(staggeredPenalty);
    expect(staggeredPenalty).toBe(0);
  });
});
