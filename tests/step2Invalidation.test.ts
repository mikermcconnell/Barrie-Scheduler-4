import { describe, expect, it } from 'vitest';
import { createStep2ApprovedRuntimeContract } from '../components/NewSchedule/utils/step2Approval';
import { isStep2ApprovalCurrent, isStep2ApprovalStale, resolveStep2ApprovalState } from '../components/NewSchedule/utils/step2Invalidation';
import type { Step2ReviewResult, Step2SourceSnapshot } from '../components/NewSchedule/utils/step2ReviewTypes';

const reviewResult: Step2ReviewResult = {
    lifecycle: 'reviewable',
    inputFingerprint: 'step2-review:v1:{"routeIdentity":"400-Weekday"}',
    routeIdentity: '400-Weekday',
    routeNumber: '400',
    dayType: 'Weekday',
    importMode: 'performance',
    health: {
        status: 'ready',
        blockers: [],
        warnings: [],
        expectedDirections: 2,
        matchedDirections: ['North', 'South'],
        expectedSegmentCount: 4,
        matchedSegmentCount: 4,
        missingSegments: [],
        availableBucketCount: 6,
        completeBucketCount: 6,
        incompleteBucketCount: 0,
        lowConfidenceBucketCount: 0,
        runtimeSourceSummary: 'stop-level',
        confidenceThreshold: 5,
        usesLegacyRuntimeLogic: false,
    },
    planning: {
        chartBasis: 'observed-cycle',
        generationBasis: 'direction-band-summary',
        buckets: [{
            timeBucket: '06:30 - 06:59',
            totalP50: 40,
            totalP80: 44,
            assignedBand: 'A',
            isOutlier: false,
            ignored: false,
            details: [],
        }],
        bands: [{
            id: 'A',
            label: 'Band A',
            min: 35,
            max: 45,
            avg: 40,
            color: '#2563eb',
            count: 1,
        }],
        directionBandSummary: {
            North: [{
                bandId: 'A',
                color: '#2563eb',
                avgTotal: 40,
                segments: [],
                timeSlots: ['06:30 - 06:59'],
            }],
        },
        segmentColumns: [{ segmentName: 'A to B' }],
        canonicalDirectionStops: {
            North: ['A', 'B'],
        },
        usableBucketCount: 6,
        ignoredBucketCount: 0,
        usableBandCount: 1,
        directions: ['North', 'South'],
    },
    troubleshooting: {
        matrixAnalysis: [],
        matrixSegmentsMap: {},
        canRenderFullPath: true,
    },
    plannerOverrides: {
        excludedBuckets: [],
    },
    approvalEligible: true,
};

const sourceSnapshot: Step2SourceSnapshot = {
    performanceRouteId: '400',
    runtimeLogicVersion: 7,
    importedAt: '2026-03-27T12:00:00.000Z',
};

const approvedContract = createStep2ApprovedRuntimeContract({
    reviewResult,
    sourceSnapshot,
    approvedAt: '2026-03-27T12:30:00.000Z',
});

describe('step2Invalidation', () => {
    it('keeps an approval current when the fingerprint and lifecycle still match', () => {
        expect(approvedContract).not.toBeNull();
        expect(isStep2ApprovalStale(reviewResult, approvedContract)).toBe(false);
        expect(isStep2ApprovalCurrent(reviewResult, approvedContract)).toBe(true);
        expect(resolveStep2ApprovalState(reviewResult, approvedContract)).toBe('approved');
    });

    it('marks approval stale when the input fingerprint changes', () => {
        const changedReview = {
            ...reviewResult,
            inputFingerprint: 'step2-review:v1:{"routeIdentity":"400-Weekday","parsedDataFingerprint":"different"}',
        };

        expect(isStep2ApprovalStale(changedReview, approvedContract)).toBe(true);
        expect(isStep2ApprovalCurrent(changedReview, approvedContract)).toBe(false);
        expect(resolveStep2ApprovalState(changedReview, approvedContract)).toBe('stale');
    });

    it('marks approval stale when the approval contract schema version changes', () => {
        const mismatchedSchema = approvedContract
            ? ({ ...approvedContract, schemaVersion: 2 } as any)
            : null;

        expect(isStep2ApprovalStale(reviewResult, mismatchedSchema)).toBe(true);
        expect(resolveStep2ApprovalState(reviewResult, mismatchedSchema)).toBe('stale');
    });
});
