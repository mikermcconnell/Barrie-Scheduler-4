import type { DailySummary, StopMetrics, StopRouteBreakdown } from './performanceDataTypes';
import { addDaysToISODate, compareDateStrings, toDateSortKey } from './performanceDateUtils';

export type StopActivityViewMode = 'total' | 'boardings' | 'alightings';

export interface StopActivityComparisonPeriod {
    days: DailySummary[];
    startDate: string;
    endDate: string;
}

export interface StopActivityChange {
    currentPerDay: number;
    comparisonPerDay: number;
    changePerDay: number;
    changePercent: number | null;
}

const HOURS_PER_DAY = 24;

function emptyHourlySeries(): number[] {
    return new Array(HOURS_PER_DAY).fill(0);
}

function normalizeHourlySeries(hourly: number[] | undefined): number[] {
    return Array.from({ length: HOURS_PER_DAY }, (_, h) => hourly?.[h] || 0);
}

function hasAnyHourlySeries(stop: Pick<StopMetrics, 'hourlyBoardings' | 'hourlyAlightings'>): boolean {
    return !!(stop.hourlyBoardings || stop.hourlyAlightings);
}

function hasAnyRouteHourlySeries(route: Pick<StopRouteBreakdown, 'hourlyBoardings' | 'hourlyAlightings'>): boolean {
    return !!(route.hourlyBoardings || route.hourlyAlightings);
}

function ensureHourlySeries(stop: StopMetrics): void {
    if (!stop.hourlyBoardings) stop.hourlyBoardings = emptyHourlySeries();
    if (!stop.hourlyAlightings) stop.hourlyAlightings = emptyHourlySeries();
}

function ensureRouteHourlySeries(route: StopRouteBreakdown): void {
    if (!route.hourlyBoardings) route.hourlyBoardings = emptyHourlySeries();
    if (!route.hourlyAlightings) route.hourlyAlightings = emptyHourlySeries();
}

function normalizeRouteBreakdown(routeBreakdown: StopRouteBreakdown[] | undefined): StopRouteBreakdown[] {
    if (!routeBreakdown || routeBreakdown.length === 0) return [];
    return routeBreakdown.map(route => {
        const hasRouteHourly = hasAnyRouteHourlySeries(route);
        return {
            ...route,
            hourlyBoardings: hasRouteHourly ? normalizeHourlySeries(route.hourlyBoardings) : undefined,
            hourlyAlightings: hasRouteHourly ? normalizeHourlySeries(route.hourlyAlightings) : undefined,
        };
    });
}

function buildRouteBreakdownFallbackByStop(day: DailySummary): Map<string, StopRouteBreakdown[]> {
    const byStop = new Map<string, Map<string, { boardings: number; alightings: number }>>();

    for (const profile of day.loadProfiles || []) {
        const tripCount = Number.isFinite(profile.tripCount) ? profile.tripCount : 0;
        if (tripCount <= 0) continue;

        for (const stop of profile.stops || []) {
            if (!stop.stopId) continue;

            const boardings = Math.max(0, Math.round(stop.avgBoardings * tripCount));
            const alightings = Math.max(0, Math.round(stop.avgAlightings * tripCount));
            if (boardings === 0 && alightings === 0) continue;

            let byRoute = byStop.get(stop.stopId);
            if (!byRoute) {
                byRoute = new Map<string, { boardings: number; alightings: number }>();
                byStop.set(stop.stopId, byRoute);
            }

            const existing = byRoute.get(profile.routeId);
            if (existing) {
                existing.boardings += boardings;
                existing.alightings += alightings;
            } else {
                byRoute.set(profile.routeId, { boardings, alightings });
            }
        }
    }

    const result = new Map<string, StopRouteBreakdown[]>();
    for (const [stopId, byRoute] of byStop) {
        const rows = Array.from(byRoute.entries())
            .map(([routeId, values]) => ({
                routeId,
                boardings: values.boardings,
                alightings: values.alightings,
            }))
            .filter(row => (row.boardings + row.alightings) > 0)
            .sort((a, b) => {
                const totalCmp = (b.boardings + b.alightings) - (a.boardings + a.alightings);
                if (totalCmp !== 0) return totalCmp;
                return a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
            });
        if (rows.length > 0) result.set(stopId, rows);
    }

    return result;
}

