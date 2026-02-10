import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../utils/scheduleGenerator';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { TripBucketAnalysis, TimeBand, DirectionBandSummary } from '../utils/runtimeAnalysis';
import type { SegmentRawData } from '../components/NewSchedule/utils/csvParser';

describe('scheduleGenerator floating mode defaults', () => {
    it('generates without cycleTime and defaults recovery ratio to 15%', () => {
        const config: ScheduleConfig = {
            routeNumber: '99',
            cycleMode: 'Floating',
            cycleTime: 0,
            blocks: [
                {
                    id: '99-1',
                    startTime: '06:00',
                    endTime: '06:40'
                }
            ]
        };

        const buckets: TripBucketAnalysis[] = [
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 20,
                totalP80: 25,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [{ segmentName: 'Start to End', p50: 20, p80: 25 }]
            }
        ];

        const bands: TimeBand[] = [
            { id: 'A', label: 'Band A', min: 20, max: 20, avg: 20, color: '#ef4444', count: 1 }
        ];

        const bandSummary: DirectionBandSummary = {
            North: [
                {
                    bandId: 'A',
                    color: '#ef4444',
                    avgTotal: 20,
                    segments: [{ segmentName: 'Start to End', avgTime: 20 }],
                    timeSlots: ['06:00']
                }
            ]
        };

        const segmentsMap: Record<string, SegmentRawData[]> = {
            North: [
                {
                    segmentName: 'Start to End',
                    timeBuckets: {
                        '06:00 - 06:29': { p50: 20, p80: 25 }
                    }
                }
            ]
        };

        const tables = generateSchedule(config, buckets, bands, bandSummary, segmentsMap, 'Weekday');

        expect(tables.length).toBe(1);
        expect(tables[0].trips.length).toBeGreaterThan(0);
        expect(tables[0].trips[0].recoveryTime).toBe(3); // 15% of 20 minutes
    });

    it('generates trips for blocks that end after midnight', () => {
        const config: ScheduleConfig = {
            routeNumber: '99',
            cycleMode: 'Strict',
            cycleTime: 30,
            blocks: [
                {
                    id: '99-overnight-1',
                    startTime: '23:50',
                    endTime: '00:30'
                }
            ]
        };

        const buckets: TripBucketAnalysis[] = [
            {
                timeBucket: '23:30 - 23:59',
                totalP50: 20,
                totalP80: 25,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [{ segmentName: 'Start to End', p50: 20, p80: 25 }]
            }
        ];

        const bands: TimeBand[] = [
            { id: 'A', label: 'Band A', min: 20, max: 20, avg: 20, color: '#ef4444', count: 1 }
        ];

        const bandSummary: DirectionBandSummary = {
            North: [
                {
                    bandId: 'A',
                    color: '#ef4444',
                    avgTotal: 20,
                    segments: [{ segmentName: 'Start to End', avgTime: 20 }],
                    timeSlots: ['23:30']
                }
            ]
        };

        const segmentsMap: Record<string, SegmentRawData[]> = {
            North: [
                {
                    segmentName: 'Start to End',
                    timeBuckets: {
                        '23:30 - 23:59': { p50: 20, p80: 25 }
                    }
                }
            ]
        };

        const tables = generateSchedule(config, buckets, bands, bandSummary, segmentsMap, 'Weekday');

        expect(tables.length).toBe(1);
        expect(tables[0].trips.length).toBeGreaterThan(0);
        // At least one trip should be late night (near/after midnight in operational minutes).
        expect(tables[0].trips.some(t => t.startTime >= 1430)).toBe(true);
    });
});
