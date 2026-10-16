import { calculateBands, type TripBucketAnalysis, type TimeBand } from '../../../utils/ai/runtimeAnalysis';
import type { PerformanceRuntimeDiagnostics } from '../../../utils/performanceRuntimeComputer';
import { buildStep2ParsedDataFingerprint } from '../../NewSchedule/utils/step2ParsedDataFingerprint';
import type { Step2ReviewBuilderInput } from '../../NewSchedule/utils/step2ReviewBuilder';
import { buildRuntimeAnalysis } from './buildRuntimeReviewModel';
import type { PreparedRuntimeReview } from './prepareRuntimeReview';
import type {
    CycleStartDirection,
    GuidedDateRange,
    GuidedDayType,
    RuntimeReviewModel,
} from './guidedRuntimeReviewTypes';

type CycleExclusions = Partial<Record<CycleStartDirection, string[]>>;

export const getPrimaryCycleStartDirection = (model: RuntimeReviewModel): CycleStartDirection | null => {
    if (model.parsedData.some(runtime => runtime.cycleStartDirection === 'North')) return 'North';
    if (model.parsedData.some(runtime => runtime.cycleStartDirection === 'South')) return 'South';
    return null;
};

/** Primary-orientation exclusions live on the analysis; the other orientation's live in the map. */
export const buildPlannerOverrides = (
    model: RuntimeReviewModel,
    cycleExclusions: CycleExclusions
): Step2ReviewBuilderInput['plannerOverrides'] => {
    const excludedBuckets = model.analysis.filter(bucket => bucket.ignored).map(bucket => bucket.timeBucket);
    const primary = getPrimaryCycleStartDirection(model);
    return primary
        ? { excludedBuckets, excludedCycleBucketsByStartDirection: { ...cycleExclusions, [primary]: excludedBuckets } }
        : { excludedBuckets };
};

export const buildCycleAnalysisByStartDirection = (
    model: RuntimeReviewModel,
    plannerOverrides: Step2ReviewBuilderInput['plannerOverrides']
): Partial<Record<CycleStartDirection, TripBucketAnalysis[]>> | undefined => {
    if (!model.parsedData.some(runtime => runtime.cycleStartDirection)) return undefined;

    const primary = getPrimaryCycleStartDirection(model) ?? 'North';
    const result: Partial<Record<CycleStartDirection, TripBucketAnalysis[]>> = {};
    (['North', 'South'] as const).forEach(direction => {
        const directionResults = model.parsedData.filter(runtime => runtime.cycleStartDirection === direction);
        if (directionResults.length === 0) return;
        const directionAnalysis = direction === primary
            ? model.analysis
            : buildRuntimeAnalysis(directionResults).buckets;
        const excluded = new Set(plannerOverrides.excludedCycleBucketsByStartDirection?.[direction] ?? []);
        result[direction] = directionAnalysis.map(bucket => (
            excluded.has(bucket.timeBucket) ? { ...bucket, ignored: true } : bucket
        ));
    });
    return result;
};

/** The buckets and bands shown for the orientation the planner is reviewing. */
export const selectOrientationView = (
    model: RuntimeReviewModel,
    cycleAnalysis: Partial<Record<CycleStartDirection, TripBucketAnalysis[]>> | undefined,
    direction: CycleStartDirection
): { analysis: TripBucketAnalysis[]; bands: TimeBand[] } => {
    const analysis = cycleAnalysis?.[direction] ?? model.analysis;
    return { analysis, bands: cycleAnalysis ? calculateBands(analysis).bands : model.bands };
};

export interface GuidedReviewInputArgs {
    prepared: PreparedRuntimeReview;
    model: RuntimeReviewModel;
    cycleExclusions: CycleExclusions;
    dayType: GuidedDayType;
    dateRange: GuidedDateRange | null;
    diagnostics: PerformanceRuntimeDiagnostics | null;
}

