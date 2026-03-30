import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import {
    computeDirectionBandSummary,
    computeSegmentBreakdownByBand,
    getAverageBandTotal,
    getBucketDisplayedTotal,
    getBucketCoverageCauseLabel,
    getLowConfidenceThreshold,
    type BucketCoverageCause,
    type DirectionBandSummary,
    type TimeBand,
    type TripBucketAnalysis,
} from '../../../utils/ai/runtimeAnalysis';
import { buildNormalizedSegmentNameLookup, resolveCanonicalSegmentName } from '../../../utils/runtimeSegmentMatching';
import type { SegmentRawData } from '../utils/csvParser';
import {
    alignOrderedSegmentColumnsToPreferredGroups,
    buildApprovedRuntimeModel,
    buildStep2DataHealthReport,
    getOrderedSegmentColumns,
    normalizeSegmentNameForMatching,
    orderSegmentColumnsByCanonicalStops,
    type ApprovedRuntimeModel,
    type OrderedSegmentColumn,
    type Step2DataHealthReport,
} from '../utils/wizardState';
import type { ApprovedRuntimeContract, Step2ApprovalState } from '../utils/step2ReviewTypes';

const EMPTY_SEGMENTS_MAP: Record<string, SegmentRawData[]> = {};

const formatImportedAt = (value?: string): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(parsed);
};

export interface Step2BucketConfidence {
    matchedSegments: number;
    expectedSegments: number;
    missingSegments: number;
    minSegmentSamples: number;
    avgSegmentSamples: number;
    hasLowSamples: boolean;
    hasMissingSegments: boolean;
    isLowConfidence: boolean;
    coverageCause?: BucketCoverageCause;
    coverageCauseLabel?: string | null;
    missingSegmentNames?: string[];
    repairedSegments?: string[];
    repairSourceBuckets?: string[];
    isEstimatedRepair?: boolean;
}

export interface UseStep2RuntimeReviewInput {
    dayType: string;
    routeNumber?: string;
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    setAnalysis: (data: TripBucketAnalysis[]) => void;
    segmentsMap?: Record<string, SegmentRawData[]>;
    matrixAnalysis?: TripBucketAnalysis[];
    matrixSegmentsMap?: Record<string, SegmentRawData[]>;
    canonicalSegmentColumns?: OrderedSegmentColumn[];
    canonicalDirectionStops?: Partial<Record<'North' | 'South', string[]>>;
    healthReport?: Step2DataHealthReport | null;
    approvedRuntimeModel?: ApprovedRuntimeModel | null;
    approvalState?: Step2ApprovalState;
    approvedRuntimeContract?: ApprovedRuntimeContract | null;
    warningAcknowledged: boolean;
    onBandSummaryChange?: (summary: DirectionBandSummary) => void;
}

export interface UseStep2RuntimeReviewResult {
    viewMetric: 'p50' | 'p80';
    setViewMetric: Dispatch<SetStateAction<'p50' | 'p80'>>;
    expandedBuckets: Set<string>;
    toggleExpand: (bucket: string) => void;
    showDataHealth: boolean;
    setShowDataHealth: Dispatch<SetStateAction<boolean>>;
    showApprovedRuntimeModel: boolean;
    setShowApprovedRuntimeModel: Dispatch<SetStateAction<boolean>>;
    displaySegmentColumns: OrderedSegmentColumn[];
    matrixSourceAnalysis: TripBucketAnalysis[];
    matrixDisplaySegmentColumns: OrderedSegmentColumn[];
    orderedSegmentIndex: Map<string, number>;
    sampleCountMode?: Step2DataHealthReport['sampleCountMode'];
    confidenceThreshold: number;
    sampleCountUnitLabel: string;
    sampleCountPluralLabel: string;
    metricLabel: string;
    metricShortLabel: string;
    displayedHealthReport: Step2DataHealthReport;
    displayedApprovedRuntimeModel: ApprovedRuntimeModel;
    resolvedApprovalState: Step2ApprovalState;
    approvalRequiresAcknowledgement: boolean;
    approvalWarningList: string[];
    approvalActionDisabled: boolean;
    approvedAtLabel: string | null;
    bandContextLabel: string;
    bucketConfidence: Record<string, Step2BucketConfidence>;
    matrixBucketConfidence: Record<string, Step2BucketConfidence>;
    displayedBandTotals: Map<string, number>;
    chartData: Array<{
        name: string;
        runtime: number;
        band?: string;
        color: string;
        ignored?: boolean;
        isOutlier?: boolean;
        fullBucket: string;
        confidence?: Step2BucketConfidence;
        contributingDays?: Array<{ date: string; runtime: number }>;
    }>;
    toggleIgnore: (bucket: string) => void;
}

