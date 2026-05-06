import { describe, expect, it } from 'vitest';
import {
  TIME_SLOTS_PER_DAY,
  hoursToSlots,
  minutesToSlot,
  minutesToSlotsCeil,
} from '../utils/demandConstants';
import { calculateSchedule } from '../utils/dataGenerator';
import { Zone, type Requirement, type Shift } from '../utils/demandTypes';
import { validateOnDemandSchedule } from '../utils/onDemandValidation';

function makeRequirements(overrides: Partial<Omit<Requirement, 'slotIndex'>> = {}): Requirement[] {
  return Array.from({ length: TIME_SLOTS_PER_DAY }, (_, slotIndex) => ({
    slotIndex,
    north: 2,
    south: 1,
    floater: 1,
    total: 4,
    ...overrides,
  }));
}

const slotAt = (hour: number, minute = 0): number => minutesToSlot((hour * 60) + minute);

const SLOT_13_00 = slotAt(13);
const SLOT_13_15 = slotAt(13, 15);
const SLOT_19_15 = slotAt(19, 15);

function makeShift(
  id: string,
  zone: Zone,
  breakStartSlot = 0,
  breakDurationSlots = 0,
  startSlot = 0,
  endSlot = TIME_SLOTS_PER_DAY,
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

    const slot = slots[SLOT_13_15];
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
    ], makeRequirements({
      north: 0,
      south: 4,
      floater: 1,
      total: 5,
    }));

    const slot = slots[SLOT_19_15];
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
      makeShift('floater-2', Zone.FLOATER, SLOT_13_15, minutesToSlotsCeil(45)),
    ], makeRequirements());

    expect(slots[SLOT_13_00].timeLabel).toBe('13:00');
    expect(slots[SLOT_13_00].floaterCoverage).toBe(2);
    expect(slots[SLOT_13_00].floaterEffectiveRequirement).toBe(2);
    expect(slots[SLOT_13_00].netDifference).toBe(0);

    expect(slots[SLOT_13_15].timeLabel).toBe('13:15');
    expect(slots[SLOT_13_15].floaterCoverage).toBe(1);
    expect(slots[SLOT_13_15].floaterBreaks).toBe(1);
    expect(slots[SLOT_13_15].totalEffectiveCoverage).toBe(3);
    expect(slots[SLOT_13_15].floaterEffectiveRequirement).toBe(2);
    expect(slots[SLOT_13_15].netDifference).toBe(-1);
  });

  it('does not apply changeoff time to pull-outs or pull-ins at the service edges', () => {
    const requirements = makeRequirements({
      north: 2,
      south: 1,
      floater: 0,
      total: 3,
    });

    const slots = calculateSchedule([
      makeShift('north-1', Zone.NORTH, 0, 0, slotAt(5), slotAt(15)),
      makeShift('south-1', Zone.SOUTH, 0, 0, slotAt(5, 15), slotAt(17, 30)),
      makeShift('north-2', Zone.NORTH, 0, 0, slotAt(6), slotAt(20)),
    ], requirements, {
      northChangeoffMinutes: 10,
      southChangeoffMinutes: 8,
    });

    expect(slots[slotAt(5)].northChangeoffs).toBe(0);
    expect(slots[slotAt(5, 15)].southChangeoffs).toBe(0);
    expect(slots[slotAt(6)].northChangeoffs).toBe(0);
    expect(slots[slotAt(14, 55)].northChangeoffs).toBe(0);
    expect(slots[slotAt(17, 25)].southChangeoffs).toBe(0);
    expect(slots[slotAt(19, 55)].northChangeoffs).toBe(0);
  });

  it('does not apply changeoff time to the first or last service piece of the day', () => {
    const requirements = makeRequirements({
      north: 1,
      south: 1,
      floater: 0,
      total: 2,
    });

    const startSlot = slotAt(8);
    const endSlot = slotAt(10);
    const slots = calculateSchedule([
      makeShift('north-1', Zone.NORTH, 0, 0, startSlot, endSlot),
      makeShift('south-1', Zone.SOUTH, 0, 0, startSlot, endSlot),
    ], requirements, {
      northChangeoffMinutes: 10,
      southChangeoffMinutes: 8,
    });

    expect(slots[startSlot].northCoverage).toBe(1);
    expect(slots[startSlot].southCoverage).toBe(1);
    expect(slots[startSlot].northChangeoffs).toBe(0);
    expect(slots[startSlot].southChangeoffs).toBe(0);
    expect(slots[startSlot].driversInChangeoff).toBe(0);
    expect(slots[startSlot].totalActiveCoverage).toBe(2);
    expect(slots[startSlot + 1].totalActiveCoverage).toBe(2);
    expect(slots[endSlot - 1].driversInChangeoff).toBe(0);
    expect(slots[endSlot - 1].totalActiveCoverage).toBe(2);
  });

  it('applies changeoff time to an internal cross-zone handoff', () => {
    const requirements = makeRequirements({
      north: 1,
      south: 1,
      floater: 0,
      total: 2,
    });

    const firstStart = slotAt(8);
    const firstEnd = slotAt(10);
    const secondEnd = slotAt(12);
    const thirdEnd = slotAt(14);
    const slots = calculateSchedule([
      makeShift('north-1', Zone.NORTH, 0, 0, firstStart, firstEnd),
      makeShift('south-1', Zone.SOUTH, 0, 0, firstEnd, secondEnd),
      makeShift('north-2', Zone.NORTH, 0, 0, secondEnd, thirdEnd),
    ], requirements, {
      northChangeoffMinutes: 10,
      southChangeoffMinutes: 8,
    });

    expect(slots[firstStart].northChangeoffs).toBe(0);
    expect(slots[firstEnd - 2].northChangeoffs).toBe(1);
    expect(slots[firstEnd].southChangeoffs).toBe(1);
    expect(slots[secondEnd - 2].southChangeoffs).toBe(1);
    expect(slots[secondEnd].northChangeoffs).toBe(1);
    expect(slots[thirdEnd - 1].northChangeoffs).toBe(0);
  });

  it('applies changeoff time to a valid manual handoff that is one planning slot apart', () => {
    const requirements = makeRequirements({
      north: 1,
      south: 0,
      floater: 0,
      total: 1,
    });

    const firstStart = slotAt(8);
    const firstEnd = slotAt(10);
    const secondStart = firstEnd + 1;
    const secondEnd = secondStart + hoursToSlots(2);
    const slots = calculateSchedule([
      {
        ...makeShift('north-1', Zone.NORTH, 0, 0, firstStart, firstEnd),
        handoffToShiftId: 'north-2',
      },
      {
        ...makeShift('north-2', Zone.NORTH, 0, 0, secondStart, secondEnd),
        handoffFromShiftId: 'north-1',
      },
    ], requirements, {
      northChangeoffMinutes: 10,
      southChangeoffMinutes: 8,
    });

    expect(slots[firstEnd - 2].northChangeoffs).toBe(1);
    expect(slots[firstEnd].northChangeoffs).toBe(0);
    expect(slots[secondStart].northChangeoffs).toBe(1);
    expect(slots[secondStart + 2].northCoverage).toBe(1);
  });

  it('applies changeoff time only between internal service shifts', () => {
    const requirements = makeRequirements({
      north: 1,
      south: 0,
      floater: 0,
      total: 1,
    });

    const firstStart = slotAt(8);
    const handoffSlot = slotAt(10);
    const secondEnd = slotAt(12);
    const slots = calculateSchedule([
      makeShift('north-1', Zone.NORTH, 0, 0, firstStart, handoffSlot),
      makeShift('north-2', Zone.NORTH, 0, 0, handoffSlot, secondEnd),
    ], requirements, {
      northChangeoffMinutes: 10,
      southChangeoffMinutes: 8,
    });

    expect(slots[firstStart].northCoverage).toBe(1);
    expect(slots[firstStart].northChangeoffs).toBe(0);
    expect(slots[handoffSlot - 1].northCoverage).toBe(0);
    expect(slots[handoffSlot - 1].northChangeoffs).toBe(1);
    expect(slots[handoffSlot].northCoverage).toBe(0);
    expect(slots[handoffSlot].northChangeoffs).toBe(1);
    expect(slots[handoffSlot + 2].northCoverage).toBe(1);
    expect(slots[secondEnd - 1].northCoverage).toBe(1);
    expect(slots[secondEnd - 1].northChangeoffs).toBe(0);
  });

  it('does not treat a new peak add-in as a changeoff without a matching ending shift', () => {
    const requirements = makeRequirements({
      north: 2,
      south: 0,
      floater: 0,
      total: 2,
    });

    const firstStart = slotAt(8);
    const secondStart = slotAt(10);
    const firstEnd = slotAt(15);
    const secondEnd = slotAt(17);
    const slots = calculateSchedule([
      makeShift('north-1', Zone.NORTH, 0, 0, firstStart, firstEnd),
      makeShift('north-2', Zone.NORTH, 0, 0, secondStart, secondEnd),
    ], requirements, {
      northChangeoffMinutes: 10,
      southChangeoffMinutes: 8,
    });

    expect(slots[secondStart].northChangeoffs).toBe(0);
    expect(slots[firstEnd - 1].northChangeoffs).toBe(0);
  });

  it('ignores placeholder shifts in coverage and validation', () => {
    const placeholder = {
      ...makeShift('new-driver', Zone.NORTH, 0, 0, slotAt(8), slotAt(16)),
      isPlaceholder: true,
    };

    const slots = calculateSchedule([placeholder], makeRequirements({
      north: 1,
      south: 0,
      floater: 0,
      total: 1,
    }));
    const validation = validateOnDemandSchedule([placeholder], makeRequirements());

    expect(slots[slotAt(10)].northCoverage).toBe(0);
    expect(slots[slotAt(10)].totalActiveCoverage).toBe(0);
    expect(validation.shiftRuleViolations).toEqual([]);
    expect(validation.handoffViolations).toEqual([]);
  });

  it('flags a break as removing a bus from service when it is not covered', () => {
    const shifts = [
      makeShift('bus-1', Zone.FLOATER),
      makeShift('bus-2', Zone.FLOATER),
      makeShift('bus-3', Zone.FLOATER),
      makeShift('bus-4', Zone.FLOATER),
      makeShift('bus-5', Zone.FLOATER),
      makeShift('bus-6', Zone.FLOATER, SLOT_13_15, minutesToSlotsCeil(45)),
    ];
    const requirements = makeRequirements({
      north: 0,
      south: 0,
      floater: 6,
      total: 6,
    });

    const slots = calculateSchedule(shifts, requirements);
    const validation = validateOnDemandSchedule(shifts, requirements);

    expect(slots[SLOT_13_15].totalActiveCoverage).toBe(5);
    expect(slots[SLOT_13_15].driversOnBreak).toBe(1);
    expect(validation.breakCoverageViolations).toContainEqual(
      expect.objectContaining({
        slotIndex: SLOT_13_15,
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
      makeShift('bus-6', Zone.FLOATER, SLOT_13_15, minutesToSlotsCeil(45)),
      makeShift('cover-bus', Zone.FLOATER, 0, 0, SLOT_13_15, SLOT_13_15 + minutesToSlotsCeil(45)),
    ];
    const requirements = makeRequirements({
      north: 0,
      south: 0,
      floater: 6,
      total: 6,
    });

    const slots = calculateSchedule(shifts, requirements);
    const validation = validateOnDemandSchedule(shifts, requirements);

    expect(slots[SLOT_13_15].totalActiveCoverage).toBe(6);
    expect(slots[SLOT_13_15].driversOnBreak).toBe(1);
    expect(validation.maxActiveVehicles).toBe(6);
    expect(validation.maxOverlappingShifts).toBe(7);
    expect(validation.fleetViolations).toHaveLength(0);
    expect(validation.breakCoverageViolations).toHaveLength(0);
  });

  it('flags a system short when another zone surplus masks an uncovered break', () => {
    const shifts = [
      makeShift('north-1', Zone.NORTH),
      makeShift('north-2', Zone.NORTH, SLOT_13_15, minutesToSlotsCeil(45)),
      makeShift('south-1', Zone.SOUTH),
      makeShift('south-2', Zone.SOUTH),
    ];
    const requirements = makeRequirements({
      north: 2,
      south: 1,
      floater: 0,
      total: 3,
    });

    const slots = calculateSchedule(shifts, requirements);
    const validation = validateOnDemandSchedule(shifts, requirements);

    expect(slots[SLOT_13_15].timeLabel).toBe('13:15');
    expect(slots[SLOT_13_15].totalActiveCoverage).toBe(3);
    expect(slots[SLOT_13_15].totalEffectiveCoverage).toBe(2);
    expect(slots[SLOT_13_15].totalOverlappingShifts).toBe(4);
    expect(slots[SLOT_13_15].driversOnBreak).toBe(1);
    expect(slots[SLOT_13_15].netDifference).toBe(-1);
    expect(validation.coverageViolations).toContainEqual(
      expect.objectContaining({
        slotIndex: SLOT_13_15,
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
        slotIndex: SLOT_13_15,
        timeLabel: '13:15',
        shortfall: 1,
      }),
    );
  });

  it('flags a shift that exceeds the 11-hour hard guardrail', () => {
    const shifts = [
      makeShift('long-shift', Zone.FLOATER, hoursToSlots(5), minutesToSlotsCeil(45), 0, hoursToSlots(11) + 1),
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
