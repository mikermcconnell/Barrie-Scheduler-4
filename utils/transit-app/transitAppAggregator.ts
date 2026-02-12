/**
 * Transit App Data Aggregator
 *
 * Transforms raw parsed rows into compact summary objects for Firebase storage.
 * Single-pass Map-based aggregation for performance (~2.3M location rows → ~2,500 cells).
 */

import type {
    TransitAppParsedData,
    TransitAppFileStats,
    TransitAppDataSummary,
    RouteMetricDaily,
    RouteMetricSummary,
    HourlyTripDistribution,
    DailyTripCount,
    LocationGridCell,
    RouteLegSummary,
    AppUsageDaily,
    TransitAppTripRow,
    TransitAppTripLegRow,
    ODPairData,
    ODPair,
    ODCoverageGap,
    RoutePerformanceMonthly,
    TransitAppRoutePerformance,
    RoutePerformanceScorecardRow,
    RouteWatchlistRow,
    RouteDemandSupplyProfile,
    RouteSupplyProfile,
    ServiceGapRegisterRow,
    ServiceGapType,
    TransferDayType,
    TransferSeason,
    TransferTimeBand,
    TransitAppServiceGapAnalysis,
    TransitAppStopProximityAnalysis,
    StopCoverageGapCluster,
    StopMentionRankingRow,
    TransitAppHeatmapAnalysis,
    HeatmapCallout,
    LocationAtlasSlice,
    HeatmapAtlasSliceId,
    LocationTimeBand,
} from './transitAppTypes';
import {
    classifyTrend,
    computeCompositeScore,
    computePercentileRanks,
    deriveConfidence,
    isWeekendDate,
    median,
    safeRate,
    toMonthKey,
} from './transitAppScoring';
import { evaluatePlannerRules } from './transitAppPlannerRules';
import {
    getRouteSupplyProfiles,
    getScheduledTripsForRouteOnDate,
    hasGtfsNormalizationData,
    hasGtfsSupplyProfiles,
} from './transitAppGtfsNormalization';
import { analyzeTransferConnections } from './transitAppTransferAnalysis';
import { getAllStopsWithCoords, findNearestStopName } from '../gtfs/gtfsStopLookup';
import { loadGtfsRouteShapes, pointToPolylineDistanceKm } from '../gtfs/gtfsShapesLoader';

// ============ MAIN AGGREGATOR ============

export function aggregateTransitAppData(
    parsed: TransitAppParsedData,
    stats: TransitAppFileStats,
    userId: string
): TransitAppDataSummary {
    const routeMetrics = aggregateRouteMetrics(parsed.lines);
    const tripDistribution = aggregateTripDistribution(parsed.trips);
    const heatmapAnalysis = aggregateHeatmapAnalysis(parsed.locations);
    const locationDensity = {
        cells: heatmapAnalysis.base.cells,
        bounds: heatmapAnalysis.base.bounds,
        totalPoints: heatmapAnalysis.base.totalPoints,
        rawPoints: heatmapAnalysis.base.rawPoints,
        debiasedPoints: heatmapAnalysis.base.debiasedPoints,
        debiasWindowMinutes: heatmapAnalysis.base.debiasWindowMinutes,
    };
    const transferAnalysisResult = analyzeTransferConnections(parsed.goTripLegs, parsed.tappedTripLegs);

    // Combine all leg types for transfer and route analysis
    const allLegs = [
        ...parsed.goTripLegs,
        ...parsed.plannedTripLegs,
        ...parsed.tappedTripLegs,
    ];
    const routeLegs = aggregateRouteLegSummary(allLegs);
    const routePerformance = aggregateRoutePerformance(routeMetrics.daily, routeLegs);
    const serviceGapAnalysis = aggregateServiceGapAnalysis(allLegs, routeMetrics.summary, routePerformance?.scorecard || []);
    const odPairs = aggregateODPairs(parsed.trips);
    const stopProximityAnalysis = aggregateStopProximityAnalysis(parsed.trips, allLegs, odPairs);
    const appUsage = aggregateAppUsage(parsed.users);

    return {
        schemaVersion: 3,
        routeMetrics,
        tripDistribution,
        locationDensity,
        odPairs,
        transferPatterns: transferAnalysisResult.transferPatterns,
        transferAnalysis: transferAnalysisResult.transferAnalysis,
        routeLegs,
        routePerformance,
        serviceGapAnalysis,
        stopProximityAnalysis,
        heatmapAnalysis: heatmapAnalysis.analysis,
        appUsage,
        metadata: {
            importedAt: new Date().toISOString(),
            importedBy: userId,
            dateRange: stats.dateRange || { start: '', end: '' },
            fileStats: stats,
        },
    };
}

// ============ SUB-AGGREGATORS ============

function aggregateRouteMetrics(lines: TransitAppParsedData['lines']): TransitAppDataSummary['routeMetrics'] {
    // Group by route+date → daily
    const dailyMap = new Map<string, RouteMetricDaily>();
    for (const row of lines) {
        const key = `${row.route_short_name}_${row.date}`;
        const existing = dailyMap.get(key);
        if (existing) {
            existing.nearbyViews += row.nearby_views;
            existing.nearbyTaps += row.nearby_taps;
            existing.tappedRoutingSuggestions += row.tapped_routing_suggestions;
            existing.goTrips += row.go_trips;
        } else {
            dailyMap.set(key, {
                date: row.date,
                route: row.route_short_name,
                nearbyViews: row.nearby_views,
                nearbyTaps: row.nearby_taps,
                tappedRoutingSuggestions: row.tapped_routing_suggestions,
                goTrips: row.go_trips,
            });
        }
    }

    const daily = Array.from(dailyMap.values());
    daily.sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route));

    // Per-route summary
    const routeMap = new Map<string, { views: number; taps: number; suggestions: number; goTrips: number; days: Set<string> }>();
    for (const d of daily) {
        const existing = routeMap.get(d.route);
        if (existing) {
            existing.views += d.nearbyViews;
            existing.taps += d.nearbyTaps;
            existing.suggestions += d.tappedRoutingSuggestions;
            existing.goTrips += d.goTrips;
            existing.days.add(d.date);
        } else {
            routeMap.set(d.route, {
                views: d.nearbyViews,
                taps: d.nearbyTaps,
                suggestions: d.tappedRoutingSuggestions,
                goTrips: d.goTrips,
                days: new Set([d.date]),
            });
        }
    }

    const summary: RouteMetricSummary[] = Array.from(routeMap.entries())
        .map(([route, data]) => ({
            route,
            totalViews: data.views,
            totalTaps: data.taps,
            totalSuggestions: data.suggestions,
            totalGoTrips: data.goTrips,
            avgDailyViews: data.days.size > 0 ? Math.round(data.views / data.days.size) : 0,
            avgDailyTaps: data.days.size > 0 ? Math.round(data.taps / data.days.size) : 0,
            daysActive: data.days.size,
        }))
        .sort((a, b) => b.totalViews - a.totalViews);

    return { daily, summary };
}

const ROUTE_PERFORMANCE_SCHEMA_VERSION = 1;
const MINIMUM_VIEWS_FOR_RATIOS = 30;
const TREND_DELTA_POINTS = 5;
const SERVICE_GAP_SCHEMA_VERSION = 1;
const MAX_GAP_REGISTER_ROWS = 500;
const STOP_PROXIMITY_SCHEMA_VERSION = 1;
const HEATMAP_ANALYSIS_SCHEMA_VERSION = 1;
const STOP_PROXIMITY_THRESHOLD_KM = 0.4;
const STOP_CLUSTER_RESOLUTION = 0.004; // ~400m
const LOCATION_DEBIAS_WINDOW_MINUTES = 15;

interface DayPartAccumulator {
    views: number;
    taps: number;
    suggestions: number;
    goTrips: number;
}

