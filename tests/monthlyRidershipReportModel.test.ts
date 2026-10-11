import { describe, expect, it } from 'vitest';
import { RIDERSHIP_TREND_BASELINE } from '../utils/ridership-trends/baseline';
import {
  buildMonthlyRidershipReportModel,
  getPreviousReportMonth,
} from '../utils/ridership-trends/monthlyReport';
import type { TodRidershipProjectionV1 } from '../utils/ridership-trends/tod';
import type { RidershipTrendProjectionV1 } from '../utils/ridership-trends/types';

const GENERATED_AT = '2026-09-01T14:00:00.000Z';

function augustDates(): string[] {
  return Array.from({ length: 31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`);
}

function priorYearFixedDailyTotals(): Record<string, number> {
  return Object.fromEntries(Array.from({ length: 31 }, (_, index) => {
    const date = `2025-08-${String(index + 1).padStart(2, '0')}`;
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const boardings = day === 0 ? 500 : day === 6 ? 800 : 1_200;
    return [date, boardings];
  }));
}

function fixedProjection(excludedDates: string[] = []): RidershipTrendProjectionV1 {
  const excluded = new Set(excludedDates);
  return {
    schemaVersion: 1,
    metric: 'fixed_route_boardings',
    cutoverDate: '2026-08-01',
    baselineHash: RIDERSHIP_TREND_BASELINE.source.sha256,
    dailyTotals: Object.fromEntries(augustDates()
      .filter(date => !excluded.has(date))
      .map(date => [date, { boardings: 1_000, performanceSchemaVersion: 14 }])),
    latestServiceDate: '2026-08-31',
    updatedAt: GENERATED_AT,
  };
}

function todProjection(excludedDates: string[] = []): TodRidershipProjectionV1 {
  const excluded = new Set(excludedDates);
  return {
    schemaVersion: 1,
    metric: 'tod_completed_trips',
    dailyTotals: Object.fromEntries(augustDates()
      .filter(date => !excluded.has(date))
      .map(date => [date, 10])),
    latestServiceDate: '2026-08-31',
    updatedAt: GENERATED_AT,
  };
}

describe('monthly ridership report model', () => {
  it('combines complete scheduled-route and On Demand evidence without double-counting trips', () => {
    const model = buildMonthlyRidershipReportModel({
      baseline: RIDERSHIP_TREND_BASELINE,
      fixedProjection: fixedProjection(),
      todProjection: todProjection(),
      priorYearFixedDailyTotals: priorYearFixedDailyTotals(),
      reportMonth: '2026-08',
      generatedAt: GENERATED_AT,
    });

    expect(model.scheduledRoutes.total).toBe(31_000);
    expect(model.onDemand.total).toBe(310);
    expect(model.allTransit).toEqual({
      total: 31_310,
      complete: true,
      completeDates: augustDates(),
    });
    expect(model.priorYearScheduledTotal).toBe(269_090);
    expect(model.priorYearShare).toBeCloseTo(31_310 / 269_090);
    expect(model.dayTypes.weekday).toEqual({
      total: 21_210,
      observedDays: 21,
      average: 1_010,
      priorYearAverage: 1_200,
      priorYearObservedDays: 21,
      priorYearShare: 1_010 / 1_200,
      yearOverYearChange: (1_010 / 1_200) - 1,
    });
    expect(model.dayTypes.saturday).toMatchObject({
      total: 5_050,
      observedDays: 5,
      average: 1_010,
      priorYearAverage: 800,
      priorYearObservedDays: 5,
    });
    expect(model.dayTypes.saturday.yearOverYearChange).toBeCloseTo((1_010 / 800) - 1);
    expect(model.dayTypes.sunday).toMatchObject({
      total: 5_050,
      observedDays: 5,
      average: 1_010,
      priorYearAverage: 500,
      priorYearObservedDays: 5,
    });
    expect(model.yearToDateScheduledRoutes).toMatchObject({
      total: 1_663_133,
      complete: true,
      priorYearTotal: 2_348_346,
    });
    expect(model.projectedAnnualScheduledRoutes.total).toBeCloseTo(
      (1_663_133 / 2_348_346) * 3_362_338,
    );
  });

  it('keeps partial totals, excludes mismatched dates from averages, and suppresses comparison', () => {
    const model = buildMonthlyRidershipReportModel({
      baseline: RIDERSHIP_TREND_BASELINE,
      fixedProjection: fixedProjection(['2026-08-10']),
      todProjection: todProjection(['2026-08-11']),
      priorYearFixedDailyTotals: priorYearFixedDailyTotals(),
      reportMonth: '2026-08',
      generatedAt: GENERATED_AT,
    });

    expect(model.scheduledRoutes.total).toBe(30_000);
    expect(model.onDemand.total).toBe(300);
    expect(model.allTransit.total).toBe(30_300);
    expect(model.allTransit.complete).toBe(false);
    expect(model.allTransit.completeDates).toHaveLength(29);
    expect(model.scheduledRoutes.coverage.missingDates).toEqual(['2026-08-10']);
    expect(model.onDemand.coverage.missingDates).toEqual(['2026-08-11']);
    expect(model.dayTypes.weekday).toMatchObject({
      total: 19_190,
      observedDays: 19,
      average: 1_010,
      priorYearAverage: 1_200,
      priorYearObservedDays: 21,
      priorYearShare: null,
      yearOverYearChange: null,
    });
    expect(model.priorYearShare).toBeNull();
    expect(model.projectedAnnualScheduledRoutes.total).toBeNull();
    expect(model.chart.series.at(-1)?.points.at(-1)?.partial).toBe(true);
  });

  it('uses the supplied monthly history for a comparable five-year cumulative chart', () => {
    const model = buildMonthlyRidershipReportModel({
      baseline: RIDERSHIP_TREND_BASELINE,
      fixedProjection: fixedProjection(),
      todProjection: todProjection(),
      reportMonth: '2026-08',
      generatedAt: GENERATED_AT,
    });

    expect(model.chart.months).toEqual([3, 4, 5, 6, 7, 8]);
    expect(model.chart.series.map(series => series.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(model.chart.series.find(series => series.year === 2025)?.points.at(-1)?.cumulativeTotal).toBe(2_348_346);
    expect(model.chart.series.find(series => series.year === 2026)?.points.at(-1)).toEqual({
      month: 8,
      cumulativeTotal: 1_663_133,
      partial: false,
    });
  });

  it('uses a single January chart point and resolves the previous Toronto month across year boundaries', () => {
    const model = buildMonthlyRidershipReportModel({
      baseline: RIDERSHIP_TREND_BASELINE,
      reportMonth: '2026-01',
      generatedAt: GENERATED_AT,
    });

    expect(model.chart.months).toEqual([1]);
    expect(getPreviousReportMonth(new Date('2027-01-01T15:00:00.000Z'))).toBe('2026-12');
    expect(getPreviousReportMonth(new Date('2027-01-01T02:00:00.000Z'))).toBe('2026-11');
  });

  it('does not convert a completely unavailable source into zero', () => {
    const model = buildMonthlyRidershipReportModel({
      baseline: RIDERSHIP_TREND_BASELINE,
      fixedProjection: fixedProjection(),
      todProjection: null,
      reportMonth: '2026-08',
      generatedAt: GENERATED_AT,
    });

    expect(model.onDemand.total).toBeNull();
    expect(model.allTransit.total).toBe(31_000);
    expect(model.allTransit.complete).toBe(false);
    expect(model.dayTypes.weekday.average).toBeNull();
    expect(model.priorYearShare).toBeNull();
  });
});
