import type { TodRidershipProjectionV1 } from './tod';
import type {
    RidershipTrendBaselineV1,
    RidershipTrendProjectionV1,
    RidershipTrendSource,
} from './types';

export const MONTHLY_RIDERSHIP_REPORT_SCHEMA_VERSION = 1 as const;

export type MonthlyRidershipDayType = 'weekday' | 'saturday' | 'sunday';

export interface MonthlyRidershipSourceCoverage {
    observedDays: number;
    expectedDays: number;
    missingDates: string[];
    firstServiceDate: string | null;
    latestServiceDate: string | null;
    complete: boolean;
}

export interface MonthlyRidershipSourceMetric {
    total: number | null;
    coverage: MonthlyRidershipSourceCoverage;
}

export interface MonthlyRidershipDayTypeMetric {
    total: number | null;
    observedDays: number;
    average: number | null;
    priorYearAverage: number | null;
    priorYearObservedDays: number;
    priorYearShare: number | null;
    yearOverYearChange: number | null;
}

export interface MonthlyRidershipYearToDateMetric {
    total: number | null;
    complete: boolean;
    priorYearTotal: number | null;
    yearOverYearChange: number | null;
}

export interface MonthlyRidershipAnnualProjection {
    total: number | null;
    priorYearTotal: number | null;
    yearOverYearChange: number | null;
}

export interface MonthlyRidershipChartPoint {
    month: number;
    cumulativeTotal: number | null;
    partial: boolean;
}

export interface MonthlyRidershipChartSeries {
    year: number;
    source: RidershipTrendSource;
    points: MonthlyRidershipChartPoint[];
}

export interface MonthlyRidershipReportModel {
    schemaVersion: typeof MONTHLY_RIDERSHIP_REPORT_SCHEMA_VERSION;
    reportMonth: string;
    reportYear: number;
    month: number;
    generatedAt: string;
    scheduledRoutes: MonthlyRidershipSourceMetric;
    onDemand: MonthlyRidershipSourceMetric;
    allTransit: {
        total: number | null;
        complete: boolean;
        completeDates: string[];
    };
    dayTypes: Record<MonthlyRidershipDayType, MonthlyRidershipDayTypeMetric>;
    priorYearDayTypeCoverage: MonthlyRidershipSourceCoverage;
    priorYearScheduledTotal: number | null;
    priorYearShare: number | null;
    yearToDateScheduledRoutes: MonthlyRidershipYearToDateMetric;
    projectedAnnualScheduledRoutes: MonthlyRidershipAnnualProjection;
    chart: {
        months: number[];
        series: MonthlyRidershipChartSeries[];
    };
}

interface ResolvedMonth {
    total: number | null;
    coverage: MonthlyRidershipSourceCoverage;
    source: RidershipTrendSource;
}

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function parseMonthKey(value: string): { year: number; month: number } {
    const match = MONTH_PATTERN.exec(value);
    if (!match) throw new Error('Report month must use YYYY-MM format.');
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    if (!Number.isInteger(year) || month < 1 || month > 12) {
        throw new Error('Report month must use YYYY-MM format.');
    }
    return { year, month };
}

function monthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function enumerateMonthDates(year: number, month: number): string[] {
    return Array.from(
        { length: daysInMonth(year, month) },
        (_, index) => `${monthKey(year, month)}-${String(index + 1).padStart(2, '0')}`,
    );
}

function coverageForDates(expectedDates: readonly string[], observedDates: readonly string[]): MonthlyRidershipSourceCoverage {
    const observedSet = new Set(observedDates);
    const sortedObserved = [...observedSet].sort();
    const missingDates = expectedDates.filter(date => !observedSet.has(date));
    return {
        observedDays: sortedObserved.length,
        expectedDays: expectedDates.length,
        missingDates,
        firstServiceDate: sortedObserved[0] ?? null,
        latestServiceDate: sortedObserved.at(-1) ?? null,
        complete: expectedDates.length > 0 && missingDates.length === 0,
    };
}