interface RouteMonthAccumulator {
    route: string;
    month: string;
    days: Set<string>;
    totalViews: number;
    totalTaps: number;
    totalSuggestions: number;
    totalGoTrips: number;
    totalScheduledTrips: number;
    scheduledDays: number;
    weekday: DayPartAccumulator;
    weekend: DayPartAccumulator;
}

function aggregateRoutePerformance(
    dailyMetrics: RouteMetricDaily[],
    routeLegs: RouteLegSummary[]
): TransitAppRoutePerformance {
    const gtfsAvailable = hasGtfsNormalizationData();
    const routeLegMap = new Map<string, RouteLegSummary>();
    for (const leg of routeLegs) {
        routeLegMap.set(normalizeRouteKey(leg.route), leg);
    }

    const monthlyMap = new Map<string, RouteMonthAccumulator>();
    for (const daily of dailyMetrics) {
        const route = normalizeRouteKey(daily.route);
        const month = toMonthKey(daily.date);
        const key = `${route}|${month}`;
        let acc = monthlyMap.get(key);
        if (!acc) {
            acc = {
                route,
                month,
                days: new Set<string>(),
                totalViews: 0,
                totalTaps: 0,
                totalSuggestions: 0,
                totalGoTrips: 0,
                totalScheduledTrips: 0,
                scheduledDays: 0,
                weekday: { views: 0, taps: 0, suggestions: 0, goTrips: 0 },
                weekend: { views: 0, taps: 0, suggestions: 0, goTrips: 0 },
            };
            monthlyMap.set(key, acc);
        }

        acc.days.add(daily.date);
        acc.totalViews += daily.nearbyViews;
        acc.totalTaps += daily.nearbyTaps;
        acc.totalSuggestions += daily.tappedRoutingSuggestions;
        acc.totalGoTrips += daily.goTrips;

        const scheduledTrips = gtfsAvailable ? getScheduledTripsForRouteOnDate(route, daily.date) : null;
        if (scheduledTrips !== null && scheduledTrips > 0) {
            acc.totalScheduledTrips += scheduledTrips;
            acc.scheduledDays += 1;
        }

        const bucket = isWeekendDate(daily.date) ? acc.weekend : acc.weekday;
        bucket.views += daily.nearbyViews;
        bucket.taps += daily.nearbyTaps;
        bucket.suggestions += daily.tappedRoutingSuggestions;
        bucket.goTrips += daily.goTrips;
    }

    const monthlyRows: RoutePerformanceMonthly[] = [];
    const dayPartByKey = new Map<string, { weekday: DayPartAccumulator; weekend: DayPartAccumulator }>();

    for (const [key, acc] of monthlyMap.entries()) {
        const legs = routeLegMap.get(acc.route);
        const daysActive = acc.days.size;
        const ratioEligible = acc.totalViews >= MINIMUM_VIEWS_FOR_RATIOS;
        const viewsPerScheduledTrip = gtfsAvailable && acc.totalScheduledTrips > 0
            ? safeRate(acc.totalViews, acc.totalScheduledTrips, 4)
            : null;
        const tapsPerScheduledTrip = gtfsAvailable && acc.totalScheduledTrips > 0
            ? safeRate(acc.totalTaps, acc.totalScheduledTrips, 4)
            : null;

        const monthly: RoutePerformanceMonthly = {
            route: acc.route,
            month: acc.month,
            daysActive,
            totalViews: acc.totalViews,
            totalTaps: acc.totalTaps,
            totalSuggestions: acc.totalSuggestions,
            totalGoTrips: acc.totalGoTrips,
            totalLegs: legs?.totalLegs || 0,
            uniqueTrips: legs?.uniqueTrips || 0,
            avgDailyViews: daysActive > 0 ? Math.round(acc.totalViews / daysActive) : 0,
            avgDailyTaps: daysActive > 0 ? Math.round(acc.totalTaps / daysActive) : 0,
            viewToTapRate: ratioEligible ? safeRate(acc.totalTaps, acc.totalViews, 4) : null,
            tapToSuggestionRate: ratioEligible ? safeRate(acc.totalSuggestions, acc.totalTaps, 4) : null,
            suggestionToGoRate: ratioEligible ? safeRate(acc.totalGoTrips, acc.totalSuggestions, 4) : null,
            viewToTapRankPct: null,
            tapToSuggestionRankPct: null,
            suggestionToGoRankPct: null,
            goTripsRankPct: null,
            totalLegsRankPct: null,
            compositeScore: null,
            weekdayScore: null,
            weekendScore: null,
            viewsPerScheduledTrip,
            tapsPerScheduledTrip,
            normalizationAvailable: viewsPerScheduledTrip !== null || tapsPerScheduledTrip !== null,
            confidence: deriveConfidence(acc.totalViews, daysActive),
        };

        monthlyRows.push(monthly);
        dayPartByKey.set(key, { weekday: acc.weekday, weekend: acc.weekend });
    }

    monthlyRows.sort((a, b) => a.month.localeCompare(b.month) || a.route.localeCompare(b.route));
    applyMonthlyPercentilesAndScores(monthlyRows);
    applyDayPartScores(monthlyRows, dayPartByKey, 'weekday');
    applyDayPartScores(monthlyRows, dayPartByKey, 'weekend');

    const months = Array.from(new Set(monthlyRows.map(r => r.month))).sort((a, b) => a.localeCompare(b));
    const latestMonth = months.length > 0 ? months[months.length - 1] : null;
    const latestRows = latestMonth ? monthlyRows.filter(r => r.month === latestMonth) : [];
    const latestMedianScore = median(latestRows.map(r => r.compositeScore));

    const rowsByRoute = new Map<string, RoutePerformanceMonthly[]>();
    for (const row of monthlyRows) {
        const existing = rowsByRoute.get(row.route);
        if (existing) {
            existing.push(row);
        } else {
            rowsByRoute.set(row.route, [row]);
        }
    }
    for (const rows of rowsByRoute.values()) {
        rows.sort((a, b) => a.month.localeCompare(b.month));
    }

    const scorecard: RoutePerformanceScorecardRow[] = [];
    for (const [route, rows] of rowsByRoute.entries()) {
        const latest = rows[rows.length - 1];
        const previous = rows.length > 1 ? rows[rows.length - 2] : null;
        const trendInfo = classifyTrend(latest.compositeScore, previous?.compositeScore ?? null, TREND_DELTA_POINTS);

        const belowMedian = latestMedianScore !== null
            && latest.compositeScore !== null
            && latest.compositeScore < latestMedianScore;

        const priorScores = rows
            .slice(0, rows.length - 1)
            .map(r => r.compositeScore)
            .filter((score): score is number => score !== null);
        const seasonalDropPoints = latest.compositeScore !== null && priorScores.length > 0
            ? Math.max(0, Math.max(...priorScores) - latest.compositeScore)
            : null;

        const isWatchRoute = belowMedian && trendInfo.trend === 'Declining';
        const isMonitorRoute = !isWatchRoute && (belowMedian || trendInfo.trend === 'Declining');
        const planner = evaluatePlannerRules({
            confidence: latest.confidence,
            totalViews: latest.totalViews,
            viewToTapRate: latest.viewToTapRate,
            tapToSuggestionRate: latest.tapToSuggestionRate,
            suggestionToGoRate: latest.suggestionToGoRate,
            compositeScore: latest.compositeScore,
            trend: trendInfo.trend,
            belowMedian,
            weekdayScore: latest.weekdayScore,
            weekendScore: latest.weekendScore,
            seasonalDropPoints,
        });

        scorecard.push({
            route,
            latestMonth: latest.month,
            avgDailyViews: latest.avgDailyViews,
            avgDailyTaps: latest.avgDailyTaps,
            totalViews: latest.totalViews,
            totalTaps: latest.totalTaps,
            totalSuggestions: latest.totalSuggestions,
            totalGoTrips: latest.totalGoTrips,
            totalLegs: latest.totalLegs,
            uniqueTrips: latest.uniqueTrips,
            viewToTapRate: latest.viewToTapRate,
            tapToSuggestionRate: latest.tapToSuggestionRate,
            suggestionToGoRate: latest.suggestionToGoRate,
            compositeScore: latest.compositeScore,
            trend: trendInfo.trend,
            trendDelta: trendInfo.delta,
            weekdayScore: latest.weekdayScore,
            weekendScore: latest.weekendScore,
            viewsPerScheduledTrip: latest.viewsPerScheduledTrip,
            tapsPerScheduledTrip: latest.tapsPerScheduledTrip,
            normalizationAvailable: latest.normalizationAvailable,
            belowMedian,
            isWatchRoute,
            isMonitorRoute,
            confidence: latest.confidence,
            diagnosisCode: planner.diagnosisCode,
            diagnosisLabel: planner.diagnosisLabel,
            recommendedAction: planner.recommendedAction,
            recommendedActionLabel: planner.recommendedActionLabel,
            effortBand: planner.effortBand,
            impactBand: planner.impactBand,
        });
    }

    scorecard.sort((a, b) => {
        const watchDelta = Number(b.isWatchRoute) - Number(a.isWatchRoute);
        if (watchDelta !== 0) return watchDelta;
        const aScore = a.compositeScore ?? Number.POSITIVE_INFINITY;
        const bScore = b.compositeScore ?? Number.POSITIVE_INFINITY;
        return aScore - bScore;
    });

    const watchlist: RouteWatchlistRow[] = scorecard
        .filter(r => r.isWatchRoute || r.isMonitorRoute)
        .map(row => ({
            route: row.route,
            latestMonth: row.latestMonth,
            compositeScore: row.compositeScore,
            trend: row.trend,
            belowMedian: row.belowMedian,
            confidence: row.confidence,
            diagnosisCode: row.diagnosisCode,
            recommendedAction: row.recommendedAction,
            priorityScore: computePriorityScore(row, latestMedianScore),
        }))
        .sort((a, b) => b.priorityScore - a.priorityScore);

    return {
        schemaVersion: ROUTE_PERFORMANCE_SCHEMA_VERSION,
        thresholds: {
            minimumViewsForRatios: MINIMUM_VIEWS_FOR_RATIOS,
            trendDeltaPoints: TREND_DELTA_POINTS,
        },
        months,
        latestMonth,
        latestMedianScore,
        monthly: monthlyRows,
        scorecard,
        watchlist,
        generatedAt: new Date().toISOString(),
    };
}

