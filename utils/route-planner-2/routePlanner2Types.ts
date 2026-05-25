export type RoutePlanner2ProjectStatus = 'local-draft' | 'local-saved' | 'archived';
export type RoutePlanner2ScenarioStatus = 'draft' | 'review';
export type RoutePlanner2RouteShape = 'one-way' | 'closed-loop' | 'out-and-back';
export type RoutePlanner2StopRole = 'regular' | 'timed' | 'start-terminal' | 'end-terminal' | 'turnaround';
export type RoutePlanner2RuntimeSource =
    | 'observed-proxy'
    | 'observed-scheduled-blend'
    | 'scheduled-proxy'
    | 'partial-scheduled-proxy'
    | 'manual'
    | 'mapbox'
    | 'fallback'
    | 'missing';
export type RoutePlanner2RuntimeEvidenceMethod = 'adjacent-stop-pair' | 'corridor-path' | 'shape-overlap';
export type RoutePlanner2Confidence = 'high' | 'medium' | 'low' | 'not-ready';
export type RoutePlanner2SegmentConfidence = 'high' | 'medium' | 'low' | 'missing';
export type RoutePlanner2WarningSeverity = 'info' | 'warning' | 'blocking';
export type RoutePlanner2RuntimeRouteFilterMode = 'all-matching' | 'selected';
export type RoutePlanner2RuntimeSourceMode = 'gtfs' | 'mapbox';

export type RoutePlanner2ScenarioSource =
    | { type: 'blank' }
    | {
        type: 'gtfs';
        routeId?: string;
        routeShortName?: string;
        routeLongName?: string;
        serviceId?: string;
        directionId?: number;
        tripHeadsign?: string;
        shapeId?: string;
        feedVersion?: string;
        importedAt?: string;
    };

export interface RoutePlanner2Project {
    id: string;
    name: string;
    status: RoutePlanner2ProjectStatus;
    selectedScenarioId: string;
    preferredScenarioId?: string;
    scenarios: RoutePlanner2Scenario[];
    createdAt: string;
    updatedAt: string;
}

export interface RoutePlanner2Scenario {
    id: string;
    name: string;
    status: RoutePlanner2ScenarioStatus;
    routeShape: RoutePlanner2RouteShape;
    source?: RoutePlanner2ScenarioSource;
    alignment: RoutePlanner2RoutePoint[];
    stops: RoutePlanner2Stop[];
    turnaroundStopId?: string;
    service: RoutePlanner2ServiceAssumptions;
    runtimeSourceMode?: RoutePlanner2RuntimeSourceMode;
    runtimeRouteFilter?: RoutePlanner2RuntimeRouteFilter;
    runtimeEstimates?: RoutePlanner2SegmentRuntime[];
    runtimeOverrides?: Record<string, RoutePlanner2SegmentRuntimeOverride>;
    notes: string;
    feasibility?: RoutePlanner2FeasibilitySummary;
    createdAt: string;
    updatedAt: string;
}

export interface RoutePlanner2RuntimeRouteFilter {
    mode: RoutePlanner2RuntimeRouteFilterMode;
    routeShortNames: string[];
}

export interface RoutePlanner2RoutePoint {
    id: string;
    lat: number;
    lng: number;
    sequence: number;
    afterStopId?: string;
    beforeStopId?: string;
    segmentSequence?: number;
}

export interface RoutePlanner2Stop {
    id: string;
    name: string;
    address?: string;
    riderCount?: number;
    sourceRows?: number[];
    lat: number;
    lng: number;
    sequence: number;
    role: RoutePlanner2StopRole;
    source: 'custom' | 'barrie-stop';
    stopCode?: string;
    notes?: string;
}

export interface RoutePlanner2ServiceAssumptions {
    firstTripTime: string;
    lastTripTime: string;
    frequencyMinutes: number;
    targetBuses?: number;
    startTerminalLayoverMinutes: number;
    endTerminalLayoverMinutes: number;
    intermediateStopDwellSeconds: number;
    dayType?: 'weekday' | 'saturday' | 'sunday';
    planningPeriod?: 'all-day' | 'am-peak' | 'midday' | 'pm-peak' | 'evening';
}

export interface RoutePlanner2FeasibilitySummary {
    oneWayRuntimeMinutes: number | null;
    segmentRuntimeMinutes: number | null;
    dwellTimeMinutes: number;
    intermediateStopCount: number;
    cycleTimeMinutes: number | null;
    busesRequired: number | null;
    recoveryTimeMinutes: number | null;
    recoveryPercent: number | null;
    confidence: RoutePlanner2Confidence;
    segmentSummaries: RoutePlanner2SegmentRuntime[];
    warnings: RoutePlanner2Warning[];
}

export interface RoutePlanner2SegmentRuntime {
    id: string;
    fromStopId: string;
    toStopId: string;
    runtimeMinutes: number | null;
    source: RoutePlanner2RuntimeSource;
    sampleSize?: number;
    scheduledRuntimeMinutes?: number;
    scheduledCoverageRatio?: number;
    scheduledCoverageDistanceKm?: number;
    estimatedUncoveredDistanceKm?: number;
    observedRuntimeMinutes?: number;
    matchQuality?: 'exact-code' | 'name' | 'nearby' | 'unmatched';
    matchedFromStopId?: string;
    matchedToStopId?: string;
    matchedRoutes?: string[];
    runtimeRouteBreakdown?: RoutePlanner2SegmentRuntimeRouteBreakdown[];
    evidenceMethod?: RoutePlanner2RuntimeEvidenceMethod;
    matchedGtfsPathStopIds?: string[];
    evidenceDayType?: 'weekday' | 'saturday' | 'sunday';
    evidencePeriod?: 'am-peak' | 'midday' | 'pm-peak' | 'evening' | 'full-day';
    confidence: RoutePlanner2SegmentConfidence;
    distanceKm?: number;
    durationSeconds?: number;
    pathFingerprint?: string;
    updatedAt?: string;
    fallbackReason?: string;
}

export interface RoutePlanner2SegmentRuntimeRouteBreakdown {
    routeShortName: string;
    scheduledRuntimeMinutes: number;
}

export interface RoutePlanner2SegmentRuntimeOverride {
    runtimeMinutes: number;
    notes?: string;
    updatedAt: string;
}

export interface RoutePlanner2Warning {
    id: string;
    severity: RoutePlanner2WarningSeverity;
    message: string;
    action?: string;
}
