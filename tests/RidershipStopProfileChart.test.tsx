import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { RidershipStopProfileChartOption } from '../components/Performance/RidershipStopProfileChart';

type RidershipStopProfileRow = RidershipStopProfileChartOption['rows'][number];

vi.mock('../components/Analytics/AnalyticsShared', () => ({
    ChartCard: ({ title, subtitle, headerExtra, children }: { title: string; subtitle: string; headerExtra?: React.ReactNode; children: React.ReactNode }) => (
        <section><h2>{title}</h2><p>{subtitle}</p>{headerExtra}{children}</section>
    ),
}));

vi.mock('recharts', () => {
    const Pass = ({ children, strokeDasharray, name }: { children?: React.ReactNode; strokeDasharray?: string; name?: string }) => (
        <div data-chart-name={name} data-stroke-dasharray={strokeDasharray}>{children}</div>
    );
    const Empty = (): null => null;
    return {
        Bar: Pass,
        CartesianGrid: Empty,
        ComposedChart: Pass,
        Legend: Empty,
        Line: Pass,
        ResponsiveContainer: Pass,
        Tooltip: Empty,
        XAxis: Empty,
        YAxis: Empty,
    };
});

import { RidershipStopProfileChart } from '../components/Performance/RidershipStopProfileChart';

function option(overrides: Partial<RidershipStopProfileChartOption> = {}): RidershipStopProfileChartOption {
    return {
        key: '10::North',
        routeId: '10',
        routeName: 'North Loop',
        direction: 'North',
        totalBoardings: 45,
        totalAlightings: 36,
        serviceDays: 2,
        multipleStopPatterns: false,
        hasEstimatedLoad: false,
        hasBlockInferredLoad: false,
        blockInferenceAssumedEmptyAnchor: false,
        blockInferenceUsesMinimumFeasibleAnchor: false,
        invalidBlockInferenceChainCount: 0,
        loadEvidence: {
            totalStopCount: 2,
            observedStopCount: 2,
            observedObservationCount: 18,
            estimatedStopCount: 0,
            estimatedObservationCount: 0,
            legacyStopCount: 0,
            legacyDayCount: 0,
            unavailableStopCount: 0,
        },
        loadQuality: {
            methodVersion: 1,
            score: 100,
            rating: 'high',
            totalOpportunityCount: 18,
            observedOpportunityCount: 18,
            estimatedOpportunityCount: 0,
            legacyEstimatedOpportunityCount: 0,
            unavailableOpportunityCount: 0,
            attemptedChainCount: 2,
            validChainCount: 2,
            assumedEmptyAnchorChainCount: 2,
            minimumFeasibleAnchorChainCount: 0,
            invalidChainCount: 0,
            openEndingChainCount: 0,
            stableTripCount: 2,
            legacyTripIdentityCount: 0,
            skippedInferenceTripCount: 0,
            issues: [],
        },
        busiestBoardingStop: { stopId: '100', stopName: 'Downtown Terminal', value: 30 },
        busiestAlightingStop: { stopId: '200', stopName: 'Georgian College', value: 32 },
        peakAverageLoad: { stopId: '200', stopName: 'Georgian College', value: 20, loadObservationCount: 8, estimated: false },
        rows: [
            { stopId: '100', stopName: 'Downtown Terminal', routeStopIndex: 0, isTimepoint: true, boardings: 30, alightings: 4, servedDays: 2, averageLoad: 12, loadObservationCount: 10, loadEstimated: false, loadSource: 'observed', blockInferredLoadCount: 0, observedLoadObservationCount: 10, legacyLoadDayCount: 0 },
            { stopId: '200', stopName: 'Georgian College', routeStopIndex: 1, isTimepoint: true, boardings: 15, alightings: 32, servedDays: 2, averageLoad: 20, loadObservationCount: 8, loadEstimated: false, loadSource: 'observed', blockInferredLoadCount: 0, observedLoadObservationCount: 8, legacyLoadDayCount: 0 },
        ],
        ...overrides,
    };
}

