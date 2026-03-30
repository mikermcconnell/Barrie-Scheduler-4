import { getBucketBandingTotal, MIN_RELIABLE_OBSERVATIONS, TimeBand, TripBucketAnalysis } from '../ai/runtimeAnalysis';

export type StrictCycleSuggestionQuality = 'high' | 'mixed' | 'fallback' | 'none';

export interface StrictCycleSuggestion {
    minutes: number | null;
    quality: StrictCycleSuggestionQuality;
    basisLabel: string;
    bucketCount: number;
}

const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
};

const getMinimumDetailSamples = (bucket: TripBucketAnalysis): number => {
    const detailCounts = bucket.details
        .map(detail => detail.n ?? 1)
        .filter(count => count > 0);

    if (detailCounts.length === 0) return 0;
    return Math.min(...detailCounts);
};

export const computeSuggestedStrictCycle = (
    analysis?: TripBucketAnalysis[] | null,
    bands?: TimeBand[] | null
): StrictCycleSuggestion => {
    const validBuckets = (analysis || []).filter(bucket => !bucket.ignored && !bucket.isOutlier && getBucketBandingTotal(bucket) > 0);

    if (validBuckets.length > 0) {
        const totals = validBuckets.map(bucket => getBucketBandingTotal(bucket));
        const medianTotal = median(totals) ?? 0;
        const tailFloor = Math.max(30, medianTotal * 0.75);
        const representativeBuckets = validBuckets.filter(bucket => getBucketBandingTotal(bucket) >= tailFloor);
        const maxDetailCount = validBuckets.reduce((max, bucket) => Math.max(max, bucket.details?.length ?? 0), 0);
        const minExpectedDetails = Math.max(1, maxDetailCount - 1);
        const minReliableSamples = Math.max(3, Math.ceil(MIN_RELIABLE_OBSERVATIONS * 0.6));

        const highConfidenceBuckets = representativeBuckets.filter(bucket => {
            const detailCount = bucket.details?.length ?? 0;
            return detailCount >= minExpectedDetails && getMinimumDetailSamples(bucket) >= minReliableSamples;
        });

        if (highConfidenceBuckets.length >= 2 || (highConfidenceBuckets.length === 1 && validBuckets.length === 1)) {
            return {
                minutes: Math.round(median(highConfidenceBuckets.map(bucket => getBucketBandingTotal(bucket))) ?? 0),
                quality: 'high',
                basisLabel: 'filtered observed cycle totals',
                bucketCount: highConfidenceBuckets.length,
            };
        }

        if (representativeBuckets.length > 0) {
            return {
                minutes: Math.round(median(representativeBuckets.map(bucket => getBucketBandingTotal(bucket))) ?? 0),
                quality: 'mixed',
                basisLabel: 'observed cycle totals',
                bucketCount: representativeBuckets.length,
            };
        }
    }

    const bandsWithData = (bands || []).filter(band => band.count > 0 && band.avg > 0);
    if (bandsWithData.length > 0) {
        const totalWeight = bandsWithData.reduce((sum, band) => sum + band.count, 0);
        if (totalWeight > 0) {
            const weightedAverage = bandsWithData.reduce((sum, band) => sum + (band.avg * band.count), 0) / totalWeight;
            return {
                minutes: Math.round(weightedAverage),
                quality: 'fallback',
                basisLabel: 'observed band averages',
                bucketCount: bandsWithData.length,
            };
        }
    }

    return {
        minutes: null,
        quality: 'none',
        basisLabel: 'no observed runtime reference',
        bucketCount: 0,
    };
};
