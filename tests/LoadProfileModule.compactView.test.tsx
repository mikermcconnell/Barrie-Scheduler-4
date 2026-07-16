import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { DailySummary, PerformanceDataSummary } from '../utils/performanceDataTypes';

vi.mock('../components/Analytics/AnalyticsShared', () => ({
    ChartCard: ({ title, children }: { title: string; children?: React.ReactNode }) => (
        <section><h2>{title}</h2>{children}</section>
    ),
}));

vi.mock('recharts', () => {
    const Chart = ({ data, children }: { data?: unknown; children?: React.ReactNode }) => (
        <div data-chart={data ? JSON.stringify(data) : undefined}>{children}</div>
    );
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    const Empty = (): null => null;
    return {
        AreaChart: Chart,
        BarChart: Chart,
        ComposedChart: Chart,
        ResponsiveContainer: Pass,
        Area: Pass,
        Bar: Pass,
        Cell: Empty,
        CartesianGrid: Empty,
        Legend: Empty,
        Line: Empty,
        ReferenceLine: Empty,
        Tooltip: Empty,
        XAxis: Empty,
        YAxis: Empty,
    };
});

import { LoadProfileModule } from '../components/Performance/LoadProfileModule';

function buildDay(): DailySummary {
    return {
        date: '2026-07-15',
        dayType: 'weekday',
        system: {
            otp: { total: 0, onTime: 0, early: 0, late: 0, onTimePercent: 0, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 },
            totalRidership: 0,
            totalBoardings: 0,
            totalAlightings: 0,
            vehicleCount: 0,
            tripCount: 0,
            wheelchairTrips: 0,
            avgSystemLoad: 0,
            peakLoad: 42,
        },
        byRoute: [],
        byHour: [],
        byStop: [],
        byTrip: [],
        loadProfilePeakTrips: [{
            routeId: '10',
            routeName: 'Route 10',
            direction: 'Loop',
            block: 'B1',
            terminalDepartureTime: '08:00',
            tripName: 'Trip 08:00',
            maxLoad: 42,
        }],
        loadProfiles: [{
            routeId: '10',
            routeName: 'Route 10',
            direction: 'Loop',
            tripCount: 1,
            stops: [
                { stopName: 'Downtown', stopId: 'S1', routeStopIndex: 0, occurrenceIndex: 0, avgBoardings: 5, avgAlightings: 1, avgLoad: 12, maxLoad: 20, isTimepoint: true },
                { stopName: 'Downtown', stopId: 'S1', routeStopIndex: 5, occurrenceIndex: 1, avgBoardings: 2, avgAlightings: 6, avgLoad: 8, maxLoad: 15, isTimepoint: true },
            ],
        }],
        dataQuality: {
            totalRecords: 10,
            inBetweenFiltered: 0,
            missingAVL: 0,
            missingAPC: 0,
            detourRecords: 0,
            tripperRecords: 0,
            loadCapped: 0,
            apcExcludedFromLoad: 0,
        },
        schemaVersion: 13,
    };
}

function buildSummary(days: DailySummary[] = [buildDay()]): PerformanceDataSummary {
    return {
        dailySummaries: days,
        metadata: {
            importedAt: '2026-07-16T00:00:00.000Z',
            importedBy: 'test',
            dateRange: { start: days[0].date, end: days.at(-1)!.date },
            dayCount: days.length,
            totalRecords: days.length * 10,
        },
        schemaVersion: 13,
    };
}

describe('LoadProfileModule compact view', () => {
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

    it('renders a single day instead of blocking the dashboard', () => {
        act(() => root.render(<LoadProfileModule data={buildSummary()} />));

        expect(container.textContent).toContain('Showing 1 day of load profiles');
        expect(container.textContent).toContain('Load Profile: Route 10 Loop');
        expect(container.textContent).not.toContain('Insufficient data');
    });

    it('uses compact peak-trip summaries when full trip details are absent', () => {
        act(() => root.render(<LoadProfileModule data={buildSummary()} />));

        const charts = [...container.querySelectorAll('[data-chart]')]
            .map(node => node.getAttribute('data-chart') ?? '');
        expect(charts.some(value => value.includes('"avgMaxLoad":42') && value.includes('"count":1'))).toBe(true);
    });

    it('keeps repeated visits to the same loop stop separate', () => {
        act(() => root.render(<LoadProfileModule data={buildSummary()} />));

        const stopRows = [...container.querySelectorAll('tbody tr')]
            .filter(row => row.textContent?.includes('Downtown'));
        expect(stopRows).toHaveLength(2);
    });

    it('weights multi-day average load by reliable APC observations', () => {
        const first = buildDay();
        first.loadProfiles[0].stops = [{
            stopName: 'Downtown', stopId: 'S1', routeStopIndex: 0, occurrenceIndex: 0,
            avgBoardings: 1, avgAlightings: 1, avgLoad: 10, loadObservationCount: 1,
            maxLoad: 10, isTimepoint: true,
        }];
        const second = buildDay();
        second.date = '2026-07-16';
        second.loadProfiles[0].stops = [{
            stopName: 'Downtown', stopId: 'S1', routeStopIndex: 0, occurrenceIndex: 0,
            avgBoardings: 1, avgAlightings: 1, avgLoad: 30, loadObservationCount: 3,
            maxLoad: 30, isTimepoint: true,
        }];

        act(() => root.render(<LoadProfileModule data={buildSummary([first, second])} />));

        const stopRow = [...container.querySelectorAll('tbody tr')]
            .find(row => row.textContent?.includes('Downtown'));
        expect(stopRow?.querySelectorAll('td')[5].textContent).toBe('25');
    });
});
