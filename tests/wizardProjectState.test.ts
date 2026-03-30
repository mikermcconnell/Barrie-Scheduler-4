import { describe, expect, it } from 'vitest';
import {
    buildFirebaseWizardSaveData,
    buildLocalWizardProgress,
    normalizeRestoredWizardState,
    resolveGeneratedScheduleBaselines,
    type WizardPersistenceState,
} from '../components/NewSchedule/utils/wizardProjectState';
import type { ApprovedRuntimeContract } from '../components/NewSchedule/utils/step2ReviewTypes';

const makeContract = (): ApprovedRuntimeContract => ({
    schemaVersion: 1,
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
        expect(payload.approvedRuntimeModel).toEqual(state.approvedRuntimeModel);
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
        expect(payload.approvedRuntimeModel).toEqual(state.approvedRuntimeModel);
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

        expect(restored.originalGeneratedSchedules).toEqual(restored.generatedSchedules);
        expect(restored.segmentNames).toEqual(['A to B', 'B to C']);
        expect(Object.keys(restored.segmentsMap)).toEqual(['North']);
    });

    it('preserves the approved runtime model through restore normalization', () => {
        const restored = normalizeRestoredWizardState({
            approvedRuntimeContract: makeContract(),
            approvedRuntimeModel: makeState().approvedRuntimeModel,
        });

        expect(restored.approvedRuntimeContract).toEqual(makeContract());
        expect(restored.approvedRuntimeModel).toEqual(makeState().approvedRuntimeModel);
    });
});
