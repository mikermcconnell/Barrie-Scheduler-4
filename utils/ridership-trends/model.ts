import {
    RIDERSHIP_TREND_BASELINE_HASH,
    RIDERSHIP_TREND_CUTOVER_DATE,
    RIDERSHIP_TREND_METRIC,
    type RidershipTrendAnnualChange,
    type RidershipTrendBaselineV1,
    type RidershipTrendDailyInput,
    type RidershipTrendMonth,
    type RidershipTrendProjectionV1,
    type RidershipTrendSource,
    type RidershipTrendView,
    type RidershipTrendYear,
} from './types';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isIsoDate(value: string): boolean {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function assertIsoDate(value: string, fieldName: string): void {
    if (!isIsoDate(value)) throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
}

function isIsoTimestamp(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseRidershipTrendProjection(value: unknown): RidershipTrendProjectionV1 {
    if (!isRecord(value)
        || value.schemaVersion !== 1
        || value.metric !== RIDERSHIP_TREND_METRIC
        || value.cutoverDate !== RIDERSHIP_TREND_CUTOVER_DATE
        || value.baselineHash !== RIDERSHIP_TREND_BASELINE_HASH
        || !isRecord(value.dailyTotals)
        || !isIsoTimestamp(value.updatedAt)) {
        throw new Error('Stored Ridership Trends projection has an unsupported or invalid schema.');
    }

    const dailyTotals: RidershipTrendProjectionV1['dailyTotals'] = {};
    for (const [date, rawTotal] of Object.entries(value.dailyTotals).sort(([left], [right]) => (
        left.localeCompare(right)
    ))) {
        if (!isIsoDate(date)
            || date < RIDERSHIP_TREND_CUTOVER_DATE
            || !isRecord(rawTotal)
            || !Number.isSafeInteger(rawTotal.boardings)
            || (rawTotal.boardings as number) < 0
            || !Number.isSafeInteger(rawTotal.performanceSchemaVersion)
            || (rawTotal.performanceSchemaVersion as number) < 1) {
            throw new Error('Stored Ridership Trends projection contains invalid daily totals.');
        }
        dailyTotals[date] = {
            boardings: rawTotal.boardings as number,
            performanceSchemaVersion: rawTotal.performanceSchemaVersion as number,
        };
    }

    const expectedLatestServiceDate = Object.keys(dailyTotals).at(-1) ?? null;
    if (value.latestServiceDate !== expectedLatestServiceDate) {
        throw new Error('Stored Ridership Trends projection has an invalid latest service date.');
    }
    return {
        schemaVersion: 1,
        metric: RIDERSHIP_TREND_METRIC,
        cutoverDate: RIDERSHIP_TREND_CUTOVER_DATE,
        baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
        dailyTotals,
        latestServiceDate: expectedLatestServiceDate,
        updatedAt: value.updatedAt,
    };
}

function monthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function enumerateDates(startDate: string, endDate: string): string[] {
    if (startDate > endDate) return [];
    const dates: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    while (cursor <= end) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

function sumPresent(values: ReadonlyArray<number | null>): number | null {
    const present = values.filter((value): value is number => value !== null);
    return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0);
}

function resolveSource(months: readonly RidershipTrendMonth[]): RidershipTrendSource {
    const sources = new Set(months.filter(month => month.total !== null).map(month => month.source));
    if (sources.size === 0) return 'workbook';
    if (sources.size === 1) return sources.values().next().value ?? 'workbook';
    return 'mixed';
}

export function createRidershipTrendProjection(input: {
    baselineHash: string;
    updatedAt: string;
}): RidershipTrendProjectionV1 {
    if (input.baselineHash !== RIDERSHIP_TREND_BASELINE_HASH) {
        throw new Error('baselineHash does not match the current workbook baseline.');
    }
    if (!isIsoTimestamp(input.updatedAt)) throw new Error('updatedAt must be an ISO timestamp.');
    return {
        schemaVersion: 1,
        metric: RIDERSHIP_TREND_METRIC,
        cutoverDate: RIDERSHIP_TREND_CUTOVER_DATE,
        baselineHash: input.baselineHash,
        dailyTotals: {},
        latestServiceDate: null,
        updatedAt: input.updatedAt,
    };
}

export function mergeRidershipTrendProjection(
    current: RidershipTrendProjectionV1,
    incoming: readonly RidershipTrendDailyInput[],
    updatedAt: string,
): RidershipTrendProjectionV1 {
    const validatedCurrent = parseRidershipTrendProjection(current);
    if (!isIsoTimestamp(updatedAt)) throw new Error('updatedAt must be an ISO timestamp.');

    const merged = { ...validatedCurrent.dailyTotals };
    for (const item of incoming) {
        assertIsoDate(item.date, 'date');
        if (item.date < validatedCurrent.cutoverDate) continue;
        if (!Number.isSafeInteger(item.boardings) || item.boardings < 0) {
            throw new Error(`Boardings for ${item.date} must be a non-negative whole number.`);
        }
        if (!Number.isSafeInteger(item.performanceSchemaVersion) || item.performanceSchemaVersion < 1) {
            throw new Error(`Performance schema version for ${item.date} must be a positive integer.`);
        }
        merged[item.date] = {
            boardings: item.boardings,
            performanceSchemaVersion: item.performanceSchemaVersion,
        };
    }

    const dailyTotals = Object.fromEntries(
        Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)),
    );
    const dates = Object.keys(dailyTotals);
    return {
        ...validatedCurrent,
        dailyTotals,
        latestServiceDate: dates.at(-1) ?? null,
        updatedAt,
    };
}

