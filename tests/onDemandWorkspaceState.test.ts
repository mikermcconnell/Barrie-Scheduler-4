import { describe, expect, it } from 'vitest';
import type { Requirement, Shift } from '../utils/demandTypes';
import { Zone } from '../utils/demandTypes';
import {
  normalizeRideCoImport,
  resolveOnDemandScheduleState,
  summarizeOnDemandValidation,
} from '../utils/onDemandWorkspaceState';

function makeRequirements(label = 1): Requirement[] {
  return Array.from({ length: 96 }, (_, slotIndex) => ({
    slotIndex,
    north: label,
    south: 0,
    floater: 0,
    total: label,
  }));
}

function makeShift(id: string, overrides: Partial<Shift> = {}): Shift {
  return {
    id,
    driverName: id,
    zone: Zone.FLOATER,
    startSlot: 0,
    endSlot: 96,
    breakStartSlot: 0,
    breakDurationSlots: 0,
    ...overrides,
  };
}

describe('onDemandWorkspaceState', () => {
  it('applies the selected day fallback to imported RideCo shifts without day tags', () => {
    const shifts = normalizeRideCoImport([makeShift('shift-1')], 'Saturday');

    expect(shifts).toHaveLength(1);
    expect(shifts[0].dayType).toBe('Saturday');
    expect(shifts[0].id.startsWith('Saturday::')).toBe(true);
  });

  it('clears stale shifts when a saved schedule has no shift data', () => {
    const state = resolveOnDemandScheduleState({
      masterScheduleData: makeRequirements(2),
      schedulesData: {
        Weekday: makeRequirements(1),
        Saturday: makeRequirements(2),
      },
      shiftData: [],
    }, 'Saturday');

    expect(state.selectedDayType).toBe('Saturday');
    expect(state.requirements[0].total).toBe(2);
    expect(state.allShifts).toEqual([]);
    expect(state.shifts).toEqual([]);
  });

  it('keeps only the selected day visible after loading multi-day schedules', () => {
    const state = resolveOnDemandScheduleState({
      masterScheduleData: makeRequirements(1),
      schedulesData: {
        Weekday: makeRequirements(1),
        Saturday: makeRequirements(3),
      },
      shiftData: [
        makeShift('weekday-1', { dayType: 'Weekday' }),
        makeShift('saturday-1', { dayType: 'Saturday' }),
      ],
    }, 'Saturday');

    expect(state.selectedDayType).toBe('Saturday');
    expect(state.shifts).toHaveLength(1);
    expect(state.shifts[0].dayType).toBe('Saturday');
  });

  it('preserves saved optimization settings when loading a schedule', () => {
    const state = resolveOnDemandScheduleState({
      masterScheduleData: makeRequirements(1),
      shiftData: [makeShift('weekday-1', { dayType: 'Weekday' })],
      optimizationSettings: {
        maxFleetVehicles: 7,
        shiftCountCaps: {
          Weekday: 14,
          Saturday: 10,
          Sunday: 8,
        },
        targetCoveragePercent: 98,
        breakDurationMinutes: 60,
        northChangeoffMinutes: 12,
        southChangeoffMinutes: 9,
        shiftCountCapMode: 'guide',
        minorGapTolerance: 'none',
        breakProtection: 'balanced',
        costPriority: 'efficiency',
      },
    }, 'Weekday');

    expect(state.optimizationSettings).toEqual({
      maxFleetVehicles: 7,
      shiftCountCaps: {
        Weekday: 14,
        Saturday: 10,
        Sunday: 8,
      },
      targetCoveragePercent: 98,
      breakDurationMinutes: 60,
      northChangeoffMinutes: 12,
      southChangeoffMinutes: 9,
      shiftCountCapMode: 'guide',
      minorGapTolerance: 'none',
      breakProtection: 'balanced',
      costPriority: 'efficiency',
    });
  });

  it('summarizes blocking validation issues for export guards', () => {
    const summary = summarizeOnDemandValidation({
      maxActiveVehicles: 7,
      maxOverlappingShifts: 8,
      coverageViolations: [{
        slotIndex: 1,
        timeLabel: '00:15',
        requirement: 1,
        activeCoverage: 0,
        overlappingShifts: 0,
        driversOnBreak: 0,
        shortfall: 1,
      }],
      fleetViolations: [{
        slotIndex: 2,
        timeLabel: '00:30',
        requirement: 1,
        activeCoverage: 2,
        overlappingShifts: 2,
        driversOnBreak: 0,
        shortfall: 0,
      }],
      breakCoverageViolations: [],
      shiftRuleViolations: [{
        shiftId: 'shift-1',
        driverName: 'Driver 1',
        kind: 'duration_too_long',
        message: 'Driver 1 exceeds the 11-hour maximum.',
      }],
      handoffViolations: [{
        shiftId: 'shift-2',
        driverName: 'Driver 2',
        kind: 'handoff_not_reciprocated',
        message: 'This handoff is missing the matching return link on the paired shift.',
        linkedShiftId: 'shift-3',
      }],
    });

    expect(summary.isValid).toBe(false);
    expect(summary.blockingIssueCount).toBe(4);
    expect(summary.message).toContain('coverage gap');
    expect(summary.message).toContain('fleet cap breach');
    expect(summary.message).toContain('shift rule violation');
    expect(summary.message).toContain('handoff issue');
  });
});