export function getStopActivityBreakdown(
    stop: Pick<StopMetrics, 'boardings' | 'alightings' | 'hourlyBoardings' | 'hourlyAlightings'>,
    hours: number[] | null
): { boardings: number; alightings: number } {
    if (hours !== null && hasAnyHourlySeries(stop)) {
        let boardings = 0;
        let alightings = 0;
        for (const hour of hours) {
            boardings += stop.hourlyBoardings?.[hour] || 0;
            alightings += stop.hourlyAlightings?.[hour] || 0;
        }
        return { boardings, alightings };
    }

    return {
        boardings: stop.boardings,
        alightings: stop.alightings,
    };
}

export function getRouteScopedStopActivityBreakdown(
    stop: Pick<StopMetrics, 'boardings' | 'alightings' | 'hourlyBoardings' | 'hourlyAlightings' | 'routes' | 'routeBreakdown'>,
    routeId: string,
    hours: number[] | null,
): { boardings: number; alightings: number } | null {
    if (routeId === 'all') {
        if (hours !== null && !hasAnyHourlySeries(stop)) return null;
        return getStopActivityBreakdown(stop, hours);
    }

    const route = stop.routeBreakdown?.find(row => row.routeId === routeId);
    if (route) {
        if (hours !== null && !hasAnyRouteHourlySeries(route)) return null;
        if (hours === null) return { boardings: route.boardings, alightings: route.alightings };
        return hours.reduce(
            (totals, hour) => ({
                boardings: totals.boardings + (route.hourlyBoardings?.[hour] || 0),
                alightings: totals.alightings + (route.hourlyAlightings?.[hour] || 0),
            }),
            { boardings: 0, alightings: 0 },
        );
    }

    const routes = stop.routes ?? [];
    if (routes.length === 1 && routes[0] === routeId) {
        if (hours !== null && !hasAnyHourlySeries(stop)) return null;
        return getStopActivityBreakdown(stop, hours);
    }

    return null;
}

export function getStopActivityValue(
    stop: Pick<StopMetrics, 'boardings' | 'alightings' | 'hourlyBoardings' | 'hourlyAlightings'>,
    mode: StopActivityViewMode,
    hours: number[] | null
): number {
    const breakdown = getStopActivityBreakdown(stop, hours);
    if (mode === 'boardings') return breakdown.boardings;
    if (mode === 'alightings') return breakdown.alightings;
    return breakdown.boardings + breakdown.alightings;
}

export function getStopActivityChange(
    current: Pick<StopMetrics, 'boardings' | 'alightings' | 'hourlyBoardings' | 'hourlyAlightings'>,
    comparison: Pick<StopMetrics, 'boardings' | 'alightings' | 'hourlyBoardings' | 'hourlyAlightings'> | undefined,
    mode: StopActivityViewMode,
    hours: number[] | null,
    currentDayCount: number,
    comparisonDayCount: number,
): StopActivityChange {
    const currentPerDay = getStopActivityValue(current, mode, hours) / Math.max(1, currentDayCount);
    const comparisonPerDay = comparison
        ? getStopActivityValue(comparison, mode, hours) / Math.max(1, comparisonDayCount)
        : 0;
    const changePerDay = currentPerDay - comparisonPerDay;
    return {
        currentPerDay,
        comparisonPerDay,
        changePerDay,
        changePercent: comparisonPerDay > 0 ? (changePerDay / comparisonPerDay) * 100 : null,
    };
}

