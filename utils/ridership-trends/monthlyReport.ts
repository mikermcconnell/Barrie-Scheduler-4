import type { TodRidershipProjectionV1 } from './tod';
import type {
    RidershipTrendBaselineV1,
    RidershipTrendProjectionV1,
} from './types';

export const MONTHLY_RIDERSHIP_REPORT_SCHEMA_VERSION = 2 as const;

export const MONTHLY_RIDERSHIP_SERVICE_KEYS = ['conventional', 'onDemand', 'specialized'] as const;
export type MonthlyRidershipServiceKey = typeof MONTHLY_RIDERSHIP_SERVICE_KEYS[number];

export const MONTHLY_RIDERSHIP_TREND_MONTHS = 13;

export interface MonthlyRidershipSourceCoverage {
    observedDays: number;
    expectedDays: number;
    missingDates: string[];
    firstServiceDate: string | null;
    latestServiceDate: string | null;
    complete: boolean;
}

/** A current value, the same value one year earlier, and the change as a fraction (0.064 = +6.4%). */
export interface MonthlyRidershipComparison {
    current: number | null;
    priorYear: number | null;
    change: number | null;
}

export interface MonthlyRidershipTrendPoint {
    month: string;
    total: number | null;
}

export interface MonthlyRidershipServiceSummary {
    key: MonthlyRidershipServiceKey;
    label: string;
    description: string;
    /** Riders this month. `coverage` is null for monthly sources (Specialized). */
    month: MonthlyRidershipComparison & {
        complete: boolean;
        coverage: MonthlyRidershipSourceCoverage | null;
        /** True when the prior-year change comes from the source report's own percentage. */
        changeFromSourceReport: boolean;
    };
    yearToDate: MonthlyRidershipComparison;
    trend: MonthlyRidershipTrendPoint[];
    weekdayAverage: MonthlyRidershipComparison & { supported: boolean; observedDays: number };
    serviceHours: { current: number | null; priorYear: number | null };
    ridersPerServiceHour: MonthlyRidershipComparison;
}

/** Official monthly service hours entered by staff, keyed by service. */
export type MonthlyServiceHours = Partial<Record<MonthlyRidershipServiceKey, number>>;

export interface SpecializedMonthlyRidership {
    reportedTrips: number;
    /** Ridership as a percentage of the same month last year, as printed on the source report. */
    priorYearPercent: number | null;
}

export interface MonthlyRidershipReportModel {
    schemaVersion: typeof MONTHLY_RIDERSHIP_REPORT_SCHEMA_VERSION;
    reportMonth: string;
    reportYear: number;
    month: number;
    generatedAt: string;
    services: MonthlyRidershipServiceSummary[];
    /** Riders across every service that reported. The change covers `comparedServices` only. */
    total: MonthlyRidershipComparison & {
        reportedServices: MonthlyRidershipServiceKey[];
        comparedServices: MonthlyRidershipServiceKey[];
    };
    totalYearToDate: MonthlyRidershipComparison & { comparedServices: MonthlyRidershipServiceKey[] };
    totalRidersPerServiceHour: MonthlyRidershipComparison;
    /** Daily-source coverage for the report month. */
    coverage: {
        scheduledRoutes: MonthlyRidershipSourceCoverage;
        onDemand: MonthlyRidershipSourceCoverage;
        complete: boolean;
    };
    /** Conventional riders for the last 13 months and the same months one year earlier. */
    trend: {
        months: string[];
        current: Array<number | null>;
        priorYear: Array<number | null>;
    };
}

const SERVICE_LABELS: Record<MonthlyRidershipServiceKey, { label: string; description: string }> = {
    conventional: { label: 'Conventional', description: 'Scheduled bus routes' },
    onDemand: { label: 'Transit ON Demand', description: 'On-demand zones' },
    specialized: { label: 'Specialized', description: 'Accessible door-to-door' },
};

