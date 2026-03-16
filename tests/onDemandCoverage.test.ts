import { describe, expect, it } from 'vitest';
import { calculateSchedule } from '../utils/dataGenerator';
import { Zone, type Requirement, type Shift } from '../utils/demandTypes';
import { validateOnDemandSchedule } from '../utils/onDemandValidation';

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
  startSlot = 0,
  endSlot = 96,
): Shift {
  return {
    id,
    driverName: id,
    zone,
    startSlot,
    endSlot,
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
    expect(slot.floaterAssignedRelief).toBe(1);
    expect(slot.floaterAvailableCoverage).toBe(1);
    expect(slot.netDifference).toBe(0);
  });

  it('removes relief-assigned floaters from floater availability', () => {
    const slots = calculateSchedule([
      makeShift('south-1', Zone.SOUTH),
      makeShift('south-2', Zone.SOUTH),
      makeShift('south-3', Zone.SOUTH),
      makeShift('floater-1', Zone.FLOATER),
      makeShift('floater-2', Zone.FLOATER),
    ], Array.from({ length: 96 }, (_, slotIndex): Requirement => ({
      slotIndex,
      north: 0,
      south: 4,
      floater: 1,
      total: 5,
    })));

    const slot = slots[77];
    expect(slot.timeLabel).toBe('19:15');
    expect(slot.southCoverage).toBe(3);
    expect(slot.floaterCoverage).toBe(2);
    expect(slot.southRelief).toBe(1);
    expect(slot.floaterAssignedRelief).toBe(1);
    expect(slot.floaterAvailableCoverage).toBe(1);
    expect(slot.floaterEffectiveCoverage).toBe(1);
    expect(slot.totalEffectiveCoverage).toBe(5);
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
    expect(slots[53].totalEffectiveCoverage).toBe(3);
    expect(slots[53].floaterEffectiveRequirement).toBe(2);
    expect(slots[53].netDifference).toBe(-1);
  });

  it('flags a break as removing a bus from service when it is not covered', () => {
    const shifts = [
      makeShift('bus-1', Zone.FLOATER),
      makeShift('bus-2', Zone.FLOATER),
      makeShift('bus-3', Zone.FLOATER),
      makeShift('bus-4', Zone.FLOATER),
      makeShift('bus-5', Zone.FLOATER),
      makeShift('bus-6', Zone.FLOATER, 53, 3),
    ];
    const requirements = Array.from({ length: 96 }, (_, slotIndex): Requirement => ({
      slotIndex,
      north: 0,
      south: 0,
      floater: 6,
      total: 6,
    }));

    const slots = calculateSchedule(shifts, requirements);
    const validation = validateOnDemandSchedule(shifts, requirements);

    expect(slots[53].totalActiveCoverage).toBe(5);
    expect(slots[53].driversOnBreak).toBe(1);
    expect(validation.breakCoverageViolations).toContainEqual(
      expect.objectContaining({
        slotIndex: 53,
        timeLabel: '13:15',
        requirement: 6,
        activeCoverage: 5,
        overlappingShifts: 6,
        driversOnBreak: 1,
        shortfall: 1,
      }),
    );
  });

  it('allows an extra overlapping cover shift while keeping only six buses active', () => {
    const shifts = [
      makeShift('bus-1', Zone.FLOATER),
      makeShift('bus-2', Zone.FLOATER),
      makeShift('bus-3', Zone.FLOATER),
      makeShift('bus-4', Zone.FLOATER),
      makeShift('bus-5', Zone.FLOATER),
      makeShift('bus-6', Zone.FLOATER, 53, 3),
      makeShift('cover-bus', Zone.FLOATER, 0, 0, 53, 56),
    ];
    const requirements = Array.from({ length: 96 }, (_, slotIndex): Requirement => ({
      slotIndex,
      north: 0,
      south: 0,
      floater: 6,
      total: 6,
    }));

    const slots = calculateSchedule(shifts, requirements);
    const validation = validateOnDemandSchedule(shifts, requirements);

    expect(slots[53].totalActiveCoverage).toBe(6);
    expect(slots[53].driversOnBreak).toBe(1);
    expect(validation.maxActiveVehicles).toBe(6);
    expect(validation.maxOverlappingShifts).toBe(7);
    expect(validation.fleetViolations).toHaveLength(0);
    expect(validation.breakCoverageViolations).toHaveLength(0);
  });

  it('flags a system short when another zone surplus masks an uncovered break', () => {
    const shifts = [
      makeShift('north-1', Zone.NORTH),
      makeShift('north-2', Zone.NORTH, 53, 3),
      makeShift('south-1', Zone.SOUTH),
      makeShift('south-2', Zone.SOUTH),
    ];
    const requirements = Array.from({ length: 96 }, (_, slotIndex): Requirement => ({
      slotIndex,
      north: 2,
      south: 1,
      floater: 0,
      total: 3,
    }));

    const slots = calculateSchedule(shifts, requirements);
    const validation = validateOnDemandSchedule(shifts, requirements);

    expect(slots[53].timeLabel).toBe('13:15');
    expect(slots[53].totalActiveCoverage).toBe(3);
    expect(slots[53].totalEffectiveCoverage).toBe(2);
    expect(slots[53].totalOverlappingShifts).toBe(4);
    expect(slots[53].driversOnBreak).toBe(1);
    expect(slots[53].netDifference).toBe(-1);
    expect(validation.coverageViolations).toContainEqual(
      expect.objectContaining({
        slotIndex: 53,
        timeLabel: '13:15',
        requirement: 3,
        activeCoverage: 3,
        overlappingShifts: 4,
        driversOnBreak: 1,
        shortfall: 1,
      }),
    );
    expect(validation.breakCoverageViolations).toContainEqual(
      expect.objectContaining({
        slotIndex: 53,
        timeLabel: '13:15',
        shortfall: 1,
      }),
    );
  });

  it('flags a shift that exceeds the 11-hour hard guardrail', () => {
    const shifts = [
      makeShift('long-shift', Zone.FLOATER, 24, 3, 0, 47),
    ];

    const validation = validateOnDemandSchedule(shifts, makeRequirements());

    expect(validation.shiftRuleViolations).toContainEqual(
      expect.objectContaining({
        shiftId: 'long-shift',
        kind: 'duration_too_long',
      }),
    );
  });
});
