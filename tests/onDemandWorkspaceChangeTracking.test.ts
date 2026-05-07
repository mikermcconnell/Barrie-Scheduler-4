import { describe, expect, it } from 'vitest';
import type { Requirement, Shift } from '../utils/demandTypes';
import { Zone } from '../utils/demandTypes';
import {
  buildOnDemandWorkspaceSignature,
  summarizeOnDemandShiftDiff,
} from '../utils/onDemandWorkspaceChangeTracking';

const requirements: Requirement[] = [
  { slotIndex: 0, north: 1, south: 0, floater: 0, total: 1 },
  { slotIndex: 1, north: 0, south: 1, floater: 0, total: 1 },
];

const settings = {
  maxFleetVehicles: 6,
  shiftCountCaps: { Weekday: 12, Saturday: 8, Sunday: 6 },
  targetCoveragePercent: 100,
  breakDurationMinutes: 30,
  northChangeoffMinutes: 10,
  southChangeoffMinutes: 10,
  shiftCountCapMode: 'hard' as const,
  minorGapTolerance: 'rare' as const,
  breakProtection: 'strict' as const,
  costPriority: 'balanced' as const,
};

function makeShift(id: string, overrides: Partial<Shift> = {}): Shift {
  return {
    id,
    driverName: id,
    zone: Zone.NORTH,
    startSlot: 0,
    endSlot: 8,
    breakStartSlot: 0,
    breakDurationSlots: 0,
    dayType: 'Weekday',
    ...overrides,
  };
}

describe('onDemandWorkspaceChangeTracking', () => {
  it('changes the workspace signature when saved shift details change', () => {
    const baseline = buildOnDemandWorkspaceSignature({
      draftName: 'Draft',
      selectedDayType: 'Weekday',
      requirements,
      allShifts: [makeShift('shift-1')],
      schedules: null,
      optimizationSettings: settings,
    });

    const changed = buildOnDemandWorkspaceSignature({
      draftName: 'Draft',
      selectedDayType: 'Weekday',
      requirements,
      allShifts: [makeShift('shift-1', { endSlot: 10 })],
      schedules: null,
      optimizationSettings: settings,
    });

    expect(changed).not.toBe(baseline);
  });

  it('keeps the workspace signature stable when shifts are only reordered', () => {
    const first = buildOnDemandWorkspaceSignature({
      draftName: 'Draft',
      selectedDayType: 'Weekday',
      requirements,
      allShifts: [makeShift('shift-2'), makeShift('shift-1')],
      schedules: null,
      optimizationSettings: settings,
    });

    const second = buildOnDemandWorkspaceSignature({
      draftName: 'Draft',
      selectedDayType: 'Weekday',
      requirements,
      allShifts: [makeShift('shift-1'), makeShift('shift-2')],
      schedules: null,
      optimizationSettings: settings,
    });

    expect(second).toBe(first);
  });

  it('summarizes added, removed, and changed refinement shifts', () => {
    const summary = summarizeOnDemandShiftDiff(
      [
        makeShift('kept'),
        makeShift('changed', { startSlot: 0 }),
        makeShift('removed'),
      ],
      [
        makeShift('kept'),
        makeShift('changed', { startSlot: 2 }),
        makeShift('added'),
      ],
    );

    expect(summary).toEqual({
      added: 1,
      removed: 1,
      modified: 1,
      unchanged: 1,
      totalChanges: 3,
    });
  });
});
