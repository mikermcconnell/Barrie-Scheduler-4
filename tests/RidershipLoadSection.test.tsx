import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type {
    RouteLoadDiagnostics,
    RouteLoadStop,
    RouteLoadView,
    VehicleCountDiagnostic,
} from '../utils/performanceRouteLoad';

vi.mock('../components/Analytics/AnalyticsShared', () => ({
    ChartCard: ({ title, headerExtra, children }: { title: string; headerExtra?: React.ReactNode; children?: React.ReactNode }) => (
        <section><h3>{title}</h3>{headerExtra}{children}</section>
    ),
}));

vi.mock('recharts', () => {
    const Chart = ({ data, children }: { data?: unknown; children?: React.ReactNode }) => (
        <div data-chart={data ? JSON.stringify(data) : undefined}>{children}</div>
    );
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    const Empty = (): null => null;
    const Reference = ({ y }: { y?: number }) => <div data-reference-line={y} />;
    return {
        ComposedChart: Chart, ResponsiveContainer: Pass, ReferenceLine: Reference,
        Bar: Empty, Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty, Tooltip: Empty, Legend: Empty,
    };
});

import { RidershipLoadSection } from '../components/Performance/RidershipLoadSection';

function stop(stopId: string, stopNumber: number, overrides: Partial<RouteLoadStop> = {}): RouteLoadStop {
    return {
        key: `${stopId}__0`, stopNumber, stopName: `Stop ${stopId}`, stopId, routeStopIndex: stopNumber - 1,
        occurrenceIndex: 0, isTimepoint: false, avgBoardings: 2, avgAlightings: 1, avgLoad: 12,
        maxLoad: 30, loadSamples: 20, lowSample: false, partialPattern: false, ...overrides,
    };
}

function diagnostics(overrides: Partial<RouteLoadDiagnostics> = {}): RouteLoadDiagnostics {
    return {
        noCountTrips: 2,
        imbalanceBuckets: [{ label: 'Within 10%', trips: 18 }, { label: 'Far more boardings', trips: 2 }],
        medianRatio: 1.02,
        keptAvgBoardings: 20,
        skippedAvgBoardings: 20,
        clampedTripShare: 0.05,
        loopTripShare: 0,
        interlinedTripShare: 0,
        apcComparison: null,
        ...overrides,
    };
}

function view(routeId: string, direction: string, stops: RouteLoadStop[], overrides: Partial<RouteLoadView> = {}): RouteLoadView {
    return {
        key: `${routeId}__${direction}`, routeId, routeName: `Route ${routeId}`, direction,
        tripCount: 40, usableTripCount: 20, serviceDays: 2, inferenceBlocked: null, stops, peakStop: stops[0] ?? null,
        maxTripLoad: 30, fullTripCount: 3, usableShare: 0.5, busiestTrips: [], diagnostics: diagnostics(), ...overrides,
    };
}

describe('RidershipLoadSection', () => {
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

    function render(views: RouteLoadView[], vehicles: VehicleCountDiagnostic[] = []) {
        act(() => root.render(<RidershipLoadSection analysis={{ views, vehicles }} />));
    }

    function chartRows(): Array<{ stopId: string; chartLoad: number | null }> {
        return JSON.parse(container.querySelector('[data-chart]')?.getAttribute('data-chart') ?? '[]');
    }

    it('renders KPIs, the full-load line, and blanks the load line at unreliable stops', () => {
        const stops = [
            stop('A', 1, { avgLoad: 17.2 }),
            stop('B', 2, { lowSample: true }),
            stop('C', 3, { partialPattern: true }),
        ];
        render([view('8A', 'N', stops, { peakStop: stops[0] })]);

        expect(container.textContent).toContain('17.2');
        expect(container.textContent).toContain('Trips reaching 55');
        expect(container.textContent).toContain('of 20 trips with a load');
        expect(container.textContent).toContain('50%');
        expect(container.textContent).toContain('2 stops shown as a gap');
        expect(container.querySelector('[data-reference-line="55"]')).not.toBeNull();
        expect(chartRows().map(row => row.chartLoad)).toEqual([17.2, null, null]);
    });

    it('explains loop and interlined routes instead of inferring load', () => {
        const stops = [stop('A', 1, { avgLoad: null, maxLoad: null, loadSamples: 0, lowSample: true })];
        render([view('100', 'CW', stops, { inferenceBlocked: 'loop', peakStop: null, usableShare: null })]);

        expect(container.textContent).toContain('Load is not inferred for loop routes');
        expect(container.textContent).not.toContain('No trips on this route had consistent enough');
        expect(container.querySelector('[data-reference-line]')).toBeNull();
    });

    it('explains when no trip had usable counts', () => {
        const stops = [stop('A', 1, { avgLoad: null, maxLoad: null, loadSamples: 0, lowSample: true })];
        render([view('8A', 'N', stops, { peakStop: null, maxTripLoad: null, usableTripCount: 0, usableShare: 0 })]);

        expect(container.textContent).toContain('No trips on this route had consistent enough');
        expect(container.textContent).toContain('No usable trip counts');
    });

    it('lists the busiest trips and highlights days at full load', () => {
        render([view('8A', 'N', [stop('A', 1)], {
            busiestTrips: [{ departure: '07:40', block: '8-03', days: 5, avgPeakLoad: 48.4, maxPeakLoad: 61, peakStopName: 'Georgian College', fullDays: 2 }],
        })]);

        const table = container.querySelector('[data-testid="ridership-busiest-trips"]');
        expect(table?.textContent).toContain('07:40');
        expect(table?.textContent).toContain('Georgian College');
        expect(table?.textContent).toContain('48.4');
        expect(table?.textContent).toContain('2 of 5');
    });

    it('warns in diagnostics when skipped trips are busier than kept trips and flags vehicles', () => {
        render(
            [view('8A', 'N', [stop('A', 1)], { diagnostics: diagnostics({ keptAvgBoardings: 20, skippedAvgBoardings: 30 }) })],
            [{ vehicleId: '2112', trips: 12, medianRatio: 1.4, skippedShare: 0.6, flagged: true }],
        );

        const panel = container.querySelector('[data-testid="ridership-load-diagnostics"]');
        expect(panel?.textContent).toContain('busy trips may be under-represented');
        expect(panel?.textContent).toContain('1 vehicle with a median ratio outside');
        expect(panel?.textContent).toContain('2112');
    });

    it('switches route and direction', () => {
        render([
            view('8A', 'N', [stop('A', 1)]),
            view('8A', 'S', [stop('Z', 1)]),
        ]);
        expect(chartRows()[0].stopId).toBe('A');

        const select = container.querySelector('select') as HTMLSelectElement;
        act(() => {
            select.value = '8A__S';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(chartRows()[0].stopId).toBe('Z');
    });

    it('shows an empty state without route profiles', () => {
        render([]);
        expect(container.textContent).toContain('No route load profiles for this period.');
    });
});
