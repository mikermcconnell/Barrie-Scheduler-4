import type { DayType } from '../masterScheduleTypes';

export type ScheduleReviewAction = 'find-anomalies' | 'summarize-draft-vs-master';
export type ScheduleReviewCategory = 'headway' | 'recovery' | 'compare' | 'service-pattern';
export type ScheduleReviewSeverity = 'info' | 'warning' | 'critical';
export type ScheduleReviewConfidence = 'low' | 'medium' | 'high';
export type ScheduleReviewRisk = 'low' | 'medium' | 'high';
export type ScheduleReviewCompareStatus = 'matched' | 'new' | 'ambiguous' | 'removed' | 'none';

export interface ScheduleReviewRequest {
    action: ScheduleReviewAction;
    snapshot: ScheduleReviewSnapshot;
}

export interface ScheduleReviewSummary {
    tripCount: number;
    blockCount: number;
    peakVehicles: number;
    serviceStart: string;
    serviceEnd: string;
    serviceHours: number;
    totalTravelMinutes: number;
    totalRecoveryMinutes: number;
    avgHeadwayMinutes: number | null;
    targetHeadwayMinutes?: number;
    targetCycleMinutes?: number;
}

export interface ScheduleReviewCompareSummary {
    matchedCount: number;
    newCount: number;
    ambiguousCount: number;
    removedCount: number;
    masterShiftNorthMinutes?: number;
    masterShiftSouthMinutes?: number;
}

export interface ScheduleReviewRow {
    rowKey: string;
    blockId: string;
    pairIndex: number;
    northTripId?: string;
    southTripId?: string;
    firstDeparture?: string;
    lastArrival?: string;
    totalTravelMinutes: number;
    totalRecoveryMinutes: number;
    totalCycleMinutes: number;
    recoveryRatio: number | null;
    headwayMinutes: number | null;
    compareStatus: ScheduleReviewCompareStatus;
    compareReason?: string;
    flags: string[];
}

export interface DeterministicFinding {
    id: string;
    severity: Exclude<ScheduleReviewSeverity, 'critical'>;
    category: ScheduleReviewCategory;
    scope: 'row' | 'route' | 'system';
    rowKey?: string;
    blockId?: string;
    message: string;
}

export interface ScheduleReviewSnapshot {
    draftName: string;
    routeGroupName: string;
    dayType: DayType;
    routeIdentity: string;
    generatedAt: string;
    summary: ScheduleReviewSummary;
    compareToMaster?: ScheduleReviewCompareSummary;
    rows: ScheduleReviewRow[];
    deterministicFindings: DeterministicFinding[];
}

export interface ScheduleReviewFinding {
    title: string;
    severity: ScheduleReviewSeverity;
    category: ScheduleReviewCategory;
    evidence: string[];
    affectedRows: Array<{
        rowKey: string;
        blockId: string;
    }>;
    plannerNote: string;
    confidence: ScheduleReviewConfidence;
}

export interface ScheduleReviewResponse {
    summary: string;
    overallRisk: ScheduleReviewRisk;
    findings: ScheduleReviewFinding[];
    cautions: string[];
    model: {
        provider: 'local';
        modelName: string;
        durationMs?: number;
    };
}
