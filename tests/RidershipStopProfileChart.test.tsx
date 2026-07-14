import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { RidershipStopProfileChartOption } from '../components/Performance/RidershipStopProfileChart';

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
        busiestBoardingStop: { stopId: '100', stopName: 'Downtown Terminal', value: 30 },
        busiestAlightingStop: { stopId: '200', stopName: 'Georgian College', value: 32 },
        peakAverageLoad: { stopId: '200', stopName: 'Georgian College', value: 20, loadObservationCount: 8, estimated: false },
        rows: [
            { stopId: '100', stopName: 'Downtown Terminal', routeStopIndex: 0, isTimepoint: true, boardings: 30, alightings: 4, servedDays: 2, averageLoad: 12, loadObservationCount: 10, loadEstimated: false },
            { stopId: '200', stopName: 'Georgian College', routeStopIndex: 1, isTimepoint: true, boardings: 15, alightings: 32, servedDays: 2, averageLoad: 20, loadObservationCount: 8, loadEstimated: false },
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
        render([option({ multipleStopPatterns: true, hasEstimatedLoad: true })]);
        expect(container.textContent).toContain('Multiple stop patterns');
        expect(container.textContent).toContain('Estimated weighting');
        const estimatedLine = container.querySelector('[data-chart-name="Average onboard (contains estimates)"]');
        expect(estimatedLine?.getAttribute('data-stroke-dasharray')).toBe('6 4');
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

        render([option({ rows: option().rows.map(row => ({ ...row, averageLoad: null, loadObservationCount: null })) })]);
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
