import { describe, expect, it } from 'vitest';
import {
    buildFirebaseWizardSaveData,
    buildLocalWizardProgress,
    normalizeRestoredWizardState,
    resolveGeneratedScheduleBaselines,
    type WizardPersistenceState,
} from '../components/NewSchedule/utils/wizardProjectState';
import type { ApprovedRuntimeContract } from '../components/NewSchedule/utils/step2ReviewTypes';
import type { TripBucketAnalysis } from '../utils/ai/runtimeAnalysis';

const eligibleBucket: TripBucketAnalysis = {
    timeBucket: '06:00 - 06:29',
    totalP50: 60,
    totalP80: 66,
    observedCycleP50: 60,
    assignedBand: 'A',
    ignored: false,
    isOutlier: false,
    expectedSegmentCount: 1,
    observedSegmentCount: 1,
    sampleCountMode: 'days',
    details: [{ segmentName: 'A to B', p50: 60, p80: 66, n: 5 }],
    contributingDays: ['01', '02', '03', '04', '05'].map(day => ({
        date: `2026-03-${day}`,
        runtime: 60,
    })),
    evidence: {
        kind: 'paired-cycle',
        qualifyingCount: 5,
        requiredCount: 5,
        planningEligible: true,
        exclusionReasons: [],
    },
};

const makeContract = (): ApprovedRuntimeContract => ({
    schemaVersion: 2,
    routeIdentity: '8-Weekday',
    routeNumber: '8',
    dayType: 'Weekday',
    importMode: 'performance',
    inputFingerprint: 'step2-review:v1:{"routeIdentity":"8-Weekday"}',
    approvalState: 'approved',
    readinessStatus: 'ready',
    approvedAt: '2026-03-27T12:30:00.000Z',
    sourceSnapshot: {
        performanceRouteId: '8',
        performanceDateRange: null,
        runtimeLogicVersion: 7,
        importedAt: '2026-03-27T12:00:00.000Z',
    },
    planning: {
        chartBasis: 'observed-cycle',
        generationBasis: 'direction-band-summary',
        buckets: [eligibleBucket],
        reviewBuckets: [eligibleBucket],
        approvedBuckets: [eligibleBucket],
        bands: [{
            id: 'A', label: 'Band A', min: 55, max: 65, avg: 60, color: '#ef4444', count: 1,
        }],
        directionBandSummary: {
            North: [{
                bandId: 'A',
                color: '#ef4444',
                avgTotal: 60,
                segments: [],
                timeSlots: ['06:00'],
            }],
        },
        segmentColumns: [{ segmentName: 'A to B' }],
        canonicalDirectionStops: { North: ['A', 'B'] },
        usableBucketCount: 1,
        ignoredBucketCount: 0,
        usableBandCount: 1,
        directions: ['North'],
    },
    healthSnapshot: {
        status: 'ready',
        blockers: [],
        warnings: [],
        expectedDirections: 1,
        matchedDirections: ['North'],
        expectedSegmentCount: 1,
        matchedSegmentCount: 1,
        missingSegments: [],
        completeBucketCount: 1,
        coverageCompleteBucketCount: 1,
        trustedReadyBucketCount: 1,
        incompleteBucketCount: 0,
        lowConfidenceBucketCount: 0,
        availableBucketCount: 1,
        runtimeSourceSummary: 'stop-level',
        confidenceThreshold: 5,
        usesLegacyRuntimeLogic: false,
    },
    troubleshootingSnapshot: {
        matrixAnalysis: [eligibleBucket],
        matrixSegmentsMap: {
            North: [{ segmentName: 'A to B', timeBuckets: {} }],
        },
        fallbackWarning: 'Review-only pattern warning',
        canRenderFullPath: false,
    },
});

const makeState = (): WizardPersistenceState => ({
    step: 3,
    dayType: 'Weekday',
    importMode: 'performance',
    performanceConfig: {
        routeId: '8',
        dateRange: null,
    },
    autofillFromMaster: true,
    projectName: 'Route 8 Weekday',
    fileNames: [],
    analysis: [],
    bands: [],
    config: {
        routeNumber: '8',
        cycleTime: 60,
        recoveryRatio: 15,
        blocks: [],
    },
    generatedSchedules: [{
        routeName: '8 (North)',
        stops: [] as string[],
        stopIds: {},
        trips: [] as never[],
    }],
    originalGeneratedSchedules: [],
    parsedData: [],
    approvedRuntimeContract: makeContract(),
    approvedRuntimeModel: {
        routeNumber: '8',
        dayType: 'Weekday',
        importMode: 'performance',
        status: 'ready',
        chartBasis: 'observed-cycle',
        generationBasis: 'direction-band-summary',
        buckets: [],
        bands: [],
        directionBandSummary: {
            North: [{
                bandId: 'A',
                color: '#ef4444',
                avgTotal: 60,
                segments: [],
                timeSlots: ['06:00'],
            }],
        },
        segmentColumns: [],
        healthReport: {
            status: 'ready',
            blockers: [],
            warnings: [],
            expectedDirections: 1,
            matchedDirections: ['North'],
            expectedSegmentCount: 0,
            matchedSegmentCount: 0,
            missingSegments: [],
            completeBucketCount: 1,
            incompleteBucketCount: 0,
            lowConfidenceBucketCount: 0,
            availableBucketCount: 1,
            runtimeSourceSummary: 'stop-level',
            confidenceThreshold: 5,
            usesLegacyRuntimeLogic: false,
        },
        usableBucketCount: 1,
        ignoredBucketCount: 0,
        usableBandCount: 1,
        directions: ['North'],
        bandPreviews: [{
            direction: 'North',
            bandId: 'A',
            avgTotal: 60,
            timeSlotCount: 1,
            segmentCount: 0,
        }],
    },
});

