/**
 * Transit App Data Types
 *
 * Types for importing, parsing, and aggregating Transit App rider data.
 * Raw types are transient (parsing only). Aggregated types are stored in Firebase.
 */

// ============ FILE DETECTION ============

export type TransitAppFileType =
    | 'lines'
    | 'trips'
    | 'locations'
    | 'go_trip_legs'
    | 'planned_go_trip_legs'
    | 'tapped_trip_view_legs'
    | 'users';

export interface DetectedTransitAppFile {
    file: File;
    type: TransitAppFileType;
    date: string | null; // YYYY-MM-DD, null for users.csv
}

// ============ RAW ROW TYPES (transient, parsing only) ============

export interface TransitAppLineRow {
    route_short_name: string;
    nearby_views: number;
    nearby_taps: number;
    tapped_routing_suggestions: number;
    go_trips: number;
    date: string; // extracted from filename
}

export interface TransitAppTripRow {
    user_id: string;
    start_longitude: number;
    start_latitude: number;
    end_longitude: number;
    end_latitude: number;
    timestamp: string;
    arrive_by: string;
    leave_at: string;
}

export interface TransitAppLocationRow {
    user_id: string;
    longitude: number;
    latitude: number;
    timestamp: string;
}

export interface TransitAppTripLegRow {
    user_trip_id: string;
    start_time: string;
    end_time: string;
    start_longitude: number;
    start_latitude: number;
    end_longitude: number;
    end_latitude: number;
    service_name: string;
    route_short_name: string;
    mode: string;
    start_stop_name: string;
    end_stop_name: string;
    // go_trip_legs extras (optional)
    distance?: number;
    progression?: number;
    users_helped?: number;
}

export interface TransitAppUsersRow {
    date: string;
    users: number;
    sessions: number;
    downloads: number;
}

/** All parsed data from a batch of files */
export interface TransitAppParsedData {
    lines: TransitAppLineRow[];
    trips: TransitAppTripRow[];
    locations: TransitAppLocationRow[];
    goTripLegs: TransitAppTripLegRow[];
    plannedTripLegs: TransitAppTripLegRow[];
    tappedTripLegs: TransitAppTripLegRow[];
    users: TransitAppUsersRow[];
}

// ============ AGGREGATED TYPES (stored in Firebase) ============

export interface RouteMetricDaily {
    date: string;
    route: string;
    nearbyViews: number;
    nearbyTaps: number;
    tappedRoutingSuggestions: number;
    goTrips: number;
}

export interface RouteMetricSummary {
    route: string;
    totalViews: number;
    totalTaps: number;
    totalSuggestions: number;
    totalGoTrips: number;
    avgDailyViews: number;
    avgDailyTaps: number;
    daysActive: number;
    viewToTapRate?: number | null;
    viewToSuggestionRate?: number | null;
    tapToSuggestionRate?: number | null;
    suggestionToGoRate?: number | null;
    compositeScore?: number | null;
    trend?: TransitAppTrend;
    weekdayScore?: number | null;
    weekendScore?: number | null;
}

export type TransitAppTrend = 'Rising' | 'Stable' | 'Declining' | 'N/A';
export type TransitAppConfidence = 'High' | 'Medium' | 'Low';
export type TransitAppEffortBand = 'Low' | 'Medium' | 'High';
export type TransitAppImpactBand = 'Low' | 'Medium' | 'High';

export type TransitAppDiagnosisCode =
    | 'healthy'
    | 'low_awareness'
    | 'low_interest_conversion'
    | 'low_itinerary_followthrough'
    | 'low_regional_integration'
    | 'weekday_weekend_mismatch'
    | 'seasonal_drop'
    | 'low_data_confidence';

export type TransitAppActionType =
    | 'maintain_service'
    | 'improve_marketing'
    | 'retime_service'
    | 'adjust_frequency'
    | 'investigate_go_connections'
    | 'monitor_only'
    | 'manual_planner_review';

export interface RoutePerformanceThresholds {
    minimumViewsForRatios: number;
    trendDeltaPoints: number;
}

export interface RoutePerformanceMonthly {
    route: string;
    month: string; // YYYY-MM
    daysActive: number;
    totalViews: number;
    totalTaps: number;
    totalSuggestions: number;
    totalGoTrips: number;
    totalLegs: number;
    uniqueTrips: number;
    avgDailyViews: number;
    avgDailyTaps: number;
    viewToTapRate: number | null;
    viewToSuggestionRate: number | null;
    tapToSuggestionRate: number | null;
    suggestionToGoRate: number | null;
    viewToTapRankPct: number | null;
    viewToSuggestionRankPct: number | null;
    suggestionToGoRankPct: number | null;
    goTripsRankPct: number | null;
    totalLegsRankPct: number | null;
    compositeScore: number | null;
    weekdayScore: number | null;
    weekendScore: number | null;
    viewsPerScheduledTrip: number | null;
    tapsPerScheduledTrip: number | null;
    normalizationAvailable: boolean;
    confidence: TransitAppConfidence;
}

