import type { DirectionBandSummary, TimeBand, TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import { buildApprovedRuntimeModel, type OrderedSegmentColumn } from './wizardState';
import { buildStep2ReviewFingerprint } from './step2ReviewFingerprint';
import type {
    ApprovedRuntimeContract,
    Step2CanonicalRouteSource,
    Step2DayType,
    Step2ImportMode,
    Step2PerformanceConfig,
    Step2PerformanceDiagnostics,
    Step2PlannerOverrides,
    Step2ReviewInput,
    Step2ReviewResult,
    Step2SourceSnapshot,
    Step2TroubleshootingPayload,
} from './step2ReviewTypes';
import { evaluateStep2ReviewHealth, type Step2HealthEvaluatorInput } from './step2HealthEvaluator';
import type { PerformanceRuntimeDiagnostics } from '../../../utils/performanceRuntimeComputer';
import type { SegmentRawData } from './csvParser';
import type { Step2StopOrderHealth } from './step2StopOrder';

export interface Step2ReviewBuilderInput extends Step2ReviewInput {
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    segmentsMap: Record<string, SegmentRawData[]>;
    matrixAnalysis?: TripBucketAnalysis[] | null;
    matrixSegmentsMap?: Record<string, SegmentRawData[]> | null;
    troubleshootingPatternWarning?: string | null;
    canonicalSegmentColumns?: OrderedSegmentColumn[] | null;
    runtimeDiagnostics?: PerformanceRuntimeDiagnostics | null;
    stopOrder?: Step2StopOrderHealth | null;
}

const cloneValue = <T>(value: T): T => {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
};

const normalizeText = (value: string): string => value.trim();

const deriveHealthStatus = (blockers: string[], warnings: string[]) => (
    blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready'
);

const normalizeExcludedBuckets = (buckets: string[]): string[] => (
    Array.from(new Set(buckets.map(normalizeText).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
);

const normalizeDirectionStops = (
    stops: Step2ReviewInput['canonicalDirectionStops']
): Step2ReviewResult['planning']['canonicalDirectionStops'] => {
    if (!stops) return undefined;

    const normalizedNorth = stops.North?.map(normalizeText).filter(Boolean) ?? [];
    const normalizedSouth = stops.South?.map(normalizeText).filter(Boolean) ?? [];

    const result: Step2ReviewResult['planning']['canonicalDirectionStops'] = {};
    if (normalizedNorth.length > 0) {
        result.North = normalizedNorth;
    }
    if (normalizedSouth.length > 0) {
        result.South = normalizedSouth;
    }

    return Object.keys(result).length > 0 ? result : undefined;
};

const buildTroubleshootingPayload = (
    input: Pick<
        Step2ReviewBuilderInput,
        'analysis' | 'segmentsMap' | 'matrixAnalysis' | 'matrixSegmentsMap' | 'troubleshootingPatternWarning'
    >
): Step2TroubleshootingPayload => {
    const matrixAnalysis = input.matrixAnalysis && input.matrixAnalysis.length > 0
        ? input.matrixAnalysis
        : input.analysis;
    const matrixSegmentsMap = input.matrixSegmentsMap && Object.keys(input.matrixSegmentsMap).length > 0
        ? input.matrixSegmentsMap
        : input.segmentsMap;
    const fallbackWarning = input.troubleshootingPatternWarning?.trim() || null;

    return {
        matrixAnalysis: cloneValue(matrixAnalysis),
        matrixSegmentsMap: cloneValue(matrixSegmentsMap),
        fallbackWarning,
        canRenderFullPath: !fallbackWarning && matrixAnalysis.length > 0,
    };
};

export const buildStep2ReviewResult = (
    input: Step2ReviewBuilderInput
): Step2ReviewResult => {
    const healthInput: Step2HealthEvaluatorInput = {
        routeNumber: input.routeNumber,
        analysis: input.analysis,
        segmentsMap: input.segmentsMap,
        canonicalSegmentColumns: input.canonicalSegmentColumns ?? undefined,
        performanceDiagnostics: input.runtimeDiagnostics ?? null,
        stopOrder: input.stopOrder ?? null,
    };
    const baseHealth = evaluateStep2ReviewHealth(healthInput);

    const normalizedPlannerOverrides: Step2PlannerOverrides = {
        excludedBuckets: normalizeExcludedBuckets(input.plannerOverrides.excludedBuckets),
    };

    const normalizedPerformanceConfig: Step2PerformanceConfig | null | undefined = input.performanceConfig
        ? {
            routeId: input.performanceConfig.routeId.trim(),
            dateRange: input.performanceConfig.dateRange
                ? {
                    start: input.performanceConfig.dateRange.start.trim(),
                    end: input.performanceConfig.dateRange.end.trim(),
                }
                : null,
        }
        : input.performanceConfig;

    const normalizedPerformanceDiagnostics: Step2PerformanceDiagnostics | null | undefined = input.performanceDiagnostics
        ? {
            routeId: input.performanceDiagnostics.routeId.trim(),
            dateRange: input.performanceDiagnostics.dateRange
                ? {
                    start: input.performanceDiagnostics.dateRange.start.trim(),
                    end: input.performanceDiagnostics.dateRange.end.trim(),
                }
                : null,
            runtimeLogicVersion: input.performanceDiagnostics.runtimeLogicVersion,
            importedAt: input.performanceDiagnostics.importedAt?.trim(),
            cleanHistoryStartDate: input.performanceDiagnostics.cleanHistoryStartDate?.trim(),
            excludedLegacyDayCount: input.performanceDiagnostics.excludedLegacyDayCount,
            usesCleanHistoryCutoff: input.performanceDiagnostics.usesCleanHistoryCutoff,
            stopOrderDecision: input.performanceDiagnostics.stopOrderDecision,
            stopOrderConfidence: input.performanceDiagnostics.stopOrderConfidence,
            stopOrderSource: input.performanceDiagnostics.stopOrderSource,
        }
        : input.performanceDiagnostics;

    const stopOrderSummary = normalizedPerformanceDiagnostics?.stopOrderDecision
        ? normalizedPerformanceDiagnostics.stopOrderSource === 'runtime-derived'
            ? `Resolved stop order ${normalizedPerformanceDiagnostics.stopOrderDecision} (${normalizedPerformanceDiagnostics.stopOrderConfidence ?? 'unknown'} confidence)`
            : normalizedPerformanceDiagnostics.stopOrderSource === 'master-fallback'
                ? 'Using master schedule stop order fallback'
                : `Stop order ${normalizedPerformanceDiagnostics.stopOrderDecision}`
        : null;

    const blockers = [...baseHealth.blockers];
    const warnings = [...baseHealth.warnings];

    if (normalizedPerformanceDiagnostics?.stopOrderDecision === 'blocked') {
        blockers.push('Observed stop order could not be resolved from recent trips. Step 2 cannot trust an automatic stop chain yet.');
    } else if (normalizedPerformanceDiagnostics?.stopOrderDecision === 'review') {
        warnings.push('Observed stop order still needs planner review before it should replace the current stop chain.');
    }

    const health = {
        ...baseHealth,
        blockers,
        warnings,
        runtimeSourceSummary: stopOrderSummary
            ? `${stopOrderSummary} • ${baseHealth.runtimeSourceSummary}`
            : baseHealth.runtimeSourceSummary,
        status: deriveHealthStatus(blockers, warnings),
    } as typeof baseHealth;

    const approvedRuntimeModel = buildApprovedRuntimeModel({
        dayType: input.dayType,
        importMode: input.importMode,
        routeNumber: input.routeNumber,
        analysis: input.analysis,
        bands: input.bands,
        segmentsMap: input.segmentsMap,
        canonicalSegmentColumns: input.canonicalSegmentColumns ?? undefined,
        healthReport: health,
    });

    const reviewInput: Step2ReviewInput = {
        routeIdentity: input.routeIdentity,
        routeNumber: input.routeNumber,
        dayType: input.dayType,
        importMode: input.importMode,
        performanceConfig: normalizedPerformanceConfig ?? null,
        performanceDiagnostics: normalizedPerformanceDiagnostics ?? null,
        parsedDataFingerprint: input.parsedDataFingerprint,
        canonicalDirectionStops: input.canonicalDirectionStops ?? null,
        canonicalRouteSource: input.canonicalRouteSource ?? null,
        plannerOverrides: normalizedPlannerOverrides,
    };

    return {
        lifecycle: 'reviewable',
        inputFingerprint: buildStep2ReviewFingerprint(reviewInput),
        routeIdentity: input.routeIdentity.trim(),
        routeNumber: input.routeNumber.trim(),
        dayType: input.dayType,
        importMode: input.importMode,
        health,
        planning: {
            chartBasis: approvedRuntimeModel.chartBasis,
            generationBasis: approvedRuntimeModel.generationBasis,
            buckets: cloneValue(approvedRuntimeModel.buckets),
            bands: cloneValue(approvedRuntimeModel.bands),
            directionBandSummary: cloneValue(approvedRuntimeModel.directionBandSummary) as DirectionBandSummary,
            segmentColumns: cloneValue(approvedRuntimeModel.segmentColumns),
            canonicalDirectionStops: normalizeDirectionStops(input.canonicalDirectionStops ?? null),
            usableBucketCount: approvedRuntimeModel.usableBucketCount,
            ignoredBucketCount: approvedRuntimeModel.ignoredBucketCount,
            usableBandCount: approvedRuntimeModel.usableBandCount,
            directions: cloneValue(approvedRuntimeModel.directions),
        },
        troubleshooting: buildTroubleshootingPayload(input),
        plannerOverrides: normalizedPlannerOverrides,
        approvalEligible: health.status !== 'blocked',
    };
};

export const buildStep2SourceSnapshot = (
    input: Step2ReviewBuilderInput
): Step2SourceSnapshot => ({
    performanceRouteId: input.performanceDiagnostics?.routeId?.trim(),
    performanceDateRange: input.performanceDiagnostics?.dateRange
        ? {
            start: input.performanceDiagnostics.dateRange.start.trim(),
            end: input.performanceDiagnostics.dateRange.end.trim(),
        }
        : null,
    runtimeLogicVersion: input.performanceDiagnostics?.runtimeLogicVersion,
    importedAt: input.performanceDiagnostics?.importedAt?.trim(),
    ...(input.performanceDiagnostics?.cleanHistoryStartDate?.trim()
        ? { cleanHistoryStartDate: input.performanceDiagnostics.cleanHistoryStartDate.trim() }
        : {}),
    stopOrderDecision: input.performanceDiagnostics?.stopOrderDecision,
    stopOrderConfidence: input.performanceDiagnostics?.stopOrderConfidence,
    stopOrderSource: input.performanceDiagnostics?.stopOrderSource,
});

export type { ApprovedRuntimeContract };