describe('wizardProjectState helpers', () => {
    it('falls back original baseline to generated schedules when original is missing', () => {
        const generatedSchedules = [{
            routeName: '8 (North)',
            stops: [] as string[],
            stopIds: {},
            trips: [] as never[],
        }];

        expect(resolveGeneratedScheduleBaselines(generatedSchedules, []).originalGeneratedSchedules)
            .toEqual(generatedSchedules);
    });

    it('promotes local save payload to step 4 when generated schedules are provided early', () => {
        const state = makeState();

        const payload = buildLocalWizardProgress(state, {
            generatedSchedules: state.generatedSchedules,
        });

        expect(payload.step).toBe(4);
        expect(payload.generatedSchedules).toEqual(state.generatedSchedules);
        expect(payload.originalGeneratedSchedules).toEqual(state.generatedSchedules);
        expect(payload.approvedRuntimeContract).toEqual(state.approvedRuntimeContract);
        expect(payload.approvedRuntimeModel).toBeUndefined();
    });

    it('keeps the firebase payload baseline stable when original is absent', () => {
        const state = makeState();

        const payload = buildFirebaseWizardSaveData(state, {
            generatedSchedules: state.generatedSchedules,
            isGenerated: true,
        });

        expect(payload.generatedSchedules).toEqual(state.generatedSchedules);
        expect(payload.originalGeneratedSchedules).toEqual(state.generatedSchedules);
        expect(payload.isGenerated).toBe(true);
        expect(payload.approvedRuntimeContract).toEqual(state.approvedRuntimeContract);
        expect(payload.approvedRuntimeModel).toBeUndefined();
    });

    it('preserves a loaded Step 4 schedule when a stale approval temporarily shows Step 2', () => {
        const state = { ...makeState(), step: 2 as const };

        const localPayload = buildLocalWizardProgress(state);
        const firebasePayload = buildFirebaseWizardSaveData(state);

        expect(localPayload.step).toBe(4);
        expect(localPayload.config).toEqual(state.config);
        expect(localPayload.generatedSchedules).toEqual(state.generatedSchedules);
        expect(localPayload.originalGeneratedSchedules).toEqual(state.generatedSchedules);
        expect(firebasePayload.config).toEqual(state.config);
        expect(firebasePayload.generatedSchedules).toEqual(state.generatedSchedules);
        expect(firebasePayload.originalGeneratedSchedules).toEqual(state.generatedSchedules);
        expect(firebasePayload.isGenerated).toBe(true);
    });

    it('preserves loaded Step 3 block settings while a stale approval temporarily shows Step 2', () => {
        const state: WizardPersistenceState = {
            ...makeState(),
            step: 2 as const,
            generatedSchedules: [],
            originalGeneratedSchedules: [],
            config: {
                ...makeState().config,
                blocks: [{ id: '8-1', startTime: '06:00', endTime: '22:00' }],
            },
        };

        const payload = buildFirebaseWizardSaveData(state);

        expect(payload.config).toEqual(state.config);
        expect(payload.generatedSchedules).toBeUndefined();
        expect(payload.isGenerated).toBe(false);
    });

    it('normalizes restored state with parsed-data segment ordering and baseline fallback', () => {
        const restored = normalizeRestoredWizardState({
            analysis: [{
                timeBucket: '06:00 - 06:29',
                totalP50: 30,
                totalP80: 35,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [{
                    segmentName: 'Fallback Segment',
                    p50: 12,
                    p80: 14,
                }],
            }],
            generatedSchedules: makeState().generatedSchedules,
            parsedData: [{
                fileName: 'north.csv',
                detectedDirection: 'North',
                segments: [
                    { segmentName: 'B to C', timeBuckets: {}, fromRouteStopIndex: 2, toRouteStopIndex: 3 },
                    { segmentName: 'A to B', timeBuckets: {}, fromRouteStopIndex: 1, toRouteStopIndex: 2 },
                ],
            }] as any,
        });

        expect(restored.originalGeneratedSchedules).toEqual([]);
        expect(restored.segmentNames).toEqual([]);
        expect(Object.keys(restored.segmentsMap)).toEqual([]);
        expect(restored.legacyRuntimeDataReset).toBe(true);
    });

    it('preserves a v2 contract but removes the old duplicate runtime model', () => {
        const restored = normalizeRestoredWizardState({
            approvedRuntimeContract: makeContract(),
            approvedRuntimeModel: makeState().approvedRuntimeModel,
        });

        expect(restored.approvedRuntimeContract).toEqual(makeContract());
        expect(restored.approvedRuntimeModel).toBeUndefined();
        expect(restored.canonicalDirectionStops).toEqual({ North: ['A', 'B'] });
        expect(restored.canonicalSegmentColumns).toEqual([{ segmentName: 'A to B' }]);
        expect(restored.canonicalRouteIdentity).toBe('8-Weekday');
        expect(restored.canonicalRouteSource).toEqual({
            type: 'master',
            routeIdentity: '8-Weekday',
            versionHint: 'master-schedule',
        });
        expect(restored.matrixAnalysis).toEqual([eligibleBucket]);
        expect(restored.matrixSegmentsMap).toEqual({
            North: [{ segmentName: 'A to B', timeBuckets: {} }],
        });
        expect(restored.troubleshootingPatternWarning).toBe('Review-only pattern warning');
        expect(restored.legacyRuntimeDataReset).toBe(false);
    });
});