function completeWorkbookCoverage(year: number, month: number): MonthlyRidershipSourceCoverage {
    const dates = enumerateMonthDates(year, month);
    return coverageForDates(dates, dates);
}

function resolveScheduledMonth(
    baseline: RidershipTrendBaselineV1,
    projection: RidershipTrendProjectionV1 | null | undefined,
    year: number,
    month: number,
): ResolvedMonth {
    const key = monthKey(year, month);
    const baselineTotal = baseline.monthlyTotals[key];
    if (typeof baselineTotal === 'number') {
        return {
            total: baselineTotal,
            coverage: completeWorkbookCoverage(year, month),
            source: 'workbook',
        };
    }

    const expectedDates = enumerateMonthDates(year, month);
    const observedDates = expectedDates.filter(date => projection?.dailyTotals[date] !== undefined);
    const coverage = coverageForDates(expectedDates, observedDates);
    const total = observedDates.length === 0
        ? null
        : observedDates.reduce((sum, date) => sum + (projection?.dailyTotals[date]?.boardings ?? 0), 0);
    return { total, coverage, source: 'live' };
}

function resolveTodMonth(
    projection: TodRidershipProjectionV1 | null | undefined,
    year: number,
    month: number,
): MonthlyRidershipSourceMetric {
    const expectedDates = enumerateMonthDates(year, month);
    const observedDates = expectedDates.filter(date => projection?.dailyTotals[date] !== undefined);
    return {
        total: observedDates.length === 0
            ? null
            : observedDates.reduce((sum, date) => sum + (projection?.dailyTotals[date] ?? 0), 0),
        coverage: coverageForDates(expectedDates, observedDates),
    };
}

function dayTypeForDate(date: string): MonthlyRidershipDayType {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (day === 0) return 'sunday';
    if (day === 6) return 'saturday';
    return 'weekday';
}

function buildDayTypeMetrics(
    fixedProjection: RidershipTrendProjectionV1 | null | undefined,
    todProjection: TodRidershipProjectionV1 | null | undefined,
    dates: readonly string[],
    priorYearDates: readonly string[],
    priorYearFixedDailyTotals: Readonly<Record<string, number>> | null | undefined,
    currentSourcesComplete: boolean,
): {
    completeDates: string[];
    dayTypes: Record<MonthlyRidershipDayType, MonthlyRidershipDayTypeMetric>;
    priorYearCoverage: MonthlyRidershipSourceCoverage;
} {
    const completeDates = dates.filter(date => (
        fixedProjection?.dailyTotals[date] !== undefined
        && todProjection?.dailyTotals[date] !== undefined
    ));
    const grouped: Record<MonthlyRidershipDayType, number[]> = {
        weekday: [],
        saturday: [],
        sunday: [],
    };
    const priorYearGrouped: Record<MonthlyRidershipDayType, number[]> = {
        weekday: [],
        saturday: [],
        sunday: [],
    };

    for (const date of completeDates) {
        grouped[dayTypeForDate(date)].push(
            (fixedProjection?.dailyTotals[date]?.boardings ?? 0)
            + (todProjection?.dailyTotals[date] ?? 0),
        );
    }

    const priorYearObservedDates = priorYearDates.filter(date => (
        priorYearFixedDailyTotals?.[date] !== undefined
        || fixedProjection?.dailyTotals[date]?.boardings !== undefined
    ));
    for (const date of priorYearObservedDates) {
        priorYearGrouped[dayTypeForDate(date)].push(
            priorYearFixedDailyTotals?.[date]
            ?? fixedProjection?.dailyTotals[date]?.boardings
            ?? 0,
        );
    }
    const priorYearCoverage = coverageForDates(priorYearDates, priorYearObservedDates);

    return {
        completeDates,
        dayTypes: Object.fromEntries(
            (Object.entries(grouped) as Array<[MonthlyRidershipDayType, number[]]>).map(([dayType, values]) => {
                const total = values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
                const priorYearValues = priorYearGrouped[dayType];
                const priorYearTotal = priorYearValues.length === 0
                    ? null
                    : priorYearValues.reduce((sum, value) => sum + value, 0);
                const average = total === null ? null : total / values.length;
                const priorYearAverage = priorYearTotal === null ? null : priorYearTotal / priorYearValues.length;
                const priorYearShare = currentSourcesComplete
                    && priorYearCoverage.complete
                    && average !== null
                    && priorYearAverage !== null
                    && priorYearAverage > 0
                    ? average / priorYearAverage
                    : null;
                return [dayType, {
                    total,
                    observedDays: values.length,
                    average,
                    priorYearAverage,
                    priorYearObservedDays: priorYearValues.length,
                    priorYearShare,
                    yearOverYearChange: priorYearShare === null ? null : priorYearShare - 1,
                }];
            }),
        ) as Record<MonthlyRidershipDayType, MonthlyRidershipDayTypeMetric>,
        priorYearCoverage,
    };
}

