import { describe, expect, it } from 'vitest';
import type { TimeBand, TripBucketAnalysis } from '../utils/ai/runtimeAnalysis';
import { computeSuggestedStrictCycle } from '../utils/schedule/strictCycleSuggestion';

describe('computeSuggestedStrictCycle', () => {
    it('leans on representative cycle buckets instead of weak tail buckets', () => {
        const analysis: TripBucketAnalysis[] = [
            {
                timeBucket: '05:30 - 05:59',
                totalP50: 77,
                totalP80: 84,
                assignedBand: 'D',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 38, p80: 41, n: 12 },
                    { segmentName: 'B to A', p50: 39, p80: 43, n: 12 },
                ],
            },
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 99,
                totalP80: 108,
                assignedBand: 'C',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 49, p80: 54, n: 12 },
                    { segmentName: 'B to A', p50: 50, p80: 54, n: 12 },
                ],
            },
            {
                timeBucket: '07:00 - 07:29',
                totalP50: 112,
                totalP80: 121,
                assignedBand: 'B',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 55, p80: 60, n: 14 },
                    { segmentName: 'B to A', p50: 57, p80: 61, n: 14 },
                ],
            },
            {
                timeBucket: '09:30 - 09:59',
                totalP50: 131,
                totalP80: 140,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 65, p80: 70, n: 15 },
                    { segmentName: 'B to A', p50: 66, p80: 70, n: 15 },
                ],
            },
        ];

        const suggestion = computeSuggestedStrictCycle(analysis, []);

        expect(suggestion.quality).toBe('high');
        expect(suggestion.basisLabel).toBe('filtered observed cycle totals');
        expect(suggestion.minutes).toBe(112);
    });

    it('falls back to weighted band averages when no usable cycle buckets remain', () => {
        const bands: TimeBand[] = [
            { id: 'A', label: 'Band A', min: 100, max: 110, avg: 100, color: '#ef4444', count: 2 },
            { id: 'B', label: 'Band B', min: 110, max: 120, avg: 110, color: '#f59e0b', count: 1 },
        ];

        const suggestion = computeSuggestedStrictCycle([], bands);

        expect(suggestion.quality).toBe('fallback');
        expect(suggestion.basisLabel).toBe('observed band averages');
        expect(suggestion.minutes).toBe(103);
    });

    it('prefers full observed cycle totals over synthetic segment sums when they exist', () => {
        const analysis: TripBucketAnalysis[] = [
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 30,
                totalP80: 36,
                observedCycleP50: 50,
                observedCycleP80: 54,
                assignedBand: 'B',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 10, p80: 12, n: 10 },
                    { segmentName: 'B to C', p50: 10, p80: 12, n: 10 },
                    { segmentName: 'C to D', p50: 10, p80: 12, n: 10 },
                ],
            },
            {
                timeBucket: '06:30 - 06:59',
                totalP50: 35,
                totalP80: 39,
                observedCycleP50: 55,
                observedCycleP80: 59,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 12, p80: 13, n: 10 },
                    { segmentName: 'B to C', p50: 11, p80: 13, n: 10 },
                    { segmentName: 'C to D', p50: 12, p80: 13, n: 10 },
                ],
            },
        ];

        const suggestion = computeSuggestedStrictCycle(analysis, []);

        expect(suggestion.quality).toBe('high');
        expect(suggestion.minutes).toBe(53);
    });
});