export interface RoutePerformanceScorecardRow {
    route: string;
    latestMonth: string;
    avgDailyViews: number;
    avgDailyTaps: number;
    totalViews: number;
    totalTaps: number;
    totalSuggestions: number;
    totalGoTrips: number;
    totalLegs: number;
    uniqueTrips: number;
    viewToTapRate: number | null;
    viewToSuggestionRate: number | null;
    tapToSuggestionRate: number | null;
    suggestionToGoRate: number | null;
    compositeScore: number | null;
    trend: TransitAppTrend;
    trendDelta: number | null;
    weekdayScore: number | null;
    weekendScore: number | null;
    viewsPerScheduledTrip: number | null;
    tapsPerScheduledTrip: number | null;
    normalizationAvailable: boolean;
    belowMedian: boolean;
    isWatchRoute: boolean;
    isMonitorRoute: boolean;
    confidence: TransitAppConfidence;
    diagnosisCode: TransitAppDiagnosisCode;
    diagnosisLabel: string;
    recommendedAction: TransitAppActionType;
    recommendedActionLabel: string;
    effortBand: TransitAppEffortBand;
    impactBand: TransitAppImpactBand;
}

export interface RouteWatchlistRow {
    route: string;
    latestMonth: string;
    compositeScore: number | null;
    trend: TransitAppTrend;
    belowMedian: boolean;
    confidence: TransitAppConfidence;
    diagnosisCode: TransitAppDiagnosisCode;
    recommendedAction: TransitAppActionType;
    priorityScore: number;
}

export interface TransitAppRoutePerformance {
    schemaVersion: number;
    thresholds: RoutePerformanceThresholds;
    months: string[];
    latestMonth: string | null;
    latestMedianScore: number | null;
    monthly: RoutePerformanceMonthly[];
    scorecard: RoutePerformanceScorecardRow[];
    watchlist: RouteWatchlistRow[];
    generatedAt: string;
}

export interface HourlyTripDistribution {
    hour: number; // 0-23
    count: number;
}

export interface DailyTripCount {
    date: string;
    count: number;
}

export type ServiceGapType =
    | 'span_start'
    | 'span_end'
    | 'weekend'
    | 'seasonal_shift'
    | 'frequency_gap';

export interface RouteSupplyProfile {
    route: string;
    dayType: TransferDayType;
    firstDepartureMin: number | null;
    lastDepartureMin: number | null;
    avgHeadwayMinutes: number | null;
    departuresByHour: number[]; // 24-element array, index = hour
    totalDepartures: number;
}

export interface RouteDemandSupplyPoint {
    hour: number; // 0-23
    demand: number;
    supply: number;
}

export interface RouteDemandSupplyProfile {
    route: string;
    dayType: TransferDayType;
    season: TransferSeason;
    firstDepartureMin: number | null;
    lastDepartureMin: number | null;
    avgHeadwayMinutes: number | null;
    totalDemand: number;
    totalSupply: number;
    demandBeforeFirst: number;
    demandAfterLast: number;
    hourly: RouteDemandSupplyPoint[];
}

export interface ServiceGapRegisterRow {
    route: string;
    gapType: ServiceGapType;
    dayType: TransferDayType;
    timeBand: TransferTimeBand;
    season: TransferSeason;
    appRequestsPerHour: number;
    scheduledTripsPerHour: number;
    notes: string;
}

export interface TransitAppServiceGapAnalysis {
    schemaVersion: number;
    generatedAt: string;
    supplyProfiles: RouteSupplyProfile[];
    routeProfiles: RouteDemandSupplyProfile[];
    gapRegister: ServiceGapRegisterRow[];
    totals: {
        routesWithDemand: number;
        routesWithSupply: number;
        matchedRoutes: number;
        gapsByType: Record<ServiceGapType, number>;
    };
}

export interface LocationGridCell {
    latBin: number;
    lonBin: number;
    count: number;
}

export type LocationTimeBand = 'am_peak' | 'midday' | 'pm_peak' | 'evening';
export type HeatmapAtlasSliceId =
    | 'weekday_am_peak'
    | 'weekday_midday'
    | 'weekday_pm_peak'
    | 'weekday_evening'
    | 'saturday_all_day'
    | 'sunday_all_day';

