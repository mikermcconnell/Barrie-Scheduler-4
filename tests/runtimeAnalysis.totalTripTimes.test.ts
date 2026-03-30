import { describe, it, expect } from 'vitest';
import {
    calculateTotalTripTimes,
    calculateBands,
    computeDirectionBandSummary,
    computeSegmentBreakdownByBand,
    hardenRuntimeAnalysisBuckets,
    getLowConfidenceThreshold,
    getAverageBandTotal,
    getBucketBandingTotal,
    getBucketDisplayedTotal,
    sumDisplayedSegmentTotals,
} from '../utils/ai/runtimeAnalysis';
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

    it('uses a 5-day confidence floor for performance-derived runtime buckets and preserves the sample floor for CSV-style inputs', () => {
        expect(getLowConfidenceThreshold('days')).toBe(5);
        expect(getLowConfidenceThreshold('observations')).toBe(10);

        const performanceData: RuntimeData = {
            segments: [
                {
                    segmentName: 'A to B',
                    timeBuckets: {
                        '06:00': { p50: 10, p80: 12, n: 5 },
                    },
                },
            ],
            allTimeBuckets: ['06:00'],
            detectedRouteNumber: '10',
            detectedDirection: 'North',
            sampleCountMode: 'days',
        };

        const csvData: RuntimeData = {
            segments: [
                {
                    segmentName: 'A to B',
                    timeBuckets: {
                        '06:00': { p50: 10, p80: 12, n: 10 },
                    },
                },
            ],
            allTimeBuckets: ['06:00'],
            detectedRouteNumber: '10',
            detectedDirection: 'North',
            sampleCountMode: 'observations',
        };

        const performanceAnalysis = calculateTotalTripTimes([performanceData]);
        const csvAnalysis = calculateTotalTripTimes([csvData]);

        expect(performanceAnalysis[0].sampleCountMode).toBe('days');
        expect(csvAnalysis[0].sampleCountMode).toBe('observations');
    });

    it('keeps the ten most recent contributing performance days on each bucket', () => {
        const days = Array.from({ length: 12 }, (_, index) => {
            const day = String(index + 1).padStart(2, '0');
            return {
                date: `2026-01-${day}`,
                runtime: index + 1,
            };
        });

        const data: RuntimeData[] = [{
            segments: [
                {
                    segmentName: 'A to B',
                    timeBuckets: {
                        '07:00': {
                            p50: 10,
                            p80: 12,
                            n: 12,
                            contributions: days.map(({ date, runtime }) => ({ date, runtime })),
                        },
                    },
                },
            ],
            allTimeBuckets: ['07:00'],
            detectedRouteNumber: '10',
            detectedDirection: 'North',
            sampleCountMode: 'days',
        }];

        const analysis = calculateTotalTripTimes(data);

        expect(analysis[0].contributingDays).toHaveLength(10);
        expect(analysis[0].contributingDays?.[0]).toEqual({ date: '2026-01-12', runtime: 12 });
        expect(analysis[0].contributingDays?.[9]).toEqual({ date: '2026-01-03', runtime: 3 });
        expect(analysis[0].observedCycleP50).toBe(6.5);
        expect(analysis[0].observedCycleP80).toBe(9.8);
    });

    it('prefers full observed cycle totals for displayed and banded values when performance day totals exist', () => {
        const data: RuntimeData[] = [{
            segments: [
                {
                    segmentName: 'A to B',
                    timeBuckets: {
                        '07:00': {
                            p50: 10,
                            p80: 20,
                            n: 3,
                            contributions: [
                                { date: '2026-01-01', runtime: 10 },
                                { date: '2026-01-02', runtime: 10 },
                                { date: '2026-01-03', runtime: 30 },
                            ],
                        },
                    },
                },
                {
                    segmentName: 'B to C',
                    timeBuckets: {
                        '07:00': {
                            p50: 10,
                            p80: 20,
                            n: 3,
                            contributions: [
                                { date: '2026-01-01', runtime: 10 },
                                { date: '2026-01-02', runtime: 30 },
                                { date: '2026-01-03', runtime: 10 },
                            ],
                        },
                    },
                },
                {
                    segmentName: 'C to D',
                    timeBuckets: {
                        '07:00': {
                            p50: 10,
                            p80: 20,
                            n: 3,
                            contributions: [
                                { date: '2026-01-01', runtime: 30 },
                                { date: '2026-01-02', runtime: 10 },
                                { date: '2026-01-03', runtime: 10 },
                            ],
                        },
                    },
                },
            ],
            allTimeBuckets: ['07:00'],
            detectedRouteNumber: '10',
            detectedDirection: 'North',
            sampleCountMode: 'days',
        }];

        const analysis = calculateTotalTripTimes(data);

        expect(analysis[0].totalP50).toBe(30);
        expect(analysis[0].observedCycleP50).toBe(50);
        expect(analysis[0].observedCycleP80).toBe(50);
        expect(getBucketBandingTotal(analysis[0])).toBe(50);
        expect(getBucketDisplayedTotal(analysis[0], 'p50')).toBe(50);
        expect(getBucketDisplayedTotal(analysis[0], 'p80')).toBe(50);
    });

    it('ignores partial day contributions when building observed full-cycle totals', () => {
        const data: RuntimeData[] = [{
            segments: [
                {
                    segmentName: 'A to B',
                    timeBuckets: {
                        '07:00': {
                            p50: 20,
                            p80: 22,
                            n: 3,
                            contributions: [
                                { date: '2026-01-01', runtime: 20 },
                                { date: '2026-01-02', runtime: 20 },
                                { date: '2026-01-03', runtime: 20 },
                            ],
                        },
                    },
                },
                {
                    segmentName: 'B to C',
                    timeBuckets: {
                        '07:00': {
                            p50: 30,
                            p80: 32,
                            n: 2,
                            contributions: [
                                { date: '2026-01-01', runtime: 30 },
                                { date: '2026-01-02', runtime: 30 },
                            ],
                        },
                    },
                },
            ],
            allTimeBuckets: ['07:00'],
            detectedRouteNumber: '10',
            detectedDirection: 'North',
            sampleCountMode: 'days',
        }];

        const analysis = calculateTotalTripTimes(data);

        expect(analysis[0].totalP50).toBe(50);
        expect(analysis[0].observedCycleP50).toBe(50);
        expect(analysis[0].observedCycleP80).toBe(50);
        expect(analysis[0].contributingDays).toEqual([
            { date: '2026-01-02', runtime: 50 },
            { date: '2026-01-01', runtime: 50 },
        ]);
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
        expect(analysis[0].expectedSegmentCount).toBe(2);
        expect(analysis[0].observedSegmentCount).toBe(2);
    });

    it('keeps incomplete buckets visible but excludes them from banding', () => {
        const data: RuntimeData[] = [{
            segments: [
                {
                    segmentName: 'A to B',
                    timeBuckets: {
                        '07:00 - 07:29': { p50: 10, p80: 12, n: 10 },
                        '07:30 - 07:59': { p50: 11, p80: 13, n: 10 },
                    },
                },
                {
                    segmentName: 'B to C',
                    timeBuckets: {
                        '07:00 - 07:29': { p50: 20, p80: 22, n: 10 },
                    },
                },
            ],
            allTimeBuckets: ['07:00 - 07:29', '07:30 - 07:59'],
            detectedRouteNumber: '10',
            detectedDirection: 'North',
        }];

        const analysis = calculateTotalTripTimes(data);
        const { buckets, bands } = calculateBands(analysis);

        expect(buckets).toHaveLength(2);
        expect(buckets[0].assignedBand).toBe('A');
        expect(buckets[1].totalP50).toBe(11);
        expect(buckets[1].observedSegmentCount).toBe(1);
        expect(buckets[1].expectedSegmentCount).toBe(2);
        expect(buckets[1].ignored).toBe(false);
        expect(buckets[1].assignedBand).toBeUndefined();
        expect(bands.find(band => band.id === 'A')?.count).toBe(1);
        expect(bands.find(band => band.id === 'A')?.avg).toBe(30);
    });

    it('bands performance buckets by full observed cycle totals when available', () => {
        const { buckets, bands } = calculateBands([
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 60,
                totalP80: 65,
                observedCycleP50: 45,
                observedCycleP80: 48,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 30, p80: 32, n: 5 },
                    { segmentName: 'B to C', p50: 30, p80: 33, n: 5 },
                ],
                expectedSegmentCount: 2,
                observedSegmentCount: 2,
            },
            {
                timeBucket: '06:30 - 06:59',
                totalP50: 40,
                totalP80: 45,
                observedCycleP50: 55,
                observedCycleP80: 58,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 20, p80: 22, n: 5 },
                    { segmentName: 'B to C', p50: 20, p80: 23, n: 5 },
                ],
                expectedSegmentCount: 2,
                observedSegmentCount: 2,
            },
        ]);

        expect(buckets.find(bucket => bucket.timeBucket === '06:30 - 06:59')?.assignedBand).toBe('A');
        expect(buckets.find(bucket => bucket.timeBucket === '06:00 - 06:29')?.assignedBand).toBe('B');
        expect(bands.find(band => band.id === 'A')?.avg).toBe(55);
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

    it('weights Step 2 segment breakdown averages by observation count after canonical matching', () => {
        const breakdown = computeSegmentBreakdownByBand(
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
            ['Park Place to Peggy Hill'],
            'p50'
        );

        expect(breakdown.A.segmentTotals['Park Place to Peggy Hill'].weightedSum).toBe(94);
        expect(breakdown.A.segmentTotals['Park Place to Peggy Hill'].totalWeight).toBe(10);
        expect(
            breakdown.A.segmentTotals['Park Place to Peggy Hill'].weightedSum
            / breakdown.A.segmentTotals['Park Place to Peggy Hill'].totalWeight
        ).toBeCloseTo(9.4, 5);
        expect(
            sumDisplayedSegmentTotals(['Park Place to Peggy Hill'], breakdown.A.segmentTotals)
        ).toBe(9);
    });

    it('preserves actual band-average totals separately from derived segment-display totals', () => {
        const breakdown = computeSegmentBreakdownByBand(
            [
                {
                    timeBucket: '06:00 - 06:29',
                    totalP50: 100,
                    totalP80: 100,
                    observedCycleP50: 120,
                    observedCycleP80: 130,
                    assignedBand: 'A',
                    isOutlier: false,
                    ignored: false,
                    details: [
                        { segmentName: 'A to B', p50: 0, p80: 0, n: 100 },
                        { segmentName: 'B to C', p50: 100, p80: 100, n: 1 },
                    ],
                },
                {
                    timeBucket: '06:30 - 06:59',
                    totalP50: 100,
                    totalP80: 100,
                    observedCycleP50: 120,
                    observedCycleP80: 130,
                    assignedBand: 'A',
                    isOutlier: false,
                    ignored: false,
                    details: [
                        { segmentName: 'A to B', p50: 100, p80: 100, n: 1 },
                        { segmentName: 'B to C', p50: 0, p80: 0, n: 100 },
                    ],
                },
            ],
            [
                { id: 'A', label: 'Band A', min: 100, max: 100, avg: 100, color: '#ef4444', count: 2 },
            ],
            ['A to B', 'B to C'],
            'p50'
        );

        expect(getAverageBandTotal(breakdown.A)).toBe(120);
        expect(sumDisplayedSegmentTotals(['A to B', 'B to C'], breakdown.A.segmentTotals)).toBe(2);
    });

    it('excludes incomplete buckets from downstream direction band summaries when they are unbanded', () => {
        const { buckets, bands } = calculateBands([
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 30,
                totalP80: 32,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 10, p80: 11, n: 10 },
                    { segmentName: 'B to C', p50: 20, p80: 21, n: 10 },
                ],
                expectedSegmentCount: 2,
                observedSegmentCount: 2,
            },
            {
                timeBucket: '06:30 - 06:59',
                totalP50: 12,
                totalP80: 14,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 12, p80: 14, n: 10 },
                ],
                expectedSegmentCount: 2,
                observedSegmentCount: 1,
            },
        ]);

        const summary = computeDirectionBandSummary(
            buckets,
            bands,
            {
                North: [
                    { segmentName: 'A to B' },
                    { segmentName: 'B to C' },
                ],
            }
        );

        expect(summary.North[0].timeSlots).toEqual(['06:00']);
        expect(summary.North[0].avgTotal).toBe(30);
        expect(summary.North[0].segments).toHaveLength(2);
    });

    it('repairs a single missing segment from adjacent complete buckets and marks the bucket as estimated', () => {
        const hardened = hardenRuntimeAnalysisBuckets([
            {
                timeBucket: '10:00 - 10:29',
                totalP50: 30,
                totalP80: 34,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 10, p80: 12, n: 4 },
                    { segmentName: 'B to C', p50: 20, p80: 22, n: 4 },
                ],
                expectedSegmentCount: 2,
                observedSegmentCount: 2,
            },
            {
                timeBucket: '10:30 - 10:59',
                totalP50: 11,
                totalP80: 13,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 11, p80: 13, n: 4 },
                ],
                expectedSegmentCount: 2,
                observedSegmentCount: 1,
            },
            {
                timeBucket: '11:00 - 11:29',
                totalP50: 33,
                totalP80: 37,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 12, p80: 14, n: 4 },
                    { segmentName: 'B to C', p50: 21, p80: 23, n: 4 },
                ],
                expectedSegmentCount: 2,
                observedSegmentCount: 2,
            },
        ], ['A to B', 'B to C']);

        expect(hardened[1].coverageCause).toBe('repaired-single-gap');
        expect(hardened[1].missingSegmentNames).toEqual([]);
        expect(hardened[1].repairedSegments).toEqual(['B to C']);
        expect(hardened[1].repairSourceBuckets).toEqual(['10:00 - 10:29', '11:00 - 11:29']);
        expect(hardened[1].observedSegmentCount).toBe(2);
        expect(hardened[1].totalP50).toBe(32);
        expect(hardened[1].totalP80).toBe(36);
        expect(hardened[1].details.find(detail => detail.segmentName === 'B to C')?.p50).toBe(21);

        const { buckets } = calculateBands(hardened);
        expect(buckets[1].assignedBand).toBeTruthy();
    });

    it('classifies missing edge-only coverage as boundary service', () => {
        const hardened = hardenRuntimeAnalysisBuckets([
            {
                timeBucket: '05:30 - 05:59',
                totalP50: 25,
                totalP80: 28,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'B to C', p50: 12, p80: 13, n: 2 },
                    { segmentName: 'C to D', p50: 13, p80: 15, n: 2 },
                ],
                expectedSegmentCount: 4,
                observedSegmentCount: 2,
            },
        ], ['A to B', 'B to C', 'C to D', 'D to E']);

        expect(hardened[0].coverageCause).toBe('boundary-service');
        expect(hardened[0].missingSegmentNames).toEqual(['A to B', 'D to E']);
    });

    it('repairs a small contiguous internal gap when adjacent complete buckets bracket it', () => {
        const hardened = hardenRuntimeAnalysisBuckets([
            {
                timeBucket: '12:00 - 12:29',
                totalP50: 40,
                totalP80: 45,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 10, p80: 11, n: 4 },
                    { segmentName: 'B to C', p50: 11, p80: 12, n: 4 },
                    { segmentName: 'C to D', p50: 9, p80: 10, n: 4 },
                    { segmentName: 'D to E', p50: 10, p80: 12, n: 4 },
                ],
                expectedSegmentCount: 4,
                observedSegmentCount: 4,
            },
            {
                timeBucket: '12:30 - 12:59',
                totalP50: 20,
                totalP80: 23,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 10, p80: 11, n: 4 },
                    { segmentName: 'D to E', p50: 10, p80: 12, n: 4 },
                ],
                expectedSegmentCount: 4,
                observedSegmentCount: 2,
            },
            {
                timeBucket: '13:00 - 13:29',
                totalP50: 44,
                totalP80: 49,
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'A to B', p50: 11, p80: 12, n: 4 },
                    { segmentName: 'B to C', p50: 12, p80: 13, n: 4 },
                    { segmentName: 'C to D', p50: 10, p80: 11, n: 4 },
                    { segmentName: 'D to E', p50: 11, p80: 13, n: 4 },
                ],
                expectedSegmentCount: 4,
                observedSegmentCount: 4,
            },
        ], ['A to B', 'B to C', 'C to D', 'D to E']);

        expect(hardened[1].coverageCause).toBe('repaired-single-gap');
        expect(hardened[1].repairedSegments).toEqual(['B to C', 'C to D']);
        expect(hardened[1].repairSourceBuckets).toEqual(['12:00 - 12:29', '13:00 - 13:29']);
        expect(hardened[1].observedSegmentCount).toBe(4);
        expect(hardened[1].totalP50).toBe(42);
        expect(hardened[1].totalP80).toBe(47);
        expect(hardened[1].details.find(detail => detail.segmentName === 'B to C')?.p50).toBe(12);
        expect(hardened[1].details.find(detail => detail.segmentName === 'C to D')?.p50).toBe(10);
    });
});
