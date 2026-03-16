import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../utils/schedule/scheduleGenerator';
import { computeDirectionBandSummary } from '../utils/ai/runtimeAnalysis';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { TripBucketAnalysis, TimeBand } from '../utils/ai/runtimeAnalysis';
import type { SegmentRawData } from '../components/NewSchedule/utils/csvParser';

describe('scheduleGenerator canonical travel times', () => {
    it('uses canonical master stops and preserves direction-specific observed runtimes', () => {
        const config: ScheduleConfig = {
            routeNumber: '7',
            cycleMode: 'Floating',
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
    });
});
