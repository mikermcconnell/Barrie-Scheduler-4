import { describe, expect, it } from 'vitest';
import { canCreateStep2Approval, createStep2ApprovedRuntimeContract } from '../components/NewSchedule/utils/step2Approval';
import type {
    Step2ReviewResult,
    Step2SourceSnapshot,
} from '../components/NewSchedule/utils/step2ReviewTypes';

const baseReviewResult: Step2ReviewResult = {
    lifecycle: 'reviewable',
    inputFingerprint: 'step2-review:v1:{"routeIdentity":"400-Weekday"}',
    routeIdentity: '400-Weekday',
    routeNumber: '400',
    dayType: 'Weekday',
    importMode: 'performance',
    health: {
        status: 'warning',
        blockers: [],
        warnings: ['Legacy runtime logic detected'],
        expectedDirections: 2,
        matchedDirections: ['North', 'South'],
        expectedSegmentCount: 4,
        matchedSegmentCount: 4,
        missingSegments: [],
        availableBucketCount: 6,
        completeBucketCount: 5,
        incompleteBucketCount: 1,
        lowConfidenceBucketCount: 1,
        runtimeSourceSummary: 'stop-level + trip-leg',
        sampleCountMode: 'days',
        confidenceThreshold: 5,
        importedAt: '2026-03-27T12:00:00.000Z',
        runtimeLogicVersion: 7,
        usesLegacyRuntimeLogic: true,
    },
    planning: {
        chartBasis: 'observed-cycle',
        generationBasis: 'direction-band-summary',
        buckets: [],
        bands: [],
        directionBandSummary: {},
        segmentColumns: [],
        canonicalDirectionStops: {
            North: ['A', 'B'],
        },
        usableBucketCount: 5,
        ignoredBucketCount: 1,
        usableBandCount: 0,
        directions: ['North', 'South'],
    },
    troubleshooting: {
        matrixAnalysis: [],
        matrixSegmentsMap: {},
        fallbackWarning: null,
        canRenderFullPath: true,
    },
    plannerOverrides: {
        excludedBuckets: ['06:30 - 06:59'],
    },
    approvalEligible: true,
};

const sourceSnapshot: Step2SourceSnapshot = {
    performanceRouteId: '400',
    performanceDateRange: {
        start: '2026-03-01',
        end: '2026-03-07',
    },
    runtimeLogicVersion: 7,
    importedAt: '2026-03-27T12:00:00.000Z',
};

describe('step2Approval', () => {
    it('requires warning acknowledgement before creating an approved contract', () => {
        expect(canCreateStep2Approval({
            reviewResult: baseReviewResult,
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
        })).toBe(false);

        expect(canCreateStep2Approval({
            reviewResult: {
                ...baseReviewResult,
                health: {
                    ...baseReviewResult.health,
                    status: 'ready',
                    warnings: [],
                },
            },
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
        })).toBe(true);
    });

    it('creates a normalized approved contract when the review is eligible', () => {
        const contract = createStep2ApprovedRuntimeContract({
            reviewResult: baseReviewResult,
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
            approvedBy: {
                userId: 'user-1',
                displayName: 'Planner One',
            },
            acknowledgedWarnings: [' Legacy runtime logic detected '],
        });

        expect(contract).not.toBeNull();
        expect(contract).toMatchObject({
            schemaVersion: 1,
            routeIdentity: '400-Weekday',
            routeNumber: '400',
            dayType: 'Weekday',
            importMode: 'performance',
            inputFingerprint: baseReviewResult.inputFingerprint,
            approvalState: 'approved',
            readinessStatus: 'warning',
            approvedAt: '2026-03-27T12:30:00.000Z',
            approvedBy: {
                userId: 'user-1',
                displayName: 'Planner One',
            },
            acknowledgedWarnings: ['Legacy runtime logic detected'],
            sourceSnapshot: {
                performanceRouteId: '400',
                performanceDateRange: {
                    start: '2026-03-01',
                    end: '2026-03-07',
                },
                runtimeLogicVersion: 7,
                importedAt: '2026-03-27T12:00:00.000Z',
            },
        });
        expect(contract?.planning).toEqual(baseReviewResult.planning);
        expect(contract?.healthSnapshot).toEqual(baseReviewResult.health);
        expect(contract?.planning).not.toBe(baseReviewResult.planning);
        expect(contract?.healthSnapshot).not.toBe(baseReviewResult.health);
    });

    it('refuses to approve blocked or stale reviews', () => {
        expect(createStep2ApprovedRuntimeContract({
            reviewResult: {
                ...baseReviewResult,
                lifecycle: 'stale',
            },
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
            acknowledgedWarnings: ['Legacy runtime logic detected'],
        })).toBeNull();

        expect(createStep2ApprovedRuntimeContract({
            reviewResult: {
                ...baseReviewResult,
                health: {
                    ...baseReviewResult.health,
                    status: 'blocked',
                },
                approvalEligible: false,
            },
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
            acknowledgedWarnings: ['Legacy runtime logic detected'],
        })).toBeNull();
    });
});
