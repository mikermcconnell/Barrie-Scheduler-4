// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateMetrics, calculateSchedule } from '../utils/dataGenerator';
import { parseRideCo, parseScheduleMaster } from '../utils/parsers/csvParsers';
import {
  DEFAULT_NORTH_CHANGEOFF_MINUTES,
  DEFAULT_SOUTH_CHANGEOFF_MINUTES,
} from '../utils/onDemandOptimizationSettings';
import { validateOnDemandShiftRules } from '../utils/onDemandShiftRules';

const fixturePath = (name: string): string =>
  path.resolve(process.cwd(), 'demo', 'fixtures', name);

describe('Transit On-Demand demo fixtures', () => {
  it('creates one fixable 20-minute South changeoff gap', () => {
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

    const changeoffSettings = {
      northChangeoffMinutes: DEFAULT_NORTH_CHANGEOFF_MINUTES,
      southChangeoffMinutes: DEFAULT_SOUTH_CHANGEOFF_MINUTES,
    };
    const originalSchedule = calculateSchedule(
      shifts,
      master.Weekday,
      changeoffSettings,
    );
    const southGapSlots = originalSchedule.filter(slot =>
      slot.timestamp >= 11 * 60 + 5
      && slot.timestamp < 11 * 60 + 25
      && slot.southCoverage < slot.southRequirement
    );
    const originalMetrics = calculateMetrics(originalSchedule, shifts);

    expect(validateOnDemandShiftRules(shifts)).toEqual([]);
    expect(southGapSlots).toHaveLength(4);
    expect(originalMetrics.coveragePercent).toBeLessThan(100);

    const adjustedShifts = shifts.map(shift =>
      shift.driverName === 'South Shift 2'
        ? { ...shift, startSlot: shift.startSlot - 6, endSlot: shift.endSlot - 6 }
        : shift
    );
    const adjustedSchedule = calculateSchedule(
      adjustedShifts,
      master.Weekday,
      changeoffSettings,
    );
    const adjustedMetrics = calculateMetrics(adjustedSchedule, adjustedShifts);

    expect(validateOnDemandShiftRules(adjustedShifts)).toEqual([]);
    expect(adjustedSchedule.every(slot =>
      slot.southCoverage >= slot.southRequirement
    )).toBe(true);
    expect(adjustedMetrics.coveragePercent).toBe(100);
  });
});
