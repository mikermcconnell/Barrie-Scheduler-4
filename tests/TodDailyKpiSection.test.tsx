import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { TodActivityMetric } from '../utils/todPickupAggregation';
import type { TodDailyKpiDataset, TodDailyKpiLocation } from '../utils/todPickupTypes';
import type { TodZoneDefinition, TodZoneVersion } from '../utils/todZones/todZoneTypes';

const { todZoneQueryState } = vi.hoisted(() => ({ todZoneQueryState: { versions: [] as unknown[], isError: false } }));

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
vi.mock('../components/Performance/TodZoneEditor', () => ({ TodZoneEditor: (): null => null }));
vi.mock('../hooks/useTodZones', () => ({
  useTodZoneVersionsQuery: () => ({ data: todZoneQueryState.versions, isLoading: false, isError: todZoneQueryState.isError }),
  useBarrieTransitStopsQuery: () => ({ data: [] as unknown[], isLoading: false, isError: false }),
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
    todZoneQueryState.versions = [];
    todZoneQueryState.isError = false;
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
    expect(container.textContent).toContain('No published zone version applies to this period.');

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

  it('filters activity day by day with the effective published version', () => {
    const definitions: TodZoneDefinition[] = [
      { code: 'A', label: 'Zone A', color: '#7c3aed', kind: 'permanent', active: true },
      { code: 'B', label: 'Zone B', color: '#2563eb', kind: 'permanent', active: true },
    ];
    const version = (id: string, effectiveFrom: string, zoneCode: string): TodZoneVersion => ({
      id, schemaVersion: 1, revision: id === 'v1' ? 1 : 2, definitions, polygons: [], connectionStops: [], overrides: [],
      effectiveFrom, source: 'test', reviewNote: 'reviewed', publishedBy: 'owner', publishedAt: `${effectiveFrom}T12:00:00Z`,
      stopSnapshot: [{ stopId: '1', name: 'Stop 1', lat: 44.38, lon: -79.69, zoneCodes: [zoneCode] }],
    });
    todZoneQueryState.versions = [version('v1', '2026-01-01', 'A'), version('v2', '2026-08-24', 'B')];
    const secondDay = { ...reports[0], date: '2026-08-24', locations: [{ ...locations[0], pickups: 10, dropoffs: 8 }] };
    flushSync(() => root.render(
      <TodDailyKpiSection reports={[reports[0], secondDay]} locations={[{ ...locations[0], pickups: 136, dropoffs: 128 }]} isLoading={false} error={null} hasStoredReports />,
    ));

    const zoneAButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'A');
    expect(zoneAButton).toBeDefined();
    flushSync(() => zoneAButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const filtered = container.querySelector('[data-testid="tod-map"]')?.getAttribute('data-locations') ?? '';
    expect(filtered).toContain('"pickups":126');
    expect(filtered).not.toContain('"pickups":136');
    expect(container.textContent).toContain('246 activity');
    expect(container.textContent).toContain('Activity spans 2 effective versions');
  });

  it('keeps earlier zone codes selectable and discloses dates before the first version', () => {
    const zoneA: TodZoneDefinition[] = [{ code: 'A', label: 'Zone A', color: '#7c3aed', kind: 'permanent', active: true }];
    const zoneB: TodZoneDefinition[] = [{ code: 'B', label: 'Zone B', color: '#2563eb', kind: 'permanent', active: true }];
    const version = (id: string, effectiveFrom: string, definitions: TodZoneDefinition[], code: string): TodZoneVersion => ({
      id, schemaVersion: 1, revision: id === 'v1' ? 1 : 2, definitions, polygons: [], connectionStops: [], overrides: [],
      effectiveFrom, source: 'test', reviewNote: 'reviewed', publishedBy: 'owner', publishedAt: `${effectiveFrom}T12:00:00Z`,
      stopSnapshot: [{ stopId: '1', name: 'Stop 1', lat: 44.38, lon: -79.69, zoneCodes: [code] }],
    });
    todZoneQueryState.versions = [version('v1', '2026-08-23', zoneA, 'A'), version('v2', '2026-08-24', zoneB, 'B')];
    const beforeZones = { ...reports[0], date: '2026-08-22', locations: [{ ...locations[0], pickups: 2, dropoffs: 1 }] };
    const zoneBReport = { ...reports[0], date: '2026-08-24', locations: [{ ...locations[0], pickups: 10, dropoffs: 8 }] };
    flushSync(() => root.render(
      <TodDailyKpiSection reports={[beforeZones, reports[0], zoneBReport]} locations={locations} isLoading={false} error={null} hasStoredReports />,
    ));

    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'A')).toBe(true);
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'B')).toBe(true);
    expect(container.textContent).toContain('1 selected service date has no effective zone version');
  });

  it('shows a fail-closed zone loading error without hiding activity', () => {
    todZoneQueryState.isError = true;
    renderSection(root);
    expect(container.textContent).toContain('Published TOD zones could not be loaded');
    expect(container.querySelector('[data-testid="tod-map"]')).not.toBeNull();
  });
});
