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
import { evaluateRuntimeBucketEligibility } from '../../../utils/ai/runtimeEvidenceEligibility';

export interface Step2ReviewBuilderInput extends Step2ReviewInput {
    analysis: TripBucketAnalysis[];
    cycleAnalysisByStartDirection?: Partial<Record<'North' | 'South', TripBucketAnalysis[]>>;
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
    const normalizedLoop = stops.Loop?.map(normalizeText).filter(Boolean) ?? [];

    const result: Step2ReviewResult['planning']['canonicalDirectionStops'] = {};
    if (normalizedNorth.length > 0) {
        result.North = normalizedNorth;
    }
    if (normalizedSouth.length > 0) {
        result.South = normalizedSouth;
    }
    if (normalizedLoop.length > 0) {
        result.Loop = normalizedLoop;
    }

    return Object.keys(result).length > 0 ? result : undefined;
};

const hasUsableCanonicalDirectionStops = (
    stops: Step2ReviewResult['planning']['canonicalDirectionStops'] | undefined
): boolean => !!stops && (
    (stops.North?.length ?? 0) > 0
    || (stops.South?.length ?? 0) > 0
    || (stops.Loop?.length ?? 0) > 0
);

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
        ...(input.plannerOverrides.excludedCycleBucketsByStartDirection
            ? {
                excludedCycleBucketsByStartDirection: {
                    North: normalizeExcludedBuckets(input.plannerOverrides.excludedCycleBucketsByStartDirection.North ?? []),
                    South: normalizeExcludedBuckets(input.plannerOverrides.excludedCycleBucketsByStartDirection.South ?? []),
                },
            }
            : {}),
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

    const stopOrderDecision = input.performanceDiagnostics?.stopOrderDecision ?? input.stopOrder?.decision;
    const stopOrderConfidence = input.performanceDiagnostics?.stopOrderConfidence ?? input.stopOrder?.confidence;
    const stopOrderSource = input.performanceDiagnostics?.stopOrderSource ?? input.stopOrder?.sourceUsed;

    const normalizedPerformanceDiagnostics: Step2PerformanceDiagnostics | null | undefined = input.performanceDiagnostics || input.stopOrder
        ? {
            routeId: (input.performanceDiagnostics?.routeId ?? input.performanceConfig?.routeId ?? input.routeNumber).trim(),
            dateRange: input.performanceDiagnostics?.dateRange
                ? {
                    start: input.performanceDiagnostics.dateRange.start.trim(),
                    end: input.performanceDiagnostics.dateRange.end.trim(),
                }
                : input.performanceConfig?.dateRange
                    ? {
                        start: input.performanceConfig.dateRange.start.trim(),
                        end: input.performanceConfig.dateRange.end.trim(),
                    }
                    : null,
            runtimeLogicVersion: input.performanceDiagnostics?.runtimeLogicVersion,
            importedAt: input.performanceDiagnostics?.importedAt?.trim(),
            cleanHistoryStartDate: input.performanceDiagnostics?.cleanHistoryStartDate?.trim(),
            excludedLegacyDayCount: input.performanceDiagnostics?.excludedLegacyDayCount,
            usesCleanHistoryCutoff: input.performanceDiagnostics?.usesCleanHistoryCutoff,
            stopOrderDecision,
            stopOrderConfidence,
            stopOrderSource,
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
        warnings.push('Observed stop order could not be resolved from recent trips. The schedule will use the best available runtime stop order.');
    } else if (normalizedPerformanceDiagnostics?.stopOrderDecision === 'review') {
        warnings.push('Observed stop order still needs planner review before it should replace the current stop chain.');
    }

    const normalizedDirectionStops = normalizeDirectionStops(input.canonicalDirectionStops ?? null);
    if (!hasUsableCanonicalDirectionStops(normalizedDirectionStops)) {
        blockers.push('No trusted planning stop chain is available. Resolve or select the canonical route stops before approval.');
    }

    const approvedRuntimeModel = buildApprovedRuntimeModel({
        dayType: input.dayType,
        importMode: input.importMode,
        routeNumber: input.routeNumber,
        analysis: input.analysis,
        bands: input.bands,
        segmentsMap: input.segmentsMap,
        canonicalSegmentColumns: input.canonicalSegmentColumns ?? undefined,
        healthReport: {
            ...baseHealth,
            blockers,
            warnings,
            runtimeSourceSummary: stopOrderSummary
                ? `${stopOrderSummary} • ${baseHealth.runtimeSourceSummary}`
                : baseHealth.runtimeSourceSummary,
            status: deriveHealthStatus(blockers, warnings),
        },
    });

    const health = {
        ...baseHealth,
        blockers,
        warnings,
        runtimeSourceSummary: stopOrderSummary
            ? `${stopOrderSummary} • ${baseHealth.runtimeSourceSummary}`
            : baseHealth.runtimeSourceSummary,
        status: deriveHealthStatus(blockers, warnings),
    } as typeof baseHealth;

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

    const reviewBuckets = cloneValue(approvedRuntimeModel.buckets);
    const approvedBuckets = reviewBuckets.filter(bucket => evaluateRuntimeBucketEligibility(bucket, {
        requireAssignedBand: true,
    }).eligible);
    const approvedCycleBucketsByStartDirection = input.cycleAnalysisByStartDirection
        ? (Object.fromEntries(
            (['North', 'South'] as const).map(direction => [
                direction,
                cloneValue((input.cycleAnalysisByStartDirection?.[direction] || []).filter(bucket => (
                    evaluateRuntimeBucketEligibility(bucket, { requireAssignedBand: true }).eligible
                ))),
            ]).filter(([, buckets]) => (buckets as TripBucketAnalysis[]).length > 0)
        ) as Partial<Record<'North' | 'South', TripBucketAnalysis[]>>)
        : undefined;

    if (input.importMode === 'performance' && input.cycleAnalysisByStartDirection) {
        (['North', 'South'] as const).forEach(direction => {
            const reviewed = input.cycleAnalysisByStartDirection?.[direction] ?? [];
            const approved = approvedCycleBucketsByStartDirection?.[direction] ?? [];
            if (reviewed.length === 0) {
                blockers.push(`No ${direction}-start paired-cycle evidence is available for independent review.`);
            } else if (approved.length === 0) {
                blockers.push(`No ${direction}-start paired-cycle bucket is eligible for schedule generation.`);
            }
        });
    }

    const finalizedHealth = {
        ...health,
        blockers: Array.from(new Set(blockers)),
        warnings: Array.from(new Set(warnings)),
        status: deriveHealthStatus(blockers, warnings),
    } as typeof health;

    return {
        lifecycle: 'reviewable',
        inputFingerprint: buildStep2ReviewFingerprint(reviewInput),
        routeIdentity: input.routeIdentity.trim(),
        routeNumber: input.routeNumber.trim(),
        dayType: input.dayType,
        importMode: input.importMode,
        health: finalizedHealth,
        planning: {
            chartBasis: approvedRuntimeModel.chartBasis,
            generationBasis: approvedRuntimeModel.generationBasis,
            reviewBuckets,
            approvedBuckets: cloneValue(approvedBuckets),
            ...(approvedCycleBucketsByStartDirection && Object.keys(approvedCycleBucketsByStartDirection).length > 0
                ? { approvedCycleBucketsByStartDirection }
                : {}),
            buckets: cloneValue(reviewBuckets),
            bands: cloneValue(approvedRuntimeModel.bands),
            directionBandSummary: cloneValue(approvedRuntimeModel.directionBandSummary) as DirectionBandSummary,
            segmentColumns: cloneValue(approvedRuntimeModel.segmentColumns),
            canonicalDirectionStops: normalizedDirectionStops,
            usableBucketCount: approvedBuckets.length,
            ignoredBucketCount: approvedRuntimeModel.ignoredBucketCount,
            usableBandCount: approvedRuntimeModel.usableBandCount,
            directions: cloneValue(approvedRuntimeModel.directions),
        },
        troubleshooting: buildTroubleshootingPayload(input),
        plannerOverrides: normalizedPlannerOverrides,
        approvalEligible: finalizedHealth.status !== 'blocked'
            && approvedBuckets.length > 0
            && approvedRuntimeModel.usableBandCount > 0,
    };
};

