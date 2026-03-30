import type {
    DirectionBandSummary,
    SampleCountMode,
    TimeBand,
    TripBucketAnalysis,
} from '../../../utils/ai/runtimeAnalysis';
import type { SegmentRawData } from './csvParser';
import type { OrderedSegmentColumn } from './wizardState';
import type { Step2StopOrderHealth } from './step2StopOrder';

export type Step2DayType = 'Weekday' | 'Saturday' | 'Sunday';
export type Step2ImportMode = 'csv' | 'performance';
export type Step2ReviewLifecycle = 'idle' | 'building' | 'reviewable' | 'stale' | 'error';
export type Step2ReadinessStatus = 'blocked' | 'warning' | 'ready';
export type Step2ApprovalState = 'unapproved' | 'approved' | 'stale';
export type Step2Direction = 'North' | 'South';

export interface Step2DateRange {
    start: string;
    end: string;
}

export interface Step2PlannerOverrides {
    excludedBuckets: string[];
}

export interface Step2PerformanceConfig {
    routeId: string;
    dateRange: Step2DateRange | null;
}

export interface Step2PerformanceDiagnostics {
    routeId: string;
    dateRange: Step2DateRange | null;
    runtimeLogicVersion?: number;
    importedAt?: string;
    cleanHistoryStartDate?: string;
    excludedLegacyDayCount?: number;
    usesCleanHistoryCutoff?: boolean;
    stopOrderDecision?: 'accept' | 'review' | 'blocked';
    stopOrderConfidence?: 'high' | 'medium' | 'low';
    stopOrderSource?: 'runtime-derived' | 'master-fallback' | 'none';
}

export interface Step2CanonicalRouteSource {
    type: 'master' | 'runtime-derived';
    routeIdentity?: string;
    versionHint?: string;
}

export interface Step2SourceSnapshot {
    performanceRouteId?: string;
    performanceDateRange?: Step2DateRange | null;
    runtimeLogicVersion?: number;
    importedAt?: string;
    cleanHistoryStartDate?: string;
    stopOrderDecision?: 'accept' | 'review' | 'blocked';
    stopOrderConfidence?: 'high' | 'medium' | 'low';
    stopOrderSource?: 'runtime-derived' | 'master-fallback' | 'none';
}

export interface Step2ReviewInput {
    routeIdentity: string;
    routeNumber: string;
    dayType: Step2DayType;
    importMode: Step2ImportMode;
    performanceConfig?: Step2PerformanceConfig | null;
    performanceDiagnostics?: Step2PerformanceDiagnostics | null;
    parsedDataFingerprint: string;
    canonicalDirectionStops?: Partial<Record<Step2Direction, string[]>> | null;
    canonicalRouteSource?: Step2CanonicalRouteSource | null;
    plannerOverrides: Step2PlannerOverrides;
}

export interface Step2ReviewHealth {
    status: Step2ReadinessStatus;
    blockers: string[];
    warnings: string[];
    stopOrder?: Step2StopOrderHealth | null;

    expectedDirections: number;
    matchedDirections: string[];

    expectedSegmentCount: number;
    matchedSegmentCount: number;
    missingSegments: string[];

    availableBucketCount: number;
    completeBucketCount: number;
    incompleteBucketCount: number;
    lowConfidenceBucketCount: number;
    repairedBucketCount?: number;
    boundaryBucketCount?: number;
    singleGapBucketCount?: number;
    internalGapBucketCount?: number;
    fragmentedGapBucketCount?: number;

    runtimeSourceSummary: string;
    sampleCountMode?: SampleCountMode;
    confidenceThreshold: number;

    importedAt?: string;
    runtimeLogicVersion?: number;
    usesLegacyRuntimeLogic: boolean;
    cleanHistoryStartDate?: string;
    excludedLegacyDayCount?: number;
    usesCleanHistoryCutoff?: boolean;
}

export interface Step2PlanningPayload {
    chartBasis: 'observed-cycle' | 'uploaded-percentiles';
    generationBasis: 'direction-band-summary';

    buckets: TripBucketAnalysis[];
    bands: TimeBand[];
    directionBandSummary: DirectionBandSummary;

    segmentColumns: OrderedSegmentColumn[];
    canonicalDirectionStops?: Partial<Record<Step2Direction, string[]>>;

    usableBucketCount: number;
    ignoredBucketCount: number;
    usableBandCount: number;
    directions: string[];
}

export interface Step2TroubleshootingPayload {
    matrixAnalysis: TripBucketAnalysis[];
    matrixSegmentsMap: Record<string, SegmentRawData[]>;
    fallbackWarning?: string | null;
    canRenderFullPath: boolean;
}

export interface Step2ReviewResult {
    lifecycle: Step2ReviewLifecycle;

    inputFingerprint: string;
    routeIdentity: string;
    routeNumber: string;
    dayType: Step2DayType;
    importMode: Step2ImportMode;

    health: Step2ReviewHealth;
    planning: Step2PlanningPayload;
    troubleshooting: Step2TroubleshootingPayload;

    plannerOverrides: Step2PlannerOverrides;
    approvalEligible: boolean;
}

export interface Step2ApprovedBy {
    userId?: string;
    displayName?: string;
}

export interface ApprovedRuntimeContract {
    schemaVersion: 1;

    routeIdentity: string;
    routeNumber: string;
    dayType: Step2DayType;
    importMode: Step2ImportMode;

    inputFingerprint: string;
    approvalState: 'approved';
    readinessStatus: Exclude<Step2ReadinessStatus, 'blocked'>;

    approvedAt: string;
    approvedBy?: Step2ApprovedBy;

    acknowledgedWarnings?: string[];

    sourceSnapshot: Step2SourceSnapshot;

    planning: Step2PlanningPayload;
    healthSnapshot: Step2ReviewHealth;
}
