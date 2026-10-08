import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type {
    LoadTimePeriod,
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
        Area: Empty, Bar: Empty, Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty, Tooltip: Empty, Legend: Empty,
    };
});

import { RidershipLoadSection } from '../components/Performance/RidershipLoadSection';

function stop(stopId: string, stopNumber: number, overrides: Partial<RouteLoadStop> = {}): RouteLoadStop {
    return {
        key: `${stopId}__0`, stopNumber, stopName: `Stop ${stopId}`, stopId, routeStopIndex: stopNumber - 1,
        occurrenceIndex: 0, isTimepoint: false, avgBoardings: 2, avgAlightings: 1, avgLoad: 12,
        maxLoad: 30, p10Load: 6, p90Load: 20, loadSamples: 20, lowSample: false, partialPattern: false, ...overrides,
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
        avgCarriedInLoad: null,
        apcComparison: null,
        ...overrides,
    };
}

function view(routeId: string, direction: string, stops: RouteLoadStop[], overrides: Partial<RouteLoadView> = {}): RouteLoadView {
    return {
        key: `${routeId}__${direction}`, routeId, routeName: `Route ${routeId}`, direction,
        tripCount: 40, usableTripCount: 20, serviceDays: 2, carriesLoad: false, stops, peakStop: stops[0] ?? null,
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
        const analysisForPeriod = () => ({ views, vehicles });
        act(() => root.render(<RidershipLoadSection analysisForPeriod={analysisForPeriod} />));
    }

    function chartRows(): Array<{ stopId: string; chartLoad: number | null; chartBand: [number, number] | null; chartTripLoad: number | null }> {
        return JSON.parse(container.querySelector('[data-chart]')?.getAttribute('data-chart') ?? '[]');
    }

    function click(element: Element | null | undefined) {
        act(() => { (element as HTMLElement).click(); });
    }

    function buttonByText(text: string): HTMLButtonElement | undefined {
        return [...container.querySelectorAll('button')].find(button => button.textContent?.trim().startsWith(text));
    }

    it('renders KPIs, the full-load line, and blanks the load line at unreliable stops', () => {
        const stops = [
            stop('A', 1, { avgLoad: 17.2 }),
            stop('B', 2, { lowSample: true }),
            stop('C', 3, { partialPattern: true }),
        ];
        render([view('8A', 'N', stops, { peakStop: stops[0], maxTripLoad: 48 })]);

        expect(container.textContent).toContain('17.2');
        expect(container.textContent).toContain('Trips reaching 55');
        expect(container.textContent).toContain('of 20 trips with a load');
        expect(container.textContent).toContain('50%');
        expect(container.textContent).toContain('2 stops with too few trips');
        expect(container.querySelector('[data-reference-line="55"]')).not.toBeNull();
        expect(chartRows().map(row => row.chartLoad)).toEqual([17.2, null, null]);
        expect(chartRows().map(row => row.chartBand)).toEqual([[6, 20], null, null]);
    });

    it('explains that loop routes carry riders over between trips', () => {
        render([view('100', 'CW', [stop('A', 1)], {
            carriesLoad: true,
            diagnostics: diagnostics({ avgCarriedInLoad: 6.4 }),
        })]);

        expect(container.textContent).toContain('Loop route: trips may start with riders aboard');
        expect(container.textContent).toContain('trips start with 6.4 riders already aboard at the start on average');
    });

    it('drops the full-load line on quiet routes and says how far below full they are', () => {
        render([view('2B', 'S', [stop('A', 1)], { maxTripLoad: 18 })]);

        expect(container.querySelector('[data-reference-line="55"]')).toBeNull();
        expect(container.textContent).toContain('Well below full: busiest trip peaked at 18 (full is 55)');
    });

    it('draws load and movements as two aligned panels with alightings below zero', () => {
        render([view('8A', 'N', [stop('A', 1, { avgBoardings: 3, avgAlightings: 2 })])]);

        const charts = container.querySelectorAll('[data-chart]');
        expect(charts).toHaveLength(2);
        const movementRows = JSON.parse(charts[1].getAttribute('data-chart') ?? '[]');
        expect(movementRows[0]).toEqual(expect.objectContaining({ chartBoardings: 3, chartAlightings: -2 }));
        expect(container.textContent).toContain('Onboard (riders per trip)');
        expect(container.textContent).toContain('Boardings and alightings (per trip)');
    });

    it('says plain routes start each trip empty', () => {
        render([view('2B', 'S', [stop('A', 1)])]);

        expect(container.textContent).not.toContain('Loop route');
        expect(container.textContent).toContain('each trip starts empty');
    });

    it('explains when no trip had usable counts', () => {
        const stops = [stop('A', 1, { avgLoad: null, maxLoad: null, loadSamples: 0, lowSample: true })];
        render([view('8A', 'N', stops, { peakStop: null, maxTripLoad: null, usableTripCount: 0, usableShare: 0 })]);

        expect(container.textContent).toContain('No trips had consistent enough boarding and alighting counts');
        expect(container.textContent).toContain('No usable trip counts');
    });

    it('lists the busiest trips and highlights days at full load', () => {
        render([view('8A', 'N', [stop('A', 1)], {
            busiestTrips: [{ departure: '07:40', block: '8-03', days: 5, avgPeakLoad: 48.4, maxPeakLoad: 61, peakStopName: 'Georgian College', fullDays: 2, stopLoads: {}, stopBoardings: {}, stopAlightings: {} }],
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

    it('picks the route from a list and the direction from a toggle', () => {
        render([
            view('8A', 'N', [stop('A', 1)]),
            view('8A', 'S', [stop('Z', 1)]),
            view('10', 'CW', [stop('Q', 1)]),
        ]);
        expect(chartRows()[0].stopId).toBe('A');
        expect([...container.querySelectorAll('select option')].map(option => option.getAttribute('value'))).toEqual(['8A', '10']);

        click(container.querySelector('[aria-label="Direction S"]'));
        expect(chartRows()[0].stopId).toBe('Z');

        const select = container.querySelector('select') as HTMLSelectElement;
        act(() => {
            select.value = '10';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(chartRows()[0].stopId).toBe('Q');
        expect(container.querySelector('[aria-label="Direction CW"]')).toBeNull();
    });

    it('recalculates for the chosen time of day', () => {
        const periods: LoadTimePeriod[] = [];
        const analysisForPeriod = (period: LoadTimePeriod) => {
            periods.push(period);
            return { views: [view('8A', 'N', [stop('A', 1, { avgLoad: period === 'am' ? 41 : 12 })])], vehicles: [] as VehicleCountDiagnostic[] };
        };
        act(() => root.render(<RidershipLoadSection analysisForPeriod={analysisForPeriod} />));
        expect(chartRows()[0].chartLoad).toBe(12);

        click(buttonByText('AM peak'));
        expect(periods).toContain('am');
        expect(chartRows()[0].chartLoad).toBe(41);
        expect(buttonByText('AM peak')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('draws a clicked busiest trip on the chart and clears it again', () => {
        render([view('8A', 'N', [stop('A', 1), stop('B', 2)], {
            busiestTrips: [{
                departure: '07:40', block: '8-03', days: 5, avgPeakLoad: 48.4, maxPeakLoad: 61, peakStopName: 'Stop B', fullDays: 2,
                stopLoads: { A__0: 30, B__0: 48 }, stopBoardings: { A__0: 30, B__0: 21 }, stopAlightings: { A__0: 0, B__0: 3 },
            }],
        })]);
        const movementRows = () => JSON.parse(container.querySelectorAll('[data-chart]')[1].getAttribute('data-chart') ?? '[]');
        expect(chartRows().map(row => row.chartTripLoad)).toEqual([null, null]);
        expect(movementRows().map((row: { chartBoardings: number }) => row.chartBoardings)).toEqual([2, 2]);

        click(container.querySelector('[data-testid="ridership-busiest-trips"] tbody tr'));
        expect(chartRows().map(row => row.chartTripLoad)).toEqual([30, 48]);
        expect(movementRows().map((row: { chartBoardings: number; chartAlightings: number }) => [row.chartBoardings, row.chartAlightings]))
            .toEqual([[30, 0], [21, -3]]);
        expect(container.textContent).toContain('Showing the 07:40 trip');
        expect(container.textContent).toContain('Boardings and alightings on the 07:40 trip (average of 5 days)');

        click(container.querySelector('[aria-label="Clear selected trip"]'));
        expect(chartRows().map(row => row.chartTripLoad)).toEqual([null, null]);
        expect(movementRows().map((row: { chartBoardings: number }) => row.chartBoardings)).toEqual([2, 2]);
    });

    it('ranks the busiest routes across the network and jumps to one when clicked', () => {
        render([
            view('2B', 'S', [stop('A', 1)], { maxTripLoad: 18, fullTripCount: 0 }),
            view('8A', 'N', [stop('Z', 1)], { maxTripLoad: 61, fullTripCount: 4 }),
        ]);
        const network = container.querySelector('[data-testid="ridership-load-network"]');
        const buttons = [...(network?.querySelectorAll('button') ?? [])];
        expect(buttons.map(button => button.textContent)).toEqual([
            expect.stringContaining('8A N'),
            expect.stringContaining('2B S'),
        ]);
        expect(buttons[0].textContent).toContain('4 at 55+');

        click(buttons[0]);
        expect(chartRows()[0].stopId).toBe('Z');
    });

    it('shows an empty state without route profiles', () => {
        render([]);
        expect(container.textContent).toContain('No route load profiles for this period.');
    });
});
