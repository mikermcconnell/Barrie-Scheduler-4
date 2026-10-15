import { describe, expect, it } from 'vitest';
import {
  buildDwellHistory,
  buildDwellWeeks,
  DwellHistoryDay,
  summarizeWeeklyDwell,
} from '../utils/performanceDwellHistory';

/** Monday 2026-03-09 is the first day of dwell history. */
const FIRST_MONDAY = '2026-03-09';

function shift(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** A full week where each day has `minutes` of dwell over 100 trips, so the weekly rate equals `minutes`. */
function week(index: number, minutes: number, dayCount = 7): DwellHistoryDay[] {
  const monday = shift(FIRST_MONDAY, index * 7);
  return Array.from({ length: dayCount }, (_, day) => ({
    date: shift(monday, day),
    dayType: day < 5 ? 'weekday' : day === 5 ? 'saturday' : 'sunday',
    reportableDwellMinutes: minutes,
    tripCount: 100,
  }));
}

function weeks(rates: number[]): DwellHistoryDay[] {
  return rates.flatMap((rate, index) => week(index, rate));
}

function sundayOf(index: number): string {
  return shift(FIRST_MONDAY, index * 7 + 6);
}

describe('buildDwellHistory', () => {
  const day = (date: string, overrides: Record<string, unknown> = {}) => ({
    date,
    dayType: 'weekday',
    system: { tripCount: 200 },
    byOperatorDwell: {
      incidents: [
        { severity: 'high', trackedDwellSeconds: 600 },
        { severity: 'moderate', trackedDwellSeconds: 300 },
        { severity: 'minor', trackedDwellSeconds: 900 },
      ],
    },
    ...overrides,
  });

  it('keeps moderate and high dwell only, from the start date, for days with trips and dwell data', () => {
    const history = buildDwellHistory([
      day('2026-03-10'),
      day('2026-03-08'),
      day('2026-03-11', { byOperatorDwell: undefined }),
      day('2026-03-12', { system: { tripCount: 0 } }),
      day('2026-03-09', { byOperatorDwell: { incidents: [], totalReportableDwellMinutes: 12.34 } }),
    ]);

    expect(history).toEqual([
      { date: '2026-03-09', dayType: 'weekday', reportableDwellMinutes: 12.3, tripCount: 200 },
      { date: '2026-03-10', dayType: 'weekday', reportableDwellMinutes: 15, tripCount: 200 },
    ]);
  });
});

describe('buildDwellWeeks', () => {
  it('rolls days into complete Monday–Sunday weeks and skips short or unfinished weeks', () => {
    const history = [...week(0, 30), ...week(1, 10, 4), ...week(2, 20, 5), ...week(3, 50, 3)];

    const result = buildDwellWeeks(history, shift(FIRST_MONDAY, 23));

    expect(result.map(entry => entry.weekStart)).toEqual(['2026-03-09', '2026-03-23']);
    expect(result[0]).toMatchObject({ weekEnd: '2026-03-15', days: 7, trips: 700, dwellHours: 3.5, minutesPer100Trips: 30 });
    expect(result[1]).toMatchObject({ days: 5, minutesPer100Trips: 20 });
  });
});

describe('summarizeWeeklyDwell', () => {
  it('waits for four earlier weeks before ranking', () => {
    expect(summarizeWeeklyDwell(weeks([10, 20, 30, 40]), sundayOf(3))).toBeNull();
  });

  it('ranks the latest week against earlier weeks and reports the typical week', () => {
    const summary = summarizeWeeklyDwell(weeks([10, 20, 30, 40, 25]), sundayOf(4));

    expect(summary).toMatchObject({
      percentile: 50,
      medianPer100Trips: 25,
      trendPercent: null,
      recentAvgPer100Trips: null,
    });
    expect(summary?.lastWeek.weekStart).toBe(shift(FIRST_MONDAY, 28));
  });

  it('ranks the last complete week mid-week, ignoring the week in progress', () => {
    const history = [...weeks([10, 20, 30, 40, 25]), ...week(5, 99, 2)];

    expect(summarizeWeeklyDwell(history, shift(FIRST_MONDAY, 36))?.lastWeek.weekEnd).toBe(sundayOf(4));
  });

  it('compares the last four weeks with the four before once there are eight', () => {
    const summary = summarizeWeeklyDwell(weeks([10, 10, 10, 10, 20, 20, 20, 20]), sundayOf(7));

    expect(summary).toMatchObject({
      percentile: 57,
      trendPercent: 100,
      recentAvgPer100Trips: 20,
      priorAvgPer100Trips: 10,
    });
  });
});
