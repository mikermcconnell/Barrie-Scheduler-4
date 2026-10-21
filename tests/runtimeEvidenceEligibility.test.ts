import { describe, expect, it } from 'vitest';
import { evaluateRuntimeBucketEligibility } from '../utils/ai/runtimeEvidenceEligibility';
import { detectOutliers, type TripBucketAnalysis } from '../utils/ai/runtimeAnalysis';

describe('runtime evidence eligibility', () => {
    it('does not trust a stored planningEligible flag with an invalid threshold', () => {
        const result = evaluateRuntimeBucketEligibility({
            totalP50: 30,
            assignedBand: 'A',
            ignored: false,
            isOutlier: false,
            expectedSegmentCount: 1,
            observedSegmentCount: 1,
            sampleCountMode: 'observations',
            details: [{ n: 4 }],
            evidence: {
                kind: 'uploaded-percentiles',
                qualifyingCount: 4,
                requiredCount: 4,
                planningEligible: true,
                exclusionReasons: [],
            },
        }, { requireAssignedBand: true });

        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('Uploaded evidence must require 10 observations');
    });

    it('does not mark already-ineligible evidence as an outlier', () => {
        const eligible = (timeBucket: string): TripBucketAnalysis => ({
            timeBucket,
            totalP50: 10,
            totalP80: 12,
            ignored: false,
            isOutlier: false,
            details: [{ segmentName: 'A to B', p50: 10, p80: 12, n: 10 }],
            expectedSegmentCount: 1,
            observedSegmentCount: 1,
            sampleCountMode: 'observations',
            evidence: { kind: 'uploaded-percentiles', qualifyingCount: 10, requiredCount: 10, planningEligible: true, exclusionReasons: [] },
        });
        const weak: TripBucketAnalysis = {
            ...eligible('07:30 - 07:59'),
            totalP50: 100,
            evidence: { kind: 'segment-only', qualifyingCount: 0, requiredCount: 5, planningEligible: false, exclusionReasons: ['No complete paired cycle day'] },
        };

        const result = detectOutliers([
            eligible('06:00 - 06:29'),
            eligible('06:30 - 06:59'),
            eligible('07:00 - 07:29'),
            weak,
        ]);

        expect(result[3].isOutlier).toBe(false);
        expect(result[3].ignored).toBe(false);
    });

    it.each([
        { label: 'missing P50', detail: { p80: 12, n: 10 } },
        { label: 'zero P50', detail: { p50: 0, p80: 12, n: 10 } },
        { label: 'non-finite P50', detail: { p50: Number.NaN, p80: 12, n: 10 } },
        { label: 'missing P80', detail: { p50: 10, n: 10 } },
        { label: 'zero P80', detail: { p50: 10, p80: 0, n: 10 } },
        { label: 'non-finite P80', detail: { p50: 10, p80: Number.POSITIVE_INFINITY, n: 10 } },
    ])('rejects otherwise sufficient uploaded evidence with $label', ({ detail }) => {
        const result = evaluateRuntimeBucketEligibility({
            totalP50: 10,
            assignedBand: 'A',
            ignored: false,
            isOutlier: false,
            expectedSegmentCount: 1,
            observedSegmentCount: 1,
            sampleCountMode: 'observations',
            details: [detail],
            evidence: {
                kind: 'uploaded-percentiles',
                qualifyingCount: 10,
                requiredCount: 10,
                planningEligible: true,
                exclusionReasons: [],
            },
        }, { requireAssignedBand: true });

        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('Every segment needs positive finite P50 and P80 runtimes');
    });

    it('accepts positive finite segment percentiles when all other evidence is sufficient', () => {
        const result = evaluateRuntimeBucketEligibility({
            totalP50: 10,
            assignedBand: 'A',
            ignored: false,
            isOutlier: false,
            expectedSegmentCount: 1,
            observedSegmentCount: 1,
            sampleCountMode: 'observations',
            details: [{ p50: 10, p80: 12, n: 10 }],
            evidence: {
                kind: 'uploaded-percentiles',
                qualifyingCount: 10,
                requiredCount: 10,
                planningEligible: true,
                exclusionReasons: [],
            },
        }, { requireAssignedBand: true });

        expect(result).toEqual({ eligible: true, reasons: [] });
    });

    it('flags cross-bucket outliers for uploaded percentiles but keeps a slow paired-cycle peak', () => {
        const uploaded = (timeBucket: string, total: number): TripBucketAnalysis => ({
            timeBucket,
            totalP50: total,
            totalP80: total + 2,
            ignored: false,
            isOutlier: false,
            details: [{ segmentName: 'A to B', p50: total, p80: total + 2, n: 10 }],
            expectedSegmentCount: 1,
            observedSegmentCount: 1,
            sampleCountMode: 'observations',
            evidence: { kind: 'uploaded-percentiles', qualifyingCount: 10, requiredCount: 10, planningEligible: true, exclusionReasons: [] },
        });
        const paired = (timeBucket: string, total: number): TripBucketAnalysis => ({
            ...uploaded(timeBucket, total),
            sampleCountMode: 'days',
            contributingDays: ['01', '02', '03', '04', '05'].map(day => ({ date: `2026-09-${day}`, runtime: total })),
            evidence: { kind: 'paired-cycle', qualifyingCount: 5, requiredCount: 5, planningEligible: true, exclusionReasons: [] },
        });
        const day = Array.from({ length: 10 }, (_, index) => `${String(6 + index).padStart(2, '0')}:00 - ${String(6 + index).padStart(2, '0')}:29`);

        const uploadedResult = detectOutliers([...day.map(bucket => uploaded(bucket, 30)), uploaded('16:30 - 16:59', 60)]);
        expect(uploadedResult[10].isOutlier).toBe(true);

        const pairedResult = detectOutliers([...day.map(bucket => paired(bucket, 30)), paired('16:30 - 16:59', 60)]);
        expect(pairedResult[10].isOutlier).toBe(false);
        expect(pairedResult[10].ignored).toBe(false);
    });
});
