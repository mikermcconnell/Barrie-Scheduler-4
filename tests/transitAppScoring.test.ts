import { describe, expect, it } from 'vitest';
import {
    classifyTrend,
    computeCompositeScore,
    computePercentileRanks,
    deriveConfidence,
    isWeekendDate,
    median,
    safeRate,
    toMonthKey,
} from '../utils/transit-app/transitAppScoring';

describe('transitAppScoring.safeRate', () => {
    it('returns null for zero denominator', () => {
        expect(safeRate(10, 0)).toBeNull();
    });

    it('returns rounded ratio when denominator is valid', () => {
        expect(safeRate(1, 3, 4)).toBe(0.3333);
    });
});

describe('transitAppScoring.computePercentileRanks', () => {
    it('handles percentile ranking with ties', () => {
        const ranks = computePercentileRanks([
            { key: 'A', value: 10 },
            { key: 'B', value: 20 },
            { key: 'C', value: 20 },
            { key: 'D', value: 40 },
        ]);

        expect(ranks.get('A')).toBe(0);
        expect(ranks.get('B')).toBe(50);
        expect(ranks.get('C')).toBe(50);
        expect(ranks.get('D')).toBe(100);
    });

    it('returns 100 for a single numeric entry', () => {
        const ranks = computePercentileRanks([
            { key: 'A', value: 12 },
            { key: 'B', value: null },
        ]);
        expect(ranks.get('A')).toBe(100);
        expect(ranks.get('B')).toBeNull();
    });
});

describe('transitAppScoring.computeCompositeScore', () => {
    it('returns null if any required component is missing', () => {
        expect(computeCompositeScore({
            viewToTapRankPct: null,
            tapToSuggestionRankPct: 50,
            goTripsRankPct: 50,
            totalLegsRankPct: 50,
            suggestionToGoRankPct: 50,
        })).toBeNull();
    });

    it('computes weighted score correctly', () => {
        expect(computeCompositeScore({
            viewToTapRankPct: 100,
            tapToSuggestionRankPct: 50,
            goTripsRankPct: 0,
            totalLegsRankPct: 100,
            suggestionToGoRankPct: 50,
        })).toBe(62.5);
    });
});

describe('transitAppScoring.classifyTrend', () => {
    it('classifies exact boundary as rising or declining', () => {
        expect(classifyTrend(55, 50, 5)).toEqual({ trend: 'Rising', delta: 5 });
        expect(classifyTrend(45, 50, 5)).toEqual({ trend: 'Declining', delta: -5 });
    });

    it('classifies deltas inside boundary as stable', () => {
        expect(classifyTrend(53.9, 50, 5)).toEqual({ trend: 'Stable', delta: 3.9 });
    });

    it('returns N/A when either score missing', () => {
        expect(classifyTrend(null, 50, 5)).toEqual({ trend: 'N/A', delta: null });
    });
});

describe('transitAppScoring.misc helpers', () => {
    it('builds month keys from date', () => {
        expect(toMonthKey('2025-09-15')).toBe('2025-09');
    });

    it('detects weekend dates', () => {
        expect(isWeekendDate('2025-09-13')).toBe(true); // Saturday
        expect(isWeekendDate('2025-09-15')).toBe(false); // Monday
    });

    it('computes median for odd and even sets', () => {
        expect(median([1, 2, 3])).toBe(2);
        expect(median([1, 2, 3, 4])).toBe(2.5);
        expect(median([null, null])).toBeNull();
    });

    it('derives confidence tiers from views and active days', () => {
        expect(deriveConfidence(250, 20)).toBe('High');
        expect(deriveConfidence(80, 7)).toBe('Medium');
        expect(deriveConfidence(10, 2)).toBe('Low');
    });
});