/**
 * Builds the Step 2 review input for a STREETS-based review. Field-for-field
 * this matches the legacy wizard's input, but the route identity always comes
 * from the route chosen in Step 1, so canonical stops can never be silently
 * dropped by a later route-number change.
 */
export const buildGuidedReviewInput = (args: GuidedReviewInputArgs): Step2ReviewBuilderInput | null => {
    const { prepared, model, diagnostics } = args;
    if (model.analysis.length === 0) return null;

    const plannerOverrides = buildPlannerOverrides(model, args.cycleExclusions);
    const parsedDataFingerprint = buildStep2ParsedDataFingerprint(model.parsedData, {
        analysis: model.analysis,
        bands: model.bands,
        segmentsMap: model.segmentsMap,
        matrixAnalysis: model.matrixAnalysis,
        matrixSegmentsMap: model.matrixSegmentsMap,
        troubleshootingPatternWarning: model.troubleshootingPatternWarning,
        canonicalDirectionStops: prepared.canonicalDirectionStops,
        canonicalSegmentColumns: prepared.canonicalSegmentColumns,
    });

    return {
        routeIdentity: prepared.routeIdentity,
        routeNumber: prepared.routeNumber,
        dayType: args.dayType,
        importMode: 'performance',
        performanceConfig: { routeId: prepared.routeNumber, dateRange: args.dateRange },
        performanceDiagnostics: {
            routeId: prepared.routeNumber,
            dateRange: args.dateRange,
            runtimeLogicVersion: diagnostics?.runtimeLogicVersion,
            importedAt: diagnostics?.importedAt,
            cleanHistoryStartDate: diagnostics?.cleanHistoryStartDate,
            excludedLegacyDayCount: diagnostics?.excludedLegacyDayCount,
            usesCleanHistoryCutoff: diagnostics?.usesCleanHistoryCutoff,
        },
        parsedDataFingerprint,
        canonicalDirectionStops: prepared.canonicalDirectionStops ?? null,
        canonicalRouteSource: prepared.canonicalRouteSource ?? {
            type: 'runtime-derived',
            routeIdentity: prepared.routeIdentity,
            versionHint: 'runtime-derived',
        },
        plannerOverrides,
        analysis: model.analysis,
        cycleAnalysisByStartDirection: buildCycleAnalysisByStartDirection(model, plannerOverrides),
        bands: model.bands,
        segmentsMap: model.segmentsMap,
        matrixAnalysis: model.matrixAnalysis,
        matrixSegmentsMap: model.matrixSegmentsMap,
        troubleshootingPatternWarning: model.troubleshootingPatternWarning,
        canonicalSegmentColumns: prepared.canonicalSegmentColumns ?? null,
        runtimeDiagnostics: diagnostics,
        stopOrder: prepared.stopOrderHealth,
    };
};

/**
 * Applies a bucket exclusion change from the review panel. Primary-orientation
 * edits re-band the analysis; other-orientation edits only update the map.
 */
export const applyAnalysisUpdate = (
    model: RuntimeReviewModel,
    cycleExclusions: CycleExclusions,
    selectedDirection: CycleStartDirection,
    updatedAnalysis: TripBucketAnalysis[]
): { model: RuntimeReviewModel; cycleExclusions: CycleExclusions } => {
    const hasCycles = model.parsedData.some(runtime => runtime.cycleStartDirection);
    let nextExclusions = cycleExclusions;
    if (hasCycles) {
        nextExclusions = {
            ...cycleExclusions,
            [selectedDirection]: updatedAnalysis.filter(bucket => bucket.ignored).map(bucket => bucket.timeBucket),
        };
        if (selectedDirection !== getPrimaryCycleStartDirection(model)) {
            return { model, cycleExclusions: nextExclusions };
        }
    }
    const { buckets, bands } = calculateBands(updatedAnalysis);
    return { model: { ...model, analysis: buckets, bands }, cycleExclusions: nextExclusions };
};
