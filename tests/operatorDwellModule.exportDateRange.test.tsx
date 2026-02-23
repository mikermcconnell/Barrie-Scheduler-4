import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';

vi.mock('../components/Performance/reports/reportExporter', () => ({
  exportOperatorDwell: vi.fn().mockResolvedValue(undefined),
  exportOperatorDwellPDF: vi.fn().mockResolvedValue(undefined),
}));

import { OperatorDwellModule } from '../components/Performance/OperatorDwellModule';
import { exportOperatorDwell } from '../components/Performance/reports/reportExporter';

const exportOperatorDwellMock = vi.mocked(exportOperatorDwell);

const sampleData = {
  dailySummaries: [
    { date: '2026-02-10', dayType: 'weekday' },
    { date: '2026-02-12', dayType: 'weekday' },
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

describe('OperatorDwellModule export date range', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    exportOperatorDwellMock.mockClear();
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

  it('exports using currently filtered day range instead of metadata date range', async () => {
    flushSync(() => {
      root.render(<OperatorDwellModule data={sampleData} />);
    });

    const excelButton = Array.from(container.querySelectorAll('button'))
      .find(btn => (btn.textContent || '').includes('Excel'));

    expect(excelButton).toBeTruthy();

    flushSync(() => {
      excelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await Promise.resolve();

    expect(exportOperatorDwellMock).toHaveBeenCalledTimes(1);
    expect(exportOperatorDwellMock).toHaveBeenCalledWith(
      sampleData.dailySummaries,
      '2026-02-10',
      '2026-02-12'
    );
  });

  it('disables export when no filtered data is available', async () => {
    const emptyData = {
      ...sampleData,
      dailySummaries: [],
    } as unknown as PerformanceDataSummary;

    flushSync(() => {
      root.render(<OperatorDwellModule data={emptyData} />);
    });

    const excelButton = Array.from(container.querySelectorAll('button'))
      .find(btn => (btn.textContent || '').includes('Excel'));

    expect(excelButton).toBeTruthy();
    expect(excelButton!.getAttribute('disabled')).not.toBeNull();

    flushSync(() => {
      excelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await Promise.resolve();

    expect(exportOperatorDwellMock).not.toHaveBeenCalled();
  });
});
