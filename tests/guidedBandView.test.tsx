import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { TimeBand, TripBucketAnalysis } from '../utils/ai/runtimeAnalysis';
import {
    buildBandedRuntimeSpread,
    buildGuidedBandSummary,
    buildGuidedBucketRows,
    findInferredSource,
    toggleGuidedBucket,
} from '../components/GuidedSchedule/runtimeReview/guidedBandView';
import { excludeLowDayBuckets } from '../components/GuidedSchedule/runtimeReview/buildRuntimeReviewModel';
import { GuidedStep2Review } from '../components/GuidedSchedule/GuidedStep2Review';

const bucket = (timeBucket: string, total: number, overrides: Partial<TripBucketAnalysis> = {}): TripBucketAnalysis => ({
    timeBucket,
    totalP50: total,
    totalP80: total + 3,
    assignedBand: 'C',
    isOutlier: false,
    ignored: false,
    details: [{ segmentName: 'A to B', p50: total, p80: total + 3, n: 6 }],
    expectedSegmentCount: 1,
    observedSegmentCount: 1,
    sampleCountMode: 'days',
    contributingDays: ['01', '02', '03', '04', '05', '06'].map(day => ({ date: `2026-09-${day}`, runtime: total })),
    evidence: { kind: 'paired-cycle', qualifyingCount: 6, requiredCount: 5, planningEligible: true, exclusionReasons: [] },
    ...overrides,
} as TripBucketAnalysis);

const bands: TimeBand[] = [
    { id: 'A', label: 'Band A (Slowest)', min: 58, max: 59, avg: 58.4, color: '#ef4444', count: 2 },
    { id: 'B', label: 'Band B', min: 0, max: 0, avg: 0, color: '#f97316', count: 0 },
    { id: 'C', label: 'Band C', min: 52, max: 52, avg: 52, color: '#eab308', count: 1 },
    { id: 'D', label: 'Band D', min: 0, max: 0, avg: 0, color: '#84cc16', count: 0 },
    { id: 'E', label: 'Band E (Fastest)', min: 45, max: 45, avg: 45, color: '#22c55e', count: 1 },
];

describe('guided band view', () => {
    it('shows each bucket with its band, colour and evidence days', () => {
        const rows = buildGuidedBucketRows([
            bucket('07:00 - 07:29', 52.4),
            bucket('08:00 - 08:29', 71, { ignored: true, assignedBand: undefined }),
        ], bands);
        expect(rows[0]).toMatchObject({ label: '07:00–07:29', minutes: 52, band: 'C', color: '#eab308', qualifyingDays: 6 });
        expect(rows[1]).toMatchObject({ band: null, color: null, ignored: true });
    });

    it('summarises each band; empty bands show no runtime', () => {
        const summary = buildGuidedBandSummary(bands);
        expect(summary[0]).toEqual({ id: 'A', color: '#ef4444', minutes: 58, minMinutes: 58, maxMinutes: 59, bucketCount: 2 });
        expect(summary[1].minutes).toBeNull();
    });

    it('shows P80 and the real cycle median beside the P50 the schedule uses', () => {
        const [row] = buildGuidedBucketRows([
            bucket('16:30 - 16:59', 50, { totalP80: 60, observedCycleP80: 57, observedCycleP50: 54 }),
        ], bands);
        expect(row).toMatchObject({ minutes: 50, p80Minutes: 57, observedCycleMinutes: 54 });
        expect(buildGuidedBucketRows([bucket('07:00 - 07:29', 50)], bands)[0].observedCycleMinutes).toBeNull();
    });

    it('measures the P50 spread across banded buckets only', () => {
        const rows = buildGuidedBucketRows([
            bucket('07:00 - 07:29', 52, { assignedBand: 'A' }),
            bucket('07:30 - 07:59', 50, { assignedBand: 'E' }),
            bucket('08:00 - 08:29', 90, { ignored: true, assignedBand: undefined }),
        ], bands);
        expect(buildBandedRuntimeSpread(rows)).toBe(2);
        expect(buildBandedRuntimeSpread([])).toBeNull();
    });

    it('excludes and restores eligible buckets but never restores weak evidence', () => {
        const analysis = [bucket('07:00 - 07:29', 52)];
        const excluded = toggleGuidedBucket(analysis, '07:00 - 07:29');
        expect(excluded[0].ignored).toBe(true);
        expect(toggleGuidedBucket(excluded, '07:00 - 07:29')[0].ignored).toBe(false);

        const weak = [bucket('21:00 - 21:29', 45, {
            ignored: true,
            evidence: { kind: 'paired-cycle', qualifyingCount: 3, requiredCount: 5, planningEligible: false, exclusionReasons: ['Too few days'] },
        })];
        expect(toggleGuidedBucket(weak, '21:00 - 21:29')[0].ignored).toBe(true);
        expect(buildGuidedBucketRows(weak, bands)[0].canRestore).toBe(false);
    });

    it('shows the banded bucket an excluded bucket borrows from, earlier bucket on a tie', () => {
        const rows = buildGuidedBucketRows([
            bucket('19:00 - 19:29', 67, { assignedBand: 'E' }),
            bucket('19:30 - 19:59', 69, { ignored: true, assignedBand: undefined }),
            bucket('20:00 - 20:29', 58, { assignedBand: 'A' }),
        ], bands);
        expect(rows[0].inferredFrom).toBeNull();
        expect(rows[1].inferredFrom).toEqual({ timeBucket: '19:00 - 19:29', label: '19:00–19:29', minutes: 67, band: 'E', color: '#22c55e' });
    });

    it('borrows across midnight and skips other unbanded buckets', () => {
        expect(findInferredSource('23:30', [
            { timeBucket: '00:00', band: 'C' },
            { timeBucket: '23:00', band: null },
            { timeBucket: '21:00', band: 'A' },
        ])?.timeBucket).toBe('00:00');
        expect(findInferredSource('19:30', [{ timeBucket: '19:30', band: null }])).toBeNull();
    });
});

