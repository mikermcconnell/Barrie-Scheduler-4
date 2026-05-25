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
import { aggregateTransitAppODPairs } from './transitAppOdPairs';
import { isBarrieOnlyODPair, isInBarrieAnalysisArea } from './transitAppGeo';
import { getAllStopsWithCoords, findNearestStopName } from '../gtfs/gtfsStopLookup';
import { loadGtfsRouteShapeVariants, pointToPolylineDistanceKm, type GtfsRouteShape } from '../gtfs/gtfsShapesLoader';

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
    const routePerformance = aggregateRoutePerformance(routeMetrics.daily, allLegs);
    const serviceGapAnalysis = aggregateServiceGapAnalysis(allLegs, routeMetrics.daily, routeMetrics.summary, routePerformance?.scorecard || []);
    const odPairs = aggregateTransitAppODPairs(parsed.trips);
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

const ROUTE_PERFORMANCE_SCHEMA_VERSION = 3;
const MINIMUM_VIEWS_FOR_RATIOS = 30;
const TREND_DELTA_POINTS = 5;
const SERVICE_GAP_SCHEMA_VERSION = 2;
const STOP_PROXIMITY_SCHEMA_VERSION = 2;
const HEATMAP_ANALYSIS_SCHEMA_VERSION = 2;
const STOP_PROXIMITY_THRESHOLD_KM = 0.4;
const STOP_CLUSTER_RESOLUTION = 0.004; // ~400m
const LOCATION_DEBIAS_WINDOW_MINUTES = 15;
const CANADA_BOUNDS = {
    minLat: 41.0,
    maxLat: 84.0,
    minLon: -141.5,
    maxLon: -52.0,
};
const STOP_INDEX_SEARCH_RADIUS = 2;
const TORONTO_TIME_ZONE = 'America/Toronto';

const TORONTO_PART_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
});

interface DayPartAccumulator {
    views: number;
    taps: number;
    suggestions: number;
    goTrips: number;
}

interface DayPartScoreMetrics extends DayPartAccumulator {
    totalLegs: number;
}