function applyMonthlyPercentilesAndScores(rows: RoutePerformanceMonthly[]): void {
    const months = Array.from(new Set(rows.map(r => r.month)));
    for (const month of months) {
        const monthRows = rows.filter(r => r.month === month);
        const viewToTapRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.viewToTapRate })));
        const tapToSuggestionRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.tapToSuggestionRate })));
        const suggestionToGoRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.suggestionToGoRate })));
        const goTripsRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.totalGoTrips })));
        const totalLegRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.totalLegs })));

        for (const row of monthRows) {
            row.viewToTapRankPct = viewToTapRanks.get(row.route) ?? null;
            row.tapToSuggestionRankPct = tapToSuggestionRanks.get(row.route) ?? null;
            row.suggestionToGoRankPct = suggestionToGoRanks.get(row.route) ?? null;
            row.goTripsRankPct = goTripsRanks.get(row.route) ?? null;
            row.totalLegsRankPct = totalLegRanks.get(row.route) ?? null;
            row.compositeScore = computeCompositeScore({
                viewToTapRankPct: row.viewToTapRankPct,
                tapToSuggestionRankPct: row.tapToSuggestionRankPct,
                goTripsRankPct: row.goTripsRankPct,
                totalLegsRankPct: row.totalLegsRankPct,
                suggestionToGoRankPct: row.suggestionToGoRankPct,
            });
        }
    }
}

function applyDayPartScores(
    rows: RoutePerformanceMonthly[],
    dayPartByKey: Map<string, { weekday: DayPartAccumulator; weekend: DayPartAccumulator }>,
    dayPart: 'weekday' | 'weekend'
): void {
    const months = Array.from(new Set(rows.map(r => r.month)));
    for (const month of months) {
        const monthRows = rows.filter(r => r.month === month);
        const metrics = monthRows.map(row => {
            const key = `${row.route}|${row.month}`;
            const dayMetrics = dayPartByKey.get(key)?.[dayPart] || { views: 0, taps: 0, suggestions: 0, goTrips: 0 };
            const ratioEligible = dayMetrics.views >= MINIMUM_VIEWS_FOR_RATIOS;
            return {
                route: row.route,
                viewToTapRate: ratioEligible ? safeRate(dayMetrics.taps, dayMetrics.views, 4) : null,
                tapToSuggestionRate: ratioEligible ? safeRate(dayMetrics.suggestions, dayMetrics.taps, 4) : null,
                suggestionToGoRate: ratioEligible ? safeRate(dayMetrics.goTrips, dayMetrics.suggestions, 4) : null,
                goTrips: dayMetrics.goTrips,
                totalLegs: row.totalLegs,
            };
        });

        const viewToTapRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.viewToTapRate })));
        const tapToSuggestionRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.tapToSuggestionRate })));
        const suggestionToGoRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.suggestionToGoRate })));
        const goTripsRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.goTrips })));
        const totalLegRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.totalLegs })));

        for (const row of monthRows) {
            const score = computeCompositeScore({
                viewToTapRankPct: viewToTapRanks.get(row.route) ?? null,
                tapToSuggestionRankPct: tapToSuggestionRanks.get(row.route) ?? null,
                goTripsRankPct: goTripsRanks.get(row.route) ?? null,
                totalLegsRankPct: totalLegRanks.get(row.route) ?? null,
                suggestionToGoRankPct: suggestionToGoRanks.get(row.route) ?? null,
            });
            if (dayPart === 'weekday') {
                row.weekdayScore = score;
            } else {
                row.weekendScore = score;
            }
        }
    }
}

function computePriorityScore(row: RoutePerformanceScorecardRow, medianScore: number | null): number {
    const scoreGap = row.compositeScore !== null && medianScore !== null
        ? Math.max(0, medianScore - row.compositeScore)
        : 0;

    const trendPenalty = row.trend === 'Declining' ? Math.abs(row.trendDelta || 0) : 0;
    const confidenceWeight = row.confidence === 'High' ? 10 : row.confidence === 'Medium' ? 5 : 1;
    const demandWeight = Math.min(20, row.avgDailyViews / 10);
    const raw = (scoreGap * 1.2) + trendPenalty + confidenceWeight + demandWeight;
    return Math.round(raw * 100) / 100;
}

function normalizeRouteKey(route: string): string {
    return route.trim().toUpperCase();
}

