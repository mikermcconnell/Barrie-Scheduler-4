import type { TripBucketAnalysis, TimeBand } from '../../../utils/ai/runtimeAnalysis';
import type { RuntimeData, SegmentRawData } from './csvParser';
import type { OrderedSegmentColumn } from './wizardState';

const normalizeText = (value: string): string => value.trim();

const normalizeSegmentTimeBuckets = (timeBuckets: SegmentRawData['timeBuckets']) => (
    Object.entries(timeBuckets || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([bucket, values]) => ({
            bucket: normalizeText(bucket),
            p50: values?.p50 ?? null,
            p80: values?.p80 ?? null,
            n: values?.n ?? null,
            contributions: (values?.contributions || [])
                .map(contribution => ({
                    date: normalizeText(contribution.date),
                    runtime: contribution.runtime,
                }))
                .sort((left, right) => left.date.localeCompare(right.date) || left.runtime - right.runtime),
        }))
);

const normalizeTimeBand = (band: TimeBand) => ({
    id: normalizeText(band.id),
    label: normalizeText(band.label),
    min: band.min,
    max: band.max,
    avg: band.avg,
    color: normalizeText(band.color),
    count: band.count,
});

const normalizeAnalysisBucket = (bucket: TripBucketAnalysis) => ({
    timeBucket: normalizeText(bucket.timeBucket),
    totalP50: bucket.totalP50,
    totalP80: bucket.totalP80,
    observedCycleP50: bucket.observedCycleP50 ?? null,
    observedCycleP80: bucket.observedCycleP80 ?? null,
    assignedBand: bucket.assignedBand || null,
    isOutlier: bucket.isOutlier,
    ignored: bucket.ignored,
    sampleCountMode: bucket.sampleCountMode || null,
    runtimePatternKind: bucket.runtimePatternKind || null,
    runtimePatternSummary: bucket.runtimePatternSummary || null,
    expectedSegmentCount: bucket.expectedSegmentCount ?? null,
    observedSegmentCount: bucket.observedSegmentCount ?? null,
    missingSegmentNames: (bucket.missingSegmentNames || []).map(normalizeText).sort(),
    coverageCause: bucket.coverageCause || null,
    repairedSegments: (bucket.repairedSegments || []).map(normalizeText).sort(),
    repairSourceBuckets: (bucket.repairSourceBuckets || []).map(normalizeText).sort(),
    contributingDays: (bucket.contributingDays || [])
        .map(contribution => ({
            date: normalizeText(contribution.date),
            runtime: contribution.runtime,
        }))
        .sort((left, right) => left.date.localeCompare(right.date) || left.runtime - right.runtime),
    evidence: bucket.evidence ? {
        kind: bucket.evidence.kind,
        qualifyingCount: bucket.evidence.qualifyingCount,
        requiredCount: bucket.evidence.requiredCount,
        planningEligible: bucket.evidence.planningEligible,
        exclusionReasons: [...bucket.evidence.exclusionReasons].map(normalizeText).sort(),
    } : null,
    details: bucket.details?.map(detail => ({
        segmentName: normalizeText(detail.segmentName),
        p50: detail.p50,
        p80: detail.p80,
        n: detail.n ?? null,
    })) || [],
});

const normalizeSegmentMap = (segmentsMap?: Record<string, SegmentRawData[]> | null) => (
    Object.entries(segmentsMap || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([direction, segments]) => ({
            direction: normalizeText(direction),
            segments: segments.map(segment => normalizeText(segment.segmentName)),
        }))
);

const normalizeSegmentColumns = (segmentColumns?: OrderedSegmentColumn[] | null) => (
    (segmentColumns || []).map(column => ({
        segmentName: normalizeText(column.segmentName),
        direction: column.direction?.trim() || null,
        groupLabel: column.groupLabel?.trim() || null,
    }))
);

const normalizeCanonicalDirectionStops = (
    stops?: Step2ParsedDataFingerprintScope['canonicalDirectionStops']
) => {
    if (!stops) return null;

    const result: Partial<Record<'North' | 'South' | 'Loop', string[]>> = {
        North: stops.North?.map(normalizeText).filter(Boolean) || [],
        South: stops.South?.map(normalizeText).filter(Boolean) || [],
    };
    const loopStops = stops.Loop?.map(normalizeText).filter(Boolean) || [];
    if (loopStops.length > 0) {
        result.Loop = loopStops;
    }
    return result;
};

export interface Step2ParsedDataFingerprintScope {
    analysis?: TripBucketAnalysis[];
    bands?: TimeBand[];
    segmentsMap?: Record<string, SegmentRawData[]>;
    matrixAnalysis?: TripBucketAnalysis[];
    matrixSegmentsMap?: Record<string, SegmentRawData[]>;
    troubleshootingPatternWarning?: string | null;
    canonicalDirectionStops?: Partial<Record<'North' | 'South' | 'Loop', string[]>> | null;
    canonicalSegmentColumns?: OrderedSegmentColumn[] | null;
}

export const buildStep2ParsedDataFingerprint = (
    parsedData: RuntimeData[],
    scope?: Step2ParsedDataFingerprintScope
): string => {
    const payload = {
        parsedData: parsedData.map((runtime, index) => ({
            index,
            detectedRouteNumber: normalizeText(runtime.detectedRouteNumber || ''),
            detectedDirection: normalizeText(runtime.detectedDirection || ''),
            ...(runtime.cycleStartDirection ? { cycleStartDirection: runtime.cycleStartDirection } : {}),
            troubleshootingPatternStatus: runtime.troubleshootingPatternStatus || null,
            sampleCountMode: runtime.sampleCountMode || null,
            runtimePatternKind: runtime.runtimePatternKind || null,
            runtimePatternSummary: runtime.runtimePatternSummary || null,
            allTimeBuckets: runtime.allTimeBuckets?.map(normalizeText) || [],
            segments: (runtime.segments || []).map(segment => ({
                segmentName: normalizeText(segment.segmentName),
                fromRouteStopIndex: segment.fromRouteStopIndex ?? null,
                toRouteStopIndex: segment.toRouteStopIndex ?? null,
                timeBuckets: normalizeSegmentTimeBuckets(segment.timeBuckets),
            })),
        })),
        analysis: scope?.analysis?.map(normalizeAnalysisBucket) || [],
        bands: scope?.bands?.map(normalizeTimeBand) || [],
        segmentsMap: normalizeSegmentMap(scope?.segmentsMap),
        matrixAnalysis: scope?.matrixAnalysis?.map(normalizeAnalysisBucket) || [],
        matrixSegmentsMap: normalizeSegmentMap(scope?.matrixSegmentsMap),
        troubleshootingPatternWarning: scope?.troubleshootingPatternWarning?.trim() || null,
        canonicalDirectionStops: normalizeCanonicalDirectionStops(scope?.canonicalDirectionStops),
        canonicalSegmentColumns: normalizeSegmentColumns(scope?.canonicalSegmentColumns),
    };

    return `step2-parsed-data:v2:${JSON.stringify(payload)}`;
};