function resolveScheduledPeriod(
    baseline: RidershipTrendBaselineV1,
    projection: RidershipTrendProjectionV1 | null | undefined,
    year: number,
    finalMonth: number,
): { total: number | null; complete: boolean } {
    const months = Array.from({ length: finalMonth }, (_, index) => index + 1)
        .map(month => resolveScheduledMonth(baseline, projection, year, month));
    const available = months.filter(month => month.total !== null);
    return {
        total: available.length === 0
            ? null
            : available.reduce((sum, month) => sum + (month.total ?? 0), 0),
        complete: months.length > 0 && months.every(month => month.coverage.complete && month.total !== null),
    };
}

function mergeSource(current: RidershipTrendSource, next: RidershipTrendSource): RidershipTrendSource {
    if (current === next) return current;
    return 'mixed';
}

function buildChartSeries(
    baseline: RidershipTrendBaselineV1,
    projection: RidershipTrendProjectionV1 | null | undefined,
    reportYear: number,
    reportMonth: number,
): { months: number[]; series: MonthlyRidershipChartSeries[] } {
    const firstDisplayedMonth = Math.max(1, reportMonth - 5);
    const months = Array.from(
        { length: reportMonth - firstDisplayedMonth + 1 },
        (_, index) => firstDisplayedMonth + index,
    );
    const years = Array.from({ length: 5 }, (_, index) => reportYear - 4 + index);

    return {
        months,
        series: years.map(year => {
            let cumulativeTotal = 0;
            let hasGap = false;
            let source: RidershipTrendSource | null = null;
            const pointsByMonth = new Map<number, MonthlyRidershipChartPoint>();

            for (let month = 1; month <= reportMonth; month += 1) {
                const resolved = resolveScheduledMonth(baseline, projection, year, month);
                source = source === null ? resolved.source : mergeSource(source, resolved.source);
                if (resolved.total === null || hasGap) {
                    hasGap = true;
                    pointsByMonth.set(month, { month, cumulativeTotal: null, partial: true });
                    continue;
                }
                cumulativeTotal += resolved.total;
                pointsByMonth.set(month, {
                    month,
                    cumulativeTotal,
                    partial: !resolved.coverage.complete,
                });
            }

            return {
                year,
                source: source ?? 'workbook',
                points: months.map(month => pointsByMonth.get(month) ?? {
                    month,
                    cumulativeTotal: null,
                    partial: true,
                }),
            };
        }),
    };
}

export function getPreviousReportMonth(now: Date, timeZone = 'America/Toronto'): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(now);
    const year = Number(parts.find(part => part.type === 'year')?.value);
    const month = Number(parts.find(part => part.type === 'month')?.value);
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
        throw new Error('Could not resolve the report month.');
    }
    const previous = new Date(Date.UTC(year, month - 2, 1));
    return monthKey(previous.getUTCFullYear(), previous.getUTCMonth() + 1);
}

