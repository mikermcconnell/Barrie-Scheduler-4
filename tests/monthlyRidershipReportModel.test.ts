import { describe, expect, it } from 'vitest';
import { RIDERSHIP_TREND_BASELINE } from '../utils/ridership-trends/baseline';
import {
  buildMonthlyRidershipReportModel,
  getPreviousReportMonth,
  type MonthlyRidershipReportModel,
  type MonthlyRidershipServiceKey,
} from '../utils/ridership-trends/monthlyReport';
import type { TodRidershipProjectionV1 } from '../utils/ridership-trends/tod';
import type { RidershipTrendProjectionV1 } from '../utils/ridership-trends/types';

const GENERATED_AT = '2026-09-01T14:00:00.000Z';
const BASELINE = RIDERSHIP_TREND_BASELINE.monthlyTotals;

function augustDates(year = 2026): string[] {
  return Array.from({ length: 31 }, (_, index) => `${year}-08-${String(index + 1).padStart(2, '0')}`);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function priorYearFixedDailyTotals(): Record<string, number> {
  return Object.fromEntries(augustDates(2025).map(date => [date, isWeekend(date) ? 600 : 1_200]));
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

function service(model: MonthlyRidershipReportModel, key: MonthlyRidershipServiceKey) {
  const found = model.services.find(entry => entry.key === key);
  if (!found) throw new Error(`Missing ${key}`);
  return found;
}

function completeModel(extra: Partial<Parameters<typeof buildMonthlyRidershipReportModel>[0]> = {}) {
  return buildMonthlyRidershipReportModel({
    baseline: RIDERSHIP_TREND_BASELINE,
    fixedProjection: fixedProjection(),
    todProjection: todProjection(),
    priorYearFixedDailyTotals: priorYearFixedDailyTotals(),
    reportMonth: '2026-08',
    generatedAt: GENERATED_AT,
    ...extra,
  });
}

describe('monthly ridership report model', () => {
  it('reports each service and compares only the services with a prior-year month', () => {
    const model = completeModel();
    const conventional = service(model, 'conventional');
    const onDemand = service(model, 'onDemand');

    expect(model.services.map(entry => entry.key)).toEqual(['conventional', 'onDemand', 'specialized']);
    expect(conventional.month.current).toBe(31_000);
    expect(conventional.month.priorYear).toBe(BASELINE['2025-08']);
    expect(conventional.month.change).toBeCloseTo((31_000 / BASELINE['2025-08']) - 1, 10);
    expect(onDemand.month.current).toBe(310);
    expect(onDemand.month.change).toBeNull();
    expect(service(model, 'specialized').month.current).toBeNull();

    expect(model.total.current).toBe(31_310);
    expect(model.total.reportedServices).toEqual(['conventional', 'onDemand']);
    expect(model.total.comparedServices).toEqual(['conventional']);
    expect(model.total.change).toBeCloseTo(conventional.month.change ?? NaN, 10);
    expect(model.coverage.complete).toBe(true);
  });

  it('uses a stored prior-year Specialized month, or else the percentage printed on the source report', () => {
    const withPriorMonth = completeModel({
      specializedMonths: {
        '2026-08': { reportedTrips: 7_350, priorYearPercent: 97 },
        '2025-08': { reportedTrips: 7_000, priorYearPercent: null },
      },
    });
    expect(service(withPriorMonth, 'specialized').month).toMatchObject({
      current: 7_350,
      priorYear: 7_000,
      changeFromSourceReport: false,
    });
    expect(service(withPriorMonth, 'specialized').month.change).toBeCloseTo(0.05, 10);

    const fromReport = completeModel({ specializedMonths: { '2026-08': { reportedTrips: 7_350, priorYearPercent: 95 } } });
    const specialized = service(fromReport, 'specialized');
    expect(specialized.month.priorYear).toBeNull();
    expect(specialized.month.change).toBeCloseTo(-0.05, 10);
    expect(specialized.month.changeFromSourceReport).toBe(true);
    expect(fromReport.total.comparedServices).toEqual(['conventional', 'specialized']);
    // Prior Specialized riders are derived from the printed percentage for the grand-total change.
    expect(fromReport.total.priorYear).toBe(Math.round(BASELINE['2025-08'] + (7_350 / 0.95)));
  });

  it('keeps partial totals visible but withholds comparisons until every day is reported', () => {
    const model = completeModel({ fixedProjection: fixedProjection(['2026-08-14']) });
    const conventional = service(model, 'conventional');

    expect(conventional.month.current).toBe(30_000);
    expect(conventional.month.complete).toBe(false);
    expect(conventional.month.change).toBeNull();
    expect(conventional.weekdayAverage.change).toBeNull();
    expect(model.coverage.scheduledRoutes.missingDates).toEqual(['2026-08-14']);
    expect(model.coverage.complete).toBe(false);
    expect(model.total.current).toBe(30_310);
    expect(model.total.change).toBeNull();
  });

  it('compares Conventional weekday averages with retained prior-year daily evidence', () => {
    const model = completeModel();
    const weekday = service(model, 'conventional').weekdayAverage;

    expect(weekday.supported).toBe(true);
    expect(weekday.current).toBe(1_000);
    expect(weekday.priorYear).toBe(1_200);
    expect(weekday.change).toBeCloseTo(-1 / 6, 10);
    expect(service(model, 'onDemand').weekdayAverage).toMatchObject({ current: 10, priorYear: null, change: null });
    expect(service(model, 'specialized').weekdayAverage.supported).toBe(false);
  });

  it('calculates riders per service hour only from entered official hours', () => {
    const withoutHours = completeModel();
    expect(service(withoutHours, 'conventional').ridersPerServiceHour.current).toBeNull();
    expect(withoutHours.totalRidersPerServiceHour.current).toBeNull();

    const partialHours = completeModel({ serviceHours: { '2026-08': { conventional: 1_000 } } });
    expect(service(partialHours, 'conventional').ridersPerServiceHour.current).toBe(31);
    expect(partialHours.totalRidersPerServiceHour.current).toBeNull();

    const allHours = completeModel({
      serviceHours: {
        '2026-08': { conventional: 1_000, onDemand: 31 },
        '2025-08': { conventional: 1_000 },
      },
    });
    expect(allHours.totalRidersPerServiceHour.current).toBeCloseTo(31_310 / 1_031, 10);
    expect(service(allHours, 'conventional').ridersPerServiceHour.priorYear).toBe(BASELINE['2025-08'] / 1_000);
    expect(service(allHours, 'conventional').ridersPerServiceHour.change).toBeCloseTo((31 / (BASELINE['2025-08'] / 1_000)) - 1, 10);
  });

  it('builds a 13-month Conventional trend aligned with the same months one year earlier', () => {
    const model = completeModel();

    expect(model.trend.months).toHaveLength(13);
    expect(model.trend.months[0]).toBe('2025-08');
    expect(model.trend.months.at(-1)).toBe('2026-08');
    expect(model.trend.current[0]).toBe(BASELINE['2025-08']);
    expect(model.trend.current.at(-1)).toBe(31_000);
    expect(model.trend.priorYear[0]).toBe(BASELINE['2024-08']);
    expect(model.trend.priorYear.at(-1)).toBe(BASELINE['2025-08']);
    expect(service(model, 'onDemand').trend.filter(point => point.total !== null)).toEqual([{ month: '2026-08', total: 310 }]);
  });

  it('compares year to date only when every month in both years is complete', () => {
    const model = completeModel();
    const conventional = service(model, 'conventional');
    const months = ['01', '02', '03', '04', '05', '06', '07'];
    const current = months.reduce((sum, month) => sum + BASELINE[`2026-${month}`], 31_000);
    const prior = [...months, '08'].reduce((sum, month) => sum + BASELINE[`2025-${month}`], 0);

    expect(conventional.yearToDate.current).toBe(current);
    expect(conventional.yearToDate.priorYear).toBe(prior);
    expect(service(model, 'onDemand').yearToDate.current).toBeNull();
    expect(model.totalYearToDate.comparedServices).toEqual(['conventional']);
    expect(model.totalYearToDate.current).toBe(current);
  });

  it('does not convert a completely unavailable source into zero', () => {
    const model = buildMonthlyRidershipReportModel({
      baseline: RIDERSHIP_TREND_BASELINE,
      reportMonth: '2026-08',
      generatedAt: GENERATED_AT,
    });

    expect(service(model, 'conventional').month.current).toBeNull();
    expect(model.total.current).toBeNull();
    expect(model.total.change).toBeNull();
    expect(model.coverage.scheduledRoutes.observedDays).toBe(0);
  });

  it('resolves the previous Toronto month across year boundaries', () => {
    expect(getPreviousReportMonth(new Date('2027-01-01T15:00:00.000Z'))).toBe('2026-12');
    expect(getPreviousReportMonth(new Date('2026-09-01T14:00:00.000Z'))).toBe('2026-08');
  });
});
