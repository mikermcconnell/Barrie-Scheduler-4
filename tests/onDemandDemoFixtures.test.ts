// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateMetrics, calculateSchedule } from '../utils/dataGenerator';
import { parseRideCo, parseScheduleMaster } from '../utils/parsers/csvParsers';

const fixturePath = (name: string): string =>
  path.resolve(process.cwd(), 'demo', 'fixtures', name);

describe('Transit On-Demand demo fixtures', () => {
  it('creates one fixable 30-minute South coverage gap', () => {
    const master = parseScheduleMaster(
      fs.readFileSync(fixturePath('Barrie_TOD_Demo_Schedule_Master.csv'), 'utf8'),
    );
    const shifts = parseRideCo(
      fs.readFileSync(fixturePath('Barrie_TOD_Demo_Contractor_Shifts.csv'), 'utf8'),
    );

    expect(master.Weekday).toBeDefined();
    expect(shifts).toHaveLength(4);
    expect(shifts.map(shift => shift.driverName)).toEqual([
      'North Shift 1',
      'North Shift 2',
      'South Shift 1',
      'South Shift 2',
    ]);

    const originalSchedule = calculateSchedule(shifts, master.Weekday);
    const southGapSlots = originalSchedule.filter(slot =>
      slot.timestamp >= 11 * 60 + 15
      && slot.timestamp < 11 * 60 + 45
      && slot.southCoverage < slot.southRequirement
    );
    const originalMetrics = calculateMetrics(originalSchedule, shifts);

    expect(southGapSlots).toHaveLength(6);
    expect(originalMetrics.coveragePercent).toBeLessThan(100);

    const adjustedShifts = shifts.map(shift =>
      shift.driverName === 'South Shift 1'
        ? { ...shift, endSlot: shift.endSlot + 6 }
        : shift
    );
    const adjustedSchedule = calculateSchedule(adjustedShifts, master.Weekday);
    const adjustedMetrics = calculateMetrics(adjustedSchedule, adjustedShifts);

    expect(adjustedSchedule.every(slot =>
      slot.southCoverage >= slot.southRequirement
    )).toBe(true);
    expect(adjustedMetrics.coveragePercent).toBe(100);
  });
});
