import { describe, expect, it } from 'vitest';
import { validateOnDemandSchedule } from '../utils/onDemandValidation';
import { Zone, type Requirement, type Shift } from '../utils/demandTypes';

const makeRequirements = (): Requirement[] => (
  Array.from({ length: 96 }, (_, slotIndex) => ({
    slotIndex,
    north: 0,
    south: 0,
    floater: 0,
    total: 0,
  }))
);

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

describe('on-demand handoff validation', () => {
  it('accepts a reciprocal manual handoff between consecutive service pieces', () => {
    const validation = validateOnDemandSchedule([
      makeShift('north-1', Zone.NORTH, 20, 40, {
        handoffToShiftId: 'north-2',
      }),
      makeShift('north-2', Zone.NORTH, 41, 61, {
        handoffFromShiftId: 'north-1',
      }),
    ], makeRequirements());

    expect(validation.handoffViolations).toEqual([]);
  });

  it('flags a handoff that is missing its reciprocal link', () => {
    const validation = validateOnDemandSchedule([
      makeShift('north-1', Zone.NORTH, 20, 40, {
        handoffToShiftId: 'north-2',
      }),
      makeShift('north-2', Zone.NORTH, 41, 61),
    ], makeRequirements());

    expect(validation.handoffViolations).toContainEqual(
      expect.objectContaining({
        shiftId: 'north-1',
        kind: 'handoff_not_reciprocated',
        linkedShiftId: 'north-2',
      }),
    );
  });

  it('flags a handoff that points too far away in time', () => {
    const validation = validateOnDemandSchedule([
      makeShift('north-1', Zone.NORTH, 20, 40, {
        handoffToShiftId: 'north-2',
      }),
      makeShift('north-2', Zone.NORTH, 43, 63, {
        handoffFromShiftId: 'north-1',
      }),
    ], makeRequirements());

    expect(validation.handoffViolations).toContainEqual(
      expect.objectContaining({
        shiftId: 'north-1',
        kind: 'handoff_time_window',
        linkedShiftId: 'north-2',
      }),
    );
  });

  it('flags handoffs that involve floater shifts', () => {
    const validation = validateOnDemandSchedule([
      makeShift('floater-1', Zone.FLOATER, 20, 40, {
        handoffToShiftId: 'north-1',
      }),
      makeShift('north-1', Zone.NORTH, 40, 60, {
        handoffFromShiftId: 'floater-1',
      }),
    ], makeRequirements());

    expect(validation.handoffViolations).toContainEqual(
      expect.objectContaining({
        shiftId: 'floater-1',
        kind: 'handoff_non_service_shift',
      }),
    );
  });

  it('flags circular handoff chains', () => {
    const validation = validateOnDemandSchedule([
      makeShift('north-1', Zone.NORTH, 20, 40, {
        handoffFromShiftId: 'north-2',
        handoffToShiftId: 'north-2',
      }),
      makeShift('north-2', Zone.NORTH, 40, 60, {
        handoffFromShiftId: 'north-1',
        handoffToShiftId: 'north-1',
      }),
    ], makeRequirements());

    expect(validation.handoffViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shiftId: 'north-1',
          kind: 'handoff_cycle',
        }),
      ]),
    );
  });
});
