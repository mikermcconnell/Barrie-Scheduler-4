export const ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION = 1 as const;

export type RouteConceptProjectSchemaVersion = typeof ROUTE_CONCEPT_PROJECT_SCHEMA_VERSION;
export type RouteConceptProjectStatus = 'local-draft' | 'local-saved' | 'archived';
export type RouteConceptAlternativeStatus = 'draft' | 'review';
export type RouteConceptStructure = 'bidirectional' | 'loop' | 'out-and-back';
export type RouteConceptPatternRole = 'outbound' | 'inbound' | 'loop' | 'out-and-back';
export type RouteConceptStopRole = 'regular' | 'timed' | 'start-terminal' | 'end-terminal' | 'turnaround';
export type RouteConceptStopSource = 'custom' | 'gtfs';
export type RouteConceptDayType = 'weekday' | 'saturday' | 'sunday';
export type RouteConceptPlanningPeriod = 'all-day' | 'am-peak' | 'midday' | 'pm-peak' | 'evening';
export type RouteConceptAutomaticRuntimeSource = 'gtfs' | 'mapbox' | 'fallback';
export type RouteConceptRuntimeSource = 'manual' | RouteConceptAutomaticRuntimeSource | 'missing';
export type RouteConceptConfidence = 'high' | 'medium' | 'low' | 'not-ready';
export type RouteConceptIssueSeverity = 'info' | 'warning' | 'blocking';
export type RouteConceptReadiness = 'not-ready' | 'needs-review' | 'ready-for-review';

export interface RouteConceptPoint {
    id: string;
    lat: number;
    lng: number;
    sequence: number;
    afterStopId?: string;
    beforeStopId?: string;
    segmentSequence?: number;
}

/** Neutral stop data. Rider manifests, addresses, and camper fields do not belong in this model. */
export interface ConceptStop {
    id: string;
    name: string;
    lat: number;
    lng: number;
    sequence: number;
    role: RouteConceptStopRole;
    source: RouteConceptStopSource;
    stopCode?: string;
    notes?: string;
}

export interface RouteConceptSegmentRuntimeEvidence {
    id: string;
    fromStopId: string;
    toStopId: string;
    runtimeMinutes: number;
    source: RouteConceptAutomaticRuntimeSource;
    pathFingerprint?: string;
    dayType?: RouteConceptDayType;
    planningPeriod?: RouteConceptPlanningPeriod;
    sampleSize?: number;
    distanceKm?: number;
    updatedAt?: string;
    fallbackReason?: string;
}

export interface RouteConceptSegmentRuntimeOverride {
    runtimeMinutes: number;
    confirmed: boolean;
    pathFingerprint?: string;
    notes?: string;
    updatedAt: string;
}

export interface RouteConceptPattern {
    id: string;
    name: string;
    role: RouteConceptPatternRole;
    alignment: RouteConceptPoint[];
    stops: ConceptStop[];
    /** Current path fingerprint by the stable `fromStopId->toStopId` segment key. */
    segmentFingerprints?: Record<string, string>;
    runtimeEvidence: RouteConceptSegmentRuntimeEvidence[];
    runtimeOverrides: Record<string, RouteConceptSegmentRuntimeOverride>;
    source?: {
        type: 'blank' | 'gtfs';
        routeId?: string;
        routeShortName?: string;
        serviceId?: string;
        directionId?: number;
        shapeId?: string;
        feedVersion?: string;
        importedAt?: string;
    };
    notes: string;
    createdAt: string;
    updatedAt: string;
}

export interface RouteConceptServiceAssumptions {
    /** Minutes since the start of the service day. Values may exceed 1440. */
    firstDepartureMinutes: number;
    /** Minutes since the start of the service day. Values may exceed 1440. */
    lastDepartureMinutes: number;
    frequencyMinutes: number;
    testedBuses?: number;
    startTerminalLayoverMinutes: number;
    endTerminalLayoverMinutes: number;
    intermediateStopDwellSeconds: number;
    dayType: RouteConceptDayType;
    planningPeriod: RouteConceptPlanningPeriod;
}

export interface RouteConceptAlternative {
    id: string;
    name: string;
    status: RouteConceptAlternativeStatus;
    structure: RouteConceptStructure;
    patternOrder: string[];
    patterns: RouteConceptPattern[];
    service: RouteConceptServiceAssumptions;
    notes: string;
    createdAt: string;
    updatedAt: string;
}

export interface RouteConceptProject {
    id: string;
    name: string;
    status: RouteConceptProjectStatus;
    schemaVersion: RouteConceptProjectSchemaVersion;
    revision: number;
    selectedAlternativeId: string;
    preferredAlternativeId?: string;
    alternativeOrder: string[];
    alternatives: RouteConceptAlternative[];
    createdAt: string;
    updatedAt: string;
    updatedBy?: string;
}

export interface RouteConceptResolvedSegment {
    id: string;
    patternId: string;
    fromStopId: string;
    toStopId: string;
    runtimeMinutes: number | null;
    source: RouteConceptRuntimeSource;
    confidence: Exclude<RouteConceptConfidence, 'not-ready'> | 'missing';
    pathFingerprint?: string;
    requiresManualConfirmation: boolean;
    fallbackReason?: string;
    evidenceDayType?: RouteConceptDayType;
    evidencePlanningPeriod?: RouteConceptPlanningPeriod;
}

export interface RouteConceptDailyMetrics {
    serviceSpanMinutes: number;
    departuresPerStartingTerminal: number;
    totalDepartures: number;
    revenueHours: number;
    vehicleHours: number;
}

export interface RouteConceptIssue {
    id: string;
    severity: RouteConceptIssueSeverity;
    message: string;
    action?: string;
    patternId?: string;
    segmentId?: string;
}

export interface RouteConceptFeasibility {
    completeRouteRuntimeMinutes: number | null;
    dwellTimeMinutes: number;
    cycleRequirementMinutes: number | null;
    minimumBusesRequired: number | null;
    testedBuses: number | null;
    scheduledCycleWindowMinutes: number | null;
    recoveryTimeMinutes: number | null;
    recoveryPercent: number | null;
    daily: RouteConceptDailyMetrics | null;
    confidence: RouteConceptConfidence;
    readiness: RouteConceptReadiness;
    comparisonReady: boolean;
    segments: RouteConceptResolvedSegment[];
    issues: RouteConceptIssue[];
}

export interface RouteConceptAlternativeSummary {
    alternativeId: string;
    alternativeName: string;
    isPreferred: boolean;
    readiness: RouteConceptReadiness;
    comparisonReady: boolean;
    completeRouteRuntimeMinutes: number | null;
    minimumBusesRequired: number | null;
    testedBuses: number | null;
    recoveryTimeMinutes: number | null;
    recoveryPercent: number | null;
    dailyRevenueHours: number | null;
    dailyVehicleHours: number | null;
    confidence: RouteConceptConfidence;
    blockingIssueCount: number;
    warningCount: number;
}

export interface RouteConceptProjectSummary {
    totalAlternatives: number;
    comparisonReadyCount: number;
    selectedAlternative: RouteConceptAlternativeSummary | null;
    preferredAlternative: RouteConceptAlternativeSummary | null;
    alternatives: RouteConceptAlternativeSummary[];
}
