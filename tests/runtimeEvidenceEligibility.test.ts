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
});
