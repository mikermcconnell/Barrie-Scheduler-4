import { describe, expect, it } from 'vitest';
import { generateSchedule, MissingApprovedRuntimeError } from '../utils/schedule/scheduleGenerator';
import { computeDirectionBandSummary } from '../utils/ai/runtimeAnalysis';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { TripBucketAnalysis, TimeBand } from '../utils/ai/runtimeAnalysis';
import type { SegmentRawData } from '../components/NewSchedule/utils/csvParser';

describe('scheduleGenerator canonical travel times', () => {
    const trustedBucket: TripBucketAnalysis = {
        timeBucket: '06:00 - 06:29', totalP50: 10, totalP80: 12, assignedBand: 'A',
        isOutlier: false, ignored: false,
        details: [{ segmentName: 'A to B', p50: 10, p80: 12, n: 10 }],
        expectedSegmentCount: 1,
        observedSegmentCount: 1,
        sampleCountMode: 'observations',
        evidence: { kind: 'uploaded-percentiles', qualifyingCount: 10, requiredCount: 10, planningEligible: true, exclusionReasons: [] },
    };

    const makePairedBucket = (
        timeBucket: string,
        northMinutes: number,
        southMinutes: number
    ): TripBucketAnalysis => ({
        timeBucket,
        totalP50: northMinutes + southMinutes,
        totalP80: northMinutes + southMinutes + 4,
        assignedBand: 'A',
        isOutlier: false,
        ignored: false,
        details: [
            { segmentName: 'A to B', p50: northMinutes, p80: northMinutes + 2, n: 5 },
            { segmentName: 'B to A', p50: southMinutes, p80: southMinutes + 2, n: 5 },
        ],
        expectedSegmentCount: 2,
        observedSegmentCount: 2,
        sampleCountMode: 'days',
        contributingDays: [
            { date: '2026-01-01', runtime: northMinutes + southMinutes },
            { date: '2026-01-02', runtime: northMinutes + southMinutes },
            { date: '2026-01-03', runtime: northMinutes + southMinutes },
            { date: '2026-01-04', runtime: northMinutes + southMinutes },
            { date: '2026-01-05', runtime: northMinutes + southMinutes },
        ],
        evidence: { kind: 'paired-cycle', qualifyingCount: 5, requiredCount: 5, planningEligible: true, exclusionReasons: [] },
    });

    const pairedBands: TimeBand[] = [
        { id: 'A', label: 'A', min: 55, max: 55, avg: 55, color: '#000', count: 1 },
    ];
    const pairedSummary = {
        North: [{ bandId: 'A', color: '#000', avgTotal: 35, segments: [{ segmentName: 'A to B', avgTime: 35, totalN: 5 }], timeSlots: ['06:00'] }],
        South: [{ bandId: 'A', color: '#000', avgTotal: 20, segments: [{ segmentName: 'B to A', avgTime: 20, totalN: 5 }], timeSlots: ['06:00'] }],
    };
    const pairedSegments = {
        North: [{ segmentName: 'A to B', timeBuckets: {} }],
        South: [{ segmentName: 'B to A', timeBuckets: {} }],
    };
    const pairedStops = { North: ['A', 'B'], South: ['B', 'A'] };

    it('uses an exact trusted bucket and falls back to it when a nearby half hour is missing', () => {
        const bands: TimeBand[] = [{ id: 'A', label: 'A', min: 10, max: 10, avg: 10, color: '#000', count: 1 }];
        const summary = { North: [{ bandId: 'A', color: '#000', avgTotal: 10, segments: [{ segmentName: 'A to B', avgTime: 10, totalN: 10 }], timeSlots: ['06:00'] }] };
        const segments = { North: [{ segmentName: 'A to B', timeBuckets: {} }] };
        const base = { routeNumber: '1', cycleMode: 'Floating' as const, cycleTime: 0, recoveryRatio: 0, blocks: [{ id: '1-1', startTime: '06:00', endTime: '06:09' }] };

        expect(generateSchedule(base, [trustedBucket], bands, summary, segments, 'Weekday', undefined, undefined, { North: ['A', 'B'] }, undefined, { strictApprovedRuntime: true })).toHaveLength(1);
        const fallbackTables = generateSchedule(
            { ...base, blocks: [{ id: '1-1', startTime: '06:30', endTime: '06:39' }] },
            [trustedBucket], bands, summary, segments, 'Weekday', undefined, undefined,
            { North: ['A', 'B'] }, undefined, { strictApprovedRuntime: true }
        );

        expect(fallbackTables[0].trips[0].travelTime).toBe(10);
        expect(fallbackTables[0].trips[0].runtimeSourceBreakdown).toEqual({
            'A to B': 'approved-nearest-bucket[06:00-for-06:30]',
        });
    });

    it('uses only eligible buckets and prefers the earlier bucket when distance is tied', () => {
        const buckets: TripBucketAnalysis[] = [
            trustedBucket,
            {
                ...trustedBucket,
                timeBucket: '06:30 - 06:59',
                details: [{ segmentName: 'A to B', p50: 99, p80: 99, n: 2 }],
                evidence: { kind: 'uploaded-percentiles', qualifyingCount: 2, requiredCount: 10, planningEligible: true, exclusionReasons: [] },
            },
            {
                ...trustedBucket,
                timeBucket: '07:00 - 07:29',
                details: [{ segmentName: 'A to B', p50: 20, p80: 22, n: 10 }],
            },
        ];
        const tables = generateSchedule(
            {
                routeNumber: '1', cycleMode: 'Floating', cycleTime: 0, recoveryRatio: 0,
                blocks: [{ id: '1-1', startTime: '06:30', endTime: '06:39' }],
            },
            buckets,
            pairedBands,
            { North: [{ bandId: 'A', color: '#000', avgTotal: 15, segments: [], timeSlots: ['06:00', '07:00'] }] },
            { North: [{ segmentName: 'A to B', timeBuckets: {} }] },
            'Weekday',
            undefined,
            undefined,
            { North: ['A', 'B'] },
            undefined,
            { strictApprovedRuntime: true }
        );

        expect(tables[0].trips[0].travelTime).toBe(10);
        expect(tables[0].trips[0].runtimeSourceBreakdown?.['A to B']).toBe(
            'approved-nearest-bucket[06:00-for-06:30]'
        );
    });

    it('finds the nearest eligible bucket across midnight', () => {
        const buckets: TripBucketAnalysis[] = [
            {
                ...trustedBucket,
                timeBucket: '23:30 - 23:59',
                details: [{ segmentName: 'A to B', p50: 12, p80: 14, n: 10 }],
            },
            {
                ...trustedBucket,
                timeBucket: '01:00 - 01:29',
                details: [{ segmentName: 'A to B', p50: 20, p80: 22, n: 10 }],
            },
        ];
        const tables = generateSchedule(
            {
                routeNumber: '1', cycleMode: 'Floating', cycleTime: 0, recoveryRatio: 0,
                blocks: [{ id: '1-1', startTime: '00:00', endTime: '00:09' }],
            },
            buckets,
            pairedBands,
            { North: [{ bandId: 'A', color: '#000', avgTotal: 16, segments: [], timeSlots: ['23:30', '01:00'] }] },
            { North: [{ segmentName: 'A to B', timeBuckets: {} }] },
            'Weekday',
            undefined,
            undefined,
            { North: ['A', 'B'] },
            undefined,
            { strictApprovedRuntime: true }
        );

        expect(tables[0].trips[0].travelTime).toBe(12);
        expect(tables[0].trips[0].runtimeSourceBreakdown?.['A to B']).toBe(
            'approved-nearest-bucket[23:30-for-00:00]'
        );
    });

    it('revalidates strict bucket evidence instead of trusting a stored planning flag', () => {
        const malformedBucket: TripBucketAnalysis = {
            ...trustedBucket,
            sampleCountMode: undefined,
        };
        const base = {
            routeNumber: '1', cycleMode: 'Floating' as const, cycleTime: 0, recoveryRatio: 0,
            blocks: [{ id: '1-1', startTime: '06:00', endTime: '06:09' }],
        };

        expect(() => generateSchedule(
            base,
            [malformedBucket],
            pairedBands,
            { North: [{ bandId: 'A', color: '#000', avgTotal: 10, segments: [], timeSlots: ['06:00'] }] },
            { North: [{ segmentName: 'A to B', timeBuckets: {} }] },
            'Weekday',
            undefined,
            undefined,
            { North: ['A', 'B'] },
            undefined,
            { strictApprovedRuntime: true }
        )).toThrow(MissingApprovedRuntimeError);
    });

    it('reuses the North cycle-start bucket when the paired South leg crosses a half hour', () => {
        const tables = generateSchedule(
            {
                routeNumber: '1', cycleMode: 'Strict', cycleTime: 70, recoveryRatio: 0,
                blocks: [{ id: '1-1', startTime: '06:00', endTime: '07:09' }],
            },
            [
                makePairedBucket('06:00 - 06:29', 35, 20),
                makePairedBucket('06:30 - 06:59', 35, 99),
            ],
            pairedBands,
            pairedSummary,
            pairedSegments,
            'Weekday',
            undefined,
            undefined,
            pairedStops,
            undefined,
            { strictApprovedRuntime: true, approvedBucketMode: 'paired-cycle-start' }
        );

        expect(tables.find(table => table.routeName.includes('(North)'))?.trips[0].travelTime).toBe(35);
        expect(tables.find(table => table.routeName.includes('(South)'))?.trips[0].startTime).toBe(395);
        expect(tables.find(table => table.routeName.includes('(South)'))?.trips[0].travelTime).toBe(20);
    });

    it('does not require an adjacent South-departure bucket for a trusted paired cycle', () => {
        const tables = generateSchedule(
            {
                routeNumber: '1', cycleMode: 'Strict', cycleTime: 70, recoveryRatio: 0,
                blocks: [{ id: '1-1', startTime: '06:00', endTime: '07:09' }],
            },
            [makePairedBucket('06:00 - 06:29', 35, 20)],
            pairedBands,
            pairedSummary,
            pairedSegments,
            'Weekday',
            undefined,
            undefined,
            pairedStops,
            undefined,
            { strictApprovedRuntime: true, approvedBucketMode: 'paired-cycle-start' }
        );

        expect(tables.find(table => table.routeName.includes('(South)'))?.trips).toHaveLength(1);
    });

    it('fails closed when a paired performance block starts South without an approved South-start cycle', () => {
        expect(() => generateSchedule(
            {
                routeNumber: '1', cycleMode: 'Strict', cycleTime: 60, recoveryRatio: 0,
                blocks: [{ id: '1-1', startTime: '06:00', endTime: '06:59', startStop: 'B', startDirection: 'South' }],
            },
            [makePairedBucket('06:00 - 06:29', 30, 20)],
            pairedBands,
            pairedSummary,
            pairedSegments,
            'Weekday',
            undefined,
            undefined,
            pairedStops,
            undefined,
            { strictApprovedRuntime: true, approvedBucketMode: 'paired-cycle-start' }
        )).toThrow(/No trusted runtime for South 06:00/);
    });

    it('uses an independently approved South-start cycle for both paired legs', () => {
        const southStartBucket = makePairedBucket('06:00 - 06:29', 30, 20);
        const tables = generateSchedule(
            {
                routeNumber: '1', cycleMode: 'Strict', cycleTime: 60, recoveryRatio: 0,
                blocks: [{ id: '1-1', startTime: '06:00', endTime: '06:59', startStop: 'B', startDirection: 'South' }],
            },
            [makePairedBucket('06:00 - 06:29', 99, 99)],
            pairedBands,
            pairedSummary,
            pairedSegments,
            'Weekday',
            undefined,
            undefined,
            pairedStops,
            { South: [southStartBucket] },
            { strictApprovedRuntime: true, approvedBucketMode: 'paired-cycle-start' }
        );

        expect(tables.find(table => table.routeName.includes('(South)'))?.trips[0].travelTime).toBe(20);
        expect(tables.find(table => table.routeName.includes('(North)'))?.trips[0].travelTime).toBe(30);
    });

    it('uses the nearest independently approved South-start cycle for both paired legs', () => {
        const southStartBucket = makePairedBucket('06:30 - 06:59', 30, 20);
        const tables = generateSchedule(
            {
                routeNumber: '1', cycleMode: 'Strict', cycleTime: 60, recoveryRatio: 0,
                blocks: [{ id: '1-1', startTime: '06:00', endTime: '06:59', startStop: 'B', startDirection: 'South' }],
            },
            [makePairedBucket('06:00 - 06:29', 99, 99)],
            pairedBands,
            pairedSummary,
            pairedSegments,
            'Weekday',
            undefined,
            undefined,
            pairedStops,
            { South: [southStartBucket] },
            { strictApprovedRuntime: true, approvedBucketMode: 'paired-cycle-start' }
        );

        const southTrip = tables.find(table => table.routeName.includes('(South)'))?.trips[0];
        const northTrip = tables.find(table => table.routeName.includes('(North)'))?.trips[0];
        expect(southTrip?.travelTime).toBe(20);
        expect(northTrip?.travelTime).toBe(30);
        expect(southTrip?.runtimeSourceBreakdown?.['B to A']).toBe(
            'approved-nearest-bucket[06:30-for-06:00]'
        );
        expect(northTrip?.runtimeSourceBreakdown?.['A to B']).toBe(
            'approved-nearest-bucket[06:30-for-06:00]'
        );
    });

    it('preserves exact overnight paired-cycle lookup across midnight', () => {
        const overnightBucket = makePairedBucket('23:30 - 23:59', 30, 20);
        const tables = generateSchedule(
            {
                routeNumber: '1', cycleMode: 'Strict', cycleTime: 60, recoveryRatio: 0,
                blocks: [{ id: '1-1', startTime: '23:30', endTime: '00:20' }],
            },
            [overnightBucket],
            pairedBands,
            pairedSummary,
            pairedSegments,
            'Weekday',
            undefined,
            undefined,
            pairedStops,
            undefined,
            { strictApprovedRuntime: true, approvedBucketMode: 'paired-cycle-start' }
        );

        expect(tables.find(table => table.routeName.includes('(North)'))?.trips[0].startTime).toBe(1410);
        expect(tables.find(table => table.routeName.includes('(South)'))?.trips[0].startTime).toBe(1440);
        expect(tables.find(table => table.routeName.includes('(South)'))?.trips[0].travelTime).toBe(20);
    });

    it('keeps loop routes on exact trip-start buckets overnight', () => {
        const loopSegments = { Loop: [{ segmentName: 'A to A', timeBuckets: {} }] };
        const loopBuckets = [
            { ...trustedBucket, timeBucket: '23:30 - 23:59', details: [{ segmentName: 'A to A', p50: 10, p80: 12, n: 10 }] },
            { ...trustedBucket, timeBucket: '00:00 - 00:29', details: [{ segmentName: 'A to A', p50: 20, p80: 22, n: 10 }] },
        ];
        const tables = generateSchedule(
            {
                routeNumber: '10', cycleMode: 'Strict', cycleTime: 30, recoveryRatio: 0,
                blocks: [{ id: '10-1', startTime: '23:30', endTime: '00:15' }],
            },
            loopBuckets,
            pairedBands,
            { Loop: [{ bandId: 'A', color: '#000', avgTotal: 15, segments: [], timeSlots: ['23:30', '00:00'] }] },
            loopSegments,
            'Weekday',
            undefined,
            undefined,
            { Loop: ['A', 'A'] },
            undefined,
            { strictApprovedRuntime: true, approvedBucketMode: 'paired-cycle-start' }
        );

        expect(tables[0].trips.map(trip => trip.travelTime)).toEqual([10, 20]);
    });

    it('uses canonical master stops and preserves direction-specific observed runtimes', () => {
        const config: ScheduleConfig = {
            routeNumber: '7',
            cycleMode: 'Floating',
            cycleTime: 0,
            recoveryRatio: 0,
            blocks: [
                { id: '7-1', startTime: '06:00', endTime: '06:40', startStop: 'Park Place' },
            ],
        };

        const buckets: TripBucketAnalysis[] = [
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 32,
                totalP80: 36,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'Park Pl to Peggy Hill', p50: 4, p80: 5, n: 10 },
                    { segmentName: 'Peggy Hill to Georgian Coll.', p50: 6, p80: 7, n: 10 },
                    { segmentName: 'Georgian Coll. to Peggy Hill', p50: 10, p80: 11, n: 10 },
                    { segmentName: 'Peggy Hill to Park Pl', p50: 12, p80: 13, n: 10 },
                ],
            },
        ];

        const bands: TimeBand[] = [
            { id: 'A', label: 'Band A', min: 32, max: 32, avg: 32, color: '#ef4444', count: 1 },
        ];

        const segmentsMap: Record<string, SegmentRawData[]> = {
            North: [
                { segmentName: 'Park Pl to Peggy Hill', timeBuckets: { '06:00 - 06:29': { p50: 4, p80: 5, n: 10 } } },
                { segmentName: 'Peggy Hill to Georgian Coll.', timeBuckets: { '06:00 - 06:29': { p50: 6, p80: 7, n: 10 } } },
            ],
            South: [
                { segmentName: 'Georgian Coll. to Peggy Hill', timeBuckets: { '06:00 - 06:29': { p50: 10, p80: 11, n: 10 } } },
                { segmentName: 'Peggy Hill to Park Pl', timeBuckets: { '06:00 - 06:29': { p50: 12, p80: 13, n: 10 } } },
            ],
        };

        const canonicalSegmentColumns = [
            { segmentName: 'Park Place to Peggy Hill', direction: 'North' as const },
            { segmentName: 'Peggy Hill to Georgian College', direction: 'North' as const },
            { segmentName: 'Georgian College to Peggy Hill', direction: 'South' as const },
            { segmentName: 'Peggy Hill to Park Place', direction: 'South' as const },
        ];

        const canonicalTimepointsMap = {
            North: ['Park Place', 'Peggy Hill', 'Georgian College'],
            South: ['Georgian College', 'Peggy Hill', 'Park Place'],
        };

        const bandSummary = computeDirectionBandSummary(
            buckets,
            bands,
            segmentsMap,
            { canonicalSegmentColumns }
        );

        const tables = generateSchedule(
            config,
            buckets,
            bands,
            bandSummary,
            segmentsMap,
            'Weekday',
            undefined,
            undefined,
            canonicalTimepointsMap
        );

        const northTable = tables.find(table => table.routeName.includes('(North)'));
        const southTable = tables.find(table => table.routeName.includes('(South)'));

        expect(northTable?.stops).toEqual(canonicalTimepointsMap.North);
        expect(southTable?.stops).toEqual(canonicalTimepointsMap.South);
        expect(northTable?.trips[0].travelTime).toBe(10);
        expect(southTable?.trips[0].travelTime).toBe(22);
        expect(northTable?.trips[0].stopMinutes?.['Peggy Hill']).toBe(364);
        expect(northTable?.trips[0].runtimeSourceSummary).toContain('band:2');
        expect(northTable?.trips[0].runtimeSourceBreakdown).toEqual({
            'Park Place to Peggy Hill': 'band',
            'Peggy Hill to Georgian College': 'band',
        });
    });
});
