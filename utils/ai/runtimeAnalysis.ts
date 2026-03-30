
import { RuntimeData, SegmentRawData, BucketContribution } from '../../components/NewSchedule/utils/csvParser';
import {
    buildNormalizedSegmentNameLookup,
    resolveCanonicalSegmentName,
} from '../runtimeSegmentMatching';

export type SampleCountMode = 'observations' | 'days';

export interface SegmentDetail {
    segmentName: string;
    p50: number;
    p80: number;
    n?: number;
}

export interface TripBucketAnalysis {
    timeBucket: string;    // "06:30 - 06:59"
    totalP50: number;      // Sum of rounded segment medians
    totalP80: number;
    observedCycleP50?: number; // Percentile of full observed cycle totals when day-level data exists
    observedCycleP80?: number;
    assignedBand?: string; // 'A', 'B', 'C', 'D', 'E'
    isOutlier: boolean;
    ignored: boolean;
    details: SegmentDetail[];
    expectedSegmentCount?: number;
    observedSegmentCount?: number;
    sampleCountMode?: SampleCountMode;
    contributingDays?: BucketContribution[];
    missingSegmentNames?: string[];
    coverageCause?: BucketCoverageCause;
    repairedSegments?: string[];
    repairSourceBuckets?: string[];
}

export type BucketCoverageCause =
    | 'complete'
    | 'repaired-single-gap'
    | 'single-gap'
    | 'boundary-service'
    | 'partial-cycle-gap'
    | 'fragmented-gap';

export interface TimeBand {
    id: string; // 'A'
    label: string; // "Top 20%"
    min: number;
    max: number;
    avg: number;
    color: string;
    count: number;
}

export const MIN_RELIABLE_OBSERVATIONS = 10;
export const MIN_RELIABLE_DAYS = 5;

export const getLowConfidenceThreshold = (mode?: SampleCountMode): number => (
    mode === 'days' ? MIN_RELIABLE_DAYS : MIN_RELIABLE_OBSERVATIONS
);

const parseBucketStartMinutes = (bucket: string): number => {
    const start = bucket.split(' - ')[0].trim();
    const match = start.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return Number.POSITIVE_INFINITY;
    return Number(match[1]) * 60 + Number(match[2]);
};

const percentileInc = (sorted: number[], p: number): number => {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];

    const n = sorted.length;
    const rank = p * (n - 1);
    const lower = Math.floor(rank);
    const frac = rank - lower;

    if (lower + 1 >= n) return sorted[n - 1];
    return sorted[lower] + frac * (sorted[lower + 1] - sorted[lower]);
};

export const getBucketDisplayedTotal = (
    bucket: TripBucketAnalysis,
    metric: 'p50' | 'p80'
): number => (
    metric === 'p50'
        ? bucket.observedCycleP50 ?? bucket.totalP50
        : bucket.observedCycleP80 ?? bucket.totalP80
);

export const getBucketBandingTotal = (bucket: TripBucketAnalysis): number => (
    bucket.observedCycleP50 ?? bucket.totalP50
);

// Band summary with averaged segment times - used by schedule generator
export interface BandSegmentAverage {
    segmentName: string;
    avgTime: number; // Averaged p50 across all time slots in this band
    totalN?: number;
}

export interface BandSummary {
    bandId: string;
    color: string;
    avgTotal: number; // Average total trip time for this band
    segments: BandSegmentAverage[];
    timeSlots: string[]; // Which 30-min slots belong to this band
}

// Direction-keyed band summaries for separate North/South lookups
export type DirectionBandSummary = Record<string, BandSummary[]>;

interface CanonicalSegmentColumnLike {
    segmentName: string;
    direction?: string;
}

export interface DirectionalBucketAnalysis {
    buckets: TripBucketAnalysis[];
    bands: TimeBand[];
}

export interface SegmentBreakdownAggregate {
    weightedSum: number;
    totalWeight: number;
    totalN: number;
}

