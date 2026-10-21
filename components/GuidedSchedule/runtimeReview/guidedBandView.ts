import { getBucketDisplayedTotal, type TimeBand, type TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import { evaluateRuntimeBucketEligibility } from '../../../utils/ai/runtimeEvidenceEligibility';

export interface GuidedBucketRow {
    timeBucket: string;
    label: string;
    /** P50: the runtime the generator builds from this bucket. */
    minutes: number;
    /** P80 of observed cycles: 8 in 10 cycles finish within this. */
    p80Minutes: number;
    /** Median of real same-day cycle totals, when day-level data exists. */
    observedCycleMinutes: number | null;
    band: string | null;
    color: string | null;
    ignored: boolean;
    qualifyingDays: number | null;
    requiredDays: number | null;
    /** An excluded bucket with weak or estimated evidence cannot be restored. */
    canRestore: boolean;
    reasons: string[];
    /** For a bucket with no band: the banded bucket whose runtime trips starting here will use. */
    inferredFrom: GuidedInferredSource | null;
}

export interface GuidedInferredSource {
    timeBucket: string;
    label: string;
    minutes: number;
    band: string;
    color: string | null;
}

export interface GuidedBandSummary {
    id: string;
    color: string;
    minutes: number | null;
    minMinutes: number | null;
    maxMinutes: number | null;
    bucketCount: number;
}

const NEUTRAL = '#9ca3af';

const formatBucketLabel = (timeBucket: string): string => timeBucket.replace(/\s*-\s*/, '–');

const bucketStartMinutes = (timeBucket: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})/.exec(timeBucket.trim());
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes < 1440 ? minutes : null;
};

/** Signed minutes from target to candidate, wrapped to -720..719 around the 24-hour clock. */
const signedClockDifference = (candidate: number, target: number): number => (
    ((((candidate - target + 720) % 1440) + 1440) % 1440) - 720
);

/**
 * The banded bucket a trip starting in `timeBucket` falls back to. Mirrors the
 * generator's nearest-bucket rule (scheduleGenerator.ts findBucketForTime,
 * locked rule 7): nearest around the clock, the earlier bucket on a tie.
 */
export const findInferredSource = <T extends { timeBucket: string; band: string | null }>(
    timeBucket: string,
    candidates: T[]
): T | null => {
    const target = bucketStartMinutes(timeBucket);
    if (target === null) return null;
    let best: { row: T; distance: number; later: boolean } | null = null;
    for (const row of candidates) {
        if (!row.band || row.timeBucket === timeBucket) continue;
        const start = bucketStartMinutes(row.timeBucket);
        if (start === null) continue;
        const difference = signedClockDifference(start, target);
        const entry = { row, distance: Math.abs(difference), later: difference > 0 };
        if (
            !best
            || entry.distance < best.distance
            || (entry.distance === best.distance && !entry.later && best.later)
        ) {
            best = entry;
        }
    }
    return best?.row ?? null;
};

/** Display rows for the Step 2 bucket view. Display only: banding is unchanged. */
export const buildGuidedBucketRows = (analysis: TripBucketAnalysis[], bands: TimeBand[]): GuidedBucketRow[] => {
    const colorByBand = new Map(bands.map(band => [band.id, band.color]));
    const rows = analysis.map(bucket => {
        const band = !bucket.ignored && bucket.assignedBand ? bucket.assignedBand : null;
        return {
            timeBucket: bucket.timeBucket,
            label: formatBucketLabel(bucket.timeBucket),
            minutes: Math.round(getBucketDisplayedTotal(bucket, 'p50')),
            p80Minutes: Math.round(getBucketDisplayedTotal(bucket, 'p80')),
            observedCycleMinutes: bucket.observedCycleP50 !== undefined ? Math.round(bucket.observedCycleP50) : null,
            band,
            color: band ? colorByBand.get(band) ?? NEUTRAL : null,
            ignored: bucket.ignored,
            qualifyingDays: bucket.evidence?.qualifyingCount ?? null,
            requiredDays: bucket.evidence?.requiredCount ?? null,
            canRestore: !bucket.ignored || evaluateRuntimeBucketEligibility({ ...bucket, ignored: false }).eligible,
            reasons: bucket.evidence?.exclusionReasons ?? [],
            inferredFrom: null as GuidedInferredSource | null,
        };
    });
    return rows.map(row => {
        if (row.band) return row;
        const source = findInferredSource(row.timeBucket, rows);
        return source
            ? {
                ...row,
                inferredFrom: {
                    timeBucket: source.timeBucket,
                    label: source.label,
                    minutes: source.minutes,
                    band: source.band as string,
                    color: source.color,
                },
            }
            : row;
    });
};

/** One card per A–E band: its average and min–max runtime and how many buckets it holds. */
export const buildGuidedBandSummary = (bands: TimeBand[]): GuidedBandSummary[] => (
    bands.map(band => {
        const hasBuckets = band.count > 0;
        return {
            id: band.id,
            color: band.color,
            minutes: hasBuckets && Number.isFinite(band.avg) ? Math.round(band.avg) : null,
            minMinutes: hasBuckets && Number.isFinite(band.min) ? Math.round(band.min) : null,
            maxMinutes: hasBuckets && Number.isFinite(band.max) ? Math.round(band.max) : null,
            bucketCount: band.count,
        };
    })
);

/**
 * Bands rank buckets into fifths, so they look different even when runtimes
 * barely differ. Returns the P50 spread across banded buckets, in minutes.
 */
export const buildBandedRuntimeSpread = (rows: GuidedBucketRow[]): number | null => {
    const values = rows.filter(row => row.band && row.minutes > 0).map(row => row.minutes);
    return values.length > 0 ? Math.max(...values) - Math.min(...values) : null;
};

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
