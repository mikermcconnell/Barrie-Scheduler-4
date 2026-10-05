import type {
    RidershipTrendBaselineV1,
    RidershipTrendMonth,
    RidershipTrendView,
} from './types';

export interface RidershipTrendForecastMonth {
    month: number;
    monthKey: string;
    actual: number | null;
    projected: number | null;
    remainingEstimate: number;
    status: 'actual' | 'actual-plus-forecast' | 'forecast';
}

export interface RidershipTrendForecast {
    year: number;
    comparisonYear: number;
    completedThroughMonth: number;
    trendFactor: number;
    actualToDate: number;
    remainingEstimate: number;
    projectedAnnualTotal: number;
    lowEstimate: number;
    highEstimate: number;
    backtestSampleSize: number;
    backtestMedianAbsoluteError: number;
    months: RidershipTrendForecastMonth[];
}

interface ForecastBacktestResult {
    sampleSize: number;
    medianAbsoluteError: number;
}

function monthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function median(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getBaselineMonths(
    baseline: RidershipTrendBaselineV1,
    year: number,
): Array<number | null> {
    return Array.from({ length: 12 }, (_, index) => (
        baseline.monthlyTotals[monthKey(year, index + 1)] ?? null
    ));
}

function allPresent(values: readonly (number | null)[]): values is number[] {
    return values.every((value): value is number => value !== null);
}

export function backtestRidershipTrendForecast(
    baseline: RidershipTrendBaselineV1,
    completedThroughMonth: number,
): ForecastBacktestResult {
    if (!Number.isInteger(completedThroughMonth)
        || completedThroughMonth < 1
        || completedThroughMonth > 11) {
        return { sampleSize: 0, medianAbsoluteError: 0 };
    }

    const years = [...new Set(
        Object.keys(baseline.monthlyTotals).map(key => Number(key.slice(0, 4))),
    )].filter(Number.isInteger).sort((left, right) => left - right);
    const absoluteErrors: number[] = [];

    for (const year of years) {
        const current = getBaselineMonths(baseline, year);
        const previous = getBaselineMonths(baseline, year - 1);
        if (!allPresent(current) || !allPresent(previous)) continue;

        const currentThrough = sum(current.slice(0, completedThroughMonth));
        const previousThrough = sum(previous.slice(0, completedThroughMonth));
        const previousRemaining = sum(previous.slice(completedThroughMonth));
        const actualAnnual = sum(current);
        if (previousThrough <= 0 || actualAnnual <= 0) continue;

        const predictedAnnual = currentThrough + (previousRemaining * (currentThrough / previousThrough));
        absoluteErrors.push(Math.abs(predictedAnnual - actualAnnual) / actualAnnual);
    }

    return {
        sampleSize: absoluteErrors.length,
        medianAbsoluteError: median(absoluteErrors),
    };
}

function getMonth(
    months: readonly RidershipTrendMonth[],
    year: number,
    month: number,
): RidershipTrendMonth | null {
    return months.find(item => item.year === year && item.month === month) ?? null;
}

export function buildRidershipTrendForecast(
    baseline: RidershipTrendBaselineV1,
    view: RidershipTrendView,
): RidershipTrendForecast | null {
    const activeMonth = Number(view.referenceDate.slice(5, 7));
    const completedThroughMonth = activeMonth - 1;
    const comparisonYear = view.activeYear - 1;
    if (completedThroughMonth < 1 || view.currentYtd.total === null) return null;

    const currentCompletedMonths = Array.from({ length: completedThroughMonth }, (_, index) => (
        getMonth(view.monthly, view.activeYear, index + 1)
    ));
    const previousCompletedMonths = Array.from({ length: completedThroughMonth }, (_, index) => (
        getMonth(view.monthly, comparisonYear, index + 1)
    ));
    const completedCoverageIsUsable = [...currentCompletedMonths, ...previousCompletedMonths]
        .every(month => month?.total !== null && month?.coverageStatus === 'complete');
    if (!completedCoverageIsUsable) return null;

    const currentCompletedTotal = sum(currentCompletedMonths.map(month => month?.total ?? 0));
    const previousCompletedTotal = sum(previousCompletedMonths.map(month => month?.total ?? 0));
    if (previousCompletedTotal <= 0) return null;
    const trendFactor = currentCompletedTotal / previousCompletedTotal;

    const months: RidershipTrendForecastMonth[] = [];
    for (let month = 1; month <= 12; month += 1) {
        const current = getMonth(view.monthly, view.activeYear, month);
        if (month < activeMonth) {
            months.push({
                month,
                monthKey: monthKey(view.activeYear, month),
                actual: current?.total ?? null,
                projected: null,
                remainingEstimate: 0,
                status: 'actual',
            });
            continue;
        }

        const previous = getMonth(view.monthly, comparisonYear, month);
        if (previous?.total === null || previous?.total === undefined) return null;
        const seasonalMonthEstimate = previous.total * trendFactor;

        if (month === activeMonth) {
            const actual = current?.total ?? null;
            const fullMonthIsAlreadyActual = current?.coverageStatus === 'complete'
                && current.observedDays === null;
            const observedDays = Math.min(
                daysInMonth(view.activeYear, month),
                Math.max(0, current?.observedDays ?? 0),
            );
            const remainingShare = fullMonthIsAlreadyActual
                ? 0
                : (daysInMonth(view.activeYear, month) - observedDays)
                    / daysInMonth(view.activeYear, month);
            const remainingEstimate = Math.round(seasonalMonthEstimate * remainingShare);
            months.push({
                month,
                monthKey: monthKey(view.activeYear, month),
                actual,
                projected: (actual ?? 0) + remainingEstimate,
                remainingEstimate,
                status: actual === null ? 'forecast' : 'actual-plus-forecast',
            });
            continue;
        }

        const projected = Math.round(seasonalMonthEstimate);
        months.push({
            month,
            monthKey: monthKey(view.activeYear, month),
            actual: null,
            projected,
            remainingEstimate: projected,
            status: 'forecast',
        });
    }

    const remainingEstimate = sum(months.map(month => month.remainingEstimate));
    const projectedAnnualTotal = view.currentYtd.total + remainingEstimate;
    const backtest = backtestRidershipTrendForecast(baseline, completedThroughMonth);
    const uncertainty = backtest.medianAbsoluteError;

    return {
        year: view.activeYear,
        comparisonYear,
        completedThroughMonth,
        trendFactor,
        actualToDate: view.currentYtd.total,
        remainingEstimate,
        projectedAnnualTotal,
        lowEstimate: Math.max(view.currentYtd.total, Math.round(projectedAnnualTotal * (1 - uncertainty))),
        highEstimate: Math.round(projectedAnnualTotal * (1 + uncertainty)),
        backtestSampleSize: backtest.sampleSize,
        backtestMedianAbsoluteError: uncertainty,
        months,
    };
}
