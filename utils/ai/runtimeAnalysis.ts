
import { RuntimeData, SegmentRawData } from '../../components/NewSchedule/utils/csvParser';
import {
    buildNormalizedSegmentNameLookup,
    resolveCanonicalSegmentName,
} from '../runtimeSegmentMatching';

export interface SegmentDetail {
    segmentName: string;
    p50: number;
    p80: number;
    n?: number;
}

export interface TripBucketAnalysis {
    timeBucket: string;    // "06:30 - 06:59"
    totalP50: number;      // Sum of all segments
    totalP80: number;
    assignedBand?: string; // 'A', 'B', 'C', 'D', 'E'
    isOutlier: boolean;
    ignored: boolean;
    details: SegmentDetail[];
}

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

const COLORS = {
    A: '#ef4444', // Red (Classic implementation often uses Red for longest/slowest)
    B: '#f97316', // Orange
    C: '#eab308', // Yellow
    D: '#84cc16', // Lime
    E: '#22c55e'  // Green (Fastest)
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
    const parseBucketStartMinutes = (bucket: string): number => {
        const start = bucket.split(' - ')[0].trim();
        const match = start.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return Number.POSITIVE_INFINITY;
        return Number(match[1]) * 60 + Number(match[2]);
    };

    const masterBuckets = Array.from(
        new Set(data.flatMap(fileData => fileData.allTimeBuckets || []))
    ).sort((a, b) => {
        const am = parseBucketStartMinutes(a);
        const bm = parseBucketStartMinutes(b);
        if (am !== bm) return am - bm;
        return a.localeCompare(b);
    });
    const analysis: TripBucketAnalysis[] = [];

    masterBuckets.forEach(bucket => {
        let sumP50 = 0;
        let sumP80 = 0;
        const details: SegmentDetail[] = [];

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
                }
            });
        });

        // Basic validation: If sum is 0, it might be a gap in service.
        // We keep it 0.

        analysis.push({
            timeBucket: bucket,
            totalP50: sumP50,
            totalP80: sumP80,
            isOutlier: false,
            ignored: sumP50 === 0, // Auto-ignore empty buckets
            details
        });
    });

    return analysis;
};

// 2. Outlier Detection (Mean +/- 2 StdDev)
// To be called ONCE upon initial data load (or manual "Reset" action)
export const detectOutliers = (analysis: TripBucketAnalysis[]): TripBucketAnalysis[] => {
    const validItems = analysis.filter(a => a.totalP50 > 0);
    if (validItems.length === 0) return analysis;

    const values = validItems.map(a => a.totalP50);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    // StdDev Calculation
    const sqDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSqDiff = sqDiffs.reduce((sum, v) => sum + v, 0) / sqDiffs.length;
    const stdDev = Math.sqrt(avgSqDiff);

    const lowerBound = mean - (2 * stdDev);
    const upperBound = mean + (2 * stdDev);

    return analysis.map(item => {
        if (item.totalP50 > 0 && (item.totalP50 < lowerBound || item.totalP50 > upperBound)) {
            return { ...item, isOutlier: true, ignored: true }; // Auto-ignore outliers
        }
        return item;
    });
};

// 3. Binning (Quintiles of NON-ignored items)
// Dynamic: called whenever ignored status changes
export const calculateBands = (analysis: TripBucketAnalysis[]): { buckets: TripBucketAnalysis[], bands: TimeBand[] } => {
    const validItems = analysis.filter(a => !a.ignored && a.totalP50 > 0);

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
        const sortedDetails = [...validItems].sort((a, b) => b.totalP50 - a.totalP50);
        const quintileSize = Math.ceil(sortedDetails.length / 5);

        // Assign Bands
        sortedDetails.forEach((item, index) => {
            const bandIndex = Math.min(Math.floor(index / quintileSize), 4);
            const bandKey = bandKeys[bandIndex];

            bucketToBand[item.timeBucket] = bandKey;

            // Update Band Stats
            const band = bandDefs[bandKey];
            band.count++;
            band.avg += item.totalP50;
            const val = item.totalP50;
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
        assignedBand: (!item.ignored && item.totalP50 > 0) ? bucketToBand[item.timeBucket] : undefined
    }));

    // Convert bandsDefs to array
    const bandsArray = Object.values(bandDefs);

    return { buckets: updatedBuckets, bands: bandsArray };
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
                ? bucketsInBand.reduce((sum, b) => sum + b.totalP50, 0) / bucketsInBand.length
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