describe('RidershipStopProfileChart', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(options: RidershipStopProfileChartOption[], periodMode: 'single-day' | 'multi-day' = 'multi-day', defaultOptionKey: string | null = options[0]?.key ?? null) {
        act(() => root.render(<RidershipStopProfileChart data={{ options, defaultOptionKey }} periodMode={periodMode} />));
    }

    it('uses the requested default and supports route and direction controls', () => {
        const south = option({ key: '10::South', direction: 'South', totalBoardings: 60 });
        const routeEight = option({ key: '8::East', routeId: '8', routeName: 'Crosstown', direction: 'East', totalBoardings: 80 });
        render([option(), south, routeEight], 'multi-day', south.key);

        expect(container.textContent).toContain('South');
        expect(container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent).toContain('South');

        const select = container.querySelector<HTMLSelectElement>('select[aria-label="Passenger flow route"]')!;
        act(() => {
            select.value = '8';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent).toContain('East');

        render([option()]);
        expect(container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent).toContain('North');
    });

    it('adapts labels and summary values for multi-day and single-day periods', () => {
        render([option()]);
        expect(container.textContent).toContain('Average boardings and alightings per observed service day');
        expect(container.textContent).toContain('30 · Avg / service day');
        expect(container.textContent).toContain('Georgian College');
        expect(container.textContent).toContain('20');

        render([option({ serviceDays: 1 })], 'single-day');
        expect(container.textContent).toContain('Boardings and alightings by stop');
        expect(container.textContent).toContain('30 · Daily total');
    });

    it('discloses multiple patterns and estimated legacy weighting', () => {
        render([option({
            multipleStopPatterns: true,
            hasEstimatedLoad: true,
            loadEvidence: { ...option().loadEvidence, legacyStopCount: 2, legacyDayCount: 4 },
        })]);
        expect(container.textContent).toContain('Multiple stop patterns');
        expect(container.textContent).toContain('Estimated weighting');
        expect(container.textContent).toContain('Historical weighting:');
        const estimatedLine = container.querySelector('[data-chart-name="Average onboard (contains estimates)"]');
        expect(estimatedLine?.getAttribute('data-stroke-dasharray')).toBeNull();
    });

    it('clearly discloses block-inferred loads and invalid block chains', () => {
        const inferredRows = option().rows.map((row): RidershipStopProfileRow => ({
            ...row,
            loadObservationCount: null,
            loadEstimated: true,
            loadSource: 'block-inferred' as const,
            blockInferredLoadCount: 4,
            observedLoadObservationCount: 0,
        }));
        render([option({
            rows: inferredRows,
            hasEstimatedLoad: true,
            hasBlockInferredLoad: true,
            blockInferenceAssumedEmptyAnchor: true,
            invalidBlockInferenceChainCount: 2,
            loadEvidence: {
                ...option().loadEvidence,
                observedStopCount: 0,
                observedObservationCount: 0,
                estimatedStopCount: 2,
                estimatedObservationCount: 8,
            },
        })]);

        expect(container.textContent).toContain('Heatmap-estimated load:');
        expect(container.textContent).toContain('reliable APC load is used where available');
        expect(container.textContent).toContain('same route and block');
        expect(container.textContent).toContain('first observed trip in each block is assumed empty');
        expect(container.textContent).toContain('2 block chains were omitted');
        expect(container.textContent).toContain('outside the plausible range');
        expect(container.textContent).toContain('Georgian College · Heatmap estimate');
        expect(container.querySelector('[data-chart-name="Average onboard (APC + heatmap estimates)"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Load evidence coverage"]')?.textContent).toContain('Observed APC: 0/2 stops');
        expect(container.querySelector('[aria-label="Load evidence coverage"]')?.textContent).toContain('Heatmap estimate: 2/2 stops');
        expect(container.querySelector('[aria-label="Load evidence coverage"]')?.textContent).toContain('8 samples');
    });

    it('renders a persistent opportunity-weighted load confidence panel', () => {
        render([option({
            loadQuality: {
                ...option().loadQuality,
                score: 55,
                rating: 'low',
                observedOpportunityCount: 4,
                estimatedOpportunityCount: 8,
                legacyEstimatedOpportunityCount: 2,
                unavailableOpportunityCount: 4,
                minimumFeasibleAnchorChainCount: 1,
                openEndingChainCount: 1,
                issues: [
                    { code: 'minimum-feasible-anchor', severity: 'warning', message: '1 block chain uses a lower-bound starting-load anchor.' },
                    { code: 'unavailable-load', severity: 'critical', message: '4 served trip-stop loads have no usable load evidence.' },
                ],
            },
        })]);

        const panel = container.querySelector('[aria-label="Load confidence"]');
        expect(panel?.textContent).toContain('55/100');
        expect(panel?.textContent).toContain('low');
        expect(panel?.textContent).toContain('Observed APC4/18');
        expect(panel?.textContent).toContain('Heatmap estimated8/18');
        expect(panel?.textContent).toContain('Historical estimate2/18');
        expect(panel?.textContent).toContain('Unavailable4/18');
        expect(panel?.textContent).toContain('lower-bound starting-load anchor');
        expect(panel?.textContent).toContain('planning estimates');
    });

    it('discloses the minimum-feasible block anchor as a lower-bound estimate', () => {
        render([option({
            rows: option().rows.map(row => ({ ...row, loadEstimated: true, loadSource: 'block-inferred' as const, blockInferredLoadCount: 2 })),
            hasEstimatedLoad: true,
            hasBlockInferredLoad: true,
            blockInferenceUsesMinimumFeasibleAnchor: true,
        })]);

        expect(container.textContent).toContain('smallest starting load that keeps the full block non-negative');
        expect(container.textContent).toContain('lower-bound estimate');
    });

    it('discloses both zero and minimum-feasible anchors when a period contains both', () => {
        render([option({
            rows: option().rows.map(row => ({ ...row, loadEstimated: true, loadSource: 'block-inferred' as const, blockInferredLoadCount: 2 })),
            hasEstimatedLoad: true,
            hasBlockInferredLoad: true,
            blockInferenceAssumedEmptyAnchor: true,
            blockInferenceUsesMinimumFeasibleAnchor: true,
        })]);

        expect(container.textContent).toContain('Some blocks start from an assumed-empty first trip');
        expect(container.textContent).toContain('those values are lower-bound estimates');
    });

    it('does not name a zero-activity stop as the busiest stop', () => {
        render([option({ rows: option().rows.map(row => ({ ...row, boardings: 0 })) })]);

        expect(container.textContent).toContain('No boarding activity');
        expect(container.textContent).toContain('32 · Avg / service day');
    });

    it('shows an actionable empty state and handles bar-only data honestly', () => {
        render([]);
        expect(container.textContent).toContain('No stop-level ridership data');
        expect(container.textContent).toContain('Try a different date, day type, or route filter.');

        render([option({ rows: option().rows.map((row): RidershipStopProfileRow => ({ ...row, averageLoad: null, loadObservationCount: null })) })]);
        expect(container.textContent).toContain('Average onboard load is unavailable; boarding and alighting activity is shown.');
    });

    it('renders load-only data without activity bars', () => {
        render([option({ rows: option().rows.map(row => ({ ...row, boardings: 0, alightings: 0 })) })]);

        expect(container.textContent).toContain('No boarding or alighting activity was recorded; available load observations are shown.');
        expect(container.querySelector('[data-chart-name="Average onboard"]')).not.toBeNull();
        expect(container.querySelector('[data-chart-name="Boardings"]')).toBeNull();
        expect(container.querySelector('[data-chart-name="Alightings"]')).toBeNull();
    });

    it('renders a fully empty profile without mounting an empty chart', () => {
        render([option({ rows: [] })]);

        expect(container.textContent).toContain('No stop activity or reliable load observations for this route and direction.');
        expect(container.querySelector('[data-testid="passenger-flow-scroll-region"]')).toBeNull();
    });

    it('provides a labelled keyboard-focusable chart region and accessible summary', () => {
        render([option()]);

        const summary = container.querySelector('[role="img"]');
        expect(summary?.getAttribute('aria-label')).toContain('Busiest boarding stop is Downtown Terminal at 30.');
        expect(summary?.getAttribute('aria-label')).toContain('Peak average onboard load is 20 at Georgian College.');

        const scrollRegion = container.querySelector<HTMLElement>('[data-testid="passenger-flow-scroll-region"]');
        expect(scrollRegion?.tabIndex).toBe(0);
        expect(scrollRegion?.getAttribute('role')).toBe('region');
        expect(scrollRegion?.getAttribute('aria-label')).toContain('Scroll horizontally');
    });

    it('renders repeated visits to the same stop with stable occurrence keys', () => {
        const repeatedRows = [
            { ...option().rows[0], routeStopIndex: 2, occurrenceIndex: 0 },
            { ...option().rows[0], routeStopIndex: 2, occurrenceIndex: 1, boardings: 12 },
        ];
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            render([option({ rows: repeatedRows })]);

            expect(container.querySelectorAll('ol[aria-label="Stop sequence key"] li')).toHaveLength(2);
            expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key');
        } finally {
            consoleError.mockRestore();
        }
    });
});