function buildMonths(
    baseline: RidershipTrendBaselineV1,
    projection: RidershipTrendProjectionV1,
    referenceDate: string,
): RidershipTrendMonth[] {
    const firstBaselineMonth = Object.keys(baseline.monthlyTotals).sort()[0];
    if (!firstBaselineMonth) return [];
    const activeMonthKey = referenceDate.slice(0, 7);
    const latestEvidenceDate = projection.latestServiceDate && projection.latestServiceDate < referenceDate
        ? projection.latestServiceDate
        : referenceDate;
    const finalMonthKey = activeMonthKey > baseline.source.finalMonth ? activeMonthKey : baseline.source.finalMonth;
    const dailyEntries = Object.entries(projection.dailyTotals).filter(([date]) => date <= referenceDate);
    const result: RidershipTrendMonth[] = [];

    let cursorYear = Number(firstBaselineMonth.slice(0, 4));
    let cursorMonth = Number(firstBaselineMonth.slice(5, 7));
    while (monthKey(cursorYear, cursorMonth) <= finalMonthKey) {
        const key = monthKey(cursorYear, cursorMonth);
        const baselineTotal = baseline.monthlyTotals[key];
        if (baselineTotal !== undefined) {
            result.push({
                year: cursorYear,
                month: cursorMonth,
                monthKey: key,
                total: baselineTotal,
                source: 'workbook',
                coverageStatus: 'complete',
                observedDays: null,
                expectedDays: null,
                missingDates: [],
            });
        } else if (key >= projection.cutoverDate.slice(0, 7) && key <= activeMonthKey) {
            const monthEntries = dailyEntries.filter(([date]) => date.startsWith(`${key}-`));
            const monthEnd = `${key}-${String(daysInMonth(cursorYear, cursorMonth)).padStart(2, '0')}`;
            const expectedEnd = key === activeMonthKey ? latestEvidenceDate : monthEnd;
            const expectedDates = expectedEnd.startsWith(`${key}-`)
                ? enumerateDates(`${key}-01`, expectedEnd)
                : [];
            const observed = new Set(monthEntries.map(([date]) => date));
            const missingDates = expectedDates.filter(date => !observed.has(date));
            result.push({
                year: cursorYear,
                month: cursorMonth,
                monthKey: key,
                total: monthEntries.length === 0
                    ? null
                    : monthEntries.reduce((sum, [, value]) => sum + value.boardings, 0),
                source: 'live',
                coverageStatus: monthEntries.length === 0
                    ? 'missing'
                    : missingDates.length === 0 ? 'complete' : 'partial',
                observedDays: monthEntries.length,
                expectedDays: expectedDates.length,
                missingDates,
            });
        } else {
            result.push({
                year: cursorYear,
                month: cursorMonth,
                monthKey: key,
                total: null,
                source: key < projection.cutoverDate.slice(0, 7) ? 'workbook' : 'live',
                coverageStatus: 'missing',
                observedDays: null,
                expectedDays: null,
                missingDates: [],
            });
        }

        cursorMonth += 1;
        if (cursorMonth === 13) {
            cursorMonth = 1;
            cursorYear += 1;
        }
    }
    return result;
}

function buildYears(months: readonly RidershipTrendMonth[]): RidershipTrendYear[] {
    const years = [...new Set(months.map(month => month.year))].sort((a, b) => a - b);
    return years.map(year => {
        const yearMonths = Array.from({ length: 12 }, (_, index) => (
            months.find(month => month.year === year && month.month === index + 1) ?? null
        ));
        const values = yearMonths.map(month => month?.total ?? null);
        const populated = yearMonths.filter((month): month is RidershipTrendMonth => month !== null);
        const complete = populated.length === 12
            && populated.every(month => month.coverageStatus === 'complete' && month.total !== null);
        const hasEvidence = values.some(value => value !== null);
        return {
            year,
            months: values,
            total: hasEvidence ? sumPresent(values) : null,
            source: resolveSource(populated),
            coverageStatus: !hasEvidence ? 'missing' : complete ? 'complete' : 'partial',
        };
    });
}

