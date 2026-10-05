import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';

const usePerformanceDataQueryMock = vi.fn();

vi.mock('../hooks/usePerformanceData', () => ({
  usePerformanceDataQuery: (...args: unknown[]) => usePerformanceDataQueryMock(...args),
}));

vi.mock('../hooks/useWorkspaceAccess', () => {
  const canAccess = () => false;
  return { useWorkspaceAccess: () => ({ canAccess }) };
});

vi.mock('../utils/features', () => ({
  isFeatureEnabled: () => false,
  isFeatureUnderConstruction: () => false,
}));

vi.mock('../utils/lazyWithRetry', () => ({
  lazyWithRetry: (_loader: unknown, cacheKey: string) => {
    if (cacheKey === 'performance-system-overview') {
      return ({ data }: { data: PerformanceDataSummary }) => React.createElement(
        'div',
        { 'data-testid': 'overview-dates' },
        data.dailySummaries.map(day => day.date).join(','),
      );
    }

    return () => React.createElement('div', null, 'Mock performance module');
  },
}));

import { PerformanceWorkspace } from '../components/Performance/PerformanceWorkspace';

function makeSummary(dates: string[], metadataRange: { start: string; end: string }): PerformanceDataSummary {
  return {
    schemaVersion: 14,
    metadata: {
      importedAt: '2026-08-05T12:00:00Z',
      importedBy: 'user-1',
      dateRange: metadataRange,
      dayCount: dates.length,
      totalRecords: dates.length,
    },
    dailySummaries: dates.map(date => ({
      date,
      dayType: 'weekday',
      dataQuality: { totalRecords: 1 },
    })),
  } as PerformanceDataSummary;
}