const buildConfidenceMap = (
    buckets: TripBucketAnalysis[],
    expectedSegmentNames: string[],
    lookup: ReturnType<typeof buildNormalizedSegmentNameLookup>,
    confidenceThreshold: number
): Record<string, Step2BucketConfidence> => Object.fromEntries(buckets.map((bucket) => {
    const segmentSamples = new Map<string, number>();

    bucket.details?.forEach((detail) => {
        const resolvedSegmentName = resolveCanonicalSegmentName(detail.segmentName, lookup);
        if (!resolvedSegmentName) return;
        segmentSamples.set(resolvedSegmentName, detail.n && detail.n > 0 ? detail.n : 1);
    });

    const matchedSegments = segmentSamples.size;
    const sampleValues = Array.from(segmentSamples.values());
    const minSegmentSamples = sampleValues.length > 0 ? Math.min(...sampleValues) : 0;
    const avgSegmentSamples = sampleValues.length > 0
        ? sampleValues.reduce((sum, value) => sum + value, 0) / sampleValues.length
        : 0;
    const missingSegments = Math.max(0, expectedSegmentNames.length - matchedSegments);
    const hasLowSamples = minSegmentSamples > 0 && minSegmentSamples < confidenceThreshold;
    const hasMissingSegments = expectedSegmentNames.length > 0 && missingSegments > 0;

    return [bucket.timeBucket, {
        matchedSegments,
        expectedSegments: expectedSegmentNames.length,
        missingSegments,
        minSegmentSamples,
        avgSegmentSamples,
        hasLowSamples,
        hasMissingSegments,
        isLowConfidence: hasLowSamples || hasMissingSegments,
        coverageCause: bucket.coverageCause,
        coverageCauseLabel: getBucketCoverageCauseLabel(bucket.coverageCause),
        missingSegmentNames: bucket.missingSegmentNames,
        repairedSegments: bucket.repairedSegments,
        repairSourceBuckets: bucket.repairSourceBuckets,
        isEstimatedRepair: bucket.coverageCause === 'repaired-single-gap',
    }];
}));