export const buildStep2SourceSnapshot = (
    input: Step2ReviewBuilderInput
): Step2SourceSnapshot => {
    const dateRange = input.performanceDiagnostics?.dateRange ?? input.performanceConfig?.dateRange ?? null;
    const cleanHistoryStartDate = input.performanceDiagnostics?.cleanHistoryStartDate?.trim();

    return {
        performanceRouteId: (input.performanceDiagnostics?.routeId ?? input.performanceConfig?.routeId)?.trim(),
        performanceDateRange: dateRange
            ? {
                start: dateRange.start.trim(),
                end: dateRange.end.trim(),
            }
            : null,
        runtimeLogicVersion: input.performanceDiagnostics?.runtimeLogicVersion,
        importedAt: input.performanceDiagnostics?.importedAt?.trim(),
        ...(cleanHistoryStartDate ? { cleanHistoryStartDate } : {}),
        stopOrderDecision: input.performanceDiagnostics?.stopOrderDecision ?? input.stopOrder?.decision,
        stopOrderConfidence: input.performanceDiagnostics?.stopOrderConfidence ?? input.stopOrder?.confidence,
        stopOrderSource: input.performanceDiagnostics?.stopOrderSource ?? input.stopOrder?.sourceUsed,
        canonicalRouteSource: input.canonicalRouteSource
            ? cloneValue(input.canonicalRouteSource)
            : undefined,
    };
};

export type { ApprovedRuntimeContract };
