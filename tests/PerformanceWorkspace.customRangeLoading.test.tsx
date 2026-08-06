import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';

const usePerformanceDataQueryMock = vi.fn();

vi.mock('../hooks/usePerformanceData', () => ({
  usePerformanceDataQuery: (...args: unknown[]) => usePerformanceDataQueryMock(...args),
}));

vi.mock('../hooks/useWorkspaceAccess', () => ({
  useWorkspaceAccess: () => ({ canAccess: () => false }),
}));

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
      expect(container.textContent).toContain('Loading 2026-07-06 to 2026-07-10.');
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

    expect(container.textContent).not.toContain('Loading 2026-07-06 to 2026-07-10.');
    expect(container.textContent).toContain('2026-07-06 — 2026-07-10 · 5 days');
    expect(container.querySelector('[data-testid="overview-dates"]')?.textContent).toBe(
      '2026-07-06,2026-07-07,2026-07-08,2026-07-09,2026-07-10',
    );
  });
});
