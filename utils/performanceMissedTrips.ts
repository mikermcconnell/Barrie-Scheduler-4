import type { DayType, DailySummary } from './performanceDataTypes';

export interface AggregatedStoredMissedTrips {
    hasCoverage: boolean;
    totalScheduled: number;
    totalObserved: number;
    totalMissed: number;
    missedPct: number;
    routesMissed: { routeId: string; count: number; earliestDep: string }[];
    skippedDays: number;
    missingStoredDays: number;
}

export interface StoredMissedTripRow {
    date: string;
    routeId: string;
    departure: string;
    headsign: string;
    blockId: string;
    missType: 'not_performed' | 'late_over_15';
    lateByMinutes?: number;
}

export interface LatestStoredMissedTrips {
    date: string;
    trips: StoredMissedTripRow[];
}

interface MissedTripComputationHelpers {
    hasGtfsCoverage: (date: string) => boolean;
    computeMissedTripsForDay: (
        date: string,
        dayType: DayType,
        observedTrips: DailySummary['byTrip'],
    ) => NonNullable<DailySummary['missedTrips']> | null;
}

function buildEmptySummary(): AggregatedStoredMissedTrips {
    return {
        hasCoverage: false,
        totalScheduled: 0,
        totalObserved: 0,
        totalMissed: 0,
        missedPct: 0,
        routesMissed: [],
        skippedDays: 0,
        missingStoredDays: 0,
    };
}

export function aggregateStoredMissedTrips(days: readonly DailySummary[]): AggregatedStoredMissedTrips {
    const summary = buildEmptySummary();

    const missedByRoute = new Map<string, { routeId: string; count: number; earliestDep: string }>();

    for (const day of days) {
        const missed = day.missedTrips;
        if (!missed) {
            summary.skippedDays++;
            summary.missingStoredDays++;
            continue;
        }

        summary.hasCoverage = true;
        summary.totalScheduled += missed.totalScheduled;
        summary.totalObserved += missed.totalMatched;
        summary.totalMissed += missed.totalMissed;

        for (const route of missed.byRoute) {
            const existing = missedByRoute.get(route.routeId);
            if (existing) {
                existing.count += route.count;
                if (route.earliestDep < existing.earliestDep) existing.earliestDep = route.earliestDep;
            } else {
                missedByRoute.set(route.routeId, {
                    routeId: route.routeId,
                    count: route.count,
                    earliestDep: route.earliestDep,
                });
            }
        }
    }

    return {
        ...summary,
        missedPct: summary.totalScheduled > 0 ? (summary.totalMissed / summary.totalScheduled) * 100 : 0,
        routesMissed: Array.from(missedByRoute.values()).sort((a, b) =>
            b.count - a.count || a.routeId.localeCompare(b.routeId, undefined, { numeric: true })
        ),
    };
}

export function computeAggregatedMissedTrips(
    days: readonly DailySummary[],
    helpers: MissedTripComputationHelpers,
): AggregatedStoredMissedTrips {
    const summary = buildEmptySummary();
    const missedByRoute = new Map<string, { routeId: string; count: number; earliestDep: string }>();

    for (const day of days) {
        if (!helpers.hasGtfsCoverage(day.date)) continue;
        summary.hasCoverage = true;

        const missed = helpers.computeMissedTripsForDay(day.date, day.dayType, day.byTrip);
        if (!missed) {
            summary.skippedDays++;
            continue;
        }

        summary.totalScheduled += missed.totalScheduled;
        summary.totalObserved += missed.totalMatched;
        summary.totalMissed += missed.totalMissed;

        for (const route of missed.byRoute) {
            const existing = missedByRoute.get(route.routeId);
            if (existing) {
                existing.count += route.count;
                if (route.earliestDep < existing.earliestDep) existing.earliestDep = route.earliestDep;
            } else {
                missedByRoute.set(route.routeId, {
                    routeId: route.routeId,
                    count: route.count,
                    earliestDep: route.earliestDep,
                });
            }
        }
    }

    return {
        ...summary,
        missedPct: summary.totalScheduled > 0 ? (summary.totalMissed / summary.totalScheduled) * 100 : 0,
        routesMissed: Array.from(missedByRoute.values()).sort((a, b) =>
            b.count - a.count || a.routeId.localeCompare(b.routeId, undefined, { numeric: true })
        ),
    };
}

export function getLatestStoredMissedTrips(days: readonly DailySummary[]): LatestStoredMissedTrips | null {
    const latestDay = days
        .filter((day): day is DailySummary & { missedTrips: NonNullable<DailySummary['missedTrips']> } => !!day.missedTrips)
        .reduce<DailySummary | null>((latest, day) => {
            if (!latest || day.date > latest.date) return day;
            return latest;
        }, null);

    if (!latestDay?.missedTrips) return null;

    return {
        date: latestDay.date,
        trips: (latestDay.missedTrips.trips ?? [])
            .map(trip => ({
                date: latestDay.date,
                routeId: trip.routeId,
                departure: trip.departure,
                headsign: trip.headsign,
                blockId: trip.blockId,
                missType: trip.missType,
                lateByMinutes: trip.lateByMinutes,
            }))
            .sort((a, b) => {
                const routeCompare = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
                if (routeCompare !== 0) return routeCompare;
                return a.departure.localeCompare(b.departure);
            }),
    };
}
