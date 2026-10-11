import type { TodPickupSummary } from '../todPickupTypes';

export interface TodRidershipProjectionV1 {
    schemaVersion: 1;
    metric: 'tod_completed_trips';
    dailyTotals: Record<string, number>;
    latestServiceDate: string | null;
    updatedAt: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createTodRidershipProjection(summary: TodPickupSummary): TodRidershipProjectionV1 {
    const dailyTotals: Record<string, number> = {};
    for (const report of summary.dailyReports ?? []) {
        if (!DATE_PATTERN.test(report.date) || !Number.isFinite(report.totalCompletedTrips)) continue;
        dailyTotals[report.date] = Math.max(0, Math.round(report.totalCompletedTrips));
    }
    const dates = Object.keys(dailyTotals).sort();
    return {
        schemaVersion: 1,
        metric: 'tod_completed_trips',
        dailyTotals,
        latestServiceDate: dates.at(-1) ?? null,
        updatedAt: summary.metadata.importedAt,
    };
}

export function parseTodRidershipProjection(value: unknown): TodRidershipProjectionV1 {
    if (!value || typeof value !== 'object') throw new Error('On Demand ridership data is invalid.');
    const candidate = value as Partial<TodRidershipProjectionV1>;
    if (candidate.schemaVersion !== 1 || candidate.metric !== 'tod_completed_trips'
        || !candidate.dailyTotals || typeof candidate.dailyTotals !== 'object') {
        throw new Error('On Demand ridership data is invalid.');
    }

    const dailyTotals: Record<string, number> = {};
    for (const [date, total] of Object.entries(candidate.dailyTotals)) {
        if (!DATE_PATTERN.test(date) || typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
            throw new Error('On Demand ridership data contains an invalid daily total.');
        }
        dailyTotals[date] = Math.round(total);
    }
    const dates = Object.keys(dailyTotals).sort();
    return {
        schemaVersion: 1,
        metric: 'tod_completed_trips',
        dailyTotals,
        latestServiceDate: dates.at(-1) ?? null,
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
    };
}

export function summarizeTodRidershipMonth(
    projection: TodRidershipProjectionV1 | null | undefined,
    referenceDate: string,
): { total: number | null; observedDays: number; firstServiceDate: string | null; latestServiceDate: string | null } {
    const month = referenceDate.slice(0, 7);
    const dates = Object.keys(projection?.dailyTotals ?? {})
        .filter(date => date.startsWith(`${month}-`) && date <= referenceDate)
        .sort();
    if (dates.length === 0) {
        return { total: null, observedDays: 0, firstServiceDate: null, latestServiceDate: null };
    }
    return {
        total: dates.reduce((sum, date) => sum + (projection?.dailyTotals[date] ?? 0), 0),
        observedDays: dates.length,
        firstServiceDate: dates[0],
        latestServiceDate: dates.at(-1) ?? null,
    };
}