export interface SegmentBreakdownBandData {
    band: TimeBand;
    segmentTotals: Record<string, SegmentBreakdownAggregate>;
    totalSum: number;
    totalCount: number;
    timeSlots: string[];
}

export const getAverageBandTotal = (
    bandData: SegmentBreakdownBandData
): number | null => (
    bandData.totalCount > 0
        ? bandData.totalSum / bandData.totalCount
        : null
);

export const sumDisplayedSegmentTotals = (
    segmentNames: string[],
    segmentTotals: Record<string, SegmentBreakdownAggregate>
): number => (
    segmentNames.reduce((sum, segmentName) => {
        const aggregate = segmentTotals[segmentName];
        if (!aggregate || aggregate.totalWeight <= 0) return sum;
        return sum + Math.round(aggregate.weightedSum / aggregate.totalWeight);
    }, 0)
);

export const computeSegmentBreakdownByBand = (
    analysis: TripBucketAnalysis[],
    bands: TimeBand[],
    segmentNames: string[],
    metric: 'p50' | 'p80'
): Record<string, SegmentBreakdownBandData> => {
    const canonicalSegmentNameLookup = buildNormalizedSegmentNameLookup(segmentNames);
    const summary: Record<string, SegmentBreakdownBandData> = {};

    bands.forEach((band) => {
        summary[band.id] = {
            band,
            segmentTotals: {},
            totalSum: 0,
            totalCount: 0,
            timeSlots: [],
        };

        segmentNames.forEach((segmentName) => {
            summary[band.id].segmentTotals[segmentName] = {
                weightedSum: 0,
                totalWeight: 0,
                totalN: 0,
            };
        });
    });

    analysis.forEach((bucket) => {
        if (bucket.ignored || !bucket.assignedBand) return;
        const bandData = summary[bucket.assignedBand];
        if (!bandData) return;

        bandData.timeSlots.push(bucket.timeBucket.split(' - ')[0]);

        bucket.details?.forEach((detail) => {
            const canonicalSegmentName = resolveCanonicalSegmentName(detail.segmentName, canonicalSegmentNameLookup);
            if (!canonicalSegmentName) return;

            const target = bandData.segmentTotals[canonicalSegmentName];
            if (!target) return;

            const weight = detail.n && detail.n > 0 ? detail.n : 1;
            const value = metric === 'p50' ? detail.p50 : detail.p80;
            target.weightedSum += value * weight;
            target.totalWeight += weight;
            target.totalN += weight;
        });

        const total = getBucketDisplayedTotal(bucket, metric);
        bandData.totalSum += total;
        bandData.totalCount += 1;
    });

    return summary;
};

const COLORS = {
    A: '#ef4444', // Red (Classic implementation often uses Red for longest/slowest)
    B: '#f97316', // Orange
    C: '#eab308', // Yellow
    D: '#84cc16', // Lime
    E: '#22c55e'  // Green (Fastest)
};

const getFallbackExpectedSegmentCount = (analysis: TripBucketAnalysis[]): number => (
    analysis.reduce((max, bucket) => (
        Math.max(
            max,
            bucket.expectedSegmentCount ?? bucket.observedSegmentCount ?? bucket.details?.length ?? 0
        )
    ), 0)
);

export const hasCompleteSegmentCoverage = (
    bucket: TripBucketAnalysis,
    fallbackExpectedSegmentCount: number = 0
): boolean => {
    const observedSegmentCount = bucket.observedSegmentCount ?? bucket.details?.length ?? 0;
    const expectedSegmentCount = bucket.expectedSegmentCount ?? fallbackExpectedSegmentCount;

    if (expectedSegmentCount <= 0) return observedSegmentCount > 0;
    return observedSegmentCount >= expectedSegmentCount;
};

export const isBucketEligibleForBanding = (
    bucket: TripBucketAnalysis,
    fallbackExpectedSegmentCount: number = 0
): boolean => (
    !bucket.ignored
    && getBucketBandingTotal(bucket) > 0
    && hasCompleteSegmentCoverage(bucket, fallbackExpectedSegmentCount)
);