interface RouteLegMonthSummary {
    totalLegs: number;
    uniqueTrips: number;
    weekdayLegs: number;
    weekendLegs: number;
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
    allLegs: TransitAppTripLegRow[]
): TransitAppRoutePerformance {
    const gtfsAvailable = hasGtfsNormalizationData();
    const routeLegMonthMap = aggregateRouteLegsByMonth(allLegs);

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
    const dayPartByKey = new Map<string, { weekday: DayPartScoreMetrics; weekend: DayPartScoreMetrics }>();

    for (const [key, acc] of monthlyMap.entries()) {
        const monthLegs = routeLegMonthMap.get(key);
        const daysActive = acc.days.size;
        const viewRatioEligible = acc.totalViews >= MINIMUM_VIEWS_FOR_RATIOS;
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
            totalLegs: monthLegs?.totalLegs || 0,
            uniqueTrips: monthLegs?.uniqueTrips || 0,
            avgDailyViews: daysActive > 0 ? Math.round(acc.totalViews / daysActive) : 0,
            avgDailyTaps: daysActive > 0 ? Math.round(acc.totalTaps / daysActive) : 0,
            viewToTapRate: viewRatioEligible ? safeRate(acc.totalTaps, acc.totalViews, 4) : null,
            viewToSuggestionRate: viewRatioEligible ? safeRate(acc.totalSuggestions, acc.totalViews, 4) : null,
            tapToSuggestionRate: safeRate(acc.totalSuggestions, acc.totalTaps, 4),
            suggestionToGoRate: safeRate(acc.totalGoTrips, acc.totalSuggestions, 4),
            viewToTapRankPct: null,
            viewToSuggestionRankPct: null,
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
        dayPartByKey.set(key, {
            weekday: { ...acc.weekday, totalLegs: monthLegs?.weekdayLegs || 0 },
            weekend: { ...acc.weekend, totalLegs: monthLegs?.weekendLegs || 0 },
        });
    }

    monthlyRows.sort((a, b) => a.month.localeCompare(b.month) || a.route.localeCompare(b.route));
    applyMonthlyPercentilesAndScores(monthlyRows);
    applyDayPartScores(monthlyRows, dayPartByKey, 'weekday');
    applyDayPartScores(monthlyRows, dayPartByKey, 'weekend');

    const months = Array.from(new Set(monthlyRows.map(r => r.month))).sort((a, b) => a.localeCompare(b));
    const latestMonth = months.length > 0 ? months[months.length - 1] : null;
    const medianScoreByMonth = new Map<string, number | null>();
    for (const month of months) {
        medianScoreByMonth.set(month, median(monthlyRows.filter(r => r.month === month).map(r => r.compositeScore)));
    }
    const latestMedianScore = latestMonth ? (medianScoreByMonth.get(latestMonth) ?? null) : null;

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
    const medianForRouteLatestMonth = new Map<string, number | null>();
    for (const [route, rows] of rowsByRoute.entries()) {
        const latest = rows[rows.length - 1];
        const previous = rows.length > 1 ? rows[rows.length - 2] : null;
        const trendInfo = classifyTrend(latest.compositeScore, previous?.compositeScore ?? null, TREND_DELTA_POINTS);
        const medianForLatest = medianScoreByMonth.get(latest.month) ?? null;
        medianForRouteLatestMonth.set(route, medianForLatest);

        const belowMedian = medianForLatest !== null
            && latest.compositeScore !== null
            && latest.compositeScore < medianForLatest;

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
            viewToSuggestionRate: latest.viewToSuggestionRate,
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
            viewToSuggestionRate: latest.viewToSuggestionRate,
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
            priorityScore: computePriorityScore(row, medianForRouteLatestMonth.get(row.route) ?? null),
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
        const viewToSuggestionRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.viewToSuggestionRate })));
        const suggestionToGoRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.suggestionToGoRate })));
        const goTripsRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.totalGoTrips })));
        const totalLegRanks = computePercentileRanks(monthRows.map(r => ({ key: r.route, value: r.totalLegs })));

        for (const row of monthRows) {
            row.viewToTapRankPct = viewToTapRanks.get(row.route) ?? null;
            row.viewToSuggestionRankPct = viewToSuggestionRanks.get(row.route) ?? null;
            row.suggestionToGoRankPct = suggestionToGoRanks.get(row.route) ?? null;
            row.goTripsRankPct = goTripsRanks.get(row.route) ?? null;
            row.totalLegsRankPct = totalLegRanks.get(row.route) ?? null;
            row.compositeScore = computeCompositeScore({
                viewToTapRankPct: row.viewToTapRankPct,
                viewToSuggestionRankPct: row.viewToSuggestionRankPct,
                goTripsRankPct: row.goTripsRankPct,
                totalLegsRankPct: row.totalLegsRankPct,
                suggestionToGoRankPct: row.suggestionToGoRankPct,
            });
        }
    }
}

