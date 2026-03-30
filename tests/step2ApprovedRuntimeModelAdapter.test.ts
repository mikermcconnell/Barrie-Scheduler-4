import { describe, expect, it } from 'vitest';
import { buildStep2ApprovedRuntimeModelFromContract } from '../components/NewSchedule/utils/step2ApprovedRuntimeModelAdapter';
import type { ApprovedRuntimeContract } from '../components/NewSchedule/utils/step2ReviewTypes';

const contract: ApprovedRuntimeContract = {
    schemaVersion: 1,
    routeIdentity: '7-Weekday',
    routeNumber: '7',
    dayType: 'Weekday',
    importMode: 'performance',
    inputFingerprint: 'step2-review:v1:{"routeIdentity":"7-Weekday"}',
    approvalState: 'approved',
    readinessStatus: 'ready',
    approvedAt: '2026-03-27T12:30:00.000Z',
    sourceSnapshot: {
        performanceRouteId: '7',
        performanceDateRange: null,
        runtimeLogicVersion: 2,
        importedAt: '2026-03-24T12:00:00.000Z',
    },
    planning: {
        chartBasis: 'observed-cycle',
        generationBasis: 'direction-band-summary',
        buckets: [],
        bands: [],
        directionBandSummary: {
            North: [{
                bandId: 'B',
                color: '#f97316',
                avgTotal: 98,
                segments: [],
                timeSlots: ['15:00'],
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
};

describe('step2ApprovedRuntimeModelAdapter', () => {
    it('derives the legacy runtime model from the approved contract without reusing references', () => {
        const model = buildStep2ApprovedRuntimeModelFromContract(contract);

        expect(model).not.toBeNull();
        expect(model).toMatchObject({
            routeNumber: '7',
            dayType: 'Weekday',
            importMode: 'performance',
            status: 'ready',
            chartBasis: 'observed-cycle',
            generationBasis: 'direction-band-summary',
            usableBucketCount: 1,
            ignoredBucketCount: 0,
            usableBandCount: 1,
            directions: ['North'],
        });
        expect(model?.bandPreviews).toEqual([{
            direction: 'North',
            bandId: 'B',
            avgTotal: 98,
            timeSlotCount: 1,
            segmentCount: 0,
        }]);
        expect(model?.directionBandSummary).not.toBe(contract.planning.directionBandSummary);
        expect(model?.healthReport).not.toBe(contract.healthSnapshot);
    });
});

