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
}));

describe('Step2Analysis', () => {
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

    it('starts with the large info cards hidden and shows the bucket-total row in the segment matrix', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                    <Step2Analysis
                        dayType="Weekday"
                        routeNumber="12"
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
                            {
                                timeBucket: '07:00 - 07:29',
                                totalP50: 9,
                                totalP80: 10,
                                observedCycleP50: 9,
                                observedCycleP80: 10,
                                assignedBand: 'B',
                                isOutlier: false,
                                ignored: false,
                                details: [
                                    { segmentName: 'Stop A to Stop B', p50: 4, p80: 5, n: 2 },
                                ],
                                expectedSegmentCount: 2,
                                observedSegmentCount: 1,
                                sampleCountMode: 'observations',
                                contributingDays: [],
                            },
                        ]}
                        matrixAnalysis={[
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
                                    { segmentName: 'Stop A to Stop B', p50: 3, p80: 4, n: 2 },
                                    { segmentName: 'Stop B to Stop C', p50: 4, p80: 5, n: 2 },
                                    { segmentName: 'Stop C to Stop D', p50: 5, p80: 6, n: 2 },
                                ],
                                expectedSegmentCount: 3,
                                observedSegmentCount: 3,
                                sampleCountMode: 'observations',
                                contributingDays: [],
                            },
                            {
                                timeBucket: '07:00 - 07:29',
                                totalP50: 9,
                                totalP80: 10,
                                observedCycleP50: 9,
                                observedCycleP80: 10,
                                assignedBand: 'B',
                                isOutlier: false,
                                ignored: false,
                                details: [
                                    { segmentName: 'Stop A to Stop B', p50: 2, p80: 3, n: 1 },
                                    { segmentName: 'Stop B to Stop C', p50: 3, p80: 3.5, n: 1 },
                                ],
                                expectedSegmentCount: 3,
                                observedSegmentCount: 2,
                                sampleCountMode: 'observations',
                                contributingDays: [],
                            },
                        ]}
                        bands={[
                            { id: 'A', label: 'Slowest', min: 0, max: 15, avg: 12, color: '#ef4444', count: 1 },
                            { id: 'B', label: 'Next', min: 15, max: 30, avg: 18, color: '#f97316', count: 1 },
                        ]}
                        setAnalysis={vi.fn()}
                        segmentsMap={{
                            North: [
                                {
                                    segmentName: 'Stop A to Stop B',
                                    timeBuckets: {},
                                },
                                {
                                    segmentName: 'Stop B to Stop C',
                                    timeBuckets: {},
                                },
                            ],
                        }}
                        matrixSegmentsMap={{
                            North: [
                                {
                                    segmentName: 'Stop A to Stop B',
                                    timeBuckets: {},
                                },
                                {
                                    segmentName: 'Stop B to Stop C',
                                    timeBuckets: {},
                                },
                                {
                                    segmentName: 'Stop C to Stop D',
                                    timeBuckets: {},
                                },
                            ],
                        }}
                        canonicalSegmentColumns={[
                            { segmentName: 'Stop A to Stop B', direction: 'North', groupLabel: 'North' },
                            { segmentName: 'Stop B to Stop C', direction: 'North', groupLabel: 'North' },
                        ]}
                        healthReport={{
                            status: 'warning',
                            blockers: [],
                            warnings: ['Dynamic stop order returned review, so Step 2 kept the master stop chain for planning.'],
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
                            expectedDirections: 2,
                            matchedDirections: ['North'],
                            expectedSegmentCount: 2,
                            matchedSegmentCount: 2,
                            missingSegments: [],
                            completeBucketCount: 1,
                            incompleteBucketCount: 1,
                            lowConfidenceBucketCount: 1,
                            availableBucketCount: 2,
                            runtimeSourceSummary: 'No matched runtime source',
                            confidenceThreshold: 10,
                            usesLegacyRuntimeLogic: false,
                        }}
                    />
            );
        });

        expect(container.textContent).not.toContain('Runtime source');
        expect(container.textContent).not.toContain('Generation basis');
        expect(container.querySelector('[data-testid="step2-band-summary-view"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="step2-segment-matrix-view"]')).toBeNull();

        const dataHealthToggle = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent?.includes('Show route readiness details')
        ) as HTMLButtonElement | undefined;
        expect(dataHealthToggle).toBeTruthy();

        const runtimeModelToggle = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent?.includes('Show generation-ready runtime details')
        ) as HTMLButtonElement | undefined;
        expect(runtimeModelToggle).toBeTruthy();

        flushSync(() => {
            dataHealthToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            runtimeModelToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.textContent).toContain('Runtime source');
        expect(container.textContent).toContain('Generation basis');
        expect(container.textContent).toContain('Stop-order decision');
        expect(container.textContent).toContain('Fallback in use');

        const matrixToggle = container.querySelector('[data-testid="step2-view-segment-matrix"]') as HTMLButtonElement | null;
        expect(matrixToggle).toBeTruthy();

        flushSync(() => {
            matrixToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.querySelector('[data-testid="step2-band-summary-view"]')).toBeNull();
        expect(container.querySelector('[data-testid="step2-segment-matrix-view"]')).toBeTruthy();
        expect(container.textContent).toContain('Stop-to-Stop by 30-Minute Bucket');
        expect(container.textContent).toContain('Bucket total');
        expect(container.textContent).toContain('12.0 min');
        expect(container.textContent).toContain('9.0 min');

        const goodCell = container.querySelector('[data-testid="step2-matrix-cell-06-30-06-59-stop-a-to-stop-b"]');
        expect(goodCell?.textContent).toContain('3');
        expect(goodCell?.textContent).toContain('n=2');

        const missingCell = container.querySelector('[data-testid="step2-matrix-cell-07-00-07-29-stop-c-to-stop-d"]');
        expect(missingCell?.textContent).toContain('missing');

        const fineLegCell = container.querySelector('[data-testid="step2-matrix-cell-06-30-06-59-stop-c-to-stop-d"]');
        expect(fineLegCell?.textContent).toContain('5');
    });

    it('orders the 30-minute matrix rows by the canonical end-to-end route chain', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2Analysis
                    dayType="Weekday"
                    routeNumber="2"
                    analysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 20,
                            totalP80: 24,
                            observedCycleP50: 20,
                            observedCycleP80: 24,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Park Place to Veteran', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Veteran to Cuthbert', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Sproule to Cuthbert', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Cuthbert to Veteran', p50: 5, p80: 6, n: 3 },
                            ],
                            expectedSegmentCount: 4,
                            observedSegmentCount: 4,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    matrixAnalysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 20,
                            totalP80: 24,
                            observedCycleP50: 20,
                            observedCycleP80: 24,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Cuthbert to Veteran', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Veteran to Cuthbert', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Park Place to Veteran', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Sproule to Cuthbert', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Veteran to Short Turn', p50: 2, p80: 3, n: 3 },
                            ],
                            expectedSegmentCount: 5,
                            observedSegmentCount: 5,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    bands={[
                        { id: 'A', label: 'Band A', min: 0, max: 30, avg: 20, color: '#ef4444', count: 1 },
                    ]}
                    setAnalysis={vi.fn()}
                    segmentsMap={{
                        North: [
                            { segmentName: 'Park Place to Veteran', timeBuckets: {} },
                            { segmentName: 'Veteran to Cuthbert', timeBuckets: {} },
                        ],
                        South: [
                            { segmentName: 'Sproule to Cuthbert', timeBuckets: {} },
                            { segmentName: 'Cuthbert to Veteran', timeBuckets: {} },
                        ],
                    }}
                    matrixSegmentsMap={{
                        South: [
                            { segmentName: 'Cuthbert to Veteran', timeBuckets: {}, fromRouteStopIndex: 2, toRouteStopIndex: 3 },
                            { segmentName: 'Sproule to Cuthbert', timeBuckets: {}, fromRouteStopIndex: 1, toRouteStopIndex: 2 },
                        ],
                        North: [
                            { segmentName: 'Veteran to Cuthbert', timeBuckets: {}, fromRouteStopIndex: 2, toRouteStopIndex: 3 },
                            { segmentName: 'Park Place to Veteran', timeBuckets: {}, fromRouteStopIndex: 1, toRouteStopIndex: 2 },
                            { segmentName: 'Veteran to Short Turn', timeBuckets: {}, fromRouteStopIndex: 2, toRouteStopIndex: 99 },
                        ],
                    }}
                    canonicalSegmentColumns={[
                        { segmentName: 'Park Place to Downtown', direction: 'North', groupLabel: '2A' },
                        { segmentName: 'Downtown to Park Place', direction: 'South', groupLabel: '2B' },
                    ]}
                    canonicalDirectionStops={{
                        North: ['Park Place', 'Veteran', 'Cuthbert', 'Downtown'],
                        South: ['Downtown', 'Sproule', 'Cuthbert', 'Veteran', 'Park Place'],
                    }}
                />
            );
        });

        const matrixToggle = container.querySelector('[data-testid="step2-view-segment-matrix"]') as HTMLButtonElement | null;
        flushSync(() => {
            matrixToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const rowHeaders = Array.from(
            container.querySelectorAll('[data-testid="step2-segment-matrix-view"] tbody tr')
        )
            .filter(row => row.querySelector('[data-testid^="step2-matrix-cell-"]'))
            .map(row => row.querySelector('td:first-child')?.textContent?.replace(/\s+/g, ' ').trim() || '');

        expect(container.querySelector('[data-testid="step2-matrix-section-2a"]')?.textContent).toContain('Outbound bus path');
        expect(container.querySelector('[data-testid="step2-matrix-section-2b"]')?.textContent).toContain('Return bus path');
        expect(rowHeaders).toEqual([
            expect.stringContaining('Park Place'),
            expect.stringContaining('Veteran'),
            expect.stringContaining('Sproule'),
            expect.stringContaining('Cuthbert'),
        ]);
        expect(rowHeaders.some(header => header.includes('Short Turn'))).toBe(false);
    });

    it('keeps fine stop-to-stop rows in the 30-minute matrix when the canonical chain is coarser timepoints', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2Analysis
                    dayType="Weekday"
                    routeNumber="2"
                    analysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 20,
                            totalP80: 24,
                            observedCycleP50: 20,
                            observedCycleP80: 24,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Park Place to Downtown', p50: 20, p80: 24, n: 3 },
                            ],
                            expectedSegmentCount: 1,
                            observedSegmentCount: 1,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    matrixAnalysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 20,
                            totalP80: 24,
                            observedCycleP50: 20,
                            observedCycleP80: 24,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Park Place to Veteran', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Veteran to Cuthbert', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Cuthbert to Downtown', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Downtown to Sproule', p50: 5, p80: 6, n: 3 },
                            ],
                            expectedSegmentCount: 4,
                            observedSegmentCount: 4,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    bands={[
                        { id: 'A', label: 'Band A', min: 0, max: 30, avg: 20, color: '#ef4444', count: 1 },
                    ]}
                    setAnalysis={vi.fn()}
                    segmentsMap={{
                        North: [
                            { segmentName: 'Park Place to Downtown', timeBuckets: {} },
                        ],
                    }}
                    matrixSegmentsMap={{
                        North: [
                            { segmentName: 'Park Place to Veteran', timeBuckets: {}, fromRouteStopIndex: 1, toRouteStopIndex: 2 },
                            { segmentName: 'Veteran to Cuthbert', timeBuckets: {}, fromRouteStopIndex: 2, toRouteStopIndex: 3 },
                            { segmentName: 'Cuthbert to Downtown', timeBuckets: {}, fromRouteStopIndex: 3, toRouteStopIndex: 4 },
                        ],
                        South: [
                            { segmentName: 'Downtown to Sproule', timeBuckets: {}, fromRouteStopIndex: 1, toRouteStopIndex: 2 },
                        ],
                    }}
                    canonicalSegmentColumns={[
                        { segmentName: 'Park Place to Downtown', direction: 'North', groupLabel: '2A' },
                        { segmentName: 'Downtown to Park Place', direction: 'South', groupLabel: '2B' },
                    ]}
                    canonicalDirectionStops={{
                        North: ['Park Place', 'Downtown'],
                        South: ['Downtown', 'Park Place'],
                    }}
                />
            );
        });

        const matrixToggle = container.querySelector('[data-testid="step2-view-segment-matrix"]') as HTMLButtonElement | null;
        flushSync(() => {
            matrixToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const rowHeaders = Array.from(
            container.querySelectorAll('[data-testid="step2-segment-matrix-view"] tbody tr')
        )
            .filter(row => row.querySelector('[data-testid^="step2-matrix-cell-"]'))
            .map(row => row.querySelector('td:first-child')?.textContent?.replace(/\s+/g, ' ').trim() || '');

        expect(container.textContent).toContain('Full route only');
        expect(container.textContent).toContain('Partial / short turns removed');
        expect(rowHeaders).toEqual([
            expect.stringContaining('Park Place'),
            expect.stringContaining('Veteran'),
            expect.stringContaining('Cuthbert'),
            expect.stringContaining('Sproule'),
        ]);
        expect(rowHeaders.some(header => header.includes('Park Place to Downtown'))).toBe(false);
    });

    it('blocks the troubleshooting matrix when only a fallback partial path is available', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2Analysis
                    dayType="Weekday"
                    routeNumber="2"
                    analysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 20,
                            totalP80: 24,
                            observedCycleP50: 20,
                            observedCycleP80: 24,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Park Place to Downtown', p50: 20, p80: 24, n: 3 },
                            ],
                            expectedSegmentCount: 1,
                            observedSegmentCount: 1,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    matrixAnalysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 20,
                            totalP80: 24,
                            observedCycleP50: 20,
                            observedCycleP80: 24,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Sproule at Kraus to Pringle at Sproule', p50: 4, p80: 5, n: 1 },
                            ],
                            expectedSegmentCount: 1,
                            observedSegmentCount: 1,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    bands={[
                        { id: 'A', label: 'Band A', min: 0, max: 30, avg: 20, color: '#ef4444', count: 1 },
                    ]}
                    setAnalysis={vi.fn()}
                    segmentsMap={{
                        North: [
                            { segmentName: 'Park Place to Downtown', timeBuckets: {} },
                        ],
                    }}
                    matrixSegmentsMap={{
                        North: [
                            { segmentName: 'Sproule at Kraus to Pringle at Sproule', timeBuckets: {}, fromRouteStopIndex: 1, toRouteStopIndex: 2 },
                        ],
                    }}
                    troubleshootingPatternWarning="Troubleshooting view could not confirm a full anchored route pattern for North. The stop-by-stop matrix is hidden until a confirmed full-route path is available."
                />
            );
        });

        const matrixToggle = container.querySelector('[data-testid="step2-view-segment-matrix"]') as HTMLButtonElement | null;
        flushSync(() => {
            matrixToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.querySelector('[data-testid="step2-troubleshooting-warning"]')?.textContent).toContain('Troubleshooting view fallback');
        expect(container.querySelector('[data-testid="step2-troubleshooting-blocked"]')?.textContent).toContain('Full-route troubleshooting path not confirmed');
        expect(container.textContent).not.toContain('Sproule at Kraus');
    });

    it('keeps approval actions in the footer and removes the in-page acknowledgement gate', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2Analysis
                    dayType="Weekday"
                    routeNumber="7"
                    analysis={[
                        {
                            timeBucket: '06:30 - 06:59',
                            totalP50: 20,
                            totalP80: 24,
                            observedCycleP50: 20,
                            observedCycleP80: 24,
                            assignedBand: 'A',
                            isOutlier: false,
                            ignored: false,
                            details: [
                                { segmentName: 'Park Place to Peggy Hill', p50: 5, p80: 6, n: 3 },
                                { segmentName: 'Peggy Hill to Allandale GO Station', p50: 5, p80: 6, n: 3 },
                            ],
                            expectedSegmentCount: 2,
                            observedSegmentCount: 2,
                            sampleCountMode: 'observations',
                            contributingDays: [],
                        },
                    ]}
                    bands={[
                        { id: 'A', label: 'Band A', min: 0, max: 30, avg: 20, color: '#ef4444', count: 1 },
                    ]}
                    setAnalysis={vi.fn()}
                    segmentsMap={{
                        North: [
                            { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                            { segmentName: 'Peggy Hill to Allandale GO Station', timeBuckets: {} },
                        ],
                    }}
                    canonicalSegmentColumns={[
                        { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '7A' },
                        { segmentName: 'Peggy Hill to Allandale GO Station', direction: 'North', groupLabel: '7A' },
                    ]}
                    healthReport={{
                        status: 'warning',
                        blockers: [],
                        warnings: ['Legacy runtime logic detected'],
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
                        expectedDirections: 2,
                        matchedDirections: ['North', 'South'],
                        expectedSegmentCount: 2,
                        matchedSegmentCount: 2,
                        missingSegments: [],
                        availableBucketCount: 1,
                        completeBucketCount: 1,
                        incompleteBucketCount: 0,
                        lowConfidenceBucketCount: 0,
                        runtimeSourceSummary: 'stop-level',
                        sampleCountMode: 'days',
                        confidenceThreshold: 5,
                        usesLegacyRuntimeLogic: true,
                    } as any}
                    approvalState="unapproved"
                    approvedRuntimeContract={null}
                    matrixAnalysis={[]}
                    matrixSegmentsMap={{}}
                />
            );
        });

        const approveButton = container.querySelector('[data-testid="step2-approval-action"]') as HTMLButtonElement | null;
        expect(approveButton).toBeNull();
        expect(container.textContent).not.toContain('I understand the current warnings');
    });
});