const groupContiguousIndexes = (indexes: number[]): number[][] => {
    if (indexes.length === 0) return [];

    const groups: number[][] = [[indexes[0]]];
    for (let index = 1; index < indexes.length; index += 1) {
        const current = indexes[index];
        const previous = indexes[index - 1];
        if (current === previous + 1) {
            groups[groups.length - 1].push(current);
        } else {
            groups.push([current]);
        }
    }
    return groups;
};

const classifyCoverageCause = (
    expectedSegmentCount: number,
    missingIndexes: number[]
): BucketCoverageCause => {
    if (expectedSegmentCount <= 0 || missingIndexes.length === 0) return 'complete';
    if (missingIndexes.length === 1) return 'single-gap';

    const groups = groupContiguousIndexes(missingIndexes);
    const lastExpectedIndex = expectedSegmentCount - 1;
    const everyGroupTouchesBoundary = groups.every((group) => (
        group[0] === 0 || group[group.length - 1] === lastExpectedIndex
    ));

    if (everyGroupTouchesBoundary) return 'boundary-service';
    if (groups.length === 1) return 'partial-cycle-gap';
    return 'fragmented-gap';
};

interface BucketCoverageSnapshot {
    missingSegmentNames: string[];
    coverageCause: BucketCoverageCause;
}

const getBucketCoverageSnapshot = (
    bucket: TripBucketAnalysis,
    expectedSegmentNames: string[],
    canonicalSegmentNameLookup: ReturnType<typeof buildNormalizedSegmentNameLookup>,
): BucketCoverageSnapshot => {
    if (expectedSegmentNames.length === 0) {
        return {
            missingSegmentNames: [],
            coverageCause: 'complete',
        };
    }

    const matchedIndexes = new Set<number>();
    bucket.details?.forEach((detail) => {
        const resolvedSegmentName = resolveCanonicalSegmentName(detail.segmentName, canonicalSegmentNameLookup);
        if (!resolvedSegmentName) return;
        const position = expectedSegmentNames.indexOf(resolvedSegmentName);
        if (position >= 0) matchedIndexes.add(position);
    });

    const missingIndexes = expectedSegmentNames
        .map((_, index) => index)
        .filter((index) => !matchedIndexes.has(index));

    return {
        missingSegmentNames: missingIndexes.map((index) => expectedSegmentNames[index]),
        coverageCause: classifyCoverageCause(expectedSegmentNames.length, missingIndexes),
    };
};

const applyCoverageSnapshot = (
    bucket: TripBucketAnalysis,
    snapshot: BucketCoverageSnapshot
): TripBucketAnalysis => ({
    ...bucket,
    missingSegmentNames: snapshot.missingSegmentNames,
    coverageCause: snapshot.coverageCause,
});

export const getBucketCoverageCauseLabel = (cause?: BucketCoverageCause): string | null => {
    switch (cause) {
        case 'complete':
            return 'Complete';
        case 'repaired-single-gap':
            return 'Estimated repair';
        case 'single-gap':
            return 'Single missing segment';
        case 'boundary-service':
            return 'Boundary service / short turn';
        case 'partial-cycle-gap':
            return 'Internal cycle gap';
        case 'fragmented-gap':
            return 'Fragmented coverage';
        default:
            return null;
    }
};

