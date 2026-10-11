import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RIDERSHIP_TREND_BASELINE_HASH } from '../utils/ridership-trends/baseline';
import type { RidershipTrendProjectionV1 } from '../utils/ridership-trends/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refetch = vi.fn();
const todRefetch = vi.fn();
const populatedProjection: RidershipTrendProjectionV1 = {
    schemaVersion: 1,
    metric: 'fixed_route_boardings',
    cutoverDate: '2026-08-01',
    baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
    dailyTotals: {
        '2026-08-01': { boardings: 100, performanceSchemaVersion: 14 },
        '2026-08-03': { boardings: 200, performanceSchemaVersion: 14 },
    },
    latestServiceDate: '2026-08-03',
    updatedAt: '2026-08-03T12:00:00.000Z',
};
let trendProjection = populatedProjection;
let todProjection: {
    schemaVersion: 1;
    metric: 'tod_completed_trips';
    dailyTotals: Record<string, number>;
    latestServiceDate: string | null;
    updatedAt: string;
} = {
    schemaVersion: 1,
    metric: 'tod_completed_trips',
    dailyTotals: { '2026-08-02': 25, '2026-08-03': 30 },
    latestServiceDate: '2026-08-03',
    updatedAt: '2026-08-03T13:00:00.000Z',
};

vi.mock('../hooks/useRidershipTrend', () => ({
    useRidershipTrendQuery: () => ({
        data: trendProjection,
        isLoading: false,
        isFetching: false,
        isError: false,
        refetch,
    }),
    useTodRidershipProjectionQuery: () => ({
        data: todProjection,
        isLoading: false,
        isFetching: false,
        isError: false,
        refetch: todRefetch,
    }),
}));

vi.mock('recharts', () => {
    const Chart = ({ children, data = [] }: { children?: React.ReactNode; data?: Array<Record<string, unknown>> }) => (
        <div data-years={data.map(item => item.year).filter(Boolean).join(',')} data-chart-values={JSON.stringify(data)}>{children}</div>
    );
    const Pass = ({
        children,
        name,
        strokeDasharray,
    }: {
        children?: React.ReactNode;
        name?: string;
        strokeDasharray?: string;
    }) => <div data-chart-name={name} data-stroke-dasharray={strokeDasharray}>{children}</div>;
    const Empty = (): null => null;
    const Cell = ({ fill }: { fill?: string }) => <div data-cell-fill={fill} />;
    return {
        Bar: Pass,
        BarChart: Chart,
        CartesianGrid: Empty,
        Cell,
        Line: Pass,
        LineChart: Chart,
        ResponsiveContainer: Pass,
        Tooltip: Empty,
        XAxis: Empty,
        YAxis: Empty,
    };
});

import { RidershipTrendsWorkspace } from '../components/Analytics/RidershipTrendsWorkspace';

