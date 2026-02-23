import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';

const operatorDwellReportSpy = vi.fn();

vi.mock('../components/Performance/reports/DateRangePicker', () => ({
  DateRangePicker: (): null => null,
}));

vi.mock('../components/Performance/reports/WeeklySummaryReport', () => ({
  WeeklySummaryReport: (): null => null,
}));

vi.mock('../components/Performance/reports/RoutePerformanceReport', () => ({
  RoutePerformanceReport: (): null => null,
}));

vi.mock('../components/Performance/reports/AIQueryPanel', () => ({
  AIQueryPanel: (): null => null,
}));

vi.mock('../components/Performance/reports/OperatorDwellReport', () => ({
  OperatorDwellReport: (props: unknown): null => {
    operatorDwellReportSpy(props);
    return null;
  },
}));

import { ReportsModule } from '../components/Performance/ReportsModule';

const sampleData = {
  dailySummaries: [
    { date: '2026-02-01', dayType: 'weekday' },
    { date: '2026-02-02', dayType: 'weekday' },
  ],
  metadata: {
    importedAt: '2026-02-20T00:00:00Z',
    importedBy: 'test',
    dateRange: { start: '2026-01-01', end: '2026-01-31' },
    dayCount: 31,
    totalRecords: 1000,
  },
  schemaVersion: 1,
} as unknown as PerformanceDataSummary;

const replacementData = {
  dailySummaries: [
    { date: '2026-03-10', dayType: 'weekday' },
    { date: '2026-03-11', dayType: 'weekday' },
  ],
  metadata: {
    importedAt: '2026-03-20T00:00:00Z',
    importedBy: 'test',
    dateRange: { start: '2026-03-01', end: '2026-03-31' },
    dayCount: 31,
    totalRecords: 1000,
  },
  schemaVersion: 1,
} as unknown as PerformanceDataSummary;

describe('ReportsModule dwell panel wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    operatorDwellReportSpy.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders OperatorDwellReport without legacy export props when dwell tab is selected', () => {
    flushSync(() => {
      root.render(<ReportsModule data={sampleData} />);
    });

    const dwellButton = Array.from(container.querySelectorAll('button'))
      .find(btn => (btn.textContent || '').includes('Operator Dwell'));

    expect(dwellButton).toBeTruthy();

    flushSync(() => {
      dwellButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(operatorDwellReportSpy).toHaveBeenCalled();

    const lastCall = operatorDwellReportSpy.mock.calls.at(-1);
    const props = lastCall?.[0] as Record<string, unknown>;

    expect(props).toBeDefined();
    expect(props.startDate).toBe('2026-02-01');
    expect(props.endDate).toBe('2026-02-02');
    expect(props.dayTypeFilter).toBe('all');
    expect(props.onExportExcel).toBeUndefined();
    expect(props.onExportPDF).toBeUndefined();
    expect(props.exportingExcel).toBeUndefined();
    expect(props.exportingPDF).toBeUndefined();
  });

  it('resets date range to the new dataset window when data changes', async () => {
    flushSync(() => {
      root.render(<ReportsModule data={sampleData} />);
    });

    const dwellButton = Array.from(container.querySelectorAll('button'))
      .find(btn => (btn.textContent || '').includes('Operator Dwell'));

    expect(dwellButton).toBeTruthy();

    flushSync(() => {
      dwellButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    flushSync(() => {
      root.render(<ReportsModule data={replacementData} />);
    });

    const dwellButtonAfterSwap = Array.from(container.querySelectorAll('button'))
      .find(btn => (btn.textContent || '').includes('Operator Dwell'));

    expect(dwellButtonAfterSwap).toBeTruthy();

    flushSync(() => {
      dwellButtonAfterSwap!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await Promise.resolve();

    const lastCall = operatorDwellReportSpy.mock.calls.at(-1);
    const props = lastCall?.[0] as Record<string, unknown>;
    expect(props.startDate).toBe('2026-03-10');
    expect(props.endDate).toBe('2026-03-11');
    expect(props.dayTypeFilter).toBe('all');
  });
});
