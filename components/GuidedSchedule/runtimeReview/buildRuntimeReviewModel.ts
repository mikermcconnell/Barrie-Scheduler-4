import {
    calculateBands,
    calculateTotalTripTimes,
    detectOutliers,
    hardenRuntimeAnalysisBuckets,
    type TripBucketAnalysis,
    type TimeBand,
} from '../../../utils/ai/runtimeAnalysis';
import { MIN_RELIABLE_DAYS } from '../../../utils/ai/runtimeEvidenceEligibility';
import type { RuntimeData, SegmentRawData } from '../../NewSchedule/utils/csvParser';
import { buildSegmentsMapFromParsedData, getOrderedSegmentNames } from '../../NewSchedule/utils/wizardState';
import { resolveAutoRouteNumber } from '../../NewSchedule/utils/routeInference';
import type { RuntimeReviewModel } from './guidedRuntimeReviewTypes';

/**
 * Starts paired-cycle buckets with fewer than five qualifying days as excluded.
 * They could never be banded or approved, so this only makes that visible.
 */
export const excludeLowDayBuckets = (analysis: TripBucketAnalysis[]): TripBucketAnalysis[] => (
    analysis.map(bucket => (
        !bucket.ignored
            && bucket.evidence?.kind === 'paired-cycle'
            && bucket.evidence.qualifyingCount < MIN_RELIABLE_DAYS
            ? { ...bucket, ignored: true }
            : bucket
    ))
);

/**
 * Same runtime pipeline as the legacy wizard (totals → coverage hardening →
 * outliers → A–E bands), plus low-day buckets starting excluded.
 */
export const buildRuntimeAnalysis = (
    results: RuntimeData[]
): { buckets: TripBucketAnalysis[]; bands: TimeBand[]; segmentsMap: Record<string, SegmentRawData[]> } => {
    const segmentsMap = buildSegmentsMapFromParsedData(results);
    const orderedSegmentNames = getOrderedSegmentNames(segmentsMap);
    const rawAnalysis = calculateTotalTripTimes(results);
    const hardenedAnalysis = hardenRuntimeAnalysisBuckets(rawAnalysis, orderedSegmentNames);
    const withOutliers = excludeLowDayBuckets(detectOutliers(hardenedAnalysis));
    const { buckets, bands } = calculateBands(withOutliers);
    return { buckets, bands, segmentsMap };
};

const selectPrimaryResults = (results: RuntimeData[]): RuntimeData[] => {
    const northStart = results.filter(runtime => runtime.cycleStartDirection === 'North');
    if (northStart.length > 0) return northStart;
    const southStart = results.filter(runtime => runtime.cycleStartDirection === 'South');
    return southStart.length > 0 ? southStart : results;
};

/**
 * Builds the Step 2 analysis from prepared runtimes. The schedule-driving
 * analysis uses the primary cycle orientation (North-start when present);
 * the other orientation is reviewed separately by the review-input builder.
 */
export const buildRuntimeReviewModel = (
    results: RuntimeData[],
    displayResults: RuntimeData[] = results
): RuntimeReviewModel => {
    const { buckets, bands, segmentsMap } = buildRuntimeAnalysis(selectPrimaryResults(results));

    const primaryDisplay = selectPrimaryResults(displayResults);
    const { buckets: matrixAnalysis } = calculateBands(detectOutliers(calculateTotalTripTimes(primaryDisplay)));
    const matrixSegmentsMap = buildSegmentsMapFromParsedData(primaryDisplay);

    const fallbackDirections = displayResults
        .filter(runtime => runtime.troubleshootingPatternStatus === 'fallback' && runtime.detectedDirection)
        .map(runtime => runtime.detectedDirection as string);
    const troubleshootingPatternWarning = fallbackDirections.length > 0
        ? `Troubleshooting view could not confirm a full anchored route pattern for ${Array.from(new Set(fallbackDirections)).join(', ')}. The stop-by-stop matrix is hidden until a confirmed full-route path is available.`
        : null;

    return {
        parsedData: results,
        analysis: buckets,
        bands,
        segmentsMap,
        matrixAnalysis,
        matrixSegmentsMap,
        troubleshootingPatternWarning,
        initialCycleStartDirection: results.some(runtime => runtime.cycleStartDirection === 'North') ? 'North' : 'South',
        detectedRouteNumber: resolveAutoRouteNumber(results.map(runtime => runtime.detectedRouteNumber)) ?? null,
    };
};
