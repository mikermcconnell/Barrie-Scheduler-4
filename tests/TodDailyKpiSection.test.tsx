import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { TodActivityMetric } from '../utils/todPickupAggregation';
import type { TodDailyKpiDataset, TodDailyKpiLocation } from '../utils/todPickupTypes';

vi.mock('../components/Analytics/AnalyticsShared', () => ({
  ChartCard: ({ title, children }: { title: string; children?: React.ReactNode }) => <section><h3>{title}</h3>{children}</section>,
}));
vi.mock('../components/Performance/TodActivityMap', () => ({
  TodActivityMap: ({
    locations,
    metric,
  }: {
    locations: TodDailyKpiLocation[];
    metric: TodActivityMetric;
  }) => (
    <div
      data-testid="tod-map"
      data-metric={metric}
      data-locations={JSON.stringify(locations)}
    />
  ),
}));

import { TodDailyKpiSection } from '../components/Performance/TodDailyKpiSection';

const locations: TodDailyKpiLocation[] = [
  { id: 'stop-1', name: 'Stop 1', lat: 44.38, lon: -79.69, pickups: 126, dropoffs: 120 },
];
const reports: TodDailyKpiDataset[] = [{
  date: '2026-08-23',
  importedAt: '2026-08-24T08:00:00Z',
  importedBy: 'auto-ingest',
  sourceFileName: 'Licensee KPI.xlsx',
  rowCount: 2,
  totalCompletedTrips: 126,
  totalDropoffs: 120,
  locations,
}];

function renderSection(root: Root): void {
  flushSync(() => root.render(
    <TodDailyKpiSection
      reports={reports}
      locations={locations}
      isLoading={false}
      error={null}
      hasStoredReports={true}
    />,
  ));
}

describe('TodDailyKpiSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('renders one automatic map card using only the active Ridership period', () => {
    renderSection(root);

    expect(container.textContent).toContain('Transit On Demand Activity Map');
    expect(container.textContent).toContain('246 activity');
    expect(container.textContent).toContain('1 imported day');
    expect(container.textContent).not.toContain('226');
    expect(container.textContent).not.toContain('Choose File');
    expect(container.textContent).not.toContain('Import day');
    expect(container.textContent).not.toContain('Top pickup locations');
    expect(container.textContent).not.toContain('Average per imported day');

    const map = container.querySelector('[data-testid="tod-map"]');
    expect(map?.getAttribute('data-metric')).toBe('activity');
    expect(map?.getAttribute('data-locations')).toContain('"pickups":126');
  });

  it('switches the total and map metric to drop-offs', () => {
    renderSection(root);
    const dropoffButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Drop-offs');

    expect(dropoffButton).toBeDefined();
    flushSync(() => dropoffButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.textContent).toContain('120 drop-offs');
    expect(container.querySelector('[data-testid="tod-map"]')?.getAttribute('data-metric')).toBe('dropoffs');
  });
});
