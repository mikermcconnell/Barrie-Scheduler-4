import { describe, expect, it } from 'vitest';
import { buildGapChartDisplayData } from '../components/GapChart';
import type { TimeSlot } from '../utils/demandTypes';

function makeSlot(timestamp: number, overrides: Partial<TimeSlot> = {}): TimeSlot {
  return {
    timeLabel: `${Math.floor(timestamp / 60).toString().padStart(2, '0')}:${(timestamp % 60).toString().padStart(2, '0')}`,
    timestamp,
    northRequirement: 0,
    southRequirement: 0,
    floaterRequirement: 0,
    floaterEffectiveRequirement: 0,
    floaterEffectiveCoverage: 0,
    totalRequirement: 0,
    northCoverage: 0,
    southCoverage: 0,
    floaterCoverage: 0,
    driversOnBreak: 0,
    northBreaks: 0,
    southBreaks: 0,
    floaterBreaks: 0,
    driversInChangeoff: 0,
    northChangeoffs: 0,
    southChangeoffs: 0,
    floaterChangeoffs: 0,
    totalActiveCoverage: 0,
    totalEffectiveCoverage: 0,
    totalOverlappingShifts: 0,
    northRelief: 0,
    southRelief: 0,
    floaterAssignedRelief: 0,
    floaterAvailableCoverage: 0,
    netDifference: 0,
    ...overrides,
  };
}

describe('buildGapChartDisplayData', () => {
  it('adds a trailing zero point after the last active slot', () => {
    const data = [
      makeSlot(300, { totalRequirement: 2, totalActiveCoverage: 2 }),
      makeSlot(315, { totalRequirement: 2, totalActiveCoverage: 2 }),
      makeSlot(330, { totalRequirement: 1, totalActiveCoverage: 1 }),
    ];

    const displayData = buildGapChartDisplayData(data, 'All');

    expect(displayData).toHaveLength(4);
    expect(displayData[3].timestamp).toBe(345);
    expect(displayData[3].timeLabel).toBe('05:45');
    expect(displayData[3].totalRequirement).toBe(0);
    expect(displayData[3].totalActiveCoverage).toBe(0);
  });

  it('trims earlier empty slots but keeps a zero tail for the active zone', () => {
    const data = [
      makeSlot(240),
      makeSlot(300, { northRequirement: 1, northCoverage: 1 }),
      makeSlot(315, { northRequirement: 1, northCoverage: 1 }),
      makeSlot(330),
    ];

    const displayData = buildGapChartDisplayData(data, 'North');

    expect(displayData[0].timestamp).toBe(300);
    expect(displayData[displayData.length - 1].timestamp).toBe(330);
    expect(displayData[displayData.length - 1].northRequirement).toBe(0);
    expect(displayData[displayData.length - 1].northCoverage).toBe(0);
  });
});