export const hardenRuntimeAnalysisBuckets = (
    analysis: TripBucketAnalysis[],
    expectedSegmentNames: string[]
): TripBucketAnalysis[] => {
    if (analysis.length === 0 || expectedSegmentNames.length === 0) return analysis;

    const canonicalSegmentNameLookup = buildNormalizedSegmentNameLookup(expectedSegmentNames);
    const baseAnnotated = analysis.map((bucket) => applyCoverageSnapshot(
        bucket,
        getBucketCoverageSnapshot(bucket, expectedSegmentNames, canonicalSegmentNameLookup)
    ));

    const repairableBuckets = new Map<string, {
        estimatedDetails: SegmentDetail[];
        sourceBuckets: string[];
    }>();

    const findRepairNeighbor = (
        startIndex: number,
        direction: -1 | 1,
        missingSegmentName: string
    ): { bucket: TripBucketAnalysis; detail: SegmentDetail; distance: number } | null => {
        for (
            let index = startIndex + direction, distance = 1;
            index >= 0 && index < baseAnnotated.length && distance <= 2;
            index += direction, distance += 1
        ) {
            const candidate = baseAnnotated[index];
            if (candidate.ignored || !hasCompleteSegmentCoverage(candidate, expectedSegmentNames.length)) continue;
            const detail = candidate.details.find((entry) => {
                const resolvedSegmentName = resolveCanonicalSegmentName(entry.segmentName, canonicalSegmentNameLookup);
                return resolvedSegmentName === missingSegmentName;
            });
            if (!detail) continue;

            return { bucket: candidate, detail, distance };
        }

        return null;
    };

    baseAnnotated.forEach((bucket, index) => {
        if (bucket.ignored) return;
        const missingSegmentNames = bucket.missingSegmentNames ?? [];
        const isRepairableGap = (
            bucket.coverageCause === 'single-gap'
            || (
                bucket.coverageCause === 'partial-cycle-gap'
                && missingSegmentNames.length >= 2
                && missingSegmentNames.length <= 3
            )
        );
        if (!isRepairableGap || missingSegmentNames.length === 0) return;

        const estimatedDetails: SegmentDetail[] = [];
        const sourceBuckets = new Set<string>();
        for (const missingSegmentName of missingSegmentNames) {
            const previous = findRepairNeighbor(index, -1, missingSegmentName);
            const next = findRepairNeighbor(index, 1, missingSegmentName);
            if (!previous || !next) return;

            const previousWeight = previous.detail.n && previous.detail.n > 0 ? previous.detail.n : 1;
            const nextWeight = next.detail.n && next.detail.n > 0 ? next.detail.n : 1;
            const totalWeight = previousWeight + nextWeight;
            if (totalWeight <= 0) return;

            const estimatedP50 = Math.round(((previous.detail.p50 * previousWeight) + (next.detail.p50 * nextWeight)) / totalWeight);
            const estimatedP80 = Math.round(((previous.detail.p80 * previousWeight) + (next.detail.p80 * nextWeight)) / totalWeight);
            estimatedDetails.push({
                segmentName: missingSegmentName,
                p50: estimatedP50,
                p80: estimatedP80,
                n: Math.max(1, Math.min(previousWeight, nextWeight)),
            });
            sourceBuckets.add(previous.bucket.timeBucket);
            sourceBuckets.add(next.bucket.timeBucket);
        }

        repairableBuckets.set(bucket.timeBucket, {
            estimatedDetails,
            sourceBuckets: Array.from(sourceBuckets),
        });
    });

    return baseAnnotated.map((bucket) => {
        const repair = repairableBuckets.get(bucket.timeBucket);
        if (!repair) return bucket;

        return {
            ...bucket,
            totalP50: bucket.totalP50 + repair.estimatedDetails.reduce((sum, detail) => sum + detail.p50, 0),
            totalP80: bucket.totalP80 + repair.estimatedDetails.reduce((sum, detail) => sum + detail.p80, 0),
            details: [...bucket.details, ...repair.estimatedDetails],
            observedSegmentCount: expectedSegmentNames.length,
            missingSegmentNames: [],
            coverageCause: 'repaired-single-gap',
            repairedSegments: repair.estimatedDetails.map((detail) => detail.segmentName),
            repairSourceBuckets: repair.sourceBuckets,
        };
    }).map((bucket) => {
        if (bucket.coverageCause === 'repaired-single-gap') return bucket;

        return applyCoverageSnapshot(
            bucket,
            getBucketCoverageSnapshot(bucket, expectedSegmentNames, canonicalSegmentNameLookup)
        );
    });
};

