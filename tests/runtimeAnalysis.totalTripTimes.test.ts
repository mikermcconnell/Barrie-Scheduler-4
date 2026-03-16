import { describe, it, expect } from 'vitest';
import { calculateTotalTripTimes, computeDirectionBandSummary } from '../utils/ai/runtimeAnalysis';
import type { RuntimeData } from '../components/NewSchedule/utils/csvParser';

describe('runtimeAnalysis.calculateTotalTripTimes', () => {
    it('uses union of buckets across directions/files', () => {
        const north: RuntimeData = {
            segments: [
                {
                    segmentName: 'N1 to N2',
                    timeBuckets: {
                        '06:00': { p50: 10, p80: 12, n: 10 },
                    },
                },
            ],
            allTimeBuckets: ['06:00'],
            detectedRouteNumber: '10',
            detectedDirection: 'North',
        };

        const south: RuntimeData = {
            segments: [
                {
                    segmentName: 'S1 to S2',
                    timeBuckets: {
                        '06:30': { p50: 20, p80: 22, n: 10 },
                    },
                },
            ],
            allTimeBuckets: ['06:30'],
            detectedRouteNumber: '10',
            detectedDirection: 'South',
        };

        const analysis = calculateTotalTripTimes([north, south]);
        expect(analysis.map(a => a.timeBucket)).toEqual(['06:00', '06:30']);
        expect(analysis[0].totalP50).toBe(10);
        expect(analysis[1].totalP50).toBe(20);
    });

    it('sums rounded segment runtimes for each bucket', () => {
        const data: RuntimeData[] = [{
            segments: [
                {
                    segmentName: 'A to B',
                    timeBuckets: {
                        '07:00': { p50: 10.4, p80: 12.6, n: 10 },
                    },
                },
                {
                    segmentName: 'B to C',
                    timeBuckets: {
                        '07:00': { p50: 4.6, p80: 5.4, n: 10 },
                    },
                },
            ],
            allTimeBuckets: ['07:00'],
            detectedRouteNumber: '10',
            detectedDirection: 'North',
        }];

        const analysis = calculateTotalTripTimes(data);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].totalP50).toBe(15); // 10 + 5
        expect(analysis[0].totalP80).toBe(18); // 13 + 5
        expect(analysis[0].ignored).toBe(false);
    });

    it('maps observed labels onto canonical segments and weights averages by observation count', () => {
        const summary = computeDirectionBandSummary(
            [
                {
                    timeBucket: '06:00 - 06:29',
                    totalP50: 20,
                    totalP80: 22,
                    assignedBand: 'A',
                    isOutlier: false,
                    ignored: false,
                    details: [
                        { segmentName: 'Park Pl to Peggy Hill', p50: 4, p80: 5, n: 1 },
                    ],
                },
                {
                    timeBucket: '06:30 - 06:59',
                    totalP50: 20,
                    totalP80: 22,
                    assignedBand: 'A',
                    isOutlier: false,
                    ignored: false,
                    details: [
                        { segmentName: 'Park Place to Peggy Hill', p50: 10, p80: 11, n: 9 },
                    ],
                },
            ],
            [
                { id: 'A', label: 'Band A', min: 20, max: 20, avg: 20, color: '#ef4444', count: 2 },
            ],
            {
                North: [
                    { segmentName: 'Park Pl to Peggy Hill' },
                ],
            },
            {
                canonicalSegmentColumns: [
                    { segmentName: 'Park Place to Peggy Hill', direction: 'North' },
                ],
            }
        );

        expect(summary.North).toHaveLength(1);
        expect(summary.North[0].segments).toHaveLength(1);
        expect(summary.North[0].segments[0].segmentName).toBe('Park Place to Peggy Hill');
        expect(summary.North[0].segments[0].avgTime).toBeCloseTo(9.4, 5);
        expect(summary.North[0].segments[0].totalN).toBe(10);
    });
});
