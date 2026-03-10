import { describe, expect, it } from 'vitest';
import { Zone, type Shift } from '../utils/demandTypes';
import {
  createScopedShiftId,
  filterShiftsByDay,
  normalizeOnDemandShifts,
  removeShiftFromDay,
  updateShiftInDay,
} from '../utils/onDemandShiftUtils';

function makeShift(id: string, dayType: Shift['dayType']): Shift {
  return {
    id,
    driverName: 'Driver 1',
    zone: Zone.NORTH,
    startSlot: 32,
    endSlot: 64,
    breakStartSlot: 52,
    breakDurationSlots: 3,
    dayType,
  };
}

describe('onDemandShiftUtils', () => {
  it('scopes shift ids by day type', () => {
    expect(createScopedShiftId('Saturday', 'shift-1')).toBe('Saturday::shift-1');
    expect(createScopedShiftId('Sunday', 'Weekday::shift-1')).toBe('Sunday::shift-1');
  });

  it('normalizes duplicate ids across days into unique scoped ids', () => {
    const normalized = normalizeOnDemandShifts([
      makeShift('shared', 'Saturday'),
      makeShift('shared', 'Sunday'),
      makeShift('shared', 'Sunday'),
    ]);

    expect(normalized.map(shift => shift.id)).toEqual([
      'Saturday::shared',
      'Sunday::shared',
      'Sunday::shared-1',
    ]);
  });

  it('filters, removes, and updates within the selected day only', () => {
    const shifts = normalizeOnDemandShifts([
      makeShift('shared', 'Saturday'),
      makeShift('shared', 'Sunday'),
    ]);

    expect(filterShiftsByDay(shifts, 'Saturday')).toHaveLength(1);
    expect(filterShiftsByDay(shifts, 'Sunday')).toHaveLength(1);

    const saturdayOnly = removeShiftFromDay(shifts, 'Saturday::shared', 'Saturday');
    expect(saturdayOnly.map(shift => shift.id)).toEqual(['Sunday::shared']);

    const updated = updateShiftInDay(shifts, {
      ...shifts[0],
      driverName: 'Updated Saturday Driver',
    }, 'Saturday');

    expect(updated[0].driverName).toBe('Updated Saturday Driver');
    expect(updated[1].driverName).toBe('Driver 1');
  });
});