export function hasHourlyDataForStops(stops: Array<Pick<StopMetrics, 'hourlyBoardings' | 'hourlyAlightings'>>): boolean {
    return stops.some(stop =>
        !!(stop.hourlyBoardings?.some(v => v > 0) || stop.hourlyAlightings?.some(v => v > 0))
    );
}

export function getStopRouteActivityBreakdown(
    stop: Pick<StopMetrics, 'routeBreakdown'>,
    hours: number[] | null
): Array<{ routeId: string; boardings: number; alightings: number; total: number }> {
    const routeBreakdown = stop.routeBreakdown || [];
    if (routeBreakdown.length === 0) return [];

    const rows = routeBreakdown.map(route => {
        if (hours !== null && hasAnyRouteHourlySeries(route)) {
            let boardings = 0;
            let alightings = 0;
            for (const hour of hours) {
                boardings += route.hourlyBoardings?.[hour] || 0;
                alightings += route.hourlyAlightings?.[hour] || 0;
            }
            return {
                routeId: route.routeId,
                boardings,
                alightings,
                total: boardings + alightings,
            };
        }
        return {
            routeId: route.routeId,
            boardings: route.boardings,
            alightings: route.alightings,
            total: route.boardings + route.alightings,
        };
    });

    return rows
        .filter(row => row.total > 0)
        .sort((a, b) => {
            const totalCmp = b.total - a.total;
            if (totalCmp !== 0) return totalCmp;
            return a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
        });
}

export function matchesStopSearch(stop: Pick<StopMetrics, 'stopName' | 'stopId'>, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return (
        stop.stopName.toLowerCase().includes(normalized) ||
        stop.stopId.toLowerCase().includes(normalized)
    );
}

/**
 * Returns the equivalent period immediately before the current window.
 * A single-day view compares with the same weekday one week earlier.
 */
export function getPriorStopActivityPeriod(
    allDays: DailySummary[],
    currentWindow: { start: string; end: string },
    dayType: DailySummary['dayType'] | 'all',
): StopActivityComparisonPeriod | null {
    const currentStart = currentWindow.start;
    const currentEnd = currentWindow.end;

    let priorStart: string | null;
    let priorEnd: string | null;
    if (currentStart === currentEnd) {
        priorStart = addDaysToISODate(currentStart, -7);
        priorEnd = priorStart;
    } else {
        const startKey = toDateSortKey(currentStart);
        const endKey = toDateSortKey(currentEnd);
        if (!Number.isFinite(startKey) || !Number.isFinite(endKey)) return null;
        const calendarDayCount = Math.round((endKey - startKey) / (24 * 60 * 60 * 1000)) + 1;
        priorEnd = addDaysToISODate(currentStart, -1);
        priorStart = priorEnd ? addDaysToISODate(priorEnd, -(calendarDayCount - 1)) : null;
    }

    if (!priorStart || !priorEnd) return null;
    const priorStartKey = toDateSortKey(priorStart);
    const priorEndKey = toDateSortKey(priorEnd);
    const days = allDays
        .filter(day => {
            const dayKey = toDateSortKey(day.date);
            return Number.isFinite(dayKey)
                && dayKey >= priorStartKey
                && dayKey <= priorEndKey
                && (dayType === 'all' || day.dayType === dayType);
        })
        .sort((a, b) => compareDateStrings(a.date, b.date));

    return { days, startDate: priorStart, endDate: priorEnd };
}