export interface LocationAtlasSlice {
    id: HeatmapAtlasSliceId;
    season: TransferSeason;
    dayType: TransferDayType;
    timeBand: LocationTimeBand | 'all_day';
    cells: LocationGridCell[];
    totalPoints: number;
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

export interface HeatmapCallout {
    season: TransferSeason;
    dayType: TransferDayType;
    timeBand: LocationTimeBand | 'all_day';
    lat: number;
    lon: number;
    pointCount: number;
    note: string;
}

export interface TransitAppHeatmapAnalysis {
    schemaVersion: number;
    generatedAt: string;
    debiasing: {
        windowMinutes: number;
        rawPoints: number;
        debiasedPoints: number;
        reductionPct: number;
    };
    atlas: LocationAtlasSlice[];
    seasonalTotals: { jan: number; jul: number; sep: number; other: number };
    callouts: HeatmapCallout[];
}

export interface StopProximityPointSummary {
    lat: number;
    lon: number;
    nearestStopName: string | null;
    nearestStopDistanceKm: number;
    timeBand: TransferTimeBand;
    dayType: TransferDayType;
    season: TransferSeason;
}

export interface StopCoverageGapCluster {
    clusterId: string;
    lat: number;
    lon: number;
    tripCount: number;
    avgNearestStopDistanceKm: number;
    nearestStopName: string | null;
    nearestStopDistanceKm: number;
    dominantTimeBand: TransferTimeBand;
    dominantDayType: TransferDayType;
    dominantSeason: TransferSeason;
    odOverlapCount: number;
}

export interface StopMentionRankingRow {
    stopName: string;
    mentions: number;
}

export interface TransitAppStopProximityAnalysis {
    schemaVersion: number;
    generatedAt: string;
    totals: {
        tripEndpointsAnalyzed: number;
        avgNearestStopDistanceKm: number;
        farEndpointCount: number;
        farEndpointSharePct: number;
        clusterCount: number;
    };
    farThresholdKm: number;
    topClusters: StopCoverageGapCluster[];
    stopMentions: StopMentionRankingRow[];
}

export interface ODPair {
    originLat: number;
    originLon: number;
    destLat: number;
    destLon: number;
    count: number;
    hourlyBins?: number[]; // 24-element array, index = hour (0-23)
    weekdayCount?: number;
    weekendCount?: number;
    seasonBins?: { jan: number; jul: number; sep: number; other: number };
    odFilterBins?: Record<string, number>; // key: `${dayType}|${season}|${hour}`
}

export interface ODPairData {
    pairs: ODPair[];
    resolution: number;
    totalTripsProcessed: number;
    totalTripsSkipped: number;
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    seasonTotals?: { jan: number; jul: number; sep: number; other: number };
}

export interface ODCoverageGap {
    pair: ODPair;
    originZoneName: string;
    destZoneName: string;
    distanceKm: number;
    nearestRouteOrigin: string | null;
    nearestRouteDest: string | null;
    originRouteDistKm: number;
    destRouteDistKm: number;
    isServedByDirectRoute: boolean;
    servingRoutes: string[];
}

export interface TransferPattern {
    fromRoute: string;
    toRoute: string;
    fromStop: string;
    toStop: string;
    transferStopName?: string;
    transferStopId?: string | null;
    transferStopCode?: string | null;
    barrieTransferStop?: boolean;
    fromTripAnchors?: TransferTripAnchor[];
    toTripAnchors?: TransferTripAnchor[];
    count: number;
    avgWaitMinutes: number;
    minWaitMinutes: number;
    maxWaitMinutes: number;
}

export type TransferTimeBand = 'am_peak' | 'midday' | 'pm_peak' | 'evening' | 'overnight';
export type TransferDayType = 'weekday' | 'saturday' | 'sunday';
export type TransferSeason = 'jan' | 'jul' | 'sep' | 'other';
export type TransferType =
    | 'barrie_to_barrie'
    | 'barrie_to_go'
    | 'go_to_barrie'
    | 'barrie_to_regional'
    | 'regional_to_barrie'
    | 'regional_to_regional'
    | 'other';
export type TransferPriorityTier = 'high' | 'medium' | 'low';

export interface TransferTripAnchor {
    minuteOfDay: number;
    timeLabel: string; // HH:MM
    count: number;
    sharePct: number;
}

export interface TransferVolumeRow {
    fromRoute: string;
    toRoute: string;
    fromRouteId: string | null;
    toRouteId: string | null;
    transferStopName: string;
    transferStopId: string | null;
    transferStopCode: string | null;
    timeBand: TransferTimeBand;
    dayType: TransferDayType;
    season: TransferSeason;
    transferType: TransferType;
    count: number;
    avgWaitMinutes: number;
    minWaitMinutes: number;
    maxWaitMinutes: number;
}

export interface TransferPairSummary {
    fromRoute: string;
    toRoute: string;
    fromRouteId: string | null;
    toRouteId: string | null;
    transferStopName: string;
    transferStopId: string | null;
    transferStopCode: string | null;
    transferType: TransferType;
    totalCount: number;
    avgWaitMinutes: number;
    dominantTimeBands: TransferTimeBand[];
    fromTripAnchors?: TransferTripAnchor[];
    toTripAnchors?: TransferTripAnchor[];
}

export interface GoLinkedTransferSummary {
    fromRoute: string;
    toRoute: string;
    fromRouteId: string | null;
    toRouteId: string | null;
    transferStopName: string;
    transferStopId: string | null;
    transferStopCode: string | null;
    timeBand: TransferTimeBand;
    totalCount: number;
    avgWaitMinutes: number;
    transferType: TransferType;
}

export interface TransferConnectionTargetCandidate {
    fromRoute: string;
    toRoute: string;
    fromRouteId: string | null;
    toRouteId: string | null;
    locationStopName: string;
    locationStopId: string | null;
    locationStopCode: string | null;
    timeBands: TransferTimeBand[];
    totalTransfers: number;
    priorityTier: TransferPriorityTier;
    goLinked: boolean;
    fromTripAnchors?: TransferTripAnchor[];
    toTripAnchors?: TransferTripAnchor[];
}

export interface TransferNormalizationCoverage {
    routeReferencesMatched: number;
    routeReferencesTotal: number;
    routeMatchRate: number;
    stopReferencesMatched: number;
    stopReferencesTotal: number;
    stopMatchRate: number;
}

export interface TransitAppTransferAnalysis {
    schemaVersion: number;
    totals: {
        tripChainsProcessed: number;
        tripChainsDeduplicated: number;
        transferEvents: number;
        goLinkedTransferEvents: number;
        uniqueRoutePairs: number;
        uniqueTransferStops: number;
    };
    normalization: TransferNormalizationCoverage;
    volumeMatrix: TransferVolumeRow[];
    topTransferPairs: TransferPairSummary[];
    goLinkedSummary: GoLinkedTransferSummary[];
    connectionTargets: TransferConnectionTargetCandidate[];
}

export interface RouteLegSummary {
    route: string;
    serviceName: string;
    totalLegs: number;
    uniqueTrips: number;
    topBoardingStops: { stop: string; count: number }[];
    topAlightingStops: { stop: string; count: number }[];
}

export interface AppUsageDaily {
    date: string;
    users: number;
    sessions: number;
    downloads: number;
}

export interface TransitAppDataSummary {
    schemaVersion?: number;
    routeMetrics: {
        daily: RouteMetricDaily[];
        summary: RouteMetricSummary[];
    };
    tripDistribution: {
        hourly: HourlyTripDistribution[];
        daily: DailyTripCount[];
    };
    locationDensity: {
        cells: LocationGridCell[];
        bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
        totalPoints: number;
        rawPoints?: number;
        debiasedPoints?: number;
        debiasWindowMinutes?: number;
    };
    transferPatterns: TransferPattern[];
    transferAnalysis?: TransitAppTransferAnalysis;
    routeLegs: RouteLegSummary[];
    routePerformance?: TransitAppRoutePerformance;
    serviceGapAnalysis?: TransitAppServiceGapAnalysis;
    stopProximityAnalysis?: TransitAppStopProximityAnalysis;
    heatmapAnalysis?: TransitAppHeatmapAnalysis;
    odPairs?: ODPairData;
    appUsage: AppUsageDaily[];
    metadata: {
        importedAt: string;
        importedBy: string;
        dateRange: { start: string; end: string };
        fileStats: TransitAppFileStats;
    };
}

// ============ IMPORT STATE ============

export interface TransitAppFileStats {
    totalFiles: number;
    dateRange: { start: string; end: string } | null;
    filesByType: Record<TransitAppFileType, number>;
    rowsParsed: number;
    rowsSkipped: number;
}

export type TransitAppImportStatus = 'idle' | 'selecting' | 'previewing' | 'processing' | 'complete' | 'error';

export interface TransitAppImportState {
    status: TransitAppImportStatus;
    detectedFiles: DetectedTransitAppFile[];
    unrecognizedFiles: File[];
    progress: number; // 0-100
    progressPhase: string;
    errors: string[];
    fileStats: TransitAppFileStats | null;
}