export const calculateTotalTripTimes = (data: RuntimeData[]): TripBucketAnalysis[] => {
    // Handling multiple files (directions) - typically user builds one schedule direction at a time?
    // Requirement says "1 file if loop, 2 if bi-direction".
    // If bi-direction, we likely sum them together for a "Round Trip" time if creating a single block schedule.
    // OR we treat them as separate.

    // Assumption: We are building a Block Schedule. Blocks usually cover the full Round Trip (A->B + B->A).
    // So we should sum ALL segments from ALL files for each time bucket.

    if (data.length === 0) return [];

    // Use the UNION of buckets across all directions/files.
    // This avoids dropping valid buckets when one direction has coverage gaps.
    const masterBuckets = Array.from(
        new Set(data.flatMap(fileData => fileData.allTimeBuckets || []))
    ).sort((a, b) => {
        const am = parseBucketStartMinutes(a);
        const bm = parseBucketStartMinutes(b);
        if (am !== bm) return am - bm;
        return a.localeCompare(b);
    });
    const analysis: TripBucketAnalysis[] = [];
    const sampleCountMode = data.reduce<SampleCountMode | undefined>((mode, fileData) => {
        if (!fileData.sampleCountMode) return mode;
        if (!mode) return fileData.sampleCountMode;
        return mode === fileData.sampleCountMode ? mode : undefined;
    }, undefined);

    const expectedSegmentCount = data.reduce((sum, fileData) => sum + fileData.segments.length, 0);

    masterBuckets.forEach(bucket => {
        let sumP50 = 0;
        let sumP80 = 0;
        const details: SegmentDetail[] = [];
        const contributingDayTotals = new Map<string, number>();
        const contributingDaySegmentCounts = new Map<string, number>();

        data.forEach(fileData => {
            fileData.segments.forEach(seg => {
                const times = seg.timeBuckets[bucket];
                if (times) {
                    // Round each segment time before summing (per user requirement)
                    const roundedP50 = Math.round(times.p50);
                    const roundedP80 = Math.round(times.p80);
                    sumP50 += roundedP50;
                    sumP80 += roundedP80;
                    details.push({
                        segmentName: seg.segmentName,
                        p50: roundedP50,
                        p80: roundedP80,
                        n: times.n,
                    });

                    times.contributions?.forEach(({ date, runtime }) => {
                        contributingDayTotals.set(date, (contributingDayTotals.get(date) || 0) + runtime);
                        contributingDaySegmentCounts.set(date, (contributingDaySegmentCounts.get(date) || 0) + 1);
                    });
                }
            });
        });

        // Basic validation: If sum is 0, it might be a gap in service.
        // We keep it 0.

        const completeObservedCycleDays = Array.from(contributingDayTotals.entries())
            .filter(([date]) => (contributingDaySegmentCounts.get(date) || 0) >= expectedSegmentCount)
            .map(([date, runtime]) => ({ date, runtime }));
        const observedCycleTotals = completeObservedCycleDays
            .map(({ runtime }) => runtime)
            .sort((a, b) => a - b);

        analysis.push({
            timeBucket: bucket,
            totalP50: sumP50,
            totalP80: sumP80,
            observedCycleP50: observedCycleTotals.length > 0
                ? Math.round(percentileInc(observedCycleTotals, 0.5) * 100) / 100
                : undefined,
            observedCycleP80: observedCycleTotals.length > 0
                ? Math.round(percentileInc(observedCycleTotals, 0.8) * 100) / 100
                : undefined,
            isOutlier: false,
            ignored: sumP50 === 0, // Auto-ignore empty buckets
            details,
            expectedSegmentCount,
            observedSegmentCount: details.length,
            sampleCountMode,
            contributingDays: completeObservedCycleDays
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 10)
                .map(({ date, runtime }) => ({ date, runtime })),
        });
    });

    return analysis;
};