export function buildMonthlyRidershipReportModel(input: {
    baseline: RidershipTrendBaselineV1;
    fixedProjection?: RidershipTrendProjectionV1 | null;
    todProjection?: TodRidershipProjectionV1 | null;
    priorYearFixedDailyTotals?: Readonly<Record<string, number>> | null;
    reportMonth: string;
    generatedAt: string;
}): MonthlyRidershipReportModel {
    const { year, month } = parseMonthKey(input.reportMonth);
    const expectedDates = enumerateMonthDates(year, month);
    const priorYearExpectedDates = enumerateMonthDates(year - 1, month);
    const scheduledRoutes = resolveScheduledMonth(input.baseline, input.fixedProjection, year, month);
    const onDemand = resolveTodMonth(input.todProjection, year, month);
    const allTransitComplete = scheduledRoutes.coverage.complete && onDemand.coverage.complete;
    const { completeDates, dayTypes, priorYearCoverage } = buildDayTypeMetrics(
        input.fixedProjection,
        input.todProjection,
        expectedDates,
        priorYearExpectedDates,
        input.priorYearFixedDailyTotals,
        allTransitComplete,
    );
    const allTransitTotal = scheduledRoutes.total === null && onDemand.total === null
        ? null
        : (scheduledRoutes.total ?? 0) + (onDemand.total ?? 0);
    const priorYearScheduled = resolveScheduledMonth(
        input.baseline,
        input.fixedProjection,
        year - 1,
        month,
    );
    const priorYearShare = allTransitComplete
        && priorYearScheduled.coverage.complete
        && allTransitTotal !== null
        && priorYearScheduled.total !== null
        && priorYearScheduled.total > 0
        ? allTransitTotal / priorYearScheduled.total
        : null;
    const yearToDateScheduled = resolveScheduledPeriod(input.baseline, input.fixedProjection, year, month);
    const priorYearToDateScheduled = resolveScheduledPeriod(input.baseline, input.fixedProjection, year - 1, month);
    const priorYearAnnualScheduled = resolveScheduledPeriod(input.baseline, input.fixedProjection, year - 1, 12);
    const yearToDateShare = yearToDateScheduled.complete
        && priorYearToDateScheduled.complete
        && yearToDateScheduled.total !== null
        && priorYearToDateScheduled.total !== null
        && priorYearToDateScheduled.total > 0
        ? yearToDateScheduled.total / priorYearToDateScheduled.total
        : null;
    const projectedAnnualTotal = yearToDateShare !== null
        && priorYearAnnualScheduled.complete
        && priorYearAnnualScheduled.total !== null
        ? yearToDateShare * priorYearAnnualScheduled.total
        : null;

    return {
        schemaVersion: MONTHLY_RIDERSHIP_REPORT_SCHEMA_VERSION,
        reportMonth: input.reportMonth,
        reportYear: year,
        month,
        generatedAt: input.generatedAt,
        scheduledRoutes: {
            total: scheduledRoutes.total,
            coverage: scheduledRoutes.coverage,
        },
        onDemand,
        allTransit: {
            total: allTransitTotal,
            complete: allTransitComplete,
            completeDates,
        },
        dayTypes,
        priorYearDayTypeCoverage: priorYearCoverage,
        priorYearScheduledTotal: priorYearScheduled.total,
        priorYearShare,
        yearToDateScheduledRoutes: {
            total: yearToDateScheduled.total,
            complete: yearToDateScheduled.complete,
            priorYearTotal: priorYearToDateScheduled.total,
            yearOverYearChange: yearToDateShare === null ? null : yearToDateShare - 1,
        },
        projectedAnnualScheduledRoutes: {
            total: projectedAnnualTotal,
            priorYearTotal: priorYearAnnualScheduled.total,
            yearOverYearChange: projectedAnnualTotal !== null
                && priorYearAnnualScheduled.total !== null
                && priorYearAnnualScheduled.total > 0
                ? (projectedAnnualTotal / priorYearAnnualScheduled.total) - 1
                : null,
        },
        chart: buildChartSeries(input.baseline, input.fixedProjection, year, month),
    };
}
