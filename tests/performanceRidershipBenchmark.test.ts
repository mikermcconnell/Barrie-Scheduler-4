import { describe, expect, it } from 'vitest';
import type { DailySummary, DayType } from '../utils/performanceDataTypes';
import {
    buildDailyRidershipRows,
    buildRidershipBenchmarks,
    summarizeByDayType,
} from '../utils/performanceRidershipBenchmark';

function day(date: string, dayType: DayType, ridership: number, serviceHours = 10): DailySummary {
    return {
        date,
        dayType,
        system: { totalRidership: ridership } as DailySummary['system'],
        byRoute: [
            { routeId: '1', ridership: Math.round(ridership * 0.4), serviceHours: serviceHours / 2 },
            { routeId: '8A', ridership: Math.round(ridership * 0.6), serviceHours: serviceHours / 2 },
        ] as DailySummary['byRoute'],
        byHour: [], byStop: [], byTrip: [], loadProfiles: [],
    } as DailySummary;
}

describe('ridership typical-day benchmark', () => {
    // 2026-10-22 is a Thursday.
    const current = [day('2026-10-22', 'weekday', 1100), day('2026-10-24', 'saturday', 450)];

    it('averages each day type over the 8 weeks before the window and ignores days outside it', () => {
        const history = [
            day('2026-08-26', 'weekday', 9999), // 57 days before: outside the window
            day('2026-08-27', 'weekday', 900),  // exactly 56 days before: inside
            day('2026-10-15', 'weekday', 1100),
            day('2026-10-17', 'saturday', 500),
            day('2026-10-22', 'weekday', 5000), // current window: excluded from its own benchmark
        ];
        const benchmarks = buildRidershipBenchmarks(current, history);
        expect(benchmarks.weekday).toEqual({ typical: 1000, sampleDays: 2, excludedDays: 0 });
        expect(benchmarks.saturday).toEqual({ typical: 500, sampleDays: 1, excludedDays: 0 });
        expect(benchmarks.sunday).toBeUndefined();
    });

    it('treats zero-boarding days as missing data, not as a real low day', () => {
        const benchmarks = buildRidershipBenchmarks(current, [
            day('2026-10-15', 'weekday', 0),
            day('2026-10-14', 'weekday', 1000),
        ]);
        expect(benchmarks.weekday).toEqual({ typical: 1000, sampleDays: 1, excludedDays: 0 });
    });

    it('leaves out holidays stored as weekdays and partial imports', () => {
        // Mirrors Labour Day 2026 (Sunday service stored as a weekday) and the
        // partially imported 2026-10-13.
        const withRecords = (d: DailySummary, records: number) => ({ ...d, dataQuality: { totalRecords: records } } as DailySummary);
        const history = [
            withRecords(day('2026-09-08', 'weekday', 9200), 37000),
            withRecords(day('2026-09-09', 'weekday', 8800), 37000),
            withRecords(day('2026-09-10', 'weekday', 9000), 38000),
            withRecords(day('2026-09-07', 'weekday', 2643), 16441),
            withRecords(day('2026-10-13', 'weekday', 6584), 24468),
        ];
        expect(buildRidershipBenchmarks(current, history).weekday).toEqual({ typical: 9000, sampleDays: 3, excludedDays: 2 });
    });

    it('builds per-day rows with typical, prior-week and service-hour comparisons', () => {
        const history = [day('2026-10-15', 'weekday', 1000, 20), day('2026-10-17', 'saturday', 500)];
        const benchmarks = buildRidershipBenchmarks(current, history);
        const rows = buildDailyRidershipRows(current, history, benchmarks);

        expect(rows[0]).toMatchObject({
            fullDate: '2026-10-22',
            typical: 1000,
            priorWeek: 1000,
            serviceHours: 10,
            boardingsPerServiceHour: 110,
            topRoute: { routeId: '8A', ridership: 660 },
        });
        expect(rows[0].vsTypicalPct).toBeCloseTo(10);
        expect(rows[0].vsPriorWeekPct).toBeCloseTo(10);
        expect(rows[1].vsTypicalPct).toBeCloseTo(-10);
    });

    it('leaves comparisons empty when no history is loaded', () => {
        const rows = buildDailyRidershipRows(current, [], buildRidershipBenchmarks(current, []));
        expect(rows[0]).toMatchObject({ typical: null, vsTypicalPct: null, priorWeek: null, vsPriorWeekPct: null });
    });

    it('summarizes the window by day type in weekday, Saturday, Sunday order', () => {
        const history = [day('2026-10-15', 'weekday', 1000), day('2026-10-17', 'saturday', 500)];
        const benchmarks = buildRidershipBenchmarks(current, history);
        const summary = summarizeByDayType(buildDailyRidershipRows(current, history, benchmarks), benchmarks);
        expect(summary.map(s => s.dayType)).toEqual(['weekday', 'saturday']);
        expect(summary[0]).toMatchObject({ days: 1, avgRidership: 1100, typical: 1000 });
    });
});

describe('ridership detail range includes benchmark history', () => {
    it('loads 8 weeks before the selected window when the comparison period is requested', async () => {
        const { resolveDetailDateRange } = await import('../utils/performanceDetailDateRange');
        const metadata = { importedAt: '', importedBy: '', dateRange: { start: '2026-01-01', end: '2026-10-28' }, dayCount: 1, totalRecords: 1 };
        expect(resolveDetailDateRange(metadata, 'past-week', null, null, false)).toEqual({ start: '2026-10-22', end: '2026-10-28' });
        expect(resolveDetailDateRange(metadata, 'past-week', null, null, true)).toEqual({ start: '2026-08-27', end: '2026-10-28' });
        expect(resolveDetailDateRange(metadata, 'all', null, null, true)).toBeUndefined();
    });
});
