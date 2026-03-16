import { describe, expect, it } from 'vitest';
import { Zone, type Shift } from '../utils/demandTypes';
import { buildShiftHandoffMap } from '../utils/onDemandHandoffs';

const makeShift = (
  id: string,
  zone: Zone,
  startSlot: number,
  endSlot: number,
): Shift => ({
  id,
  driverName: id,
  zone,
  startSlot,
  endSlot,
  breakStartSlot: 0,
  breakDurationSlots: 0,
});

describe('on-demand handoffs', () => {
  it('links direct same-slot handoffs across zones', () => {
    const handoffs = buildShiftHandoffMap([
      makeShift('north-1', Zone.NORTH, 32, 40),
      makeShift('south-1', Zone.SOUTH, 40, 48),
      makeShift('north-2', Zone.NORTH, 48, 56),
    ]);

    expect(handoffs.get('north-1')?.outbound.map((shift) => shift.id)).toEqual(['south-1']);
    expect(handoffs.get('south-1')?.inbound.map((shift) => shift.id)).toEqual(['north-1']);
    expect(handoffs.get('south-1')?.outbound.map((shift) => shift.id)).toEqual(['north-2']);
    expect(handoffs.get('north-2')?.inbound.map((shift) => shift.id)).toEqual(['south-1']);
  });

  it('does not create handoffs for simple add-ins without a matching end slot', () => {
    const handoffs = buildShiftHandoffMap([
      makeShift('north-1', Zone.NORTH, 32, 60),
      makeShift('north-2', Zone.NORTH, 40, 68),
    ]);

    expect(handoffs.get('north-1')?.inbound).toEqual([]);
    expect(handoffs.get('north-1')?.outbound).toEqual([]);
    expect(handoffs.get('north-2')?.inbound).toEqual([]);
    expect(handoffs.get('north-2')?.outbound).toEqual([]);
  });
});
