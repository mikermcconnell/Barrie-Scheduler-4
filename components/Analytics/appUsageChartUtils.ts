import type { AppUsageDaily } from '../../utils/transit-app/transitAppTypes';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

const monthDayFormatter = new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
});

const fullDateFormatter = new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
});

const monthYearFormatter = new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
});

const monthShortFormatter = new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    timeZone: 'UTC',
});

export interface AppUsageTimelinePoint {
    date: string;
    timestamp: number;
    users: number;
    sessions: number;
    downloads: number;
}

export interface DayOfWeekProfilePoint {
    day: typeof DAY_NAMES[number];
    avgUsers: number;
}

export interface MonthlyAveragePoint {
    month: string;
    label: string;
    avgDailyUsers: number;
    totalUsers: number;
    days: number;
}

export function parseDateOnlyUtc(date: string): Date | null {
    const match = DATE_ONLY_RE.exec(date.trim());
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, monthIndex, day));

    if (
        parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== monthIndex
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }

    return parsed;
}

function parseMonthKeyUtc(monthKey: string): Date | null {
    const match = MONTH_KEY_RE.exec(monthKey.trim());
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const parsed = new Date(Date.UTC(year, monthIndex, 1));

    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== monthIndex) {
        return null;
    }

    return parsed;
}

export function formatMonthDayFromTimestampUtc(timestamp: number): string {
    if (!Number.isFinite(timestamp)) return '';
    return monthDayFormatter.format(new Date(timestamp));
}

export function formatFullDateUtc(date: string): string {
    const parsed = parseDateOnlyUtc(date);
    return parsed ? fullDateFormatter.format(parsed) : date;
}

export function formatMonthYearLabelUtc(monthKey: string): string {
    const parsed = parseMonthKeyUtc(monthKey);
    return parsed ? monthYearFormatter.format(parsed) : monthKey;
}

export function formatMonthShortUtc(date: string): string {
    const parsed = parseDateOnlyUtc(date);
    return parsed ? monthShortFormatter.format(parsed) : date;
}

export function buildAppUsageTimeline(appUsage: AppUsageDaily[]): AppUsageTimelinePoint[] {
    return appUsage
        .map(entry => {
            const parsed = parseDateOnlyUtc(entry.date);
            return parsed
                ? {
                    date: entry.date,
                    timestamp: parsed.getTime(),
                    users: entry.users,
                    sessions: entry.sessions,
                    downloads: entry.downloads,
                }
                : null;
        })
        .filter((entry): entry is AppUsageTimelinePoint => entry !== null)
        .sort((a, b) => a.timestamp - b.timestamp);
}

export function buildDayOfWeekProfile(appUsage: AppUsageDaily[]): DayOfWeekProfilePoint[] {
    const totals = Array(7).fill(0);
    const counts = Array(7).fill(0);

    for (const entry of appUsage) {
        const parsed = parseDateOnlyUtc(entry.date);
        if (!parsed) continue;

        const dayIndex = parsed.getUTCDay();
        totals[dayIndex] += entry.users;
        counts[dayIndex] += 1;
    }

    return DAY_NAMES.map((day, index) => ({
        day,
        avgUsers: counts[index] > 0 ? Math.round(totals[index] / counts[index]) : 0,
    }));
}

export function buildMonthlyAverages(appUsage: AppUsageDaily[]): MonthlyAveragePoint[] {
    const months: Record<string, { users: number; count: number }> = {};

    for (const entry of appUsage) {
        const monthKey = entry.date.slice(0, 7);
        if (!MONTH_KEY_RE.test(monthKey)) continue;

        if (!months[monthKey]) {
            months[monthKey] = { users: 0, count: 0 };
        }

        months[monthKey].users += entry.users;
        months[monthKey].count += 1;
    }

    return Object.entries(months)
        .map(([month, { users, count }]) => ({
            month,
            label: formatMonthYearLabelUtc(month),
            avgDailyUsers: Math.round(users / count),
            totalUsers: users,
            days: count,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
}
