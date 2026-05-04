import { describe, expect, it } from 'vitest';
import { Zone, type Requirement, type Shift } from '../utils/demandTypes';
import {
  convertOnDemandScheduleGrid,
  expandRequirementsToGrid,
} from '../utils/onDemandGridMigration';

const makeLegacyRequirements = (): Requirement[] => [
  { slotIndex: 0, north: 1, south: 0, floater: 0, total: 1 },
  { slotIndex: 1, north: 0, south: 2, floater: 1, total: 3 },
];

const makeLegacyShift = (): Shift => ({
  id: 'Saturday::shift-1',
  driverName: 'Driver 1',
  zone: Zone.SOUTH,
  startSlot: 4,
  endSlot: 12,
  breakStartSlot: 8,
  breakDurationSlots: 3,
  dayType: 'Saturday',
  handoffToShiftId: 'Saturday::shift-2',
});

describe('on-demand grid migration', () => {
  it('expands 15-minute requirements into equivalent 5-minute requirements', () => {
    const converted = expandRequirementsToGrid(makeLegacyRequirements(), 15, 5);

    expect(converted).toHaveLength(6);
    expect(converted.slice(0, 3)).toEqual([
      { slotIndex: 0, north: 1, south: 0, floater: 0, total: 1 },
      { slotIndex: 1, north: 1, south: 0, floater: 0, total: 1 },
      { slotIndex: 2, north: 1, south: 0, floater: 0, total: 1 },
    ]);
    expect(converted.slice(3, 6)).toEqual([
      { slotIndex: 3, north: 0, south: 2, floater: 1, total: 3 },
      { slotIndex: 4, north: 0, south: 2, floater: 1, total: 3 },
      { slotIndex: 5, north: 0, south: 2, floater: 1, total: 3 },
    ]);
  });

  it('converts legacy shift slots to the 5-minute grid without changing IDs or day tags', () => {
    const converted = convertOnDemandScheduleGrid({
      slotGranularityMinutes: 15,
      masterScheduleData: makeLegacyRequirements(),
      schedulesData: {
        Saturday: makeLegacyRequirements(),
      },
      shiftData: [makeLegacyShift()],
    }, 5);

    expect(converted.slotGranularityMinutes).toBe(5);
    expect(converted.masterScheduleData).toHaveLength(6);
    expect(converted.schedulesData?.Saturday).toHaveLength(6);
    expect(converted.shiftData?.[0]).toEqual({
      ...makeLegacyShift(),
      startSlot: 12,
      endSlot: 36,
      breakStartSlot: 24,
      breakDurationSlots: 9,
    });
  });

  it('infers missing legacy metadata from 96-slot requirement sets', () => {
    const legacyDay = Array.from({ length: 96 }, (_, slotIndex): Requirement => ({
      slotIndex,
      north: 1,
      south: 1,
      floater: 0,
      total: 2,
    }));

    const converted = convertOnDemandScheduleGrid({
      masterScheduleData: [],
      schedulesData: {
        Saturday: legacyDay,
      },
      shiftData: [makeLegacyShift()],
    }, 5);

    expect(converted.slotGranularityMinutes).toBe(5);
    expect(converted.schedulesData?.Saturday).toHaveLength(288);
    expect(converted.shiftData?.[0]).toMatchObject({
      startSlot: 12,
      endSlot: 36,
      breakStartSlot: 24,
      breakDurationSlots: 9,
    });
  });
});