describe('excludeLowDayBuckets', () => {
    it('starts paired-cycle buckets under 5 days excluded and leaves the rest', () => {
        const result = excludeLowDayBuckets([
            bucket('19:30 - 19:59', 69, { assignedBand: undefined, evidence: { kind: 'paired-cycle', qualifyingCount: 2, requiredCount: 5, planningEligible: false, exclusionReasons: [] } }),
            bucket('20:00 - 20:29', 67, { evidence: { kind: 'paired-cycle', qualifyingCount: 5, requiredCount: 5, planningEligible: true, exclusionReasons: [] } }),
            bucket('21:00 - 21:29', 63, { evidence: { kind: 'uploaded-percentiles', qualifyingCount: 2, requiredCount: 10, planningEligible: false, exclusionReasons: [] } }),
        ]);
        expect(result.map(entry => entry.ignored)).toEqual([true, false, false]);
    });
});

describe('GuidedStep2Review', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) flushSync(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
    });

    it('excludes a bucket from the evidence table and switches orientation', () => {
        const onAnalysisChange = vi.fn();
        const onDirectionChange = vi.fn();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => root?.render(
            <GuidedStep2Review
                dayType="Weekday"
                analysis={[bucket('07:00 - 07:29', 52)]}
                bands={bands}
                onAnalysisChange={onAnalysisChange}
                orientationCounts={{ North: 1, South: 1 }}
                selectedDirection="North"
                onDirectionChange={onDirectionChange}
            />
        ));
        const table = container.querySelector('[aria-label="Bucket evidence"]');
        expect(table?.textContent).toContain('07:00–07:29');
        const exclude = Array.from(table?.querySelectorAll('button') ?? []).find(button => button.textContent === 'Exclude');
        flushSync(() => exclude?.click());
        expect(onAnalysisChange.mock.calls[0][0][0].ignored).toBe(true);

        const south = Array.from(container.querySelectorAll('[role="tab"]')).find(tab => tab.textContent === 'South-start') as HTMLButtonElement;
        flushSync(() => south.click());
        expect(onDirectionChange).toHaveBeenCalledWith('South');
    });

    it('notes which bucket an excluded bucket will use', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => root?.render(
            <GuidedStep2Review
                dayType="Weekday"
                analysis={[
                    bucket('19:00 - 19:29', 67, { assignedBand: 'E' }),
                    bucket('19:30 - 19:59', 69, { ignored: true, assignedBand: undefined }),
                ]}
                bands={bands}
                onAnalysisChange={vi.fn()}
                selectedDirection="North"
                onDirectionChange={vi.fn()}
            />
        ));
        const table = container.querySelector('[aria-label="Bucket evidence"]');
        expect(table?.textContent).toContain('uses 19:00–19:29 · 67 min');
        expect(container.querySelector('[aria-label^="19:30–19:59"]')?.getAttribute('aria-label'))
            .toContain('trips starting here use 19:00–19:29 (67 min, band E)');
    });
});