export const useStep2RuntimeReview = ({
    dayType,
    routeNumber,
    analysis,
    bands,
    setAnalysis,
    segmentsMap,
    matrixAnalysis,
    matrixSegmentsMap,
    canonicalSegmentColumns,
    canonicalDirectionStops,
    healthReport,
    approvedRuntimeModel,
    approvalState,
    approvedRuntimeContract,
    warningAcknowledged,
    onBandSummaryChange,
}: UseStep2RuntimeReviewInput): UseStep2RuntimeReviewResult => {
    const [viewMetric, setViewMetric] = useState<'p50' | 'p80'>('p50');
    const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
    const [showDataHealth, setShowDataHealth] = useState(false);
    const [showApprovedRuntimeModel, setShowApprovedRuntimeModel] = useState(false);

    const toggleExpand = (bucket: string) => {
        setExpandedBuckets((current) => {
            const next = new Set(current);
            if (next.has(bucket)) next.delete(bucket);
            else next.add(bucket);
            return next;
        });
    };

    const toggleIgnore = (bucket: string) => {
        const newData = analysis.map(a => (
            a.timeBucket === bucket
                ? { ...a, ignored: !a.ignored }
                : a
        ));
        setAnalysis(newData);
    };

    const resolvedSegmentsMap = segmentsMap ?? EMPTY_SEGMENTS_MAP;
    const runtimeOrderedSegmentColumns = useMemo(
        () => getOrderedSegmentColumns(resolvedSegmentsMap, routeNumber, analysis),
        [analysis, resolvedSegmentsMap, routeNumber]
    );
    const displaySegmentColumns = useMemo(
        () => (canonicalSegmentColumns && canonicalSegmentColumns.length > 0 ? canonicalSegmentColumns : runtimeOrderedSegmentColumns),
        [canonicalSegmentColumns, runtimeOrderedSegmentColumns]
    );
    const displaySegmentNames = useMemo(
        () => displaySegmentColumns.map(column => column.segmentName),
        [displaySegmentColumns]
    );
    const displaySegmentLookup = useMemo(
        () => buildNormalizedSegmentNameLookup(displaySegmentNames),
        [displaySegmentNames]
    );

    const matrixSourceAnalysis = matrixAnalysis && matrixAnalysis.length > 0 ? matrixAnalysis : analysis;
    const matrixSourceSegmentsMap = matrixSegmentsMap && Object.keys(matrixSegmentsMap).length > 0
        ? matrixSegmentsMap
        : resolvedSegmentsMap;
    const matrixRuntimeOrderedSegmentColumns = useMemo(
        () => getOrderedSegmentColumns(matrixSourceSegmentsMap, routeNumber, matrixSourceAnalysis),
        [matrixSourceAnalysis, matrixSourceSegmentsMap, routeNumber]
    );
    const matrixDisplaySegmentColumns = useMemo(() => {
        const runtimeColumns = matrixRuntimeOrderedSegmentColumns.length > 0
            ? matrixRuntimeOrderedSegmentColumns
            : displaySegmentColumns;
        const groupAlignedColumns = alignOrderedSegmentColumnsToPreferredGroups(runtimeColumns, displaySegmentColumns);
        const canonicalFilteredColumns = orderSegmentColumnsByCanonicalStops(
            groupAlignedColumns,
            canonicalDirectionStops,
            displaySegmentColumns,
            { excludeUnmatched: true }
        );
        const displaySegmentNameSet = new Set(displaySegmentColumns.map(column => column.segmentName));
        const runtimeOverlapCount = groupAlignedColumns.filter(column => displaySegmentNameSet.has(column.segmentName)).length;
        const shouldPreserveRuntimeMatrixOrder = (
            groupAlignedColumns.length >= 4
            && canonicalFilteredColumns.length < groupAlignedColumns.length
            && canonicalFilteredColumns.length <= displaySegmentColumns.length
            && runtimeOverlapCount / groupAlignedColumns.length <= 0.5
        );

        return shouldPreserveRuntimeMatrixOrder ? groupAlignedColumns : canonicalFilteredColumns;
    }, [canonicalDirectionStops, displaySegmentColumns, matrixRuntimeOrderedSegmentColumns]);
    const matrixDisplaySegmentNames = useMemo(
        () => matrixDisplaySegmentColumns.map(column => column.segmentName),
        [matrixDisplaySegmentColumns]
    );
    const matrixDisplaySegmentLookup = useMemo(
        () => buildNormalizedSegmentNameLookup(matrixDisplaySegmentNames),
        [matrixDisplaySegmentNames]
    );
    const orderedSegmentIndex = useMemo(() => {
        const index = new Map<string, number>();
        displaySegmentColumns.forEach((column, position) => {
            index.set(normalizeSegmentNameForMatching(column.segmentName), position);
        });
        return index;
    }, [displaySegmentColumns]);

    const sampleCountMode = useMemo(
        () => analysis.find(bucket => bucket.sampleCountMode)?.sampleCountMode,
        [analysis]
    );
    const confidenceThreshold = getLowConfidenceThreshold(sampleCountMode);
    const sampleCountUnitLabel = sampleCountMode === 'days' ? 'day' : 'sample';
    const sampleCountPluralLabel = sampleCountMode === 'days' ? 'days' : 'samples';
    const metricLabel = viewMetric === 'p50' ? 'median (P50)' : 'reliable (P80)';
    const metricShortLabel = viewMetric === 'p50' ? 'Median' : 'Reliable';

    const displayedHealthReport = useMemo(
        () => healthReport ?? buildStep2DataHealthReport({
            routeNumber,
            analysis,
            segmentsMap: resolvedSegmentsMap,
            canonicalSegmentColumns,
            performanceDiagnostics: null,
        }),
        [analysis, canonicalSegmentColumns, healthReport, resolvedSegmentsMap, routeNumber]
    );
    const displayedApprovedRuntimeModel = useMemo(
        () => approvedRuntimeModel ?? buildApprovedRuntimeModel({
            dayType,
            importMode: sampleCountMode === 'days' ? 'performance' : 'csv',
            routeNumber,
            analysis,
            bands,
            segmentsMap: resolvedSegmentsMap,
            canonicalSegmentColumns,
            healthReport: displayedHealthReport,
        }),
        [analysis, approvedRuntimeModel, bands, canonicalSegmentColumns, dayType, displayedHealthReport, routeNumber, sampleCountMode, resolvedSegmentsMap]
    );

    const resolvedApprovalState: Step2ApprovalState = approvalState ?? 'unapproved';
    const approvalRequiresAcknowledgement = displayedHealthReport.status === 'warning';
    const approvalWarningList = approvalRequiresAcknowledgement ? displayedHealthReport.warnings : [];
    const approvalActionDisabled = resolvedApprovalState === 'approved'
        || displayedHealthReport.status === 'blocked'
        || (approvalRequiresAcknowledgement && !warningAcknowledged);
    const approvedAtLabel = formatImportedAt(approvedRuntimeContract?.approvedAt);

    const chartBasisLabel = sampleCountMode === 'days'
        ? 'For performance data, the chart uses full observed cycle totals for each time bucket.'
        : 'For CSV imports, the chart uses the uploaded bucket percentile totals.';
    const bandContextLabel = viewMetric === 'p50'
        ? `${chartBasisLabel} Band colors and ranges reflect the same median bucket totals shown in the chart. Buckets missing one or more segments stay visible, but remain unbanded until coverage is complete. Performance imports use a ${confidenceThreshold}-day confidence floor; CSV imports keep the existing sample-count rule.`
        : `${chartBasisLabel} Bars switch to reliable (P80) totals, but band colors and ranges stay tied to the median (P50) bucket assignment. Buckets missing one or more segments stay visible, but remain unbanded until coverage is complete. Performance imports use a ${confidenceThreshold}-day confidence floor; CSV imports keep the existing sample-count rule.`;

    const bucketConfidence = useMemo(
        () => buildConfidenceMap(analysis, displaySegmentNames, displaySegmentLookup, confidenceThreshold),
        [analysis, confidenceThreshold, displaySegmentLookup, displaySegmentNames]
    );
    const matrixBucketConfidence = useMemo(
        () => buildConfidenceMap(matrixSourceAnalysis, matrixDisplaySegmentNames, matrixDisplaySegmentLookup, confidenceThreshold),
        [confidenceThreshold, matrixDisplaySegmentLookup, matrixDisplaySegmentNames, matrixSourceAnalysis]
    );

    const segmentBreakdownByBand = useMemo(
        () => computeSegmentBreakdownByBand(analysis, bands, displaySegmentNames, viewMetric),
        [analysis, bands, displaySegmentNames, viewMetric]
    );

    const computedBandSummary = useMemo(
        (): DirectionBandSummary => computeDirectionBandSummary(
            analysis,
            bands,
            resolvedSegmentsMap,
            { canonicalSegmentColumns: displaySegmentColumns }
        ),
        [analysis, bands, displaySegmentColumns, resolvedSegmentsMap]
    );

    useEffect(() => {
        onBandSummaryChange?.(computedBandSummary);
    }, [computedBandSummary, onBandSummaryChange]);

    const displayedBandTotals = useMemo(() => {
        const totals = new Map<string, number>();
        Object.entries(segmentBreakdownByBand).forEach(([bandId, bandData]) => {
            const average = getAverageBandTotal(bandData);
            if (average !== null) {
                totals.set(bandId, average);
            }
        });
        return totals;
    }, [segmentBreakdownByBand]);

    const chartData = useMemo(() => (
        analysis.map(bucket => ({
            name: bucket.timeBucket.split(' - ')[0],
            runtime: getBucketDisplayedTotal(bucket, viewMetric),
            band: bucket.assignedBand,
            color: bands.find(band => band.id === bucket.assignedBand)?.color || '#cccccc',
            ignored: bucket.ignored,
            isOutlier: bucket.isOutlier,
            fullBucket: bucket.timeBucket,
            confidence: bucketConfidence[bucket.timeBucket],
            contributingDays: bucket.contributingDays,
        }))
    ), [analysis, bands, bucketConfidence, viewMetric]);

    return {
        viewMetric,
        setViewMetric,
        expandedBuckets,
        toggleExpand,
        showDataHealth,
        setShowDataHealth,
        showApprovedRuntimeModel,
        setShowApprovedRuntimeModel,
        displaySegmentColumns,
        matrixSourceAnalysis,
        matrixDisplaySegmentColumns,
        orderedSegmentIndex,
        sampleCountMode,
        confidenceThreshold,
        sampleCountUnitLabel,
        sampleCountPluralLabel,
        metricLabel,
        metricShortLabel,
        displayedHealthReport,
        displayedApprovedRuntimeModel,
        resolvedApprovalState,
        approvalRequiresAcknowledgement,
        approvalWarningList,
        approvalActionDisabled,
        approvedAtLabel,
        bandContextLabel,
        bucketConfidence,
        matrixBucketConfidence,
        displayedBandTotals,
        chartData,
        toggleIgnore,
    };
};
