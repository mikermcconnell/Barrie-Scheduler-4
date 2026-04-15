import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../utils/schedule/scheduleGenerator';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { DirectionBandSummary, TimeBand, TripBucketAnalysis } from '../utils/ai/runtimeAnalysis';
import type { SegmentRawData } from '../components/NewSchedule/utils/csvParser';

const buildSingleDirectionFixtures = (
    segmentA: number,
    segmentB: number
): {
    config: ScheduleConfig;
    buckets: TripBucketAnalysis[];
    bands: TimeBand[];
    bandSummary: DirectionBandSummary;
    segmentsMap: Record<string, SegmentRawData[]>;
} => ({
    config: {
        routeNumber: '99',
        cycleMode: 'Floating',
        cycleTime: 0,
        recoveryRatio: 0,
        blocks: [
            {
                id: '99-1',
                startTime: '06:00',
                endTime: '06:25',
            }
        ]
    },
    buckets: [
        {
            timeBucket: '06:00 - 06:29',
            totalP50: segmentA + segmentB,
            totalP80: segmentA + segmentB,
            assignedBand: 'A',
            isOutlier: false,
            ignored: false,
            details: [
                { segmentName: 'A to B', p50: segmentA, p80: segmentA, n: 10 },
                { segmentName: 'B to C', p50: segmentB, p80: segmentB, n: 10 },
            ]
        }
    ],
    bands: [
        { id: 'A', label: 'Band A', min: segmentA + segmentB, max: segmentA + segmentB, avg: segmentA + segmentB, color: '#ef4444', count: 1 }
    ],
    bandSummary: {
        North: [
            {
                bandId: 'A',
                color: '#ef4444',
                avgTotal: segmentA + segmentB,
                segments: [
                    { segmentName: 'A to B', avgTime: segmentA, totalN: 100 },
                    { segmentName: 'B to C', avgTime: segmentB, totalN: 100 },
                ],
                timeSlots: ['06:00']
            }
        ]
    },
    segmentsMap: {
        North: [
            {
                segmentName: 'A to B',
                timeBuckets: {
                    '06:00 - 06:29': { p50: segmentA, p80: segmentA, n: 10 }
                }
            },
            {
                segmentName: 'B to C',
                timeBuckets: {
                    '06:00 - 06:29': { p50: segmentB, p80: segmentB, n: 10 }
                }
            }
        ]
    }
});

describe('scheduleGenerator locked logic', () => {
    it('rounds each segment before summing full-trip travel time', () => {
        const fixtures = buildSingleDirectionFixtures(10.6, 10.6);

        const tables = generateSchedule(
            fixtures.config,
            fixtures.buckets,
            fixtures.bands,
            fixtures.bandSummary,
            fixtures.segmentsMap,
            'Weekday'
        );

        const trip = tables[0].trips[0];
        expect(trip.travelTime).toBe(22);
        expect(trip.cycleTime).toBe(22);
        expect(trip.stopMinutes?.['B']).toBe(371);
        expect(trip.stopMinutes?.['C']).toBe(382);
    });

    it('rounds only the active segments when a block starts mid-route', () => {
        const fixtures = buildSingleDirectionFixtures(9.4, 10.6);
        fixtures.config.blocks = [
            {
                id: '99-1',
                startTime: '06:00',
                endTime: '06:15',
                startStop: 'B'
            }
        ];

        const tables = generateSchedule(
            fixtures.config,
            fixtures.buckets,
            fixtures.bands,
            fixtures.bandSummary,
            fixtures.segmentsMap,
            'Weekday'
        );

        const trip = tables[0].trips[0];
        expect(trip.startStopIndex).toBe(1);
        expect(trip.travelTime).toBe(11);
        expect(trip.cycleTime).toBe(11);
        expect(trip.stops['A']).toBeUndefined();
        expect(trip.stopMinutes?.['B']).toBe(360);
        expect(trip.stopMinutes?.['C']).toBe(371);
    });
});