function parseUtcDateTime(value: string): Date | null {
    if (!value) return null;
    const dt = new Date(value.replace(' UTC', 'Z'));
    return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Convert a UTC Date to Eastern Time hour (0-23). Accounts for EDT/EST. */
function utcToEasternHour(dt: Date): number {
    const month = dt.getUTCMonth(); // 0-indexed
    const day = dt.getUTCDate();
    // Approximate DST: EDT = second Sunday in March to first Sunday in November
    // Simplified: March 10 – November 3 (close enough for hourly binning)
    const isEDT = (month > 2 && month < 10) ||
        (month === 2 && day >= 10) ||
        (month === 10 && day < 3);
    const offset = isEDT ? -4 : -5;
    return (dt.getUTCHours() + offset + 24) % 24;
}

/** Convert a UTC Date to Eastern Time date string (YYYY-MM-DD), accounting for day rollover. */
function utcToEasternDateStr(dt: Date): string {
    const month = dt.getUTCMonth();
    const day = dt.getUTCDate();
    const isEDT = (month > 2 && month < 10) ||
        (month === 2 && day >= 10) ||
        (month === 10 && day < 3);
    const offset = isEDT ? -4 : -5;
    const localMs = dt.getTime() + offset * 3600_000;
    const local = new Date(localMs);
    return local.toISOString().split('T')[0];
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function inferTimeBandForHour(hour: number): TransferTimeBand {
    if (hour >= 6 && hour < 9) return 'am_peak';
    if (hour >= 9 && hour < 15) return 'midday';
    if (hour >= 15 && hour < 18) return 'pm_peak';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'overnight';
}

function inferDayTypeForDate(date: Date): TransferDayType {
    const day = date.getUTCDay();
    if (day === 0) return 'sunday';
    if (day === 6) return 'saturday';
    return 'weekday';
}

function inferSeasonForDate(date: Date): TransferSeason {
    const month = date.getUTCMonth() + 1;
    if (month === 1) return 'jan';
    if (month === 7) return 'jul';
    if (month === 9) return 'sep';
    return 'other';
}

function inferLocationTimeBand(hour: number): LocationTimeBand {
    if (hour >= 6 && hour < 9) return 'am_peak';
    if (hour >= 9 && hour < 15) return 'midday';
    if (hour >= 15 && hour < 18) return 'pm_peak';
    return 'evening';
}

function toOperationMinute(hour: number): number {
    // Keep late-night buckets in-service-day order (00:00-02:59 treated as after 24:00).
    return hour < 3 ? (hour + 24) * 60 : hour * 60;
}

function aggregateServiceGapAnalysis(
    allLegs: TransitAppTripLegRow[],
    routeSummary: RouteMetricSummary[],
    scorecard: RoutePerformanceScorecardRow[]
): TransitAppServiceGapAnalysis | undefined {
    if (!hasGtfsSupplyProfiles()) return undefined;

    const supplyProfiles = getRouteSupplyProfiles();
    if (supplyProfiles.length === 0) return undefined;

    const routeDemandHourly = new Map<string, number>();
    const seasonsByRouteDay = new Map<string, Set<TransferSeason>>();
    const routesWithDemand = new Set<string>();

    for (const leg of allLegs) {
        if (!leg.route_short_name) continue;
        if ((leg.mode || '').trim().toUpperCase() !== 'TRANSIT') continue;
        const timestamp = parseUtcDateTime(leg.start_time || leg.end_time);
        if (!timestamp) continue;

        const route = normalizeRouteKey(leg.route_short_name);
        const dayType = inferDayTypeForDate(timestamp);
        const season = inferSeasonForDate(timestamp);
        const hour = utcToEasternHour(timestamp);
        const key = `${route}|${dayType}|${season}|${hour}`;
        routeDemandHourly.set(key, (routeDemandHourly.get(key) || 0) + 1);
        routesWithDemand.add(route);

        const routeDayKey = `${route}|${dayType}`;
        const existingSeasons = seasonsByRouteDay.get(routeDayKey);
        if (existingSeasons) {
            existingSeasons.add(season);
        } else {
            seasonsByRouteDay.set(routeDayKey, new Set([season]));
        }
    }

    const supplyByRouteDay = new Map<string, RouteSupplyProfile>();
    const routesWithSupply = new Set<string>();
    for (const profile of supplyProfiles) {
        const route = normalizeRouteKey(profile.route);
        supplyByRouteDay.set(`${route}|${profile.dayType}`, profile);
        routesWithSupply.add(route);
    }

    const engagementByRoute = new Map(routeSummary.map(row => [normalizeRouteKey(row.route), row]));
    const scoreByRoute = new Map(scorecard.map(row => [normalizeRouteKey(row.route), row]));

    const routeProfiles: RouteDemandSupplyProfile[] = [];
    const profileByKey = new Map<string, RouteDemandSupplyProfile>();

    for (const route of Array.from(routesWithDemand).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
        const dayTypes: TransferDayType[] = ['weekday', 'saturday', 'sunday'];
        for (const dayType of dayTypes) {
            const seasonSet = seasonsByRouteDay.get(`${route}|${dayType}`);
            if (!seasonSet || seasonSet.size === 0) continue;

            const supply = supplyByRouteDay.get(`${route}|${dayType}`);
            const firstDepMin = supply?.firstDepartureMin ?? null;
            const lastDepMin = supply?.lastDepartureMin ?? null;
            const firstOpMin = firstDepMin === null ? null : firstDepMin;
            const lastOpMin = lastDepMin === null ? null : lastDepMin;

            for (const season of Array.from(seasonSet.values()).sort()) {
                const hourly = new Array(24).fill(null).map((_, hour) => {
                    const demand = routeDemandHourly.get(`${route}|${dayType}|${season}|${hour}`) || 0;
                    const supplyAtHour = supply?.departuresByHour?.[hour] || 0;
                    return { hour, demand, supply: supplyAtHour };
                });

                const totalDemand = hourly.reduce((sum, h) => sum + h.demand, 0);
                const totalSupply = hourly.reduce((sum, h) => sum + h.supply, 0);

                let demandBeforeFirst = 0;
                let demandAfterLast = 0;
                if (firstOpMin !== null || lastOpMin !== null) {
                    for (const point of hourly) {
                        const opMinute = toOperationMinute(point.hour);
                        if (firstOpMin !== null && opMinute < firstOpMin) demandBeforeFirst += point.demand;
                        if (lastOpMin !== null && opMinute > lastOpMin) demandAfterLast += point.demand;
                    }
                }

                const profile: RouteDemandSupplyProfile = {
                    route,
                    dayType,
                    season,
                    firstDepartureMin: firstDepMin,
                    lastDepartureMin: lastDepMin,
                    avgHeadwayMinutes: supply?.avgHeadwayMinutes ?? null,
                    totalDemand,
                    totalSupply,
                    demandBeforeFirst,
                    demandAfterLast,
                    hourly,
                };
                routeProfiles.push(profile);
                profileByKey.set(`${route}|${dayType}|${season}`, profile);
            }
        }
    }

    interface GapAccumulator {
        route: string;
        gapType: ServiceGapType;
        dayType: TransferDayType;
        timeBand: TransferTimeBand;
        season: TransferSeason;
        demandTotal: number;
        supplyTotal: number;
        bucketCount: number;
        notes: Set<string>;
    }

    const gapMap = new Map<string, GapAccumulator>();
    const addGap = (
        route: string,
        gapType: ServiceGapType,
        dayType: TransferDayType,
        season: TransferSeason,
        hour: number,
        demand: number,
        supply: number,
        note: string
    ) => {
        const timeBand = inferTimeBandForHour(hour);
        const key = `${route}|${gapType}|${dayType}|${timeBand}|${season}`;
        let acc = gapMap.get(key);
        if (!acc) {
            acc = {
                route,
                gapType,
                dayType,
                timeBand,
                season,
                demandTotal: 0,
                supplyTotal: 0,
                bucketCount: 0,
                notes: new Set<string>(),
            };
            gapMap.set(key, acc);
        }
        acc.demandTotal += demand;
        acc.supplyTotal += supply;
        acc.bucketCount += 1;
        if (note) acc.notes.add(note);
    };

    for (const profile of routeProfiles) {
        if (profile.totalDemand <= 0) continue;
        const routeEngagement = engagementByRoute.get(profile.route);
        const routeScore = scoreByRoute.get(profile.route);

        const context = [
            routeEngagement ? `views/day ${routeEngagement.avgDailyViews}` : '',
            routeScore?.trend ? `trend ${routeScore.trend}` : '',
        ].filter(Boolean).join(', ');

        const firstOpMin = profile.firstDepartureMin;
        const lastOpMin = profile.lastDepartureMin;

        for (const point of profile.hourly) {
            if (point.demand <= 0) continue;

            const opMinute = toOperationMinute(point.hour);
            if (firstOpMin !== null && opMinute < firstOpMin) {
                addGap(profile.route, 'span_start', profile.dayType, profile.season, point.hour, point.demand, point.supply, context);
                continue;
            }
            if (lastOpMin !== null && opMinute > lastOpMin) {
                addGap(profile.route, 'span_end', profile.dayType, profile.season, point.hour, point.demand, point.supply, context);
                continue;
            }
            if (point.supply === 0 && point.demand >= 3) {
                addGap(profile.route, 'frequency_gap', profile.dayType, profile.season, point.hour, point.demand, point.supply, context || 'Demand with zero scheduled departures');
            }
        }
    }

    // Weekend gaps: demand persists on weekends where supply is notably thinner than weekday.
    for (const profile of routeProfiles) {
        if (profile.dayType !== 'saturday' && profile.dayType !== 'sunday') continue;
        const weekdayProfile = profileByKey.get(`${profile.route}|weekday|${profile.season}`);
        if (!weekdayProfile) continue;

        for (const point of profile.hourly) {
            const weekendDemand = point.demand;
            const weekendSupply = point.supply;
            const weekdayPoint = weekdayProfile.hourly[point.hour];
            const weekdaySupply = weekdayPoint?.supply || 0;
            const weekdayDemand = weekdayPoint?.demand || 0;

            if (weekendDemand < 2) continue;
            const demandComparable = weekendDemand >= Math.max(2, Math.round(weekdayDemand * 0.6));
            const supplyThinner = weekdaySupply > weekendSupply && (weekdaySupply - weekendSupply) >= 1;

            if (demandComparable && supplyThinner) {
                addGap(
                    profile.route,
                    'weekend',
                    profile.dayType,
                    profile.season,
                    point.hour,
                    weekendDemand,
                    weekendSupply,
                    `Weekday supply ${weekdaySupply}/h vs weekend ${weekendSupply}/h`
                );
            }
        }
    }

    // Seasonal shifts: same route/day/hour has large season-to-season demand swing.
    const seasonsToCompare: TransferSeason[] = ['jan', 'jul', 'sep'];
    const dayTypes: TransferDayType[] = ['weekday', 'saturday', 'sunday'];
    for (const route of routesWithDemand) {
        for (const dayType of dayTypes) {
            for (let hour = 0; hour < 24; hour++) {
                const demandPoints = seasonsToCompare.map(season => {
                    const profile = profileByKey.get(`${route}|${dayType}|${season}`);
                    return {
                        season,
                        demand: profile?.hourly[hour]?.demand || 0,
                        supply: profile?.hourly[hour]?.supply || 0,
                    };
                });

                const ranked = demandPoints.sort((a, b) => b.demand - a.demand);
                const top = ranked[0];
                const second = ranked[1];
                if (!top || !second) continue;
                if (top.demand < 3) continue;
                if (second.demand <= 0) continue;
                if (top.demand < second.demand * 1.8) continue;

                addGap(
                    route,
                    'seasonal_shift',
                    dayType,
                    top.season,
                    hour,
                    top.demand,
                    top.supply,
                    `Demand ${top.demand}/h vs ${second.demand}/h in ${second.season.toUpperCase()}`
                );
            }
        }
    }

    const gapRegister: ServiceGapRegisterRow[] = Array.from(gapMap.values())
        .map(row => ({
            route: row.route,
            gapType: row.gapType,
            dayType: row.dayType,
            timeBand: row.timeBand,
            season: row.season,
            appRequestsPerHour: Math.round((row.demandTotal / Math.max(1, row.bucketCount)) * 10) / 10,
            scheduledTripsPerHour: Math.round((row.supplyTotal / Math.max(1, row.bucketCount)) * 10) / 10,
            notes: Array.from(row.notes).slice(0, 2).join(' | '),
        }))
        .sort((a, b) => {
            const aSeverity = (a.appRequestsPerHour - a.scheduledTripsPerHour);
            const bSeverity = (b.appRequestsPerHour - b.scheduledTripsPerHour);
            if (bSeverity !== aSeverity) return bSeverity - aSeverity;
            return a.route.localeCompare(b.route, undefined, { numeric: true });
        })
        .slice(0, MAX_GAP_REGISTER_ROWS);

    const matchedRoutes = Array.from(routesWithDemand).filter(route => routesWithSupply.has(route)).length;
    const gapsByType: Record<ServiceGapType, number> = {
        span_start: 0,
        span_end: 0,
        weekend: 0,
        seasonal_shift: 0,
        frequency_gap: 0,
    };
    for (const row of gapRegister) {
        gapsByType[row.gapType] = (gapsByType[row.gapType] || 0) + 1;
    }

    routeProfiles.sort((a, b) => {
        if (a.route !== b.route) return a.route.localeCompare(b.route, undefined, { numeric: true });
        if (a.dayType !== b.dayType) return a.dayType.localeCompare(b.dayType);
        return a.season.localeCompare(b.season);
    });

    return {
        schemaVersion: SERVICE_GAP_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        supplyProfiles,
        routeProfiles,
        gapRegister,
        totals: {
            routesWithDemand: routesWithDemand.size,
            routesWithSupply: routesWithSupply.size,
            matchedRoutes,
            gapsByType,
        },
    };
}

function aggregateTripDistribution(trips: TransitAppParsedData['trips']): TransitAppDataSummary['tripDistribution'] {
    // Hourly bins (0-23)
    const hourly = new Array(24).fill(0);
    const dailyMap = new Map<string, number>();

    for (const trip of trips) {
        // Parse UTC timestamp and convert to Eastern Time for correct hourly binning
        const dt = parseUtcDateTime(trip.timestamp);
        if (dt) {
            const hour = utcToEasternHour(dt);
            const date = utcToEasternDateStr(dt);
            hourly[hour]++;
            dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
        }
    }

    const hourlyDist: HourlyTripDistribution[] = hourly.map((count, hour) => ({ hour, count }));

    const daily: DailyTripCount[] = Array.from(dailyMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return { hourly: hourlyDist, daily };
}

interface DebiasedLocationPoint {
    lat: number;
    lon: number;
    dayType: TransferDayType;
    season: TransferSeason;
    timeBand: LocationTimeBand;
}

interface DensityResult {
    cells: LocationGridCell[];
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    totalPoints: number;
}

interface HeatmapAggregationResult {
    base: DensityResult & {
        rawPoints: number;
        debiasedPoints: number;
        debiasWindowMinutes: number;
    };
    analysis: TransitAppHeatmapAnalysis;
}

interface StopIndexEntry {
    stopName: string;
    lat: number;
    lon: number;
}

interface StopSpatialIndex {
    stops: StopIndexEntry[];
    buckets: Map<string, StopIndexEntry[]>;
    bucketSize: number;
}

function buildStopSpatialIndex(): StopSpatialIndex {
    const bucketSize = 0.01;
    const stops = getAllStopsWithCoords().map(stop => ({
        stopName: stop.stop_name,
        lat: stop.lat,
        lon: stop.lon,
    }));
    const buckets = new Map<string, StopIndexEntry[]>();
    for (const stop of stops) {
        const latBin = Math.round(stop.lat / bucketSize);
        const lonBin = Math.round(stop.lon / bucketSize);
        const key = `${latBin}_${lonBin}`;
        const existing = buckets.get(key);
        if (existing) existing.push(stop);
        else buckets.set(key, [stop]);
    }
    return { stops, buckets, bucketSize };
}

function findNearestStop(
    lat: number,
    lon: number,
    index: StopSpatialIndex,
    cache: Map<string, { stopName: string | null; distanceKm: number }>
): { stopName: string | null; distanceKm: number } {
    const cacheKey = `${lat.toFixed(5)}_${lon.toFixed(5)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const latBin = Math.round(lat / index.bucketSize);
    const lonBin = Math.round(lon / index.bucketSize);
    const candidates: StopIndexEntry[] = [];
    for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLon = -1; dLon <= 1; dLon++) {
            const bucket = index.buckets.get(`${latBin + dLat}_${lonBin + dLon}`);
            if (bucket) candidates.push(...bucket);
        }
    }
    const searchSet = candidates.length > 0 ? candidates : index.stops;

    let bestName: string | null = null;
    let bestDistanceKm = Number.POSITIVE_INFINITY;
    for (const stop of searchSet) {
        const dist = haversineKm(lat, lon, stop.lat, stop.lon);
        if (dist < bestDistanceKm) {
            bestDistanceKm = dist;
            bestName = stop.stopName;
        }
    }

    const result = {
        stopName: bestName,
        distanceKm: Number.isFinite(bestDistanceKm) ? bestDistanceKm : 0,
    };
    cache.set(cacheKey, result);
    return result;
}

function buildDensityFromPoints(points: Array<{ lat: number; lon: number }>): DensityResult {
    const RESOLUTION = 0.002; // ~200m
    const cellMap = new Map<string, number>();
    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;

    for (const point of points) {
        const latBin = Math.round(point.lat / RESOLUTION) * RESOLUTION;
        const lonBin = Math.round(point.lon / RESOLUTION) * RESOLUTION;
        const key = `${latBin.toFixed(4)}_${lonBin.toFixed(4)}`;
        cellMap.set(key, (cellMap.get(key) || 0) + 1);

        if (point.lat < minLat) minLat = point.lat;
        if (point.lat > maxLat) maxLat = point.lat;
        if (point.lon < minLon) minLon = point.lon;
        if (point.lon > maxLon) maxLon = point.lon;
    }

    const cells: LocationGridCell[] = Array.from(cellMap.entries())
        .map(([key, count]) => {
            const [latStr, lonStr] = key.split('_');
            return { latBin: Number.parseFloat(latStr), lonBin: Number.parseFloat(lonStr), count };
        })
        .sort((a, b) => b.count - a.count);

    return {
        cells,
        bounds: points.length > 0
            ? { minLat, maxLat, minLon, maxLon }
            : { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
        totalPoints: points.length,
    };
}

function debiasLocations(locations: TransitAppParsedData['locations']): DebiasedLocationPoint[] {
    const seenBucketsByUser = new Map<string, Set<number>>();
    const results: DebiasedLocationPoint[] = [];

    for (const loc of locations) {
        if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) continue;
        if (loc.latitude === 0 && loc.longitude === 0) continue;

        const timestamp = parseUtcDateTime(loc.timestamp);
        if (!timestamp) continue;

        const bucket = Math.floor(timestamp.getTime() / (LOCATION_DEBIAS_WINDOW_MINUTES * 60 * 1000));
        const userKey = loc.user_id?.trim() || '__unknown_user__';
        let seenBuckets = seenBucketsByUser.get(userKey);
        if (!seenBuckets) {
            seenBuckets = new Set<number>();
            seenBucketsByUser.set(userKey, seenBuckets);
        }
        if (seenBuckets.has(bucket)) continue;
        seenBuckets.add(bucket);

        results.push({
            lat: loc.latitude,
            lon: loc.longitude,
            dayType: inferDayTypeForDate(timestamp),
            season: inferSeasonForDate(timestamp),
            timeBand: inferLocationTimeBand(utcToEasternHour(timestamp)),
        });
    }

    return results;
}

function aggregateHeatmapAnalysis(locations: TransitAppParsedData['locations']): HeatmapAggregationResult {
    const rawPoints = locations.length;
    const debiasedPoints = debiasLocations(locations);
    const base = buildDensityFromPoints(debiasedPoints.map(point => ({ lat: point.lat, lon: point.lon })));

    const sliceDefinitions: Array<{
        id: HeatmapAtlasSliceId;
        dayType: TransferDayType;
        timeBand: LocationTimeBand | 'all_day';
    }> = [
        { id: 'weekday_am_peak', dayType: 'weekday', timeBand: 'am_peak' },
        { id: 'weekday_midday', dayType: 'weekday', timeBand: 'midday' },
        { id: 'weekday_pm_peak', dayType: 'weekday', timeBand: 'pm_peak' },
        { id: 'weekday_evening', dayType: 'weekday', timeBand: 'evening' },
        { id: 'saturday_all_day', dayType: 'saturday', timeBand: 'all_day' },
        { id: 'sunday_all_day', dayType: 'sunday', timeBand: 'all_day' },
    ];
    const atlasSeasons: TransferSeason[] = ['jan', 'jul', 'sep'];

    const atlas: LocationAtlasSlice[] = [];
    for (const season of atlasSeasons) {
        for (const def of sliceDefinitions) {
            const filtered = debiasedPoints.filter(point => {
                if (point.season !== season) return false;
                if (point.dayType !== def.dayType) return false;
                if (def.timeBand !== 'all_day' && point.timeBand !== def.timeBand) return false;
                return true;
            });

            const density = buildDensityFromPoints(filtered.map(point => ({ lat: point.lat, lon: point.lon })));
            atlas.push({
                id: def.id,
                season,
                dayType: def.dayType,
                timeBand: def.timeBand,
                cells: density.cells,
                totalPoints: density.totalPoints,
                bounds: density.bounds,
            });
        }
    }

    const seasonalTotals = { jan: 0, jul: 0, sep: 0, other: 0 };
    for (const point of debiasedPoints) {
        seasonalTotals[point.season] += 1;
    }

    const stopIndex = buildStopSpatialIndex();
    const stopCache = new Map<string, { stopName: string | null; distanceKm: number }>();
    const callouts: HeatmapCallout[] = atlas
        .filter(slice => slice.totalPoints > 0 && slice.cells.length > 0)
        .map(slice => {
            const hotspot = slice.cells[0];
            const nearestStop = findNearestStop(hotspot.latBin, hotspot.lonBin, stopIndex, stopCache);
            const note = nearestStop.stopName
                ? `Hotspot near ${nearestStop.stopName}`
                : 'Hotspot detected';
            return {
                season: slice.season,
                dayType: slice.dayType,
                timeBand: slice.timeBand,
                lat: hotspot.latBin,
                lon: hotspot.lonBin,
                pointCount: hotspot.count,
                note,
            };
        })
        .sort((a, b) => b.pointCount - a.pointCount)
        .slice(0, 18);

    const debiasedCount = debiasedPoints.length;
    const reductionPct = rawPoints > 0
        ? Math.round(((rawPoints - debiasedCount) / rawPoints) * 1000) / 10
        : 0;

    return {
        base: {
            ...base,
            rawPoints,
            debiasedPoints: debiasedCount,
            debiasWindowMinutes: LOCATION_DEBIAS_WINDOW_MINUTES,
        },
        analysis: {
            schemaVersion: HEATMAP_ANALYSIS_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            debiasing: {
                windowMinutes: LOCATION_DEBIAS_WINDOW_MINUTES,
                rawPoints,
                debiasedPoints: debiasedCount,
                reductionPct,
            },
            atlas,
            seasonalTotals,
            callouts,
        },
    };
}

function aggregateStopProximityAnalysis(
    trips: TransitAppTripRow[],
    allLegs: TransitAppTripLegRow[],
    odPairs?: ODPairData
): TransitAppStopProximityAnalysis | undefined {
    const stopIndex = buildStopSpatialIndex();
    if (stopIndex.stops.length === 0) return undefined;

    const stopCache = new Map<string, { stopName: string | null; distanceKm: number }>();
    const endpointSummaries: Array<{
        lat: number;
        lon: number;
        nearestStopName: string | null;
        nearestStopDistanceKm: number;
        timeBand: TransferTimeBand;
        dayType: TransferDayType;
        season: TransferSeason;
    }> = [];

    for (const trip of trips) {
        const timestamp = parseUtcDateTime(trip.timestamp);
        if (!timestamp) continue;
        const timeBand = inferTimeBandForHour(utcToEasternHour(timestamp));
        const dayType = inferDayTypeForDate(timestamp);
        const season = inferSeasonForDate(timestamp);

        const endpoints = [
            { lat: trip.start_latitude, lon: trip.start_longitude },
            { lat: trip.end_latitude, lon: trip.end_longitude },
        ];

        for (const endpoint of endpoints) {
            if (!Number.isFinite(endpoint.lat) || !Number.isFinite(endpoint.lon)) continue;
            if (endpoint.lat === 0 && endpoint.lon === 0) continue;
            const nearest = findNearestStop(endpoint.lat, endpoint.lon, stopIndex, stopCache);
            endpointSummaries.push({
                lat: endpoint.lat,
                lon: endpoint.lon,
                nearestStopName: nearest.stopName,
                nearestStopDistanceKm: nearest.distanceKm,
                timeBand,
                dayType,
                season,
            });
        }
    }

    if (endpointSummaries.length === 0) return undefined;

    const farEndpoints = endpointSummaries.filter(point => point.nearestStopDistanceKm > STOP_PROXIMITY_THRESHOLD_KM);

    interface ClusterAccumulator {
        clusterId: string;
        lat: number;
        lon: number;
        tripCount: number;
        sumNearestStopDistanceKm: number;
        nearestStopName: string | null;
        nearestStopDistanceKm: number;
        timeBands: Map<TransferTimeBand, number>;
        dayTypes: Map<TransferDayType, number>;
        seasons: Map<TransferSeason, number>;
    }

    const clusterMap = new Map<string, ClusterAccumulator>();
    for (const point of farEndpoints) {
        const latBin = Math.round(point.lat / STOP_CLUSTER_RESOLUTION) * STOP_CLUSTER_RESOLUTION;
        const lonBin = Math.round(point.lon / STOP_CLUSTER_RESOLUTION) * STOP_CLUSTER_RESOLUTION;
        const clusterId = `${latBin.toFixed(4)}_${lonBin.toFixed(4)}`;

        let cluster = clusterMap.get(clusterId);
        if (!cluster) {
            const nearest = findNearestStop(latBin, lonBin, stopIndex, stopCache);
            cluster = {
                clusterId,
                lat: latBin,
                lon: lonBin,
                tripCount: 0,
                sumNearestStopDistanceKm: 0,
                nearestStopName: nearest.stopName,
                nearestStopDistanceKm: nearest.distanceKm,
                timeBands: new Map<TransferTimeBand, number>(),
                dayTypes: new Map<TransferDayType, number>(),
                seasons: new Map<TransferSeason, number>(),
            };
            clusterMap.set(clusterId, cluster);
        }

        cluster.tripCount += 1;
        cluster.sumNearestStopDistanceKm += point.nearestStopDistanceKm;
        cluster.timeBands.set(point.timeBand, (cluster.timeBands.get(point.timeBand) || 0) + 1);
        cluster.dayTypes.set(point.dayType, (cluster.dayTypes.get(point.dayType) || 0) + 1);
        cluster.seasons.set(point.season, (cluster.seasons.get(point.season) || 0) + 1);
    }

    const dominantKey = <T extends string>(map: Map<T, number>, fallback: T): T => {
        let topKey = fallback;
        let topCount = -1;
        for (const [key, count] of map.entries()) {
            if (count > topCount) {
                topCount = count;
                topKey = key;
            }
        }
        return topKey;
    };

    const topClusters: StopCoverageGapCluster[] = Array.from(clusterMap.values())
        .map(cluster => {
            let odOverlapCount = 0;
            if (odPairs?.pairs?.length) {
                for (const pair of odPairs.pairs) {
                    const originDist = haversineKm(cluster.lat, cluster.lon, pair.originLat, pair.originLon);
                    const destDist = haversineKm(cluster.lat, cluster.lon, pair.destLat, pair.destLon);
                    if (originDist <= 0.8 || destDist <= 0.8) {
                        odOverlapCount += pair.count;
                    }
                }
            }

            return {
                clusterId: cluster.clusterId,
                lat: cluster.lat,
                lon: cluster.lon,
                tripCount: cluster.tripCount,
                avgNearestStopDistanceKm: Math.round((cluster.sumNearestStopDistanceKm / Math.max(1, cluster.tripCount)) * 1000) / 1000,
                nearestStopName: cluster.nearestStopName,
                nearestStopDistanceKm: Math.round(cluster.nearestStopDistanceKm * 1000) / 1000,
                dominantTimeBand: dominantKey(cluster.timeBands, 'midday'),
                dominantDayType: dominantKey(cluster.dayTypes, 'weekday'),
                dominantSeason: dominantKey(cluster.seasons, 'other'),
                odOverlapCount,
            };
        })
        .sort((a, b) => b.tripCount - a.tripCount || b.avgNearestStopDistanceKm - a.avgNearestStopDistanceKm)
        .slice(0, 150);

    const mentionMap = new Map<string, number>();
    for (const leg of allLegs) {
        const names = [leg.start_stop_name, leg.end_stop_name];
        for (const rawName of names) {
            const name = (rawName || '').trim();
            if (!name) continue;
            mentionMap.set(name, (mentionMap.get(name) || 0) + 1);
        }
    }
    const stopMentions: StopMentionRankingRow[] = Array.from(mentionMap.entries())
        .map(([stopName, mentions]) => ({ stopName, mentions }))
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 80);

    const avgNearestStopDistanceKm = endpointSummaries.reduce((sum, point) => sum + point.nearestStopDistanceKm, 0) / endpointSummaries.length;
    const farEndpointCount = farEndpoints.length;
    const farEndpointSharePct = Math.round((farEndpointCount / endpointSummaries.length) * 1000) / 10;

    return {
        schemaVersion: STOP_PROXIMITY_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        totals: {
            tripEndpointsAnalyzed: endpointSummaries.length,
            avgNearestStopDistanceKm: Math.round(avgNearestStopDistanceKm * 1000) / 1000,
            farEndpointCount,
            farEndpointSharePct,
            clusterCount: topClusters.length,
        },
        farThresholdKm: STOP_PROXIMITY_THRESHOLD_KM,
        topClusters,
        stopMentions,
    };
}

function aggregateRouteLegSummary(allLegs: TransitAppTripLegRow[]): RouteLegSummary[] {
    const routeMap = new Map<string, {
        serviceName: string;
        totalLegs: number;
        trips: Set<string>;
        boardingStops: Map<string, number>;
        alightingStops: Map<string, number>;
    }>();

    for (const leg of allLegs) {
        if (leg.mode !== 'Transit' || !leg.route_short_name) continue;

        const key = leg.route_short_name;
        let entry = routeMap.get(key);
        if (!entry) {
            entry = {
                serviceName: leg.service_name,
                totalLegs: 0,
                trips: new Set(),
                boardingStops: new Map(),
                alightingStops: new Map(),
            };
            routeMap.set(key, entry);
        }

        entry.totalLegs++;
        entry.trips.add(leg.user_trip_id);

        if (leg.start_stop_name) {
            entry.boardingStops.set(leg.start_stop_name, (entry.boardingStops.get(leg.start_stop_name) || 0) + 1);
        }
        if (leg.end_stop_name) {
            entry.alightingStops.set(leg.end_stop_name, (entry.alightingStops.get(leg.end_stop_name) || 0) + 1);
        }
    }

    const summaries: RouteLegSummary[] = Array.from(routeMap.entries())
        .map(([route, data]) => ({
            route,
            serviceName: data.serviceName,
            totalLegs: data.totalLegs,
            uniqueTrips: data.trips.size,
            topBoardingStops: getTopN(data.boardingStops, 5),
            topAlightingStops: getTopN(data.alightingStops, 5),
        }))
        .sort((a, b) => b.totalLegs - a.totalLegs);

    return summaries;
}

function getTopN(map: Map<string, number>, n: number): { stop: string; count: number }[] {
    return Array.from(map.entries())
        .map(([stop, count]) => ({ stop, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
}

function aggregateAppUsage(users: TransitAppParsedData['users']): AppUsageDaily[] {
    return users
        .map(u => ({
            date: u.date,
            users: u.users,
            sessions: u.sessions,
            downloads: u.downloads,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateODPairs(trips: TransitAppTripRow[]): ODPairData {
    const RESOLUTION = 0.005; // ~500m grid cells
    const MAX_PAIRS = 200;

    const pairMap = new Map<string, { count: number; hourlyBins: number[]; weekdayCount: number; weekendCount: number; seasonBins: { jan: number; jul: number; sep: number; other: number } }>();
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    let skipped = 0;

    for (const trip of trips) {
        const oLat = trip.start_latitude;
        const oLon = trip.start_longitude;
        const dLat = trip.end_latitude;
        const dLon = trip.end_longitude;

        // Skip trips with zero coords
        if (oLat === 0 && oLon === 0 || dLat === 0 && dLon === 0) {
            skipped++;
            continue;
        }

        const oLatBin = Math.round(oLat / RESOLUTION) * RESOLUTION;
        const oLonBin = Math.round(oLon / RESOLUTION) * RESOLUTION;
        const dLatBin = Math.round(dLat / RESOLUTION) * RESOLUTION;
        const dLonBin = Math.round(dLon / RESOLUTION) * RESOLUTION;

        // Skip intra-zone trips
        if (oLatBin === dLatBin && oLonBin === dLonBin) {
            skipped++;
            continue;
        }

        // Extract date, hour, and month from timestamp — convert UTC to Eastern Time
        let hour = -1;
        let isWeekend = false;
        let monthNum = -1;
        const tripDt = parseUtcDateTime(trip.timestamp);
        if (tripDt) {
            hour = utcToEasternHour(tripDt);
            const localDate = utcToEasternDateStr(tripDt);
            isWeekend = isWeekendDate(localDate);
            monthNum = parseInt(localDate.split('-')[1], 10);
        }

        const seasonKey: 'jan' | 'jul' | 'sep' | 'other' =
            monthNum === 1 ? 'jan' : monthNum === 7 ? 'jul' : monthNum === 9 ? 'sep' : 'other';

        const key = `${oLatBin.toFixed(4)}_${oLonBin.toFixed(4)}|${dLatBin.toFixed(4)}_${dLonBin.toFixed(4)}`;
        const existing = pairMap.get(key);
        if (existing) {
            existing.count++;
            if (hour >= 0 && hour < 24) existing.hourlyBins[hour]++;
            if (isWeekend) existing.weekendCount++;
            else existing.weekdayCount++;
            if (monthNum > 0) existing.seasonBins[seasonKey]++;
        } else {
            const bins = new Array(24).fill(0);
            if (hour >= 0 && hour < 24) bins[hour]++;
            const sBins = { jan: 0, jul: 0, sep: 0, other: 0 };
            if (monthNum > 0) sBins[seasonKey]++;
            pairMap.set(key, {
                count: 1,
                hourlyBins: bins,
                weekdayCount: isWeekend ? 0 : 1,
                weekendCount: isWeekend ? 1 : 0,
                seasonBins: sBins,
            });
        }

        // Track bounds from raw coords
        if (oLat < minLat) minLat = oLat;
        if (oLat > maxLat) maxLat = oLat;
        if (dLat < minLat) minLat = dLat;
        if (dLat > maxLat) maxLat = dLat;
        if (oLon < minLon) minLon = oLon;
        if (oLon > maxLon) maxLon = oLon;
        if (dLon < minLon) minLon = dLon;
        if (dLon > maxLon) maxLon = dLon;
    }

    const pairs: ODPair[] = Array.from(pairMap.entries())
        .map(([key, data]) => {
            const [originPart, destPart] = key.split('|');
            const [oLat, oLon] = originPart.split('_').map(Number);
            const [dLat, dLon] = destPart.split('_').map(Number);
            return {
                originLat: oLat, originLon: oLon,
                destLat: dLat, destLon: dLon,
                count: data.count,
                hourlyBins: data.hourlyBins,
                weekdayCount: data.weekdayCount,
                weekendCount: data.weekendCount,
                seasonBins: data.seasonBins,
            };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_PAIRS);

    const processed = trips.length - skipped;

    // Compute season totals across all retained pairs
    const seasonTotals = { jan: 0, jul: 0, sep: 0, other: 0 };
    for (const p of pairs) {
        if (p.seasonBins) {
            seasonTotals.jan += p.seasonBins.jan;
            seasonTotals.jul += p.seasonBins.jul;
            seasonTotals.sep += p.seasonBins.sep;
            seasonTotals.other += p.seasonBins.other;
        }
    }

    return {
        pairs,
        resolution: RESOLUTION,
        totalTripsProcessed: processed,
        totalTripsSkipped: skipped,
        bounds: processed > 0
            ? { minLat, maxLat, minLon, maxLon }
            : { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
        seasonTotals,
    };
}

// ============ OD COVERAGE GAP ANALYSIS ============

/**
 * Analyze OD pairs for route coverage gaps.
 * For each top OD pair, checks if both origin and destination are within
 * a 1km buffer of the same GTFS route shape. Pairs where no single route
 * covers both endpoints are identified as coverage gaps.
 */
export function analyzeODCoverageGaps(
    odPairs: ODPairData,
    topN: number = 25
): ODCoverageGap[] {
    let shapes: ReturnType<typeof loadGtfsRouteShapes>;
    try {
        shapes = loadGtfsRouteShapes();
    } catch {
        return [];
    }
    if (shapes.length === 0) return [];

    const BUFFER_KM = 1.0;
    const pairs = odPairs.pairs.slice(0, topN);
    const results: ODCoverageGap[] = [];

    for (const pair of pairs) {
        const originPt: [number, number] = [pair.originLat, pair.originLon];
        const destPt: [number, number] = [pair.destLat, pair.destLon];

        let nearestRouteOrigin: string | null = null;
        let nearestRouteDest: string | null = null;
        let originRouteDistKm = Infinity;
        let destRouteDistKm = Infinity;
        const servingRoutes: string[] = [];

        for (const shape of shapes) {
            if (shape.points.length === 0) continue;

            const oDist = pointToPolylineDistanceKm(originPt, shape.points);
            const dDist = pointToPolylineDistanceKm(destPt, shape.points);

            // Track nearest route to origin
            if (oDist < originRouteDistKm) {
                originRouteDistKm = oDist;
                nearestRouteOrigin = shape.routeShortName;
            }
            // Track nearest route to dest
            if (dDist < destRouteDistKm) {
                destRouteDistKm = dDist;
                nearestRouteDest = shape.routeShortName;
            }

            // Check if this route covers both endpoints
            if (oDist <= BUFFER_KM && dDist <= BUFFER_KM) {
                servingRoutes.push(shape.routeShortName);
            }
        }

        const originZoneName = findNearestStopName(pair.originLat, pair.originLon, 0.5)
            ?? `${pair.originLat.toFixed(3)}, ${pair.originLon.toFixed(3)}`;
        const destZoneName = findNearestStopName(pair.destLat, pair.destLon, 0.5)
            ?? `${pair.destLat.toFixed(3)}, ${pair.destLon.toFixed(3)}`;

        results.push({
            pair,
            originZoneName,
            destZoneName,
            distanceKm: haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon),
            nearestRouteOrigin,
            nearestRouteDest,
            originRouteDistKm: Math.round(originRouteDistKm * 100) / 100,
            destRouteDistKm: Math.round(destRouteDistKm * 100) / 100,
            isServedByDirectRoute: servingRoutes.length > 0,
            servingRoutes,
        });
    }

    // Sort: gaps first, then by count descending
    results.sort((a, b) => {
        if (a.isServedByDirectRoute !== b.isServedByDirectRoute) {
            return a.isServedByDirectRoute ? 1 : -1;
        }
        return b.pair.count - a.pair.count;
    });

    return results;
}
