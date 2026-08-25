import type { RuntimePatternKind } from '../performanceDataTypes';

export const CORRIDOR_MIN_TRAVERSAL_COUNT = 8;
export const CORRIDOR_MIN_DISTINCT_DAY_COUNT = 5;

export type CorridorConfidenceLevel = 'none' | 'low' | 'usable';

export interface CorridorEvidenceQuality {
    level: CorridorConfidenceLevel;
    reasons: string[];
}

export function calculatePercentile(values: readonly number[], percentile: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const boundedPercentile = Math.max(0, Math.min(1, percentile));
    const rank = boundedPercentile * (sorted.length - 1);
    const lowerIndex = Math.floor(rank);
    const upperIndex = Math.ceil(rank);
    const lower = sorted[lowerIndex];
    const upper = sorted[upperIndex];
    if (lowerIndex === upperIndex) return lower;
    return lower + ((upper - lower) * (rank - lowerIndex));
}

export function calculateMedian(values: readonly number[]): number | null {
    return calculatePercentile(values, 0.5);
}

export function buildCorridorEvidenceQuality(
    sampleCount: number,
    distinctDayCount: number,
): CorridorEvidenceQuality {
    if (sampleCount === 0) {
        return { level: 'none', reasons: ['No matched observed traversals'] };
    }

    const reasons: string[] = [];
    if (sampleCount < CORRIDOR_MIN_TRAVERSAL_COUNT) {
        reasons.push(`Fewer than ${CORRIDOR_MIN_TRAVERSAL_COUNT} matched traversals`);
    }
    if (distinctDayCount > 0 && distinctDayCount < CORRIDOR_MIN_DISTINCT_DAY_COUNT) {
        reasons.push(`Fewer than ${CORRIDOR_MIN_DISTINCT_DAY_COUNT} distinct service days`);
    }
    if (distinctDayCount === 0) {
        reasons.push('Service-day provenance is unavailable');
    }

    return {
        level: reasons.length > 0 ? 'low' : 'usable',
        reasons,
    };
}

export function isEligibleCorridorPattern(patternKind: RuntimePatternKind | undefined): boolean {
    return patternKind === 'normal';
}
