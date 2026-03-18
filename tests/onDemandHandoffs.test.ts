import { describe, expect, it } from 'vitest';
import { Zone, type Shift } from '../utils/demandTypes';
import {
  MAX_MANUAL_HANDOFF_GAP_SLOTS,
  buildShiftHandoffMap,
  buildShiftServiceWindowMap,
} from '../utils/onDemandHandoffs';

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

  it('pairs concurrent same-minute handoffs one-to-one with same-zone preference', () => {
    const handoffs = buildShiftHandoffMap([
      makeShift('north-end', Zone.NORTH, 24, 40),
      makeShift('south-end-1', Zone.SOUTH, 24, 40),
      makeShift('south-end-2', Zone.SOUTH, 24, 40),
      makeShift('north-start', Zone.NORTH, 40, 56),
      makeShift('south-start-1', Zone.SOUTH, 40, 56),
      makeShift('south-start-2', Zone.SOUTH, 40, 56),
    ]);

    expect(handoffs.get('north-end')?.outbound.map((shift) => shift.id)).toEqual(['north-start']);
    expect(handoffs.get('north-start')?.inbound.map((shift) => shift.id)).toEqual(['north-end']);
    expect(handoffs.get('south-end-1')?.outbound.map((shift) => shift.id)).toEqual(['south-start-1']);
    expect(handoffs.get('south-start-1')?.inbound.map((shift) => shift.id)).toEqual(['south-end-1']);
    expect(handoffs.get('south-end-2')?.outbound.map((shift) => shift.id)).toEqual(['south-start-2']);
    expect(handoffs.get('south-start-2')?.inbound.map((shift) => shift.id)).toEqual(['south-end-2']);
  });

  it('uses an explicit reciprocal handoff even when shifts are one planning slot apart', () => {
    const handoffs = buildShiftHandoffMap([
      makeShift('north-1', Zone.NORTH, 32, 40, {
        handoffToShiftId: 'north-2',
      }),
      makeShift('north-2', Zone.NORTH, 41, 49, {
        handoffFromShiftId: 'north-1',
      }),
    ]);

    expect(MAX_MANUAL_HANDOFF_GAP_SLOTS).toBe(1);
    expect(handoffs.get('north-1')?.outbound.map((shift) => shift.id)).toEqual(['north-2']);
    expect(handoffs.get('north-2')?.inbound.map((shift) => shift.id)).toEqual(['north-1']);
  });

  it('lets an explicit reciprocal handoff override the fallback same-slot pairing', () => {
    const handoffs = buildShiftHandoffMap([
      makeShift('north-1', Zone.NORTH, 32, 40, {
        handoffToShiftId: 'south-1',
      }),
      makeShift('north-2', Zone.NORTH, 32, 40),
      makeShift('north-3', Zone.NORTH, 40, 48),
      makeShift('south-1', Zone.SOUTH, 40, 48, {
        handoffFromShiftId: 'north-1',
      }),
    ]);

    expect(handoffs.get('north-1')?.outbound.map((shift) => shift.id)).toEqual(['south-1']);
    expect(handoffs.get('south-1')?.inbound.map((shift) => shift.id)).toEqual(['north-1']);
    expect(handoffs.get('north-2')?.outbound.map((shift) => shift.id)).toEqual(['north-3']);
    expect(handoffs.get('north-3')?.inbound.map((shift) => shift.id)).toEqual(['north-2']);
  });

  it('ignores explicit handoffs that are not reciprocal', () => {
    const handoffs = buildShiftHandoffMap([
      makeShift('north-1', Zone.NORTH, 32, 40, {
        handoffToShiftId: 'north-2',
      }),
      makeShift('north-2', Zone.NORTH, 41, 49),
    ]);

    expect(handoffs.get('north-1')?.outbound).toEqual([]);
    expect(handoffs.get('north-2')?.inbound).toEqual([]);
  });

  it('derives effective service windows from zone-specific changeoff minutes', () => {
    const serviceWindows = buildShiftServiceWindowMap([
      makeShift('north-1', Zone.NORTH, 32, 40),
      makeShift('south-1', Zone.SOUTH, 40, 48),
      makeShift('north-2', Zone.NORTH, 48, 56),
    ], {
      northChangeoffMinutes: 15,
      southChangeoffMinutes: 8,
    });

    expect(serviceWindows.get('north-1')).toEqual({
      serviceStartSlot: 32,
      serviceEndSlot: 39,
      startChangeoffSlots: 0,
      endChangeoffSlots: 1,
    });
    expect(serviceWindows.get('south-1')).toEqual({
      serviceStartSlot: 41,
      serviceEndSlot: 47,
      startChangeoffSlots: 1,
      endChangeoffSlots: 1,
    });
    expect(serviceWindows.get('north-2')).toEqual({
      serviceStartSlot: 49,
      serviceEndSlot: 56,
      startChangeoffSlots: 1,
      endChangeoffSlots: 0,
    });
  });

  it('does not shrink the first or last service piece of the day', () => {
    const serviceWindows = buildShiftServiceWindowMap([
      makeShift('north-1', Zone.NORTH, 32, 60),
      makeShift('north-2', Zone.NORTH, 40, 68),
    ], {
      northChangeoffMinutes: 15,
      southChangeoffMinutes: 8,
    });

    expect(serviceWindows.get('north-1')).toEqual({
      serviceStartSlot: 32,
      serviceEndSlot: 60,
      startChangeoffSlots: 0,
      endChangeoffSlots: 0,
    });
    expect(serviceWindows.get('north-2')).toEqual({
      serviceStartSlot: 40,
      serviceEndSlot: 68,
      startChangeoffSlots: 0,
      endChangeoffSlots: 0,
    });
  });
});