interface ResolvedMonth {
    total: number | null;
    complete: boolean;
    coverage: MonthlyRidershipSourceCoverage | null;
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

function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
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

function sumDaily(dates: readonly string[], valueFor: (date: string) => number | undefined): ResolvedMonth & { observedDates: string[] } {
    const observedDates = dates.filter(date => valueFor(date) !== undefined);
    const coverage = coverageForDates(dates, observedDates);
    return {
        total: observedDates.length === 0 ? null : observedDates.reduce((sum, date) => sum + (valueFor(date) ?? 0), 0),
        complete: coverage.complete,
        coverage,
        observedDates,
    };
}

function resolveConventionalMonth(
    baseline: RidershipTrendBaselineV1,
    projection: RidershipTrendProjectionV1 | null | undefined,
    year: number,
    month: number,
): ResolvedMonth {
    const baselineTotal = baseline.monthlyTotals[monthKey(year, month)];
    if (typeof baselineTotal === 'number') {
        const dates = enumerateMonthDates(year, month);
        return { total: baselineTotal, complete: true, coverage: coverageForDates(dates, dates) };
    }
    return sumDaily(enumerateMonthDates(year, month), date => projection?.dailyTotals[date]?.boardings);
}

function resolveOnDemandMonth(
    projection: TodRidershipProjectionV1 | null | undefined,
    year: number,
    month: number,
): ResolvedMonth {
    return sumDaily(enumerateMonthDates(year, month), date => projection?.dailyTotals[date]);
}

function resolveSpecializedMonth(
    months: Readonly<Record<string, SpecializedMonthlyRidership>> | null | undefined,
    year: number,
    month: number,
): ResolvedMonth & { priorYearPercent: number | null } {
    const entry = months?.[monthKey(year, month)];
    return entry
        ? { total: entry.reportedTrips, complete: true, coverage: null, priorYearPercent: entry.priorYearPercent }
        : { total: null, complete: false, coverage: null, priorYearPercent: null };
}

function ratioChange(current: number | null, priorYear: number | null): number | null {
    return current !== null && priorYear !== null && priorYear > 0 ? (current / priorYear) - 1 : null;
}

function comparison(current: number | null, priorYear: number | null, comparable: boolean): MonthlyRidershipComparison {
    return { current, priorYear, change: comparable ? ratioChange(current, priorYear) : null };
}

function isWeekday(date: string): boolean {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6;
}

function weekdayAverage(dates: readonly string[], valueFor: (date: string) => number | undefined): {
    average: number | null;
    observedDays: number;
    complete: boolean;
} {
    const weekdays = dates.filter(isWeekday);
    const observed = weekdays.filter(date => valueFor(date) !== undefined);
    return {
        average: observed.length === 0 ? null : observed.reduce((sum, date) => sum + (valueFor(date) ?? 0), 0) / observed.length,
        observedDays: observed.length,
        complete: weekdays.length > 0 && observed.length === weekdays.length,
    };
}

function positiveHours(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function sumKnown(values: Array<number | null>): number | null {
    const known = values.filter((value): value is number => value !== null);
    return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
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
    const previous = shiftMonth(year, month, -1);
    return monthKey(previous.year, previous.month);
}

export function buildMonthlyRidershipReportModel(input: {
    baseline: RidershipTrendBaselineV1;
    fixedProjection?: RidershipTrendProjectionV1 | null;
    todProjection?: TodRidershipProjectionV1 | null;
    priorYearFixedDailyTotals?: Readonly<Record<string, number>> | null;
    specializedMonths?: Readonly<Record<string, SpecializedMonthlyRidership>> | null;
    serviceHours?: Readonly<Record<string, MonthlyServiceHours>> | null;
    reportMonth: string;
    generatedAt: string;
}): MonthlyRidershipReportModel {
    const { year, month } = parseMonthKey(input.reportMonth);
    const priorYear = year - 1;
    const resolvers: Record<MonthlyRidershipServiceKey, (y: number, m: number) => ResolvedMonth> = {
        conventional: (y, m) => resolveConventionalMonth(input.baseline, input.fixedProjection, y, m),
        onDemand: (y, m) => resolveOnDemandMonth(input.todProjection, y, m),
        specialized: (y, m) => resolveSpecializedMonth(input.specializedMonths, y, m),
    };
    const trendMonths = Array.from({ length: MONTHLY_RIDERSHIP_TREND_MONTHS }, (_, index) => (
        shiftMonth(year, month, index - (MONTHLY_RIDERSHIP_TREND_MONTHS - 1))
    ));
    const reportDates = enumerateMonthDates(year, month);
    const priorYearDates = enumerateMonthDates(priorYear, month);
    const fixedDaily = (date: string): number | undefined => input.fixedProjection?.dailyTotals[date]?.boardings;
    const priorFixedDaily = (date: string): number | undefined => input.priorYearFixedDailyTotals?.[date] ?? fixedDaily(date);
    const todDaily = (date: string): number | undefined => input.todProjection?.dailyTotals[date];

    const services = MONTHLY_RIDERSHIP_SERVICE_KEYS.map((key): MonthlyRidershipServiceSummary => {
        const resolve = resolvers[key];
        const current = resolve(year, month);
        const prior = resolve(priorYear, month);
        let monthComparison = comparison(current.total, prior.total, current.complete && prior.complete);
        let changeFromSourceReport = false;
        if (key === 'specialized' && monthComparison.change === null && current.total !== null) {
            const percent = resolveSpecializedMonth(input.specializedMonths, year, month).priorYearPercent;
            if (percent !== null && percent > 0) {
                monthComparison = { current: current.total, priorYear: null, change: (percent / 100) - 1 };
                changeFromSourceReport = true;
            }
        }

        const ytdMonths = Array.from({ length: month }, (_, index) => index + 1);
        const ytdCurrent = ytdMonths.map(m => resolve(year, m));
        const ytdPrior = ytdMonths.map(m => resolve(priorYear, m));
        const ytdComplete = (months: ResolvedMonth[]) => months.every(m => m.complete && m.total !== null);
        const yearToDate = comparison(
            ytdComplete(ytdCurrent) ? sumKnown(ytdCurrent.map(m => m.total)) : null,
            ytdComplete(ytdPrior) ? sumKnown(ytdPrior.map(m => m.total)) : null,
            true,
        );

        const trend = trendMonths.map(({ year: y, month: m }) => {
            const resolved = resolve(y, m);
            return { month: monthKey(y, m), total: resolved.complete ? resolved.total : null };
        });

        let weekday: MonthlyRidershipServiceSummary['weekdayAverage'] = {
            current: null, priorYear: null, change: null, supported: false, observedDays: 0,
        };
        if (key !== 'specialized') {
            const currentDaily = key === 'conventional' ? fixedDaily : todDaily;
            const priorDaily = key === 'conventional' ? priorFixedDaily : todDaily;
            const currentAverage = weekdayAverage(reportDates, currentDaily);
            const priorAverage = weekdayAverage(priorYearDates, priorDaily);
            weekday = {
                ...comparison(currentAverage.average, priorAverage.average, currentAverage.complete && priorAverage.complete),
                supported: true,
                observedDays: currentAverage.observedDays,
            };
        }

        const hoursNow = positiveHours(input.serviceHours?.[input.reportMonth]?.[key]);
        const hoursPrior = positiveHours(input.serviceHours?.[monthKey(priorYear, month)]?.[key]);
        const rphNow = hoursNow !== null && current.complete && current.total !== null ? current.total / hoursNow : null;
        const rphPrior = hoursPrior !== null && prior.complete && prior.total !== null ? prior.total / hoursPrior : null;

        return {
            key,
            ...SERVICE_LABELS[key],
            month: { ...monthComparison, complete: current.complete, coverage: current.coverage, changeFromSourceReport },
            yearToDate,
            trend,
            weekdayAverage: weekday,
            serviceHours: { current: hoursNow, priorYear: hoursPrior },
            ridersPerServiceHour: comparison(rphNow, rphPrior, true),
        };
    });

    const reported = services.filter(service => service.month.current !== null);
    const compared = services.filter(service => service.month.change !== null && service.month.current !== null);
    const comparedPriorTotal = sumKnown(compared.map(service => (
        service.month.priorYear ?? (service.month.current ?? 0) / (1 + (service.month.change ?? 0))
    )));
    const comparedCurrentTotal = sumKnown(compared.map(service => service.month.current));
    const ytdCompared = services.filter(service => service.yearToDate.change !== null);

    const allHoursNow = reported.length > 0 && reported.every(service => service.serviceHours.current !== null && service.month.complete);
    const priorReported = services.filter(service => service.month.priorYear !== null);
    const allHoursPrior = priorReported.length > 0 && priorReported.every(service => service.serviceHours.priorYear !== null);
    const totalRphNow = allHoursNow
        ? (sumKnown(reported.map(s => s.month.current)) ?? 0) / (sumKnown(reported.map(s => s.serviceHours.current)) ?? 1)
        : null;
    const totalRphPrior = allHoursPrior
        ? (sumKnown(priorReported.map(s => s.month.priorYear)) ?? 0) / (sumKnown(priorReported.map(s => s.serviceHours.priorYear)) ?? 1)
        : null;

    const scheduledCoverage = services[0].month.coverage ?? coverageForDates(reportDates, []);
    const onDemandCoverage = services[1].month.coverage ?? coverageForDates(reportDates, []);
    const conventional = services[0];

    return {
        schemaVersion: MONTHLY_RIDERSHIP_REPORT_SCHEMA_VERSION,
        reportMonth: input.reportMonth,
        reportYear: year,
        month,
        generatedAt: input.generatedAt,
        services,
        total: {
            current: sumKnown(reported.map(service => service.month.current)),
            priorYear: comparedPriorTotal === null ? null : Math.round(comparedPriorTotal),
            change: comparedCurrentTotal !== null && comparedPriorTotal !== null && comparedPriorTotal > 0
                ? (comparedCurrentTotal / comparedPriorTotal) - 1
                : null,
            reportedServices: reported.map(service => service.key),
            comparedServices: compared.map(service => service.key),
        },
        totalYearToDate: {
            ...comparison(
                sumKnown(ytdCompared.map(service => service.yearToDate.current)),
                sumKnown(ytdCompared.map(service => service.yearToDate.priorYear)),
                ytdCompared.length > 0,
            ),
            comparedServices: ytdCompared.map(service => service.key),
        },
        totalRidersPerServiceHour: comparison(totalRphNow, totalRphPrior, true),
        coverage: {
            scheduledRoutes: scheduledCoverage,
            onDemand: onDemandCoverage,
            complete: scheduledCoverage.complete && onDemandCoverage.complete,
        },
        trend: {
            months: conventional.trend.map(point => point.month),
            current: conventional.trend.map(point => point.total),
            priorYear: trendMonths.map(({ year: y, month: m }) => {
                const resolved = resolvers.conventional(y - 1, m);
                return resolved.complete ? resolved.total : null;
            }),
        },
    };
}