function setDateInput(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('PerformanceWorkspace custom range loading', () => {
  let container: HTMLDivElement;
  let root: Root;
  const overviewData = makeSummary(
    ['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
    { start: '2026-07-29', end: '2026-08-04' },
  );
  const metadata = {
    ...overviewData.metadata,
    dateRange: { start: '2026-07-01', end: '2026-08-04' },
    dayCount: 35,
    monthlyStoragePaths: {
      '2026-07': 'teams/team-1/performanceData/months/2026-07.json',
      '2026-08': 'teams/team-1/performanceData/months/2026-08.json',
    },
  };
  const workspaceProps = {
    data: overviewData,
    teamId: 'team-1',
    requestingTeamId: 'team-1',
    metadata,
    onReimport: vi.fn(),
    onBack: vi.fn(),
  };

  beforeEach(() => {
    usePerformanceDataQueryMock.mockReset();
    usePerformanceDataQueryMock.mockReturnValue({
      data: null,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the recent overview visible while loading, then switches to the requested range', async () => {
    await act(async () => {
      root.render(<PerformanceWorkspace {...workspaceProps} />);
    });

    const customRangeButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === 'Custom Range',
    );
    expect(customRangeButton).toBeDefined();

    await act(async () => {
      customRangeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const startInput = container.querySelector<HTMLInputElement>('input[aria-label="Custom range start date"]');
    const endInput = container.querySelector<HTMLInputElement>('input[aria-label="Custom range end date"]');
    expect(startInput).not.toBeNull();
    expect(endInput).not.toBeNull();

    await act(async () => {
      setDateInput(startInput!, '2026-07-06');
      setDateInput(endInput!, '2026-07-10');
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Loading 2026-07-06 to 2026-07-10');
    });
    expect(container.textContent).toContain('Showing 2026-07-29 to 2026-08-04 on Overview');
    expect(container.querySelector('[data-testid="overview-dates"]')?.textContent).toContain('2026-07-29');
    expect(container.textContent).not.toContain('No data');
    expect(usePerformanceDataQueryMock.mock.calls.at(-1)?.[5]).toMatchObject({
      dateRange: { start: '2026-07-06', end: '2026-07-10' },
      detailMode: 'overview',
    });

    const requestedData = makeSummary(
      ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'],
      metadata.dateRange,
    );
    usePerformanceDataQueryMock.mockReturnValue({
      data: requestedData,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    await act(async () => {
      root.render(<PerformanceWorkspace {...workspaceProps} />);
    });

    expect(container.textContent).not.toContain('Loading 2026-07-06 to 2026-07-10');
    expect(container.textContent).toContain('2026-07-06 — 2026-07-10 · 5 days');
    expect(container.querySelector('[data-testid="overview-dates"]')?.textContent).toBe(
      '2026-07-06,2026-07-07,2026-07-08,2026-07-09,2026-07-10',
    );
  });

  it('loads year to date from January 1 through the latest imported service day', async () => {
    const yearToDateMetadata = {
      ...metadata,
      dateRange: { start: '2026-01-01', end: '2026-08-04' },
    };

    await act(async () => {
      root.render(<PerformanceWorkspace {...workspaceProps} metadata={yearToDateMetadata} />);
    });

    const yearToDateButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === 'Year to Date',
    );
    expect(yearToDateButton).toBeDefined();

    await act(async () => {
      yearToDateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(usePerformanceDataQueryMock.mock.calls.at(-1)?.[5]).toMatchObject({
        dateRange: { start: '2026-01-01', end: '2026-08-04' },
        detailMode: 'overview',
      });
    });
    expect(yearToDateButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the requested tab and reports later tab changes', async () => {
    const onTabChange = vi.fn();

    await act(async () => {
      root.render(
        <PerformanceWorkspace
          {...workspaceProps}
          initialTab="ridership"
          onTabChange={onTabChange}
        />,
      );
    });

    expect(container.querySelector('[data-tab="ridership"]')?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-tab="otp"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onTabChange).toHaveBeenCalledWith('otp');
  });

  it('defaults to sum and retains daily average across tabs and monthly-source visits', async () => {
    usePerformanceDataQueryMock.mockReturnValue({ data: overviewData, isError: false, isFetching: false, refetch: vi.fn() });
    await act(async () => { root.render(<PerformanceWorkspace {...workspaceProps} specializedTransitTeamId="team-1" />); });
    const button = (text: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent === text)!;
    expect(button('Sum').getAttribute('aria-pressed')).toBe('true');
    await act(async () => { button('Daily average').click(); });
    expect(container.textContent).toContain('Average per day');
    for (const tab of ['ridership', 'otp', 'specialized-transit', 'overview']) {
      await act(async () => { container.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!.click(); });
      if (tab === 'specialized-transit') {
        expect(container.querySelector('[aria-label="Metric aggregation"]')).toBeNull();
        expect(container.textContent).toContain('does not apply to this source');
      } else expect(button('Daily average').getAttribute('aria-pressed')).toBe('true');
    }
    await act(async () => { button('Sum').click(); });
    expect(container.textContent).toContain('Sum · Based on');
  });

  it('removes STREETS filters and detail loading when switching to Specialized Transit', async () => {
    await act(async () => {
      root.render(<PerformanceWorkspace {...workspaceProps} specializedTransitTeamId="team-1" />);
    });

    const yearToDateButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === 'Year to Date',
    );
    await act(async () => { yearToDateButton?.click(); });
    expect(usePerformanceDataQueryMock.mock.calls.at(-1)?.[1]).toBe(true);

    usePerformanceDataQueryMock.mockReturnValue({
      data: null, isError: true, isFetching: false, refetch: vi.fn(),
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-tab="specialized-transit"]')?.click();
    });

    expect(usePerformanceDataQueryMock.mock.calls.at(-1)?.[1]).toBe(false);
    expect(container.textContent).toContain('Mock performance module');
    expect(container.textContent).not.toContain('Year to Date');
    expect(container.textContent).not.toContain('Custom Range');
    expect(container.textContent).not.toContain('All routes');
    expect(container.textContent).not.toContain('7-day avg');
    expect(container.textContent).not.toContain('2026-07-29');
    expect(container.textContent).not.toContain('Performance details could not be loaded');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-tab="overview"]')?.click();
    });
    const restoredYearToDateButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === 'Year to Date',
    );
    expect(restoredYearToDateButton?.getAttribute('aria-pressed')).toBe('true');
    expect(usePerformanceDataQueryMock.mock.calls.at(-1)?.[1]).toBe(true);
  });
});
