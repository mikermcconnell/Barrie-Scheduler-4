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
        reviewBuckets: [{
            timeBucket: '06:30 - 06:59',
            totalP50: 40,
            totalP80: 44,
            assignedBand: 'A',
            isOutlier: false,
            ignored: false,
            details: [{ segmentName: 'A to B', p50: 40, p80: 44, n: 5 }],
            expectedSegmentCount: 1,
            observedSegmentCount: 1,
            sampleCountMode: 'days',
            contributingDays: ['01', '02', '03', '04', '05'].map(date => ({ date: `2026-03-${date}`, runtime: 40 })),
            evidence: { kind: 'paired-cycle', qualifyingCount: 5, requiredCount: 5, planningEligible: true, exclusionReasons: [] },
        }],
        approvedBuckets: [{
            timeBucket: '06:30 - 06:59', totalP50: 40, totalP80: 44, assignedBand: 'A',
            isOutlier: false, ignored: false,
            details: [{ segmentName: 'A to B', p50: 40, p80: 44, n: 5 }],
            expectedSegmentCount: 1, observedSegmentCount: 1, sampleCountMode: 'days',
            contributingDays: ['01', '02', '03', '04', '05'].map(date => ({ date: `2026-03-${date}`, runtime: 40 })),
            evidence: { kind: 'paired-cycle', qualifyingCount: 5, requiredCount: 5, planningEligible: true, exclusionReasons: [] },
        }],
        buckets: [{
            timeBucket: '06:30 - 06:59', totalP50: 40, totalP80: 44, assignedBand: 'A',
            isOutlier: false, ignored: false,
            details: [{ segmentName: 'A to B', p50: 40, p80: 44, n: 5 }],
            expectedSegmentCount: 1, observedSegmentCount: 1, sampleCountMode: 'days',
            contributingDays: ['01', '02', '03', '04', '05'].map(date => ({ date: `2026-03-${date}`, runtime: 40 })),
            evidence: { kind: 'paired-cycle', qualifyingCount: 5, requiredCount: 5, planningEligible: true, exclusionReasons: [] },
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
        usableBucketCount: 5,
        ignoredBucketCount: 1,
        usableBandCount: 1,
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
    cleanHistoryStartDate: '2026-03-01',
};

describe('step2Approval', () => {
    it('allows warning approvals and records the active warnings on the approved contract', () => {
        expect(canCreateStep2Approval({
            reviewResult: baseReviewResult,
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
        })).toBe(true);

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

        const contract = createStep2ApprovedRuntimeContract({
            reviewResult: baseReviewResult,
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
        });
        expect(contract?.acknowledgedWarnings).toEqual(['Legacy runtime logic detected']);
    });

    it('allows approval when a loop route only has Loop canonical stops', () => {
        expect(canCreateStep2Approval({
            reviewResult: {
                ...baseReviewResult,
                routeIdentity: '10-Weekday',
                routeNumber: '10',
                planning: {
                    ...baseReviewResult.planning,
                    canonicalDirectionStops: {
                        Loop: ['Downtown', 'Georgian College', 'Downtown'],
                    },
                    directions: ['Loop'],
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
            schemaVersion: 2,
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
                cleanHistoryStartDate: '2026-03-01',
            },
        });
        expect(contract?.planning).toEqual(baseReviewResult.planning);
        expect(contract?.healthSnapshot).toEqual(baseReviewResult.health);
        expect(contract?.planning).not.toBe(baseReviewResult.planning);
        expect(contract?.healthSnapshot).not.toBe(baseReviewResult.health);
    });

    it('refuses to approve blocked, stale, or generation-incomplete reviews', () => {
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

        expect(createStep2ApprovedRuntimeContract({
            reviewResult: {
                ...baseReviewResult,
                planning: {
                    ...baseReviewResult.planning,
                    usableBucketCount: 0,
                },
            },
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
        })).toBeNull();

        expect(createStep2ApprovedRuntimeContract({
            reviewResult: {
                ...baseReviewResult,
                planning: {
                    ...baseReviewResult.planning,
                    usableBandCount: 0,
                },
            },
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
        })).toBeNull();

        expect(createStep2ApprovedRuntimeContract({
            reviewResult: {
                ...baseReviewResult,
                planning: {
                    ...baseReviewResult.planning,
                    canonicalDirectionStops: undefined,
                },
            },
            sourceSnapshot,
            approvedAt: '2026-03-27T12:30:00.000Z',
        })).toBeNull();
    });
});