function applyDayPartScores(
    rows: RoutePerformanceMonthly[],
    dayPartByKey: Map<string, { weekday: DayPartScoreMetrics; weekend: DayPartScoreMetrics }>,
    dayPart: 'weekday' | 'weekend'
): void {
    const months = Array.from(new Set(rows.map(r => r.month)));
    for (const month of months) {
        const monthRows = rows.filter(r => r.month === month);
        const metrics = monthRows.map(row => {
            const key = `${row.route}|${row.month}`;
            const dayMetrics = dayPartByKey.get(key)?.[dayPart] || { views: 0, taps: 0, suggestions: 0, goTrips: 0, totalLegs: 0 };
            const viewRatioEligible = dayMetrics.views >= MINIMUM_VIEWS_FOR_RATIOS;
            return {
                route: row.route,
                viewToTapRate: viewRatioEligible ? safeRate(dayMetrics.taps, dayMetrics.views, 4) : null,
                viewToSuggestionRate: viewRatioEligible ? safeRate(dayMetrics.suggestions, dayMetrics.views, 4) : null,
                suggestionToGoRate: safeRate(dayMetrics.goTrips, dayMetrics.suggestions, 4),
                goTrips: dayMetrics.goTrips,
                totalLegs: dayMetrics.totalLegs,
            };
        });

        const viewToTapRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.viewToTapRate })));
        const viewToSuggestionRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.viewToSuggestionRate })));
        const suggestionToGoRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.suggestionToGoRate })));
        const goTripsRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.goTrips })));
        const totalLegRanks = computePercentileRanks(metrics.map(m => ({ key: m.route, value: m.totalLegs })));

        for (const row of monthRows) {
            const score = computeCompositeScore({
                viewToTapRankPct: viewToTapRanks.get(row.route) ?? null,
                viewToSuggestionRankPct: viewToSuggestionRanks.get(row.route) ?? null,
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

const MERGED_BARRIE_ROUTE_BASES = new Set(['2', '7', '12']);

function normalizeBarrieRouteForSupply(route: string): string {
    const normalized = normalizeRouteKey(route);
    const match = normalized.match(/^(\d+)([AB])$/);
    if (match && MERGED_BARRIE_ROUTE_BASES.has(match[1])) {
        return match[1];
    }
    return normalized;
}

function isBarrieTransitServiceName(serviceName: string): boolean {
    return serviceName.trim().toUpperCase().includes('BARRIE TRANSIT');
}

function parseUtcDateTime(value: string): Date | null {
    if (!value) return null;
    const dt = new Date(value.replace(' UTC', 'Z'));
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function getTorontoParts(dt: Date): { year: number; month: number; day: number; hour: number; minute: number } {
    const parts = TORONTO_PART_FORMATTER.formatToParts(dt);
    const lookup: Record<string, string> = {};
    parts.forEach(part => {
        if (part.type !== 'literal') lookup[part.type] = part.value;
    });

    return {
        year: Number(lookup.year),
        month: Number(lookup.month),
        day: Number(lookup.day),
        hour: Number(lookup.hour),
        minute: Number(lookup.minute || '0'),
    };
}

/** Convert a UTC Date to a Toronto-local date/hour represented in a UTC Date. */
function utcToEasternDate(dt: Date): Date {
    const local = getTorontoParts(dt);
    return new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute));
}

function utcToEasternHour(dt: Date): number {
    return utcToEasternDate(dt).getUTCHours();
}

function utcToEasternOperationMinute(dt: Date): number {
    const local = getTorontoParts(dt);
    return toOperationMinute(local.hour, local.minute);
}

/** Convert a UTC Date to Eastern Time date string (YYYY-MM-DD), accounting for day rollover. */
function utcToEasternDateStr(dt: Date): string {
    const local = utcToEasternDate(dt);
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
    const day = utcToEasternDate(date).getUTCDay();
    if (day === 0) return 'sunday';
    if (day === 6) return 'saturday';
    return 'weekday';
}

function inferDayTypeForDateString(date: string): TransferDayType | null {
    const dt = new Date(`${date}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return null;
    const day = dt.getUTCDay();
    if (day === 0) return 'sunday';
    if (day === 6) return 'saturday';
    return 'weekday';
}

function inferSeasonForDate(date: Date): TransferSeason {
    const month = utcToEasternDate(date).getUTCMonth() + 1;
    if (month === 1) return 'jan';
    if (month === 7) return 'jul';
    if (month === 9) return 'sep';
    return 'other';
}

function inferSeasonForDateString(date: string): TransferSeason {
    const month = Number(date.slice(5, 7));
    if (month === 1) return 'jan';
    if (month === 7) return 'jul';
    if (month === 9) return 'sep';
    return 'other';
}

function inferLocationTimeBand(hour: number): LocationTimeBand {
    if (hour >= 6 && hour < 9) return 'am_peak';
    if (hour >= 9 && hour < 15) return 'midday';
    if (hour >= 15 && hour < 18) return 'pm_peak';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'overnight';
}

function toOperationMinute(hour: number, minute = 0): number {
    // Keep late-night buckets in-service-day order (00:00-02:59 treated as after 24:00).
    return hour < 3 ? ((hour + 24) * 60) + minute : (hour * 60) + minute;
}

function roundToTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

function aggregateServiceGapAnalysis(
    allLegs: TransitAppTripLegRow[],
    dailyMetrics: RouteMetricDaily[],
    routeSummary: RouteMetricSummary[],
    scorecard: RoutePerformanceScorecardRow[]
): TransitAppServiceGapAnalysis | undefined {
    if (!hasGtfsSupplyProfiles()) return undefined;

    const supplyProfiles = getRouteSupplyProfiles();
    if (supplyProfiles.length === 0) return undefined;

    const supplyByRouteDay = new Map<string, RouteSupplyProfile>();
    const routesWithSupply = new Set<string>();
    for (const profile of supplyProfiles) {
        const route = normalizeBarrieRouteForSupply(profile.route);
        supplyByRouteDay.set(`${route}|${profile.dayType}`, { ...profile, route });
        routesWithSupply.add(route);
    }

    const routeDemandHourly = new Map<string, number>();
    const routeDemandEvents = new Map<string, Array<{ hour: number; opMinute: number }>>();
    const serviceDatesByProfile = new Map<string, Set<string>>();
    const demandDatesByProfile = new Map<string, Set<string>>();
    const seasonsByRouteDay = new Map<string, Set<TransferSeason>>();
    const routesWithDemand = new Set<string>();

    for (const daily of dailyMetrics) {
        const route = normalizeBarrieRouteForSupply(daily.route);
        if (!routesWithSupply.has(route)) continue;
        const dayType = inferDayTypeForDateString(daily.date);
        if (!dayType) continue;
        const season = inferSeasonForDateString(daily.date);
        const profileKey = `${route}|${dayType}|${season}`;
        const existing = serviceDatesByProfile.get(profileKey);
        if (existing) {
            existing.add(daily.date);
        } else {
            serviceDatesByProfile.set(profileKey, new Set([daily.date]));
        }
    }

    for (const leg of allLegs) {
        if (!leg.route_short_name) continue;
        if ((leg.mode || '').trim().toUpperCase() !== 'TRANSIT') continue;
        const rawRoute = normalizeBarrieRouteForSupply(leg.route_short_name);
        if (!rawRoute) continue;

        if (leg.service_name?.trim()) {
            if (!isBarrieTransitServiceName(leg.service_name)) continue;
        } else if (!routesWithSupply.has(rawRoute)) {
            continue;
        }

        const timestamp = parseUtcDateTime(leg.start_time || leg.end_time);
        if (!timestamp) continue;

        const route = rawRoute;
        const dayType = inferDayTypeForDate(timestamp);
        const season = inferSeasonForDate(timestamp);
        const hour = utcToEasternHour(timestamp);
        const localDate = utcToEasternDateStr(timestamp);
        const profileKey = `${route}|${dayType}|${season}`;
        const hourlyKey = `${profileKey}|${hour}`;
        routeDemandHourly.set(hourlyKey, (routeDemandHourly.get(hourlyKey) || 0) + 1);
        routesWithDemand.add(route);
        const existingDates = demandDatesByProfile.get(profileKey);
        if (existingDates) {
            existingDates.add(localDate);
        } else {
            demandDatesByProfile.set(profileKey, new Set([localDate]));
        }
        const event = { hour, opMinute: utcToEasternOperationMinute(timestamp) };
        const existingEvents = routeDemandEvents.get(profileKey);
        if (existingEvents) {
            existingEvents.push(event);
        } else {
            routeDemandEvents.set(profileKey, [event]);
        }

        const routeDayKey = `${route}|${dayType}`;
        const existingSeasons = seasonsByRouteDay.get(routeDayKey);
        if (existingSeasons) {
            existingSeasons.add(season);
        } else {
            seasonsByRouteDay.set(routeDayKey, new Set([season]));
        }
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
                const profileKey = `${route}|${dayType}|${season}`;
                const activeDayCount = serviceDatesByProfile.get(profileKey)?.size
                    || demandDatesByProfile.get(profileKey)?.size
                    || 1;
                const hourly = new Array(24).fill(null).map((_, hour) => {
                    const demand = roundToTenth((routeDemandHourly.get(`${route}|${dayType}|${season}|${hour}`) || 0) / activeDayCount);
                    const supplyAtHour = supply?.departuresByHour?.[hour] || 0;
                    return { hour, demand, supply: supplyAtHour };
                });

                const totalDemand = Array.from({ length: 24 }, (_, hour) => routeDemandHourly.get(`${route}|${dayType}|${season}|${hour}`) || 0)
                    .reduce((sum, demand) => sum + demand, 0);
                const totalSupply = hourly.reduce((sum, h) => sum + h.supply, 0);

                let demandBeforeFirst = 0;
                let demandAfterLast = 0;
                const demandEvents = routeDemandEvents.get(profileKey) || [];
                if (firstOpMin !== null || lastOpMin !== null) {
                    for (const event of demandEvents) {
                        if (firstOpMin !== null && event.opMinute < firstOpMin) demandBeforeFirst += 1;
                        if (lastOpMin !== null && event.opMinute > lastOpMin) demandAfterLast += 1;
                    }
                }
                demandBeforeFirst = roundToTenth(demandBeforeFirst / activeDayCount);
                demandAfterLast = roundToTenth(demandAfterLast / activeDayCount);

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
        const profileKey = `${profile.route}|${profile.dayType}|${profile.season}`;
        const activeDayCount = serviceDatesByProfile.get(profileKey)?.size
            || demandDatesByProfile.get(profileKey)?.size
            || 1;
        const demandEvents = routeDemandEvents.get(profileKey) || [];
        const spanStartDemandByHour = new Map<number, number>();
        const spanEndDemandByHour = new Map<number, number>();

        for (const event of demandEvents) {
            if (firstOpMin !== null && event.opMinute < firstOpMin) {
                spanStartDemandByHour.set(event.hour, (spanStartDemandByHour.get(event.hour) || 0) + 1);
            }
            if (lastOpMin !== null && event.opMinute > lastOpMin) {
                spanEndDemandByHour.set(event.hour, (spanEndDemandByHour.get(event.hour) || 0) + 1);
            }
        }

        for (const point of profile.hourly) {
            if (point.demand <= 0) continue;

            const rawDemand = routeDemandHourly.get(`${profileKey}|${point.hour}`) || 0;
            const rawSpanStartDemand = spanStartDemandByHour.get(point.hour) || 0;
            const rawSpanEndDemand = spanEndDemandByHour.get(point.hour) || 0;
            const spanStartDemand = roundToTenth(rawSpanStartDemand / activeDayCount);
            const spanEndDemand = roundToTenth(rawSpanEndDemand / activeDayCount);
            const inSpanDemand = roundToTenth(Math.max(0, rawDemand - rawSpanStartDemand - rawSpanEndDemand) / activeDayCount);

            if (spanStartDemand > 0) {
                addGap(profile.route, 'span_start', profile.dayType, profile.season, point.hour, spanStartDemand, point.supply, context);
            }
            if (spanEndDemand > 0) {
                addGap(profile.route, 'span_end', profile.dayType, profile.season, point.hour, spanEndDemand, point.supply, context);
            }

            const demandGap = roundToTenth(inSpanDemand - point.supply);
            if (inSpanDemand >= 3 && (point.supply === 0 || demandGap >= 3 || inSpanDemand >= point.supply * 2)) {
                const note = point.supply === 0
                    ? 'Demand with zero scheduled departures'
                    : `Demand exceeds scheduled departures by ${demandGap}/h`;
                addGap(
                    profile.route,
                    'frequency_gap',
                    profile.dayType,
                    profile.season,
                    point.hour,
                    inSpanDemand,
                    point.supply,
                    context ? `${context}, ${note}` : note
                );
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
        });

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
    for (let dLat = -STOP_INDEX_SEARCH_RADIUS; dLat <= STOP_INDEX_SEARCH_RADIUS; dLat++) {
        for (let dLon = -STOP_INDEX_SEARCH_RADIUS; dLon <= STOP_INDEX_SEARCH_RADIUS; dLon++) {
            const bucket = index.buckets.get(`${latBin + dLat}_${lonBin + dLon}`);
            if (bucket) candidates.push(...bucket);
        }
    }
    const searchSet = candidates.length > 0 ? candidates : index.stops;

    const findBest = (stops: StopIndexEntry[]): { stopName: string | null; distanceKm: number } => {
        let bestName: string | null = null;
        let bestDistanceKm = Number.POSITIVE_INFINITY;
        for (const stop of stops) {
            const dist = haversineKm(lat, lon, stop.lat, stop.lon);
            if (dist < bestDistanceKm) {
                bestDistanceKm = dist;
                bestName = stop.stopName;
            }
        }

        return {
            stopName: bestName,
            distanceKm: Number.isFinite(bestDistanceKm) ? bestDistanceKm : 0,
        };
    };

    let result = findBest(searchSet);
    if (searchSet !== index.stops && result.distanceKm > STOP_PROXIMITY_THRESHOLD_KM) {
        result = findBest(index.stops);
    }

    cache.set(cacheKey, result);
    return result;
}

function isValidStopAnalysisCoordinate(lat: number, lon: number): boolean {
    return Number.isFinite(lat)
        && Number.isFinite(lon)
        && !(lat === 0 && lon === 0)
        && lat >= CANADA_BOUNDS.minLat
        && lat <= CANADA_BOUNDS.maxLat
        && lon >= CANADA_BOUNDS.minLon
        && lon <= CANADA_BOUNDS.maxLon
        && isInBarrieAnalysisArea(lat, lon);
}

function normalizeStopMentionDisplayName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function normalizeStopMentionKey(value: string): string {
    return normalizeStopMentionDisplayName(value).toLowerCase();
}

function getMostCommonStopMentionDisplayName(displayCounts: Map<string, number>): string {
    let selected = '';
    let selectedCount = -1;
    for (const [displayName, count] of displayCounts.entries()) {
        if (count > selectedCount) {
            selected = displayName;
            selectedCount = count;
        }
    }
    return selected;
}

function buildStopMentionRanking(allLegs: TransitAppTripLegRow[]): StopMentionRankingRow[] {
    const mentionMap = new Map<string, { mentions: number; displayCounts: Map<string, number> }>();
    for (const leg of allLegs) {
        const names = [leg.start_stop_name, leg.end_stop_name];
        for (const rawName of names) {
            const displayName = normalizeStopMentionDisplayName(rawName || '');
            if (!displayName) continue;

            const key = normalizeStopMentionKey(displayName);
            let entry = mentionMap.get(key);
            if (!entry) {
                entry = { mentions: 0, displayCounts: new Map<string, number>() };
                mentionMap.set(key, entry);
            }

            entry.mentions += 1;
            entry.displayCounts.set(displayName, (entry.displayCounts.get(displayName) || 0) + 1);
        }
    }

    return Array.from(mentionMap.values())
        .map(entry => ({
            stopName: getMostCommonStopMentionDisplayName(entry.displayCounts),
            mentions: entry.mentions,
        }))
        .sort((a, b) => b.mentions - a.mentions || a.stopName.localeCompare(b.stopName))
        .slice(0, 80);
}

function buildEmptyStopProximityAnalysis(
    candidateEndpointCount: number,
    invalidEndpointCount: number,
    outOfScopeEndpointCount: number,
    stopMentions: StopMentionRankingRow[],
): TransitAppStopProximityAnalysis {
    return {
        schemaVersion: STOP_PROXIMITY_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        totals: {
            tripEndpointsAnalyzed: 0,
            avgNearestStopDistanceKm: 0,
            farEndpointCount: 0,
            farEndpointSharePct: 0,
            clusterCount: 0,
            candidateTripEndpoints: candidateEndpointCount,
            invalidEndpointCount,
            outOfScopeEndpointCount,
        },
        farThresholdKm: STOP_PROXIMITY_THRESHOLD_KM,
        topClusters: [],
        stopMentions,
    };
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
        { id: 'weekday_overnight', dayType: 'weekday', timeBand: 'overnight' },
        { id: 'saturday_all_day', dayType: 'saturday', timeBand: 'all_day' },
        { id: 'sunday_all_day', dayType: 'sunday', timeBand: 'all_day' },
    ];
    const atlasSeasons: TransferSeason[] = ['jan', 'jul', 'sep'];
    if (debiasedPoints.some(point => point.season === 'other')) {
        atlasSeasons.push('other');
    }

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
        .sort((a, b) => b.pointCount - a.pointCount);

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
    const stopMentions = buildStopMentionRanking(allLegs);
    const endpointSummaries: Array<{
        lat: number;
        lon: number;
        nearestStopName: string | null;
        nearestStopDistanceKm: number;
        timeBand: TransferTimeBand;
        dayType: TransferDayType;
        season: TransferSeason;
    }> = [];
    let candidateEndpointCount = 0;
    let invalidEndpointCount = 0;
    let outOfScopeEndpointCount = 0;

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
            candidateEndpointCount += 1;
            if (!Number.isFinite(endpoint.lat) || !Number.isFinite(endpoint.lon) || (endpoint.lat === 0 && endpoint.lon === 0)) {
                invalidEndpointCount += 1;
                continue;
            }
            if (!isValidStopAnalysisCoordinate(endpoint.lat, endpoint.lon)) {
                outOfScopeEndpointCount += 1;
                continue;
            }
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

    if (endpointSummaries.length === 0) {
        return buildEmptyStopProximityAnalysis(
            candidateEndpointCount,
            invalidEndpointCount,
            outOfScopeEndpointCount,
            stopMentions,
        );
    }

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
            clusterCount: clusterMap.size,
            candidateTripEndpoints: candidateEndpointCount,
            invalidEndpointCount,
            outOfScopeEndpointCount,
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

function aggregateRouteLegsByMonth(allLegs: TransitAppTripLegRow[]): Map<string, RouteLegMonthSummary> {
    const routeMonthMap = new Map<string, {
        totalLegs: number;
        trips: Set<string>;
        weekdayLegs: number;
        weekendLegs: number;
    }>();

    for (const leg of allLegs) {
        if ((leg.mode || '').trim().toUpperCase() !== 'TRANSIT' || !leg.route_short_name) continue;
        const timestamp = parseUtcDateTime(leg.start_time || leg.end_time);
        if (!timestamp) continue;

        const route = normalizeRouteKey(leg.route_short_name);
        const month = toMonthKey(utcToEasternDateStr(timestamp));
        const key = `${route}|${month}`;
        const existing = routeMonthMap.get(key);
        const dayType = inferDayTypeForDate(timestamp);
        const isWeekdayLeg = dayType === 'weekday';

        if (existing) {
            existing.totalLegs += 1;
            if (isWeekdayLeg) {
                existing.weekdayLegs += 1;
            } else {
                existing.weekendLegs += 1;
            }
            existing.trips.add(leg.user_trip_id);
        } else {
            routeMonthMap.set(key, {
                totalLegs: 1,
                weekdayLegs: isWeekdayLeg ? 1 : 0,
                weekendLegs: isWeekdayLeg ? 0 : 1,
                trips: new Set([leg.user_trip_id]),
            });
        }
    }

    return new Map(
        Array.from(routeMonthMap.entries()).map(([key, value]) => ([
            key,
            {
                totalLegs: value.totalLegs,
                uniqueTrips: value.trips.size,
                weekdayLegs: value.weekdayLegs,
                weekendLegs: value.weekendLegs,
            },
        ]))
    );
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

// ============ OD COVERAGE GAP ANALYSIS ============

type CoverageRouteGroup = {
    route: string;
    shapes: GtfsRouteShape[];
};

function buildCoverageRouteGroups(shapes: GtfsRouteShape[]): CoverageRouteGroup[] {
    const groups = new Map<string, GtfsRouteShape[]>();
    for (const shape of shapes) {
        if (shape.points.length === 0) continue;
        const route = normalizeBarrieRouteForSupply(shape.routeShortName);
        const existing = groups.get(route);
        if (existing) existing.push(shape);
        else groups.set(route, [shape]);
    }

    return Array.from(groups.entries())
        .map(([route, routeShapes]) => ({ route, shapes: routeShapes }))
        .sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
}

function minDistanceToRouteGroupKm(point: [number, number], group: CoverageRouteGroup): number {
    let minDistance = Number.POSITIVE_INFINITY;
    for (const shape of group.shapes) {
        const distance = pointToPolylineDistanceKm(point, shape.points);
        if (distance < minDistance) minDistance = distance;
    }
    return minDistance;
}

/**
 * Analyze Barrie-only OD pairs for route coverage gaps.
 * For each top OD pair, checks whether both endpoints are within a 1km
 * buffer of the same normalized Barrie GTFS route. A/B routes that operate
 * as one Transit App route key (2, 7, 12) are grouped together, and every
 * GTFS shape variant is considered before classifying direct service.
 */
export function analyzeODCoverageGaps(
    odPairs: ODPairData,
    topN: number = 25
): ODCoverageGap[] {
    let shapes: GtfsRouteShape[];
    try {
        shapes = loadGtfsRouteShapeVariants();
    } catch {
        return [];
    }
    if (shapes.length === 0) return [];

    const BUFFER_KM = 1.0;
    const routeGroups = buildCoverageRouteGroups(shapes);
    if (routeGroups.length === 0) return [];

    const pairs = odPairs.pairs
        .filter(isBarrieOnlyODPair)
        .slice(0, topN);
    const results: ODCoverageGap[] = [];

    for (const pair of pairs) {
        const originPt: [number, number] = [pair.originLat, pair.originLon];
        const destPt: [number, number] = [pair.destLat, pair.destLon];

        let nearestRouteOrigin: string | null = null;
        let nearestRouteDest: string | null = null;
        let originRouteDistKm = Infinity;
        let destRouteDistKm = Infinity;
        const servingRoutes = new Set<string>();

        for (const group of routeGroups) {
            const oDist = minDistanceToRouteGroupKm(originPt, group);
            const dDist = minDistanceToRouteGroupKm(destPt, group);

            // Track nearest route to origin
            if (oDist < originRouteDistKm) {
                originRouteDistKm = oDist;
                nearestRouteOrigin = group.route;
            }
            // Track nearest route to dest
            if (dDist < destRouteDistKm) {
                destRouteDistKm = dDist;
                nearestRouteDest = group.route;
            }

            // Check if this route covers both endpoints
            if (oDist <= BUFFER_KM && dDist <= BUFFER_KM) {
                servingRoutes.add(group.route);
            }
        }

        const directServingRoutes = Array.from(servingRoutes)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        const originZoneName = findNearestStopName(pair.originLat, pair.originLon, 0.5)
            ?? `${pair.originLat.toFixed(3)}, ${pair.originLon.toFixed(3)}`;
        const destZoneName = findNearestStopName(pair.destLat, pair.destLon, 0.5)
            ?? `${pair.destLat.toFixed(3)}, ${pair.destLon.toFixed(3)}`;

        const coverageStatus = directServingRoutes.length > 0
            ? 'served'
            : originRouteDistKm > BUFFER_KM && destRouteDistKm > BUFFER_KM
                ? 'gap'
                : 'partial';

        results.push({
            pair,
            originZoneName,
            destZoneName,
            distanceKm: haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon),
            nearestRouteOrigin,
            nearestRouteDest,
            originRouteDistKm: Math.round(originRouteDistKm * 100) / 100,
            destRouteDistKm: Math.round(destRouteDistKm * 100) / 100,
            isServedByDirectRoute: directServingRoutes.length > 0,
            servingRoutes: directServingRoutes,
            coverageStatus,
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