// 2. Outlier Detection (Mean +/- 2 StdDev)
// To be called ONCE upon initial data load (or manual "Reset" action)
export const detectOutliers = (analysis: TripBucketAnalysis[]): TripBucketAnalysis[] => {
    const validItems = analysis.filter(a => getBucketBandingTotal(a) > 0);
    if (validItems.length === 0) return analysis;

    const values = validItems.map(a => getBucketBandingTotal(a));
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    // StdDev Calculation
    const sqDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSqDiff = sqDiffs.reduce((sum, v) => sum + v, 0) / sqDiffs.length;
    const stdDev = Math.sqrt(avgSqDiff);

    const lowerBound = mean - (2 * stdDev);
    const upperBound = mean + (2 * stdDev);

    return analysis.map(item => {
        const bucketTotal = getBucketBandingTotal(item);
        if (bucketTotal > 0 && (bucketTotal < lowerBound || bucketTotal > upperBound)) {
            return { ...item, isOutlier: true, ignored: true }; // Auto-ignore outliers
        }
        return item;
    });
};

// 3. Binning (Quintiles of NON-ignored items)
// Dynamic: called whenever ignored status changes
export const calculateBands = (analysis: TripBucketAnalysis[]): { buckets: TripBucketAnalysis[], bands: TimeBand[] } => {
    const fallbackExpectedSegmentCount = getFallbackExpectedSegmentCount(analysis);
    const validItems = analysis.filter(bucket => isBucketEligibleForBanding(bucket, fallbackExpectedSegmentCount));

    // Initialize Bands
    const bandKeys = ['A', 'B', 'C', 'D', 'E'];
    const bandLabels = ['Band A (Slowest)', 'Band B', 'Band C', 'Band D', 'Band E (Fastest)'];

    const bandDefs: Record<string, TimeBand> = {};
    bandKeys.forEach((key, idx) => {
        bandDefs[key] = {
            id: key,
            label: bandLabels[idx],
            min: Infinity,
            max: -Infinity,
            avg: 0,
            count: 0,
            color: COLORS[key as keyof typeof COLORS]
        };
    });

    // Determine bands for valid items
    const bucketToBand: Record<string, string> = {};

    if (validItems.length > 0) {
        // Sort by duration descending (Slowest = A)
        const sortedDetails = [...validItems].sort((a, b) => getBucketBandingTotal(b) - getBucketBandingTotal(a));
        const quintileSize = Math.ceil(sortedDetails.length / 5);

        // Assign Bands
        sortedDetails.forEach((item, index) => {
            const bandIndex = Math.min(Math.floor(index / quintileSize), 4);
            const bandKey = bandKeys[bandIndex];

            bucketToBand[item.timeBucket] = bandKey;

            // Update Band Stats
            const band = bandDefs[bandKey];
            band.count++;
            const val = getBucketBandingTotal(item);
            band.avg += val;
            if (val < band.min) band.min = val;
            if (val > band.max) band.max = val;
        });

        // Finalize averages (using P50 as requested)
        Object.values(bandDefs).forEach(b => {
            if (b.count > 0) b.avg = Math.round(b.avg / b.count);

            // Fix min/max for empty bands
            if (b.min === Infinity) b.min = 0;
            if (b.max === -Infinity) b.max = 0;
        });
    }

    // Map updated band assignments back to buckets
    const updatedBuckets = analysis.map(item => ({
        ...item,
        assignedBand: isBucketEligibleForBanding(item, fallbackExpectedSegmentCount)
            ? bucketToBand[item.timeBucket]
            : undefined
    }));

    // Convert bandsDefs to array
    const bandsArray = Object.values(bandDefs);

    return { buckets: updatedBuckets, bands: bandsArray };
};

export const calculateDirectionalBands = (
    data: RuntimeData[],
    ignoredBuckets?: Set<string>
): Record<string, DirectionalBucketAnalysis> => {
    const grouped = data.reduce<Record<string, RuntimeData[]>>((acc, runtime) => {
        const direction = runtime.detectedDirection || 'North';
        if (!acc[direction]) acc[direction] = [];
        acc[direction].push(runtime);
        return acc;
    }, {});

    return Object.fromEntries(
        Object.entries(grouped).map(([direction, runtimes]) => {
            const rawAnalysis = calculateTotalTripTimes(runtimes);
            const withOutliers = detectOutliers(rawAnalysis).map(bucket => {
                if (!ignoredBuckets?.has(bucket.timeBucket)) return bucket;
                return { ...bucket, ignored: true };
            });
            const { buckets, bands } = calculateBands(withOutliers);
            return [direction, { buckets, bands }];
        })
    );
};

