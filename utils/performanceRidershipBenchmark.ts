import type { DailySummary, DayType } from './performanceDataTypes';
import { addDaysToISODate, compareDateStrings } from './performanceDateUtils';

export const RIDERSHIP_BENCHMARK_WEEKS = 8;
/** Days under this share of the day-type median boardings are treated as atypical (e.g. a holiday stored as a weekday). */
export const ATYPICAL_RIDERSHIP_SHARE = 0.6;
/** Days under this share of the day-type median record count are treated as partial imports. */
export const PARTIAL_IMPORT_RECORD_SHARE = 0.75;

export interface DayTypeBenchmark {
    /** Mean daily boardings for this day type over the benchmark window. */
    typical: number;
    /** Days that contributed to the mean. */
    sampleDays: number;
    /** Days left out as atypical service or partial imports. */
    excludedDays: number;
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

function median(values: number[]): number {
    const sorted = [...values].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds a typical-day benchmark per day type from the weeks before the
 * selected window. Days with no boardings are missing data. Days far below the
 * day-type median, in boardings or in imported records, are left out so a
 * holiday or a partial import does not drag the typical day down.
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

    const candidates = new Map<DayType, Array<{ ridership: number; records: number }>>();
    const seen = new Set<string>();
    for (const day of historyDays) {
        if (seen.has(day.date)) continue;
        if (compareDateStrings(day.date, historyStart) < 0 || compareDateStrings(day.date, windowStart) >= 0) continue;
        const ridership = day.system.totalRidership;
        if (!(ridership > 0)) continue;
        seen.add(day.date);
        const list = candidates.get(day.dayType) ?? [];
        list.push({ ridership, records: day.dataQuality?.totalRecords ?? 0 });
        candidates.set(day.dayType, list);
    }

    const benchmarks: RidershipBenchmarks = {};
    for (const [dayType, list] of candidates) {
        const medianRidership = median(list.map(item => item.ridership));
        const recordCounts = list.map(item => item.records).filter(records => records > 0);
        const medianRecords = recordCounts.length > 0 ? median(recordCounts) : 0;
        const kept = list.filter(item => item.ridership >= medianRidership * ATYPICAL_RIDERSHIP_SHARE
            && !(medianRecords > 0 && item.records > 0 && item.records < medianRecords * PARTIAL_IMPORT_RECORD_SHARE));
        if (kept.length === 0) continue;
        benchmarks[dayType] = {
            typical: kept.reduce((sum, item) => sum + item.ridership, 0) / kept.length,
            sampleDays: kept.length,
            excludedDays: list.length - kept.length,
        };
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