export function aggregateStopActivity(days: DailySummary[]): StopMetrics[] {
    type AggregatedStop = StopMetrics & {
        _routes: Set<string>;
        _routeBreakdown: Map<string, StopRouteBreakdown>;
    };
    const map = new Map<string, AggregatedStop>();

    for (const day of days) {
        const fallbackRouteBreakdownByStop = buildRouteBreakdownFallbackByStop(day);
        for (const stop of day.byStop) {
            const normalizedRouteBreakdown = normalizeRouteBreakdown(stop.routeBreakdown);
            const effectiveRouteBreakdown = normalizedRouteBreakdown.length > 0
                ? normalizedRouteBreakdown
                : (fallbackRouteBreakdownByStop.get(stop.stopId) || []);
            const existing = map.get(stop.stopId);
            if (existing) {
                existing.boardings += stop.boardings;
                existing.alightings += stop.alightings;
                if (stop.routes) stop.routes.forEach(route => existing._routes.add(route));

                if (effectiveRouteBreakdown.length > 0) {
                    for (const route of effectiveRouteBreakdown) {
                        existing._routes.add(route.routeId);
                        const routeExisting = existing._routeBreakdown.get(route.routeId);
                        if (routeExisting) {
                            routeExisting.boardings += route.boardings;
                            routeExisting.alightings += route.alightings;

                            if (hasAnyRouteHourlySeries(route)) {
                                ensureRouteHourlySeries(routeExisting);
                                const hourlyBoardings = routeExisting.hourlyBoardings;
                                const hourlyAlightings = routeExisting.hourlyAlightings;
                                if (!hourlyBoardings || !hourlyAlightings) continue;
                                for (let h = 0; h < HOURS_PER_DAY; h++) {
                                    hourlyBoardings[h] += route.hourlyBoardings?.[h] || 0;
                                    hourlyAlightings[h] += route.hourlyAlightings?.[h] || 0;
                                }
                            }
                        } else {
                            const hasRouteHourly = hasAnyRouteHourlySeries(route);
                            existing._routeBreakdown.set(route.routeId, {
                                routeId: route.routeId,
                                boardings: route.boardings,
                                alightings: route.alightings,
                                hourlyBoardings: hasRouteHourly ? normalizeHourlySeries(route.hourlyBoardings) : undefined,
                                hourlyAlightings: hasRouteHourly ? normalizeHourlySeries(route.hourlyAlightings) : undefined,
                            });
                        }
                    }
                }

                if (hasAnyHourlySeries(stop)) {
                    ensureHourlySeries(existing);
                    const hourlyBoardings = existing.hourlyBoardings;
                    const hourlyAlightings = existing.hourlyAlightings;
                    if (!hourlyBoardings || !hourlyAlightings) continue;
                    for (let h = 0; h < HOURS_PER_DAY; h++) {
                        hourlyBoardings[h] += stop.hourlyBoardings?.[h] || 0;
                        hourlyAlightings[h] += stop.hourlyAlightings?.[h] || 0;
                    }
                }
                continue;
            }

            const hasHourly = hasAnyHourlySeries(stop);
            const routeBreakdownMap = new Map<string, StopRouteBreakdown>();
            for (const route of effectiveRouteBreakdown) {
                routeBreakdownMap.set(route.routeId, route);
            }
            map.set(stop.stopId, {
                ...stop,
                _routes: new Set([...(stop.routes || []), ...effectiveRouteBreakdown.map(route => route.routeId)]),
                _routeBreakdown: routeBreakdownMap,
                hourlyBoardings: hasHourly ? normalizeHourlySeries(stop.hourlyBoardings) : undefined,
                hourlyAlightings: hasHourly ? normalizeHourlySeries(stop.hourlyAlightings) : undefined,
            });
        }
    }

    return Array.from(map.values()).map(({ _routes, _routeBreakdown, ...rest }) => {
        const routeBreakdown = Array.from(_routeBreakdown.values())
            .sort((a, b) => {
                const totalCmp = (b.boardings + b.alightings) - (a.boardings + a.alightings);
                if (totalCmp !== 0) return totalCmp;
                return a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
            });

        return {
            ...rest,
            routeCount: _routes.size,
            routes: Array.from(_routes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
            routeBreakdown: routeBreakdown.length > 0 ? routeBreakdown : undefined,
        };
    });
}
