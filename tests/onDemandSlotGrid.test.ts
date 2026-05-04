import { describe, expect, it } from 'vitest';
import {
  createSlotGrid,
  formatSlotToTime,
  hoursToSlots,
  minutesToSlot,
  minutesToSlotsCeil,
  slotDurationToHours,
  slotToMinutes,
} from '../utils/demandConstants';

describe('on-demand slot grid helpers', () => {
  it('describes the current 15-minute grid from one shared source', () => {
    const grid = createSlotGrid(15);

    expect(grid.slotMinutes).toBe(15);
    expect(grid.slotsPerHour).toBe(4);
    expect(grid.timeSlotsPerDay).toBe(96);
    expect(grid.hoursToSlots(7.5)).toBe(30);
    expect(grid.minutesToSlotsCeil(35)).toBe(3);
    expect(grid.slotDurationToHours(3)).toBe(0.75);
  });

  it('can describe the future 5-minute grid without changing call sites', () => {
    const grid = createSlotGrid(5);

    expect(grid.slotMinutes).toBe(5);
    expect(grid.slotsPerHour).toBe(12);
    expect(grid.timeSlotsPerDay).toBe(288);
    expect(grid.hoursToSlots(7.5)).toBe(90);
    expect(grid.minutesToSlotsCeil(35)).toBe(7);
    expect(grid.slotDurationToHours(7)).toBeCloseTo(35 / 60);
  });

  it('uses the active 5-minute grid helpers for time conversion', () => {
    expect(slotToMinutes(12)).toBe(60);
    expect(minutesToSlot(75)).toBe(15);
    expect(formatSlotToTime(15)).toBe('01:15');
    expect(hoursToSlots(5)).toBe(60);
    expect(minutesToSlotsCeil(8)).toBe(2);
    expect(slotDurationToHours(9)).toBe(0.75);
  });
});
