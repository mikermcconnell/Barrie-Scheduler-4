import { describe, it, expect } from 'vitest';
import { calculateTotalTripTimes } from '../utils/ai/runtimeAnalysis';
import type { RuntimeData } from '../components/NewSchedule/utils/csvParser';

describe('runtimeAnalysis.calculateTotalTripTimes', () => {
    it('uses union of buckets across directions/files', () => {
        const north: RuntimeData = {
            segments: [
                {
                    segmentName: 'N1 to N2',
                    timeBuckets: {
                        '06:00': { p50: 10, p80: 12 },
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
                        '06:30': { p50: 20, p80: 22 },
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
                        '07:00': { p50: 10.4, p80: 12.6 },
                    },
                },
                {
                    segmentName: 'B to C',
                    timeBuckets: {
                        '07:00': { p50: 4.6, p80: 5.4 },
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
});
