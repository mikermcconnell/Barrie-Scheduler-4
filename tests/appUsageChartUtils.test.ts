import { describe, expect, it } from 'vitest';
import {
    buildAppUsageTimeline,
    buildDayOfWeekProfile,
    buildMonthlyAverages,
    formatFullDateUtc,
    formatMonthDayFromTimestampUtc,
    formatMonthShortUtc,
    formatMonthYearLabelUtc,
    parseDateOnlyUtc,
} from '../components/Analytics/appUsageChartUtils';

describe('appUsageChartUtils', () => {
    it('parses YYYY-MM-DD strings in UTC without shifting the calendar date', () => {
        const parsed = parseDateOnlyUtc('2025-01-01');

        expect(parsed?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
        expect(parsed?.getUTCDay()).toBe(3); // Wednesday
    });

    it('formats month labels without shifting into the previous month', () => {
        expect(formatMonthYearLabelUtc('2025-01')).toBe('Jan 25');
        expect(formatMonthYearLabelUtc('2025-07')).toBe('Jul 25');
        expect(formatMonthYearLabelUtc('2025-09')).toBe('Sep 25');
        expect(formatMonthShortUtc('2025-09-03')).toBe('Sep');
    });

    it('builds a time series with UTC-safe timestamps and readable labels', () => {
        const timeline = buildAppUsageTimeline([
            { date: '2025-01-01', users: 100, sessions: 200, downloads: 10 },
            { date: '2025-01-03', users: 120, sessions: 230, downloads: 12 },
        ]);

        expect(timeline).toHaveLength(2);
        expect(formatMonthDayFromTimestampUtc(timeline[0].timestamp)).toBe('Jan 1');
        expect(formatFullDateUtc(timeline[1].date)).toBe('Jan 3, 2025');
    });

    it('assigns day-of-week averages to the correct weekday buckets', () => {
        const profile = buildDayOfWeekProfile([
            { date: '2025-01-01', users: 100, sessions: 200, downloads: 10 }, // Wed
            { date: '2025-01-08', users: 120, sessions: 220, downloads: 12 }, // Wed
            { date: '2025-01-04', users: 50, sessions: 90, downloads: 5 }, // Sat
        ]);

        expect(profile.find(day => day.day === 'Wed')?.avgUsers).toBe(110);
        expect(profile.find(day => day.day === 'Sat')?.avgUsers).toBe(50);
        expect(profile.find(day => day.day === 'Tue')?.avgUsers).toBe(0);
    });

    it('computes monthly averages with the correct month labels', () => {
        const monthly = buildMonthlyAverages([
            { date: '2025-01-01', users: 100, sessions: 200, downloads: 10 },
            { date: '2025-01-08', users: 120, sessions: 220, downloads: 12 },
            { date: '2025-07-01', users: 80, sessions: 150, downloads: 8 },
        ]);

        expect(monthly).toEqual([
            {
                month: '2025-01',
                label: 'Jan 25',
                avgDailyUsers: 110,
                totalUsers: 220,
                days: 2,
            },
            {
                month: '2025-07',
                label: 'Jul 25',
                avgDailyUsers: 80,
                totalUsers: 80,
                days: 1,
            },
        ]);
    });
});
