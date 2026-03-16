import { describe, expect, it } from 'vitest';
import {
    buildCanonicalSegmentColumnsFromMasterStops,
    buildNormalizedSegmentNameLookup,
    buildSegmentsMapFromParsedData,
    deriveWizardStepFromProject,
    getOrderedSegmentColumns,
    hasRestorableWizardProgress,
    resolveCanonicalSegmentName,
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

    it('sorts grouped performance segments by route stop index when available', () => {
        const grouped = buildSegmentsMapFromParsedData([
            {
                detectedDirection: 'North',
                segments: [
                    { segmentName: 'C to D', timeBuckets: {}, fromRouteStopIndex: 3, toRouteStopIndex: 4 },
                    { segmentName: 'A to B', timeBuckets: {}, fromRouteStopIndex: 1, toRouteStopIndex: 2 },
                    { segmentName: 'B to C', timeBuckets: {}, fromRouteStopIndex: 2, toRouteStopIndex: 3 },
                ],
            },
        ] as any);

        expect(grouped.North.map(segment => segment.segmentName)).toEqual([
            'A to B',
            'B to C',
            'C to D',
        ]);
    });

    it('reconstructs segment order from the route chain when stop indices are missing', () => {
        const grouped = buildSegmentsMapFromParsedData([
            {
                detectedDirection: 'North',
                segments: [
                    { segmentName: 'Downtown Hub to Georgian College', timeBuckets: {} },
                    { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Allandale Terminal', timeBuckets: {} },
                    { segmentName: 'Allandale Terminal to Downtown Hub', timeBuckets: {} },
                ],
            },
            {
                detectedDirection: 'South',
                segments: [
                    { segmentName: 'Peggy Hill to Park Place', timeBuckets: {} },
                    { segmentName: 'Georgian College to Downtown Hub', timeBuckets: {} },
                    { segmentName: 'Allandale Terminal to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Downtown Hub to Allandale Terminal', timeBuckets: {} },
                ],
            },
        ] as any);

        expect(grouped.North.map(segment => segment.segmentName)).toEqual([
            'Park Place to Peggy Hill',
            'Peggy Hill to Allandale Terminal',
            'Allandale Terminal to Downtown Hub',
            'Downtown Hub to Georgian College',
        ]);
        expect(grouped.South.map(segment => segment.segmentName)).toEqual([
            'Georgian College to Downtown Hub',
            'Downtown Hub to Allandale Terminal',
            'Allandale Terminal to Peggy Hill',
            'Peggy Hill to Park Place',
        ]);
    });

    it('labels ordered columns with route variants for A/B direction routes', () => {
        const grouped = buildSegmentsMapFromParsedData([
            {
                detectedDirection: 'North',
                segments: [
                    { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Downtown Hub', timeBuckets: {} },
                ],
            },
            {
                detectedDirection: 'South',
                segments: [
                    { segmentName: 'Downtown Hub to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Park Place', timeBuckets: {} },
                ],
            },
        ] as any);

        expect(getOrderedSegmentColumns(grouped, '7').map(column => column.groupLabel)).toEqual([
            '7A',
            '7A',
            '7B',
            '7B',
        ]);
    });

    it('builds canonical out-and-back columns from master stops', () => {
        expect(
            buildCanonicalSegmentColumnsFromMasterStops(
                '7',
                ['Park Pl', 'Peggy Hill', 'Downtown Hub'],
                ['Downtown Hub', 'Peggy Hill', 'Park Pl']
            )
        ).toEqual([
            { segmentName: 'Park Pl to Peggy Hill', direction: 'North', groupLabel: '7A' },
            { segmentName: 'Peggy Hill to Downtown Hub', direction: 'North', groupLabel: '7A' },
            { segmentName: 'Downtown Hub to Peggy Hill', direction: 'South', groupLabel: '7B' },
            { segmentName: 'Peggy Hill to Park Pl', direction: 'South', groupLabel: '7B' },
        ]);
    });

    it('matches observed runtime labels onto canonical segment names', () => {
        const canonicalLookup = buildNormalizedSegmentNameLookup([
            'Park Place to Peggy Hill',
            'Downtown Hub to Arrive Rose Street',
            'Depart Rose Street to Georgian College',
        ]);

        expect(resolveCanonicalSegmentName('Park Pl to Peggy Hill', canonicalLookup)).toBe('Park Place to Peggy Hill');
        expect(resolveCanonicalSegmentName('Downtown Hub to Rose Street', canonicalLookup)).toBe('Downtown Hub to Arrive Rose Street');
        expect(resolveCanonicalSegmentName('Rose Street to Georgian Coll.', canonicalLookup)).toBe('Depart Rose Street to Georgian College');
    });

    it('normalizes stop labels when reconstructing route chains', () => {
        const grouped = buildSegmentsMapFromParsedData([
            {
                detectedDirection: 'North',
                segments: [
                    { segmentName: 'Downtown Hub to Georgian Coll.', timeBuckets: {} },
                    { segmentName: 'Park Pl to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Allandale Term', timeBuckets: {} },
                    { segmentName: 'Allandale Terminal to Downtown Hub', timeBuckets: {} },
                ],
            },
        ] as any);

        expect(grouped.North.map(segment => segment.segmentName)).toEqual([
            'Park Pl to Peggy Hill',
            'Peggy Hill to Allandale Term',
            'Allandale Terminal to Downtown Hub',
            'Downtown Hub to Georgian Coll.',
        ]);
    });

    it('hides the generic next action for GTFS import mode', () => {
        expect(shouldShowNextStepAction(1, 'gtfs')).toBe(false);
        expect(shouldShowNextStepAction(1, 'csv')).toBe(true);
        expect(shouldShowNextStepAction(3, 'gtfs')).toBe(true);
        expect(shouldShowNextStepAction(4, 'csv')).toBe(false);
    });
});
