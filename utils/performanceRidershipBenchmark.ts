import type { DailySummary, DayType } from './performanceDataTypes';
import { addDaysToISODate, compareDateStrings } from './performanceDateUtils';

export const RIDERSHIP_BENCHMARK_WEEKS = 8;

export interface DayTypeBenchmark {
    /** Mean daily boardings for this day type over the benchmark window. */
    typical: number;
    /** Days that contributed to the mean. */
    sampleDays: number;
}

export type RidershipBenchmarks = Partial<Record<DayType, DayTypeBenchmark>>;

export interface DailyRidershipRow {
    fullDate: string;
    dayType: DayType;
    ridership: number;
    typical: number | null;
    typicalSampleDays: number;
    /** Percent above (+) or below (-) the day-type typical. */
    vsTypicalPct: number | null;
    /** Boardings on the same weekday one week earlier, when loaded. */
    priorWeek: number | null;
    vsPriorWeekPct: number | null;
    serviceHours: number;
    boardingsPerServiceHour: number | null;
    topRoute: { routeId: string; ridership: number } | null;
}

function pctChange(value: number, base: number | null): number | null {
    if (base === null || base <= 0) return null;
    return ((value - base) / base) * 100;
}

/**
 * Builds a typical-day benchmark per day type from the weeks before the
 * selected window. Days with no boardings are treated as missing data.
 */
export function buildRidershipBenchmarks(
    currentDays: DailySummary[],
    historyDays: DailySummary[],
    weeks = RIDERSHIP_BENCHMARK_WEEKS,
): RidershipBenchmarks {
    const windowStart = currentDays.map(day => day.date).sort(compareDateStrings)[0];
    if (!windowStart) return {};
    const historyStart = addDaysToISODate(windowStart, -weeks * 7);
    if (!historyStart) return {};

    const totals = new Map<DayType, { sum: number; count: number }>();
    const seen = new Set<string>();
    for (const day of historyDays) {
        if (seen.has(day.date)) continue;
        if (compareDateStrings(day.date, historyStart) < 0 || compareDateStrings(day.date, windowStart) >= 0) continue;
        const ridership = day.system.totalRidership;
        if (!(ridership > 0)) continue;
        seen.add(day.date);
        const entry = totals.get(day.dayType) ?? { sum: 0, count: 0 };
        entry.sum += ridership;
        entry.count += 1;
        totals.set(day.dayType, entry);
    }

    const benchmarks: RidershipBenchmarks = {};
    for (const [dayType, { sum, count }] of totals) {
        benchmarks[dayType] = { typical: sum / count, sampleDays: count };
    }
    return benchmarks;
}

export function buildDailyRidershipRows(
    currentDays: DailySummary[],
    historyDays: DailySummary[],
    benchmarks: RidershipBenchmarks,
): DailyRidershipRow[] {
    const ridershipByDate = new Map<string, number>();
    for (const day of [...historyDays, ...currentDays]) {
        ridershipByDate.set(day.date, day.system.totalRidership);
    }

    return [...currentDays]
        .sort((a, b) => compareDateStrings(a.date, b.date))
        .map(day => {
            const ridership = day.system.totalRidership;
            const benchmark = benchmarks[day.dayType];
            const typical = benchmark?.typical ?? null;
            const priorDate = addDaysToISODate(day.date, -7);
            const priorValue = priorDate ? ridershipByDate.get(priorDate) : undefined;
            const priorWeek = priorValue !== undefined && priorValue > 0 ? priorValue : null;
            const serviceHours = day.byRoute.reduce((sum, route) => sum + (route.serviceHours || 0), 0);
            const topRoute = day.byRoute.reduce<DailyRidershipRow['topRoute']>(
                (best, route) => (!best || route.ridership > best.ridership
                    ? { routeId: route.routeId, ridership: route.ridership }
                    : best),
                null,
            );
            return {
                fullDate: day.date,
                dayType: day.dayType,
                ridership,
                typical,
                typicalSampleDays: benchmark?.sampleDays ?? 0,
                vsTypicalPct: pctChange(ridership, typical),
                priorWeek,
                vsPriorWeekPct: pctChange(ridership, priorWeek),
                serviceHours,
                boardingsPerServiceHour: serviceHours > 0 ? ridership / serviceHours : null,
                topRoute: topRoute && topRoute.ridership > 0 ? topRoute : null,
            };
        });
}

export interface DayTypeSummary {
    dayType: DayType;
    days: number;
    avgRidership: number;
    typical: number | null;
    vsTypicalPct: number | null;
}

export function summarizeByDayType(rows: DailyRidershipRow[], benchmarks: RidershipBenchmarks): DayTypeSummary[] {
    const order: DayType[] = ['weekday', 'saturday', 'sunday'];
    return order.flatMap(dayType => {
        const matching = rows.filter(row => row.dayType === dayType);
        if (matching.length === 0) return [];
        const avgRidership = matching.reduce((sum, row) => sum + row.ridership, 0) / matching.length;
        const typical = benchmarks[dayType]?.typical ?? null;
        return [{ dayType, days: matching.length, avgRidership, typical, vsTypicalPct: pctChange(avgRidership, typical) }];
    });
}
