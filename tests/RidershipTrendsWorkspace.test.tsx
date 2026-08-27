import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RIDERSHIP_TREND_BASELINE_HASH } from '../utils/ridership-trends/baseline';
import type { RidershipTrendProjectionV1 } from '../utils/ridership-trends/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refetch = vi.fn();
const todRefetch = vi.fn();
const projection: RidershipTrendProjectionV1 = {
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

vi.mock('../hooks/useRidershipTrend', () => ({
    useRidershipTrendQuery: () => ({
        data: projection,
        isLoading: false,
        isFetching: false,
        isError: false,
        refetch,
    }),
    useTodRidershipProjectionQuery: () => ({
        data: {
            schemaVersion: 1,
            metric: 'tod_completed_trips',
            dailyTotals: { '2026-08-02': 25, '2026-08-03': 30 },
            latestServiceDate: '2026-08-03',
            updatedAt: '2026-08-03T13:00:00.000Z',
        },
        isLoading: false,
        isFetching: false,
        isError: false,
        refetch: todRefetch,
    }),
}));

vi.mock('recharts', () => {
    const Chart = ({ children, data = [] }: { children?: React.ReactNode; data?: Array<{ year?: string }> }) => (
        <div data-years={data.map(item => item.year).filter(Boolean).join(',')}>{children}</div>
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
    return {
        Bar: Pass,
        BarChart: Chart,
        CartesianGrid: Empty,
        Cell: Empty,
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
        expect(container.textContent).toContain('1 expected date(s) need review');
        expect(container.textContent).toContain('2026 scheduled-route year-end outlook');
        expect(container.textContent).toContain('Low scenario');
        expect(container.textContent).toContain('Base 2026 projection');
        expect(container.textContent).toContain('High scenario');
        expect(container.textContent).toContain('17 historical backtests');
        expect(container.textContent).toContain('Derived forecast, not a target');
        expect(container.querySelector('[aria-label="Monthly actual and projected fixed-route boardings for 2026"]')).not.toBeNull();
        expect(container.querySelector('[data-chart-name="Actual boardings"]')?.getAttribute('data-stroke-dasharray')).toBeNull();
        expect(container.querySelector('[data-chart-name="Projected full month"]')?.getAttribute('data-stroke-dasharray')).toBe('7 5');
        expect(container.textContent).toContain('Cannot prove: unique riders');
        expect(container.textContent).toContain('Transit Annual Ridership.xlsx');
    });

    it('keeps the active year out of the completed annual chart and refreshes on demand', async () => {
        await act(async () => root.render(
            <RidershipTrendsWorkspace teamId="source-team" requestingTeamId="requesting-team" onBack={vi.fn()} />,
        ));

        const annualChart = container.querySelector('[aria-label="Line chart of annual fixed-route boardings for completed calendar years"] [data-years]');
        expect(annualChart?.getAttribute('data-years')).toContain('2025');
        expect(annualChart?.getAttribute('data-years')).not.toContain('2026');

        const refreshButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Refresh'));
        await act(async () => refreshButton?.click());
        expect(refetch).toHaveBeenCalledTimes(1);
        expect(todRefetch).toHaveBeenCalledTimes(1);
    });
});
