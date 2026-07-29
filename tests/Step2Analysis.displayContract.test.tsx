import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Step2Analysis } from '../components/NewSchedule/steps/Step2Analysis';

vi.mock('recharts', () => ({
    BarChart: ({ children }: { children?: React.ReactNode }): React.ReactElement => <div>{children}</div>,
    Bar: ({ children }: { children?: React.ReactNode }): React.ReactElement => <div>{children}</div>,
    XAxis: (): null => null,
    YAxis: (): null => null,
    CartesianGrid: (): null => null,
    Tooltip: (): null => null,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }): React.ReactElement => <div>{children}</div>,
    Cell: (): null => null,
    LabelList: (): null => null,
}));

describe('Step2Analysis display and planner actions', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) {
            flushSync(() => {
                root?.unmount();
            });
        }
        container?.remove();
        root = null;
        container = null;
    });

    it('switches displayed Step 2 runtime values to P80 while keeping the median-based band assignment', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2Analysis
                    dayType="Weekday"
                    routeNumber="10"
                    analysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 12,
                            totalP80: 14,
                            observedCycleP50: 12,
                            observedCycleP80: 14,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Stop A to Stop B', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Stop B to Stop C', p50: 7, p80: 8, n: 3 },
                            ],
                            expectedSegmentCount: 2,
                            observedSegmentCount: 2,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    bands={[
                        { id: 'A', label: 'Band A', min: 0, max: 15, avg: 12, color: '#2563eb', count: 1 },
                    ]}
                    setAnalysis={vi.fn()}
                    segmentsMap={{
                        North: [
                            { segmentName: 'Stop A to Stop B', timeBuckets: {} },
                            { segmentName: 'Stop B to Stop C', timeBuckets: {} },
                        ],
                    }}
                    canonicalSegmentColumns={[
                        { segmentName: 'Stop A to Stop B', direction: 'North', groupLabel: '10' },
                        { segmentName: 'Stop B to Stop C', direction: 'North', groupLabel: '10' },
                    ]}
                    healthReport={{
                        status: 'ready',
                        blockers: [],
                        warnings: [],
                        expectedDirections: 1,
                        matchedDirections: ['North'],
                        expectedSegmentCount: 2,
                        matchedSegmentCount: 2,
                        missingSegments: [],
                        completeBucketCount: 1,
                        incompleteBucketCount: 0,
                        lowConfidenceBucketCount: 0,
                        availableBucketCount: 1,
                        runtimeSourceSummary: 'uploaded-percentiles',
                        sampleCountMode: 'observations',
                        confidenceThreshold: 10,
                        usesLegacyRuntimeLogic: false,
                    }}
                />
            );
        });

        const bandSummaryToggle = container.querySelector('[data-testid="step2-view-band-summary"]') as HTMLButtonElement | null;
        expect(bandSummaryToggle).toBeTruthy();
        flushSync(() => {
            bandSummaryToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.textContent).toContain('Band A (12.0m evidence avg)');
        expect(container.textContent).toContain('weighted median (P50) summaries');

        const p80Toggle = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent?.includes('80th Percentile')
        ) as HTMLButtonElement | undefined;

        expect(p80Toggle).toBeTruthy();

        flushSync(() => {
            p80Toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.textContent).toContain('Band A (14.0m evidence avg)');
        expect(container.textContent).toContain('weighted reliable (P80) summaries');
        expect(container.textContent).toContain('Band A');
    });

    it('lets the planner exclude a bucket from Step 2 analysis', () => {
        const setAnalysis = vi.fn();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2Analysis
                    dayType="Weekday"
                    routeNumber="10"
                    analysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 12,
                            totalP80: 14,
                            observedCycleP50: 12,
                            observedCycleP80: 14,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Stop A to Stop B', p50: 5, p80: 6, n: 3 },
                            ],
                            expectedSegmentCount: 1,
                            observedSegmentCount: 1,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                        {
                            timeBucket: '07:00 - 07:29',
                            totalP50: 15,
                            totalP80: 17,
                            observedCycleP50: 15,
                            observedCycleP80: 17,
                            assignedBand: 'B',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Stop A to Stop B', p50: 6, p80: 7, n: 3 },
                            ],
                            expectedSegmentCount: 1,
                            observedSegmentCount: 1,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    bands={[
                        { id: 'A', label: 'Band A', min: 0, max: 15, avg: 12, color: '#2563eb', count: 1 },
                        { id: 'B', label: 'Band B', min: 15, max: 20, avg: 15, color: '#7c3aed', count: 1 },
                    ]}
                    setAnalysis={setAnalysis}
                    segmentsMap={{
                        North: [
                            { segmentName: 'Stop A to Stop B', timeBuckets: {} },
                        ],
                    }}
                    canonicalSegmentColumns={[
                        { segmentName: 'Stop A to Stop B', direction: 'North', groupLabel: '10' },
                    ]}
                    healthReport={{
                        status: 'ready',
                        blockers: [],
                        warnings: [],
                        expectedDirections: 1,
                        matchedDirections: ['North'],
                        expectedSegmentCount: 1,
                        matchedSegmentCount: 1,
                        missingSegments: [],
                        completeBucketCount: 2,
                        incompleteBucketCount: 0,
                        lowConfidenceBucketCount: 0,
                        availableBucketCount: 2,
                        runtimeSourceSummary: 'uploaded-percentiles',
                        sampleCountMode: 'observations',
                        confidenceThreshold: 10,
                        usesLegacyRuntimeLogic: false,
                    }}
                />
            );
        });

        const ignoreButton = Array.from(container.querySelectorAll('button')).find(
            (button) => button.getAttribute('title') === 'Ignore from analysis'
        ) as HTMLButtonElement | undefined;

        expect(ignoreButton).toBeTruthy();

        flushSync(() => {
            ignoreButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(setAnalysis).toHaveBeenCalledTimes(1);
        expect(setAnalysis).toHaveBeenCalledWith([
            expect.objectContaining({
                timeBucket: '06:30 - 06:59',
                ignored: true,
            }),
            expect.objectContaining({
                timeBucket: '07:00 - 07:29',
                ignored: false,
            }),
        ]);
    });
});
