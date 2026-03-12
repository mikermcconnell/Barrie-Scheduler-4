import { describe, expect, it } from 'vitest';
import {
    buildSegmentsMapFromParsedData,
    deriveWizardStepFromProject,
    hasRestorableWizardProgress,
    shouldShowNextStepAction,
} from '../components/NewSchedule/utils/wizardState';

describe('newSchedule wizard state helpers', () => {
    it('does not treat step 1 CSV filenames as resumable progress', () => {
        expect(
            hasRestorableWizardProgress({
                step: 1,
                importMode: 'csv',
                fileNames: ['north.csv', 'south.csv'],
            })
        ).toBe(false);
    });

    it('treats later steps and performance selections as resumable progress', () => {
        expect(
            hasRestorableWizardProgress({
                step: 2,
                importMode: 'csv',
                fileNames: [],
            })
        ).toBe(true);

        expect(
            hasRestorableWizardProgress({
                step: 1,
                importMode: 'performance',
                fileNames: [],
                performanceConfig: {
                    routeId: '8',
                    dateRange: null,
                },
            })
        ).toBe(true);
    });

    it('derives the correct wizard step from project contents', () => {
        expect(
            deriveWizardStepFromProject({
                isGenerated: true,
                generatedSchedules: [{ routeName: '10', stops: [], stopIds: {}, trips: [] }],
            })
        ).toBe(4);

        expect(
            deriveWizardStepFromProject({
                config: {
                    routeNumber: '10',
                    cycleTime: 60,
                    blocks: [{ id: '10-1', startTime: '06:00', endTime: '22:00' }],
                },
            })
        ).toBe(3);

        expect(
            deriveWizardStepFromProject({
                analysis: [{
                    timeBucket: '06:00 - 06:29',
                    totalP50: 30,
                    totalP80: 35,
                    assignedBand: 'A',
                    isOutlier: false,
                    ignored: false,
                    details: [],
                }],
            })
        ).toBe(2);

        expect(deriveWizardStepFromProject({})).toBe(1);
    });

    it('groups parsed data by detected direction', () => {
        const grouped = buildSegmentsMapFromParsedData([
            {
                fileName: 'north.csv',
                detectedDirection: 'North',
                segments: [{ segmentName: 'A to B', timeBuckets: {} }],
            },
            {
                fileName: 'south.csv',
                detectedDirection: 'South',
                segments: [{ segmentName: 'B to A', timeBuckets: {} }],
            },
            {
                fileName: 'loop.csv',
                segments: [{ segmentName: 'Loop Segment', timeBuckets: {} }],
            },
        ] as any);

        expect(Object.keys(grouped)).toEqual(['North', 'South']);
        expect(grouped.North).toHaveLength(2);
        expect(grouped.South).toHaveLength(1);
    });

    it('hides the generic next action for GTFS import mode', () => {
        expect(shouldShowNextStepAction(1, 'gtfs')).toBe(false);
        expect(shouldShowNextStepAction(1, 'csv')).toBe(true);
        expect(shouldShowNextStepAction(3, 'gtfs')).toBe(true);
        expect(shouldShowNextStepAction(4, 'csv')).toBe(false);
    });
});
