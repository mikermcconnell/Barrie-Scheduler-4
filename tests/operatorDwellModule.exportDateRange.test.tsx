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

const sampleDataWithIncidents = {
  ...sampleData,
  dailySummaries: [{
    date: '2026-02-10',
    dayType: 'weekday',
    schemaVersion: 12,
    byOperatorDwell: {
      incidents: [
        { incidentId: 'high', operatorId: 'OP1', date: '2026-02-10', routeId: '10', routeName: 'Route 10', stopName: 'Main Terminal', stopId: 'S1', tripName: 'Trip 1', block: '10-01', observedArrivalTime: '08:00:00', observedDepartureTime: '08:06:00', rawDwellSeconds: 360, trackedDwellSeconds: 360, severity: 'high' },
        { incidentId: 'moderate', operatorId: 'OP2', date: '2026-02-10', routeId: '20', routeName: 'Route 20', stopName: 'Second Stop', stopId: 'S2', tripName: 'Trip 2', block: '20-01', observedArrivalTime: '09:00:00', observedDepartureTime: '09:04:00', rawDwellSeconds: 240, trackedDwellSeconds: 240, severity: 'moderate' },
      ],
      byOperator: [],
      totalIncidents: 2,
      totalTrackedDwellMinutes: 10,
      exposureByRouteOperator: [],
    },
    byCascade: {
      cascades: [], byStop: [], byTerminal: [], totalCascaded: 0, totalNonCascaded: 0, avgBlastRadius: 0, totalBlastRadius: 0,
    },
  }],
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
      '2026-02-12',
      []
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

  it('marks exports as filtered when a local incident filter is active', async () => {
    flushSync(() => {
      root.render(<OperatorDwellModule data={sampleDataWithIncidents} />);
    });

    const severity = container.querySelector('select[aria-label="Severity"]') as HTMLSelectElement;
    flushSync(() => {
      severity.value = 'high';
      severity.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const excelButton = Array.from(container.querySelectorAll('button'))
      .find(btn => (btn.textContent || '').includes('Excel'));
    flushSync(() => {
      excelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await Promise.resolve();

    expect(exportOperatorDwellMock).toHaveBeenCalledWith(
      sampleDataWithIncidents.dailySummaries,
      '2026-02-10',
      '2026-02-10',
      [expect.objectContaining({ incident: expect.objectContaining({ incidentId: 'high' }) })],
      true,
    );
  });
});
