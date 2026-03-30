import { describe, expect, it } from 'vitest';
import {
    alignOrderedSegmentColumnsToPreferredGroups,
    buildApprovedRuntimeModel,
    buildStep2DataHealthReport,
    buildCanonicalSegmentColumnsFromMasterStops,
    buildNormalizedSegmentNameLookup,
    buildSegmentsMapFromParsedData,
    clampWizardStepToCurrentStep2Approval,
    deriveWizardStepFromProject,
    getUsableCanonicalDirectionStops,
    getOrderedSegmentColumns,
    hasRestorableWizardProgress,
    normalizeSegmentStopKey,
    orderSegmentColumnsByCanonicalStops,
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

    it('clamps Step 3 and Step 4 behind the current Step 2 approval gate', () => {
        expect(clampWizardStepToCurrentStep2Approval(1, 'unapproved')).toBe(1);
        expect(clampWizardStepToCurrentStep2Approval(2, 'stale')).toBe(2);
        expect(clampWizardStepToCurrentStep2Approval(3, 'unapproved')).toBe(2);
        expect(clampWizardStepToCurrentStep2Approval(4, 'stale')).toBe(2);
        expect(clampWizardStepToCurrentStep2Approval(4, 'approved')).toBe(4);
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

    it('labels legacy A/B direction buckets with compact route variants for suffix-direction routes', () => {
        const grouped = buildSegmentsMapFromParsedData([
            {
                detectedDirection: 'A',
                segments: [
                    { segmentName: 'Park Place to Downtown', timeBuckets: {} },
                ],
            },
            {
                detectedDirection: 'B',
                segments: [
                    { segmentName: 'Downtown to Park Place', timeBuckets: {} },
                ],
            },
        ] as any);

        expect(getOrderedSegmentColumns(grouped, '2').map(column => column.groupLabel)).toEqual([
            '2A',
            '2B',
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

    it('keeps 30-minute segment columns in the preferred 2A then 2B travel order', () => {
        expect(
            alignOrderedSegmentColumnsToPreferredGroups(
                [
                    { segmentName: 'Downtown to Sproule', direction: 'South', groupLabel: '2B' },
                    { segmentName: 'Sproule to Park Place', direction: 'South', groupLabel: '2B' },
                    { segmentName: 'Park Place to Veteran', direction: 'North', groupLabel: '2A' },
                    { segmentName: 'Veteran to Downtown', direction: 'North', groupLabel: '2A' },
                ],
                [
                    { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '2A' },
                    { segmentName: 'Peggy Hill to Downtown', direction: 'North', groupLabel: '2A' },
                    { segmentName: 'Downtown to Peggy Hill', direction: 'South', groupLabel: '2B' },
                    { segmentName: 'Peggy Hill to Park Place', direction: 'South', groupLabel: '2B' },
                ]
            ).map(column => column.groupLabel)
        ).toEqual(['2A', '2A', '2B', '2B']);
    });

    it('orders fine stop-to-stop rows by the canonical end-to-end route chain', () => {
        expect(
            orderSegmentColumnsByCanonicalStops(
                [
                    { segmentName: 'Veteran\'s at Essa to Short Turn Terminal', direction: 'North', groupLabel: '2A' },
                    { segmentName: 'Cuthbert Street to Veteran\'s at Essa', direction: 'South', groupLabel: '2B' },
                    { segmentName: 'Veteran\'s at Essa to Cuthbert Street', direction: 'North', groupLabel: '2A' },
                    { segmentName: 'Park Place to Veteran\'s at Essa', direction: 'North', groupLabel: '2A' },
                    { segmentName: 'Sproule at Kraus to Cuthbert Street', direction: 'South', groupLabel: '2B' },
                ],
                {
                    North: ['Park Place', 'Veteran\'s at Essa', 'Cuthbert Street', 'Sproule at Kraus'],
                    South: ['Sproule at Kraus', 'Cuthbert Street', 'Veteran\'s at Essa', 'Park Place'],
                },
                [
                    { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '2A' },
                    { segmentName: 'Peggy Hill to Downtown', direction: 'North', groupLabel: '2A' },
                    { segmentName: 'Downtown to Peggy Hill', direction: 'South', groupLabel: '2B' },
                    { segmentName: 'Peggy Hill to Park Place', direction: 'South', groupLabel: '2B' },
                ],
                { excludeUnmatched: true }
            ).map(column => column.segmentName)
        ).toEqual([
            'Park Place to Veteran\'s at Essa',
            'Veteran\'s at Essa to Cuthbert Street',
            'Sproule at Kraus to Cuthbert Street',
            'Cuthbert Street to Veteran\'s at Essa',
        ]);
    });

    it('bridges the north chain into the south start stop when master tables start the return one stop late', () => {
        expect(
            getUsableCanonicalDirectionStops('7', {
                North: ['Park Place', 'Peggy Hill Community Centre', 'Allandale GO Station', 'Downtown', 'Georgian College'],
                South: ['Rose Street', 'Downtown (3)', 'Allandale GO Station (3)', 'Peggy Hill Community Centre (3)', 'Park Place (2)'],
            })
        ).toEqual({
            North: ['Park Place', 'Peggy Hill Community Centre', 'Allandale GO Station', 'Downtown', 'Georgian College', 'Rose Street'],
            South: ['Rose Street', 'Downtown (3)', 'Allandale GO Station (3)', 'Peggy Hill Community Centre (3)', 'Park Place (2)'],
        });
    });

    it('drops unusable one-sided master stop chains for bidirectional routes', () => {
        expect(
            getUsableCanonicalDirectionStops('7', {
                North: ['Park Place', 'Peggy Hill Community Centre', 'Allandale GO Station', 'Downtown', 'Georgian College'],
                South: [],
            })
        ).toBeUndefined();
    });

    it('keeps one-sided master stop chains for loop routes', () => {
        expect(
            getUsableCanonicalDirectionStops('10', {
                North: ['Downtown', 'Georgian College', 'Downtown'],
                South: [],
            })
        ).toEqual({
            North: ['Downtown', 'Georgian College', 'Downtown'],
            South: [],
        });
    });

    it('matches observed runtime labels onto canonical segment names', () => {
        const canonicalLookup = buildNormalizedSegmentNameLookup([
            'Park Place to Peggy Hill',
            'Downtown Hub to Arrive Rose Street',
            'Depart Rose Street to Georgian College',
            'Downtown (3) to Barrie South GO (2)',
            'Peggy Hill Community Centre (3) to Allandale GO Station (3)',
            'Allandale GO Station (3) to Rose Street',
        ]);

        expect(resolveCanonicalSegmentName('Park Pl to Peggy Hill', canonicalLookup)).toBe('Park Place to Peggy Hill');
        expect(resolveCanonicalSegmentName('Downtown Hub to Rose Street', canonicalLookup)).toBe('Downtown Hub to Arrive Rose Street');
        expect(resolveCanonicalSegmentName('Rose Street to Georgian Coll.', canonicalLookup)).toBe('Depart Rose Street to Georgian College');
        expect(resolveCanonicalSegmentName('Downtown to Barrie South GO', canonicalLookup)).toBe('Downtown (3) to Barrie South GO (2)');
        expect(resolveCanonicalSegmentName('Peggy Hill to Allandale Terminal', canonicalLookup)).toBe('Peggy Hill Community Centre (3) to Allandale GO Station (3)');
        expect(resolveCanonicalSegmentName('Allandale GO to Rose Street', canonicalLookup)).toBe('Allandale GO Station (3) to Rose Street');
    });

    it('normalizes common Barrie hub and entrance variants across routes', () => {
        expect(normalizeSegmentStopKey('Downtown Hub (Platform 2)')).toBe('downtown');
        expect(normalizeSegmentStopKey('Downtown Barrie Terminal')).toBe('downtown');
        expect(normalizeSegmentStopKey('Allandale Waterfront GO Station')).toBe('allandale');
        expect(normalizeSegmentStopKey('Barrie Allandale Transit Terminal Platform 13')).toBe('allandale');
        expect(normalizeSegmentStopKey('Barrie South GO Station')).toBe('barrie south go');
        expect(normalizeSegmentStopKey('Georgian Mall North Entrance')).toBe('georgian mall');
        expect(normalizeSegmentStopKey('Georgian College Main (330)')).toBe('georgian college');
        expect(normalizeSegmentStopKey('RVH Main Entrance')).toBe('rvh');
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

    it('builds a blocked Step 2 health report when a bidirectional route is missing a direction and has no complete buckets', () => {
        const report = buildStep2DataHealthReport({
            routeNumber: '7',
            analysis: [{
                timeBucket: '15:00 - 15:29',
                totalP50: 46,
                totalP80: 50,
                assignedBand: undefined,
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days',
                details: [
                    { segmentName: 'Park Place to Peggy Hill', p50: 12, p80: 14, n: 3 },
                    { segmentName: 'Peggy Hill to Allandale GO Station', p50: 14, p80: 16, n: 3 },
                ],
            }],
            segmentsMap: {
                North: [
                    { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Allandale GO Station', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Peggy Hill to Allandale GO Station', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Allandale GO Station to Downtown', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Downtown to Peggy Hill', direction: 'South', groupLabel: '7B' },
            ],
            performanceDiagnostics: {
                selectedRouteId: '7',
                canonicalRouteId: '7',
                filteredDayCount: 3,
                matchedRouteDayCount: 3,
                coarseEntryCount: 0,
                stopEntryCount: 5,
                tripEntryCount: 0,
                matchedRouteIds: ['7'],
                directions: ['North'],
                importedAt: '2026-03-24T12:00:00.000Z',
                runtimeLogicVersion: 1,
                isCurrentRuntimeLogic: false,
                usesLegacyRuntimeLogic: true,
            },
        });

        expect(report.status).toBe('blocked');
        expect(report.blockers).toContain('Only 1 of 2 directions were found for this route.');
        expect(report.blockers).toContain('No complete cycle buckets are currently available for scheduling.');
        expect(report.missingSegments).toEqual([
            'Allandale GO Station to Downtown',
            'Downtown to Peggy Hill',
        ]);
        expect(report.warnings).toContain('This performance import was built with older runtime logic. Re-importing is recommended.');
    });

    it('flags missing runtime logic metadata as a legacy performance import', () => {
        const report = buildStep2DataHealthReport({
            analysis: [{
                timeBucket: '06:30 - 06:59',
                totalP50: 17,
                totalP80: 19,
                assignedBand: 'C',
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days',
                details: [
                    { segmentName: "Park Place to Veteran's at Essa", p50: 5, p80: 6, n: 5 },
                    { segmentName: "Veteran's at Essa to Cuthbert Street", p50: 2, p80: 2, n: 5 },
                    { segmentName: 'Cuthbert Street to Sproule at Kraus', p50: 5, p80: 6, n: 5 },
                ],
            }],
            segmentsMap: {
                North: [
                    { segmentName: "Park Place to Veteran's at Essa", timeBuckets: {} },
                    { segmentName: "Veteran's at Essa to Cuthbert Street", timeBuckets: {} },
                    { segmentName: 'Cuthbert Street to Sproule at Kraus', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: "Park Place to Veteran's at Essa", direction: 'North', groupLabel: '2A' },
                { segmentName: "Veteran's at Essa to Cuthbert Street", direction: 'North', groupLabel: '2A' },
                { segmentName: 'Cuthbert Street to Sproule at Kraus', direction: 'North', groupLabel: '2A' },
            ],
            performanceDiagnostics: {
                selectedRouteId: '2',
                canonicalRouteId: '2',
                filteredDayCount: 5,
                matchedRouteDayCount: 5,
                coarseEntryCount: 0,
                stopEntryCount: 12,
                tripEntryCount: 0,
                matchedRouteIds: ['2A'],
                directions: ['North'],
                importedAt: '2026-03-24T12:00:00.000Z',
                isCurrentRuntimeLogic: false,
                usesLegacyRuntimeLogic: true,
            },
        });

        expect(report.status).toBe('warning');
        expect(report.warnings).toContain('This performance import was built with older runtime logic. Re-importing is recommended.');
    });

    it('builds a ready Step 2 health report when all segments and directions are present', () => {
        const report = buildStep2DataHealthReport({
            routeNumber: '7',
            analysis: [{
                timeBucket: '15:00 - 15:29',
                totalP50: 96,
                totalP80: 102,
                assignedBand: 'B',
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days',
                details: [
                    { segmentName: 'Park Place to Peggy Hill', p50: 14, p80: 16, n: 6 },
                    { segmentName: 'Peggy Hill to Allandale GO Station', p50: 16, p80: 18, n: 6 },
                    { segmentName: 'Allandale GO Station to Downtown', p50: 18, p80: 20, n: 6 },
                    { segmentName: 'Downtown to Peggy Hill', p50: 17, p80: 19, n: 6 },
                ],
            }],
            segmentsMap: {
                North: [
                    { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Allandale GO Station', timeBuckets: {} },
                ],
                South: [
                    { segmentName: 'Allandale GO Station to Downtown', timeBuckets: {} },
                    { segmentName: 'Downtown to Peggy Hill', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Peggy Hill to Allandale GO Station', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Allandale GO Station to Downtown', direction: 'South', groupLabel: '7B' },
                { segmentName: 'Downtown to Peggy Hill', direction: 'South', groupLabel: '7B' },
            ],
            performanceDiagnostics: {
                selectedRouteId: '7',
                canonicalRouteId: '7',
                filteredDayCount: 6,
                matchedRouteDayCount: 6,
                coarseEntryCount: 0,
                stopEntryCount: 12,
                tripEntryCount: 0,
                matchedRouteIds: ['7'],
                directions: ['North', 'South'],
                importedAt: '2026-03-24T12:00:00.000Z',
                runtimeLogicVersion: 2,
                isCurrentRuntimeLogic: true,
                usesLegacyRuntimeLogic: false,
            },
        });

        expect(report.status).toBe('ready');
        expect(report.blockers).toEqual([]);
        expect(report.warnings).toEqual([]);
        expect(report.completeBucketCount).toBe(1);
        expect(report.runtimeSourceSummary).toBe('stop-level');
    });

    it('builds an approved runtime model from the current Step 2 state', () => {
        const healthReport = buildStep2DataHealthReport({
            routeNumber: '7',
            analysis: [{
                timeBucket: '15:00 - 15:29',
                totalP50: 96,
                totalP80: 102,
                observedCycleP50: 98,
                observedCycleP80: 104,
                assignedBand: 'B',
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days',
                details: [
                    { segmentName: 'Park Place to Peggy Hill', p50: 14, p80: 16, n: 6 },
                    { segmentName: 'Peggy Hill to Allandale GO Station', p50: 16, p80: 18, n: 6 },
                    { segmentName: 'Allandale GO Station to Downtown', p50: 18, p80: 20, n: 6 },
                    { segmentName: 'Downtown to Peggy Hill', p50: 17, p80: 19, n: 6 },
                ],
            }],
            segmentsMap: {
                North: [
                    { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Allandale GO Station', timeBuckets: {} },
                ],
                South: [
                    { segmentName: 'Allandale GO Station to Downtown', timeBuckets: {} },
                    { segmentName: 'Downtown to Peggy Hill', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Peggy Hill to Allandale GO Station', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Allandale GO Station to Downtown', direction: 'South', groupLabel: '7B' },
                { segmentName: 'Downtown to Peggy Hill', direction: 'South', groupLabel: '7B' },
            ],
            performanceDiagnostics: {
                selectedRouteId: '7',
                canonicalRouteId: '7',
                filteredDayCount: 6,
                matchedRouteDayCount: 6,
                coarseEntryCount: 0,
                stopEntryCount: 12,
                tripEntryCount: 0,
                matchedRouteIds: ['7'],
                directions: ['North', 'South'],
                importedAt: '2026-03-24T12:00:00.000Z',
                runtimeLogicVersion: 2,
                isCurrentRuntimeLogic: true,
                usesLegacyRuntimeLogic: false,
            },
        });

        const model = buildApprovedRuntimeModel({
            dayType: 'Weekday',
            importMode: 'performance',
            routeNumber: '7',
            analysis: [{
                timeBucket: '15:00 - 15:29',
                totalP50: 96,
                totalP80: 102,
                observedCycleP50: 98,
                observedCycleP80: 104,
                assignedBand: 'B',
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days',
                details: [
                    { segmentName: 'Park Place to Peggy Hill', p50: 14, p80: 16, n: 6 },
                    { segmentName: 'Peggy Hill to Allandale GO Station', p50: 16, p80: 18, n: 6 },
                    { segmentName: 'Allandale GO Station to Downtown', p50: 18, p80: 20, n: 6 },
                    { segmentName: 'Downtown to Peggy Hill', p50: 17, p80: 19, n: 6 },
                ],
            }],
            bands: [{
                id: 'B',
                label: 'Band B',
                min: 90,
                max: 100,
                avg: 98,
                color: '#f97316',
                count: 1,
            }],
            segmentsMap: {
                North: [
                    { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Allandale GO Station', timeBuckets: {} },
                ],
                South: [
                    { segmentName: 'Allandale GO Station to Downtown', timeBuckets: {} },
                    { segmentName: 'Downtown to Peggy Hill', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Peggy Hill to Allandale GO Station', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Allandale GO Station to Downtown', direction: 'South', groupLabel: '7B' },
                { segmentName: 'Downtown to Peggy Hill', direction: 'South', groupLabel: '7B' },
            ],
            healthReport,
        });

        expect(model.status).toBe('ready');
        expect(model.chartBasis).toBe('observed-cycle');
        expect(model.usableBucketCount).toBe(1);
        expect(model.usableBandCount).toBe(1);
        expect(model.directions).toEqual(['North', 'South']);
        expect(model.bandPreviews).toEqual([
            { direction: 'North', bandId: 'B', avgTotal: 98, timeSlotCount: 1, segmentCount: 2 },
            { direction: 'South', bandId: 'B', avgTotal: 98, timeSlotCount: 1, segmentCount: 2 },
        ]);
    });

    it('surfaces stop-order fallback warnings in the Step 2 health report', () => {
        const report = buildStep2DataHealthReport({
            routeNumber: '12',
            analysis: [{
                timeBucket: '10:00 - 10:29',
                totalP50: 50,
                totalP80: 55,
                observedCycleP50: 50,
                observedCycleP80: 55,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days',
                details: [
                    { segmentName: 'Barrie South GO Station to Mapleview at Chef', p50: 5, p80: 6, n: 2 },
                    { segmentName: 'Mapleview at Chef to Georgian Mall', p50: 45, p80: 49, n: 2 },
                ],
            }],
            segmentsMap: {
                North: [
                    { segmentName: 'Barrie South GO Station to Mapleview at Chef', timeBuckets: {} },
                    { segmentName: 'Mapleview at Chef to Georgian Mall', timeBuckets: {} },
                ],
                South: [
                    { segmentName: 'Georgian Mall to Mapleview at Chef', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: 'Barrie South GO Station to Mapleview at Chef', direction: 'North', groupLabel: '12A' },
                { segmentName: 'Mapleview at Chef to Georgian Mall', direction: 'North', groupLabel: '12A' },
            ],
            stopOrder: {
                decision: 'review',
                confidence: 'low',
                sourceUsed: 'master-fallback',
                usedForPlanning: false,
                summary: 'Dynamic stop order returned review, so Step 2 kept the master stop chain for planning.',
                warnings: ['Dynamic stop order is review (low confidence).'],
                directionStats: {
                    North: { tripCountUsed: 4, dayCountUsed: 1, middayTripCount: 2 },
                },
            },
        });

        expect(report.status).toBe('warning');
        expect(report.stopOrder?.sourceUsed).toBe('master-fallback');
        expect(report.warnings).toContain('Dynamic stop order returned review, so Step 2 kept the master stop chain for planning.');
        expect(report.warnings).toContain('Dynamic stop order is review (low confidence).');
    });

    it('summarizes repaired and boundary-service buckets in the Step 2 health report', () => {
        const report = buildStep2DataHealthReport({
            routeNumber: '2',
            analysis: [
                {
                    timeBucket: '10:30 - 10:59',
                    totalP50: 65,
                    totalP80: 70,
                    assignedBand: 'C',
                    isOutlier: false,
                    ignored: false,
                    sampleCountMode: 'days',
                    coverageCause: 'repaired-single-gap',
                    repairedSegments: ['Jagges Drive to Edgehill at Ferndale'],
                    repairSourceBuckets: ['10:00 - 10:29', '11:00 - 11:29'],
                    details: [
                        { segmentName: 'A to B', p50: 20, p80: 21, n: 3 },
                        { segmentName: 'B to C', p50: 20, p80: 21, n: 3 },
                        { segmentName: 'C to D', p50: 25, p80: 28, n: 3 },
                    ],
                    expectedSegmentCount: 3,
                    observedSegmentCount: 3,
                    missingSegmentNames: [],
                },
                {
                    timeBucket: '05:30 - 05:59',
                    totalP50: 22,
                    totalP80: 26,
                    assignedBand: undefined,
                    isOutlier: false,
                    ignored: false,
                    sampleCountMode: 'days',
                    coverageCause: 'boundary-service',
                    details: [
                        { segmentName: 'B to C', p50: 10, p80: 12, n: 3 },
                    ],
                    expectedSegmentCount: 3,
                    observedSegmentCount: 1,
                    missingSegmentNames: ['A to B', 'C to D'],
                },
            ],
            segmentsMap: {
                North: [
                    { segmentName: 'A to B', timeBuckets: {} },
                    { segmentName: 'B to C', timeBuckets: {} },
                    { segmentName: 'C to D', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: 'A to B', direction: 'North', groupLabel: '2A' },
                { segmentName: 'B to C', direction: 'North', groupLabel: '2A' },
                { segmentName: 'C to D', direction: 'North', groupLabel: '2A' },
            ],
        });

        expect(report.repairedBucketCount).toBe(1);
        expect(report.boundaryBucketCount).toBe(1);
        expect(report.singleGapBucketCount).toBe(0);
        expect(report.warnings).toContain('1 near-complete bucket was repaired from adjacent complete buckets and marked as estimated.');
        expect(report.warnings).toContain('1 bucket reflects boundary service or short turns and remains excluded from banding.');
    });
});
