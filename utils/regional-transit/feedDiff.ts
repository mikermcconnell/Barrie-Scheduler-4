import { getGoTrainEvents } from './connectionAnalysis';
import type { ConnectionDirection, GoStationKey, GoTrainEvent, RegionalGoFeed } from './types';

export type ServiceDayType = 'Weekday' | 'Saturday' | 'Sunday';
export type TrainChangeKind = 'added' | 'removed' | 'shifted';

export interface TrainChange {
    station: GoStationKey;
    direction: ConnectionDirection;
    dayType: ServiceDayType;
    kind: TrainChangeKind;
    trainNumber: string;
    headsign: string;
    beforeMinutes?: number;
    afterMinutes?: number;
}

export interface DayTypeComparison {
    dayType: ServiceDayType;
    beforeDate: string | null;
    afterDate: string | null;
    unchanged: number;
    issues: string[];
}

export interface GoFeedDiff {
    changes: TrainChange[];
    comparisons: DayTypeComparison[];
}

const STATIONS: GoStationKey[] = ['allandale', 'south'];
const DAY_TYPES: { dayType: ServiceDayType; utcDay: number }[] = [
    { dayType: 'Weekday', utcDay: 3 },
    { dayType: 'Saturday', utcDay: 6 },
    { dayType: 'Sunday', utcDay: 0 },
];
const CANDIDATES_PER_DAY_TYPE = 8;
const SHIFT_THRESHOLD_MINUTES = 0.5;

/** Archived snapshots are old by design, so the live-feed freshness check is bypassed. */
export function archivedFeed(feed: RegionalGoFeed): RegionalGoFeed {
    return { ...feed, fetchedAt: new Date().toISOString() };
}

function isoDate(gtfsDate: string): string {
    return `${gtfsDate.slice(0, 4)}-${gtfsDate.slice(4, 6)}-${gtfsDate.slice(6, 8)}`;
}

function coverageOf(feed: RegionalGoFeed): { from: string; to: string } | null {
    const starts = [...feed.calendar.map(row => row.start_date), ...feed.calendarDates.map(row => row.date)].sort();
    const ends = [...feed.calendar.map(row => row.end_date), ...feed.calendarDates.map(row => row.date)].sort();
    return starts.length ? { from: isoDate(starts[0]), to: isoDate(ends[ends.length - 1]) } : null;
}

/** A normal service day of this type: the busiest of the first few matching dates, which skips holiday dates. */
export function representativeServiceDate(feed: RegionalGoFeed, dayType: ServiceDayType): string | null {
    const coverage = coverageOf(feed);
    const target = DAY_TYPES.find(item => item.dayType === dayType)?.utcDay;
    if (!coverage || target === undefined) return null;
    const checked = archivedFeed(feed);
    const cursor = new Date(`${coverage.from}T12:00:00Z`);
    const end = new Date(`${coverage.to}T12:00:00Z`);
    let best: { date: string; count: number } | null = null;
    let candidates = 0;
    for (; cursor <= end && candidates < CANDIDATES_PER_DAY_TYPE; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        if (cursor.getUTCDay() !== target) continue;
        candidates++;
        const date = cursor.toISOString().slice(0, 10);
        const count = STATIONS.reduce((sum, station) => sum + getGoTrainEvents(checked, station, date).events.length, 0);
        if (count > 0 && (!best || count > best.count)) best = { date, count };
    }
    return best?.date ?? null;
}

function groupByTrain(events: GoTrainEvent[]): Map<string, GoTrainEvent[]> {
    const groups = new Map<string, GoTrainEvent[]>();
    for (const event of events) {
        const key = `${event.direction}|${event.trainNumber || event.tripId}`;
        groups.set(key, [...(groups.get(key) ?? []), event].sort((a, b) => a.minutes - b.minutes));
    }
    return groups;
}

function compareServiceDates(beforeFeed: RegionalGoFeed, afterFeed: RegionalGoFeed, comparison: DayTypeComparison, changes: TrainChange[]): void {
    const { dayType, beforeDate, afterDate } = comparison;
    if (!beforeDate && !afterDate) return;
    for (const station of STATIONS) {
        const beforeResult = beforeDate ? getGoTrainEvents(beforeFeed, station, beforeDate) : null;
        const afterResult = afterDate ? getGoTrainEvents(afterFeed, station, afterDate) : null;
        for (const result of [beforeResult, afterResult]) {
            if (result?.status === 'unavailable') comparison.issues.push(...result.issues);
        }
        const beforeGroups = groupByTrain(beforeResult?.events ?? []);
        const afterGroups = groupByTrain(afterResult?.events ?? []);
        for (const key of new Set([...beforeGroups.keys(), ...afterGroups.keys()])) {
            const olds = beforeGroups.get(key) ?? [];
            const news = afterGroups.get(key) ?? [];
            for (let index = 0; index < Math.max(olds.length, news.length); index++) {
                const old = olds[index];
                const next = news[index];
                const reference = next ?? old;
                const base = { station, direction: reference.direction, dayType, trainNumber: reference.trainNumber, headsign: reference.headsign };
                if (old && next) {
                    if (Math.abs(old.minutes - next.minutes) >= SHIFT_THRESHOLD_MINUTES) {
                        changes.push({ ...base, kind: 'shifted', beforeMinutes: old.minutes, afterMinutes: next.minutes });
                    } else {
                        comparison.unchanged++;
                    }
                } else if (old) {
                    changes.push({ ...base, kind: 'removed', beforeMinutes: old.minutes });
                } else {
                    changes.push({ ...base, kind: 'added', afterMinutes: next.minutes });
                }
            }
        }
    }
}

function sortChanges(changes: TrainChange[]): TrainChange[] {
    return changes.sort((a, b) => a.dayType.localeCompare(b.dayType) || a.station.localeCompare(b.station) ||
        a.direction.localeCompare(b.direction) || (a.afterMinutes ?? a.beforeMinutes ?? 0) - (b.afterMinutes ?? b.beforeMinutes ?? 0));
}

/** Compares two GO snapshots at Barrie's stations, one normal Weekday, Saturday and Sunday each; trains are matched by train number. */
export function diffGoFeeds(before: RegionalGoFeed, after: RegionalGoFeed): GoFeedDiff {
    const changes: TrainChange[] = [];
    const comparisons: DayTypeComparison[] = [];
    const beforeFeed = archivedFeed(before);
    const afterFeed = archivedFeed(after);
    for (const { dayType } of DAY_TYPES) {
        const comparison: DayTypeComparison = {
            dayType, beforeDate: representativeServiceDate(before, dayType), afterDate: representativeServiceDate(after, dayType), unchanged: 0, issues: [],
        };
        comparisons.push(comparison);
        compareServiceDates(beforeFeed, afterFeed, comparison, changes);
    }
    return { changes: sortChanges(changes), comparisons };
}

/** Compares two GO timetables on chosen service dates at Barrie's stations; trains are matched by train number. */
export function diffGoFeedsOnDates(before: RegionalGoFeed, after: RegionalGoFeed, beforeDate: string | null, afterDate: string | null, dayType: ServiceDayType): GoFeedDiff {
    const changes: TrainChange[] = [];
    const comparison: DayTypeComparison = { dayType, beforeDate, afterDate, unchanged: 0, issues: [] };
    compareServiceDates(before, after, comparison, changes);
    return { changes: sortChanges(changes), comparisons: [comparison] };
}
