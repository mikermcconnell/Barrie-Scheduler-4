import type { TripBucketAnalysis, TimeBand } from '../../../utils/ai/runtimeAnalysis';
import type { RuntimeData, SegmentRawData } from './csvParser';
import type { OrderedSegmentColumn } from './wizardState';

const normalizeText = (value: string): string => value.trim();

const normalizeSegmentNames = (segments: RuntimeData['segments']): string[] => (
    segments
        .map(segment => normalizeText(segment.segmentName))
        .filter(Boolean)
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

export interface Step2ParsedDataFingerprintScope {
    analysis?: TripBucketAnalysis[];
    bands?: TimeBand[];
    segmentsMap?: Record<string, SegmentRawData[]>;
    matrixAnalysis?: TripBucketAnalysis[];
    matrixSegmentsMap?: Record<string, SegmentRawData[]>;
    troubleshootingPatternWarning?: string | null;
    canonicalDirectionStops?: Partial<Record<'North' | 'South', string[]>> | null;
    canonicalSegmentColumns?: OrderedSegmentColumn[] | null;
}

export const buildStep2ParsedDataFingerprint = (
    parsedData: RuntimeData[],
    scope?: Step2ParsedDataFingerprintScope
): string => {
    const payload = {
        parsedData: parsedData.map((runtime, index) => ({
            index,
            fileName: normalizeText(runtime.fileName || ''),
            detectedRouteNumber: normalizeText(runtime.detectedRouteNumber || ''),
            detectedDirection: normalizeText(runtime.detectedDirection || ''),
            troubleshootingPatternStatus: runtime.troubleshootingPatternStatus || null,
            sampleCountMode: runtime.sampleCountMode || null,
            allTimeBuckets: runtime.allTimeBuckets?.map(normalizeText) || [],
            segments: normalizeSegmentNames(runtime.segments || []),
        })),
        analysis: scope?.analysis?.map(normalizeAnalysisBucket) || [],
        bands: scope?.bands?.map(normalizeTimeBand) || [],
        segmentsMap: normalizeSegmentMap(scope?.segmentsMap),
        matrixAnalysis: scope?.matrixAnalysis?.map(normalizeAnalysisBucket) || [],
        matrixSegmentsMap: normalizeSegmentMap(scope?.matrixSegmentsMap),
        troubleshootingPatternWarning: scope?.troubleshootingPatternWarning?.trim() || null,
        canonicalDirectionStops: scope?.canonicalDirectionStops
            ? {
                North: scope.canonicalDirectionStops.North?.map(normalizeText).filter(Boolean) || [],
                South: scope.canonicalDirectionStops.South?.map(normalizeText).filter(Boolean) || [],
            }
            : null,
        canonicalSegmentColumns: normalizeSegmentColumns(scope?.canonicalSegmentColumns),
    };

    return `step2-parsed-data:v1:${JSON.stringify(payload)}`;
};