function calculateChange(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null || previous === 0) return null;
    return (current - previous) / previous;
}

export function buildRidershipTrendView(
    baseline: RidershipTrendBaselineV1,
    projection: RidershipTrendProjectionV1,
    referenceDate: string,
): RidershipTrendView {
    assertIsoDate(referenceDate, 'referenceDate');
    if (baseline.schemaVersion !== 1 || baseline.metric !== RIDERSHIP_TREND_METRIC) {
        throw new Error('Unsupported ridership trend baseline.');
    }
    if (projection.baselineHash !== baseline.source.sha256) {
        throw new Error('Ridership trend projection does not match the workbook baseline.');
    }

    const activeYear = Number(referenceDate.slice(0, 4));
    const activeMonth = Number(referenceDate.slice(5, 7));
    const monthly = buildMonths(baseline, projection, referenceDate);
    const years = buildYears(monthly);
    const annualSeries = years.filter(year => year.year < activeYear);
    const annualChanges: RidershipTrendAnnualChange[] = [];
    for (let index = 1; index < annualSeries.length; index += 1) {
        const previous = annualSeries[index - 1];
        const current = annualSeries[index];
        if (current.year !== previous.year + 1 || current.total === null || previous.total === null) continue;
        const coverageComplete = current.coverageStatus === 'complete' && previous.coverageStatus === 'complete';
        annualChanges.push({
            year: current.year,
            previousYear: previous.year,
            currentTotal: current.total,
            previousTotal: previous.total,
            change: coverageComplete ? calculateChange(current.total, previous.total) : null,
            suppressedReason: coverageComplete ? null : 'incomplete_coverage',
        });
    }

    const currentYear = years.find(year => year.year === activeYear);
    const throughMonth = Math.max(0, activeMonth - 1);
    const currentComparableMonths = currentYear?.months.slice(0, throughMonth) ?? [];
    const previousYear = years.find(year => year.year === activeYear - 1);
    const previousComparableMonths = previousYear?.months.slice(0, throughMonth) ?? [];
    const comparableCoverageComplete = throughMonth > 0
        && currentComparableMonths.length === throughMonth
        && previousComparableMonths.length === throughMonth
        && currentComparableMonths.every(value => value !== null)
        && previousComparableMonths.every(value => value !== null)
        && monthly
            .filter(month => (month.year === activeYear || month.year === activeYear - 1) && month.month <= throughMonth)
            .every(month => month.coverageStatus === 'complete');
    const currentComparableTotal = throughMonth === 0 ? null : sumPresent(currentComparableMonths);
    const previousComparableTotal = throughMonth === 0 ? null : sumPresent(previousComparableMonths);
    const currentYearMonthsThroughReference = monthly.filter(month => (
        month.year === activeYear && month.month <= activeMonth
    ));
    const currentYtdTotal = sumPresent(currentYearMonthsThroughReference.map(month => month.total));
    const liveExpectedDates = projection.latestServiceDate
        ? enumerateDates(projection.cutoverDate, projection.latestServiceDate)
        : [];
    const liveObservedDates = new Set(Object.keys(projection.dailyTotals).filter(date => (
        date >= projection.cutoverDate && (!projection.latestServiceDate || date <= projection.latestServiceDate)
    )));
    const liveMissingDates = liveExpectedDates.filter(date => !liveObservedDates.has(date));

    return {
        referenceDate,
        activeYear,
        latestServiceDate: projection.latestServiceDate,
        monthly,
        years,
        annualSeries,
        annualChanges,
        currentYtd: {
            total: currentYtdTotal,
            coverageComplete: currentYearMonthsThroughReference.length === activeMonth
                && currentYearMonthsThroughReference.every(month => month.coverageStatus === 'complete'),
        },
        completedMonthComparison: {
            throughMonth,
            currentTotal: currentComparableTotal,
            previousTotal: previousComparableTotal,
            change: comparableCoverageComplete
                ? calculateChange(currentComparableTotal, previousComparableTotal)
                : null,
            coverageComplete: comparableCoverageComplete,
        },
        activePartialMonth: monthly.find(month => (
            month.year === activeYear && month.month === activeMonth
        )) ?? null,
        liveCoverage: {
            observedDays: liveObservedDates.size,
            expectedDays: liveExpectedDates.length,
            missingDates: liveMissingDates,
            complete: liveMissingDates.length === 0,
        },
    };
}