// Deprecated wrapper for backward compat if needed
export const categorizeTimeBands = (analysis: TripBucketAnalysis[]): { buckets: TripBucketAnalysis[], bands: TimeBand[] } => {
    const withOutliers = detectOutliers(analysis);
    return calculateBands(withOutliers);
};

// Compute direction-keyed band summaries synchronously
// This function can be called directly before schedule generation to avoid React state timing issues
export const computeDirectionBandSummary = (
    analysis: TripBucketAnalysis[],
    bands: TimeBand[],
    segmentsMap: Record<string, { segmentName: string }[]>,
    options?: {
        canonicalSegmentColumns?: CanonicalSegmentColumnLike[];
    }
): DirectionBandSummary => {
    const canonicalSegmentColumns = options?.canonicalSegmentColumns || [];
    const canonicalSegmentNameLookup = buildNormalizedSegmentNameLookup(
        canonicalSegmentColumns.map(column => column.segmentName)
    );
    const canonicalDirections = canonicalSegmentColumns
        .map(column => column.direction)
        .filter((direction): direction is string => !!direction);
    const directions = canonicalDirections.length > 0
        ? Array.from(new Set(canonicalDirections))
        : Object.keys(segmentsMap);
    if (directions.length === 0) directions.push('North'); // Fallback

    const result: DirectionBandSummary = {};

    directions.forEach(direction => {
        const canonicalDirectionSegmentNames = canonicalSegmentColumns
            .filter(column => !column.direction || column.direction === direction)
            .map(column => column.segmentName);

        // Get segment names for this direction only
        const dirSegments = segmentsMap[direction] || [];
        const dirSegmentNames = new Set<string>();
        dirSegments.forEach(seg => dirSegmentNames.add(seg.segmentName));

        // Fallback: include all segments from analysis if direction not found
        if (canonicalDirectionSegmentNames.length === 0 && dirSegmentNames.size === 0) {
            analysis.forEach(bucket => {
                bucket.details?.forEach(detail => dirSegmentNames.add(detail.segmentName));
            });
        }

        const segmentNamesArr = canonicalDirectionSegmentNames.length > 0
            ? canonicalDirectionSegmentNames
            : Array.from(dirSegmentNames);

        result[direction] = bands.map(band => {
            const bucketsInBand = analysis.filter(a => !a.ignored && a.assignedBand === band.id);

            // Collect time slots
            const timeSlots = bucketsInBand.map(b => b.timeBucket.split(' - ')[0]);

            // Average total for this band (use full band average as one-way target)
            const avgTotal = bucketsInBand.length > 0
                ? bucketsInBand.reduce((sum, b) => sum + getBucketBandingTotal(b), 0) / bucketsInBand.length
                : band.avg;

            // Average each segment for this direction only
            const avgSegments = segmentNamesArr.map(segName => {
                let weightedSum = 0;
                let weight = 0;
                let totalN = 0;
                bucketsInBand.forEach(bucket => {
                    bucket.details?.forEach(detail => {
                        const resolvedSegmentName = canonicalSegmentColumns.length > 0
                            ? resolveCanonicalSegmentName(detail.segmentName, canonicalSegmentNameLookup)
                            : detail.segmentName;
                        if (resolvedSegmentName !== segName) return;

                        const detailWeight = detail.n && detail.n > 0 ? detail.n : 1;
                        weightedSum += detail.p50 * detailWeight;
                        weight += detailWeight;
                        totalN += detailWeight;
                    });
                });
                return {
                    segmentName: segName,
                    avgTime: weight > 0 ? weightedSum / weight : 0,
                    totalN,
                };
            }).filter(s => s.avgTime > 0); // Only keep segments with data

            return {
                bandId: band.id,
                color: band.color,
                avgTotal,
                segments: avgSegments,
                timeSlots
            };
        });
    });

    return result;
};