describe('RidershipTrendsWorkspace', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-25T16:00:00.000Z'));
        trendProjection = populatedProjection;
        todProjection = {
            schemaVersion: 1,
            metric: 'tod_completed_trips',
            dailyTotals: { '2026-08-02': 25, '2026-08-03': 30 },
            latestServiceDate: '2026-08-03',
            updatedAt: '2026-08-03T13:00:00.000Z',
        };
        refetch.mockReset();
        todRefetch.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it('shows exact YTD values, coverage, and source limitations', async () => {
        await act(async () => root.render(
            <RidershipTrendsWorkspace teamId="source-team" requestingTeamId="requesting-team" onBack={vi.fn()} />,
        ));

        expect(container.textContent).toContain('Ridership Trends');
        expect(container.textContent).toContain('August ridership so far');
        expect(container.textContent).toContain('Scheduled routes');
        expect(container.textContent).toContain('On Demand');
        expect(container.textContent).toContain('All transit ridership');
        expect(container.textContent).toContain('300');
        expect(container.textContent).toContain('55');
        expect(container.textContent).toContain('355');
        expect(container.textContent).toContain('Drop-offs are not added again');
        expect(container.textContent).toContain('2 report days through Aug 3, 2026');
        expect(container.textContent).toContain('1 missing date');
        expect(container.textContent).toContain('1,632,433');
        expect(container.textContent).toContain('2 / 3');
        expect(container.textContent).toContain('1 date missing within the reported range');
        expect(container.textContent).toContain('2026 scheduled-route ridership');
        expect(container.textContent).toContain('Low scenario');
        expect(container.textContent).toContain('Base 2026 projection');
        expect(container.textContent).toContain('High scenario');
        expect(container.textContent).toContain('17 historical backtests');
        expect(container.textContent).toContain('Derived forecast, not a target');
        expect(container.querySelector('[aria-label="Monthly actual and projected fixed-route boardings for 2026"]')).not.toBeNull();
        expect(container.querySelector('[data-chart-name="Actual boardings"]')?.getAttribute('data-stroke-dasharray')).toBeNull();
        expect(container.querySelector('[data-chart-name="Projected full month"]')?.getAttribute('data-stroke-dasharray')).toBe('7 5');
        const monthlyChart = container.querySelector('[aria-label="Monthly actual and projected fixed-route boardings for 2026"] [data-chart-values]');
        const monthlyChartData = JSON.parse(monthlyChart?.getAttribute('data-chart-values') ?? '[]') as Array<{
            actual: number | null;
            projected: number | null;
            projectionBridge: number | null;
        }>;
        const bridgeIndexes = monthlyChartData
            .map((item, index) => item.projectionBridge === null ? -1 : index)
            .filter(index => index >= 0);
        expect(bridgeIndexes).toHaveLength(2);
        expect(bridgeIndexes[1]).toBe(bridgeIndexes[0] + 1);
        expect(monthlyChartData[bridgeIndexes[0]].projectionBridge).toBe(monthlyChartData[bridgeIndexes[0]].actual);
        expect(monthlyChartData[bridgeIndexes[1]].projectionBridge).toBe(monthlyChartData[bridgeIndexes[1]].projected);
        const projectedHistoryCells = container.querySelectorAll('td[data-projected="true"]');
        expect(projectedHistoryCells.length).toBeGreaterThan(0);
        expect(Array.from(projectedHistoryCells).every(cell => cell.textContent?.includes('Projected'))).toBe(true);
        const projectedHistoryTotal = container.querySelector('td[data-projected-total="true"]');
        expect(projectedHistoryTotal?.textContent).toContain('Projected total');
        expect(container.textContent).toContain('Cannot prove: unique riders');
        expect(container.textContent).toContain('Transit Annual Ridership.xlsx');

        const currentYearHeading = container.textContent?.indexOf('2026 scheduled-route ridership') ?? -1;
        const historicalHeading = container.textContent?.indexOf('Historical context') ?? -1;
        expect(currentYearHeading).toBeGreaterThanOrEqual(0);
        expect(historicalHeading).toBeGreaterThan(currentYearHeading);
    });

    it('collapses an empty active month into a reporting status row', async () => {
        vi.setSystemTime(new Date('2026-09-01T16:00:00.000Z'));
        trendProjection = {
            ...populatedProjection,
            dailyTotals: {},
            latestServiceDate: null,
            updatedAt: '2026-09-01T12:00:00.000Z',
        };
        todProjection = {
            ...todProjection,
            dailyTotals: {},
            latestServiceDate: null,
            updatedAt: '2026-09-01T13:00:00.000Z',
        };

        await act(async () => root.render(
            <RidershipTrendsWorkspace teamId="source-team" requestingTeamId="requesting-team" onBack={vi.fn()} />,
        ));

        expect(container.textContent).toContain('September reporting has not started');
        expect(container.textContent).toContain('No STREETS reports received since Aug 1, 2026');
        expect(container.textContent).toContain('Jan-Jul vs. 2025');
        expect(container.textContent).not.toContain('September ridership so far');
    });

    it('appends the active-year projection to both annual charts and refreshes on demand', async () => {
        await act(async () => root.render(
            <RidershipTrendsWorkspace teamId="source-team" requestingTeamId="requesting-team" onBack={vi.fn()} />,
        ));

        const annualChart = container.querySelector('[aria-label="Line chart of annual fixed-route boardings with 2026 projection"] [data-years]');
        expect(annualChart?.getAttribute('data-years')).toContain('2025');
        expect(annualChart?.getAttribute('data-years')).toContain('2026');
        expect(container.querySelector('[data-chart-name="2026 projected boardings"]')).not.toBeNull();

        const annualChangeChart = container.querySelector('[aria-label="Bar chart of year-over-year percentage change in fixed-route boardings"] [data-chart-values]');
        const annualChangeData = JSON.parse(annualChangeChart?.getAttribute('data-chart-values') ?? '[]') as Array<{
            year: string;
            projected: boolean;
        }>;
        expect(annualChangeData.at(-1)).toMatchObject({ year: '2026', projected: true });
        expect(container.querySelector('[aria-label="Bar chart of year-over-year percentage change in fixed-route boardings"] [data-cell-fill]:last-child')?.getAttribute('data-cell-fill')).toBe('#7C3AED');
        expect(container.textContent).toContain('2026 uses the base scheduled-route projection shown above.');

        const refreshButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Refresh'));
        await act(async () => refreshButton?.click());
        expect(refetch).toHaveBeenCalledTimes(1);
        expect(todRefetch).toHaveBeenCalledTimes(1);
    });
});
