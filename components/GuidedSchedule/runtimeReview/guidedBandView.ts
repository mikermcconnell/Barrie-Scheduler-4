import { getBucketDisplayedTotal, type TimeBand, type TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import { evaluateRuntimeBucketEligibility } from '../../../utils/ai/runtimeEvidenceEligibility';

export interface GuidedBucketRow {
    timeBucket: string;
    label: string;
    minutes: number;
    band: string | null;
    color: string | null;
    ignored: boolean;
    qualifyingDays: number | null;
    requiredDays: number | null;
    /** An excluded bucket with weak or estimated evidence cannot be restored. */
    canRestore: boolean;
    reasons: string[];
}

export interface GuidedBandSummary {
    id: string;
    color: string;
    minutes: number | null;
    bucketCount: number;
}

const NEUTRAL = '#9ca3af';

const formatBucketLabel = (timeBucket: string): string => timeBucket.replace(/\s*-\s*/, '–');

/** Display rows for the Step 2 bucket view. Display only: banding is unchanged. */
export const buildGuidedBucketRows = (analysis: TripBucketAnalysis[], bands: TimeBand[]): GuidedBucketRow[] => {
    const colorByBand = new Map(bands.map(band => [band.id, band.color]));
    return analysis.map(bucket => {
        const band = !bucket.ignored && bucket.assignedBand ? bucket.assignedBand : null;
        return {
            timeBucket: bucket.timeBucket,
            label: formatBucketLabel(bucket.timeBucket),
            minutes: Math.round(getBucketDisplayedTotal(bucket, 'p50')),
            band,
            color: band ? colorByBand.get(band) ?? NEUTRAL : null,
            ignored: bucket.ignored,
            qualifyingDays: bucket.evidence?.qualifyingCount ?? null,
            requiredDays: bucket.evidence?.requiredCount ?? null,
            canRestore: !bucket.ignored || evaluateRuntimeBucketEligibility({ ...bucket, ignored: false }).eligible,
            reasons: bucket.evidence?.exclusionReasons ?? [],
        };
    });
};

/** One card per A–E band: its average runtime and how many buckets it holds. */
export const buildGuidedBandSummary = (bands: TimeBand[]): GuidedBandSummary[] => (
    bands.map(band => ({
        id: band.id,
        color: band.color,
        minutes: band.count > 0 && Number.isFinite(band.avg) ? Math.round(band.avg) : null,
        bucketCount: band.count,
    }))
);

/**
 * Excludes or restores one bucket. Same rule as the legacy review: a bucket
 * whose evidence is not planning-eligible cannot be restored.
 */
export const toggleGuidedBucket = (analysis: TripBucketAnalysis[], timeBucket: string): TripBucketAnalysis[] => (
    analysis.map(bucket => {
        if (bucket.timeBucket !== timeBucket) return bucket;
        if (bucket.ignored && !evaluateRuntimeBucketEligibility({ ...bucket, ignored: false }).eligible) return bucket;
        return { ...bucket, ignored: !bucket.ignored };
    })
);

/** Bar height domain (minutes) over the buckets still in use. */
export const buildBarDomain = (rows: GuidedBucketRow[]): [number, number] => {
    const values = rows.filter(row => !row.ignored && row.minutes > 0).map(row => row.minutes);
    if (values.length === 0) return [0, 60];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(2, (max - min) * 0.25);
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
};
