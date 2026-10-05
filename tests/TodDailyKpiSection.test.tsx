import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { TodActivityMetric } from '../utils/todPickupAggregation';
import type { TodDailyKpiDataset, TodDailyKpiLocation } from '../utils/todPickupTypes';
import type { TodZoneDefinition, TodZoneVersion } from '../utils/todZones/todZoneTypes';

const { todZoneQueryState } = vi.hoisted(() => ({
  todZoneQueryState: { versions: [] as unknown[], isError: false },
}));

vi.mock('../components/Analytics/AnalyticsShared', () => ({
  ChartCard: ({ title, children }: { title: string; children?: React.ReactNode }) => <section><h3>{title}</h3>{children}</section>,
}));
vi.mock('../components/Performance/TodActivityMap', () => ({
  TodActivityMap: ({
    locations,
    metric,
    zoneDefinitions,
  }: {
    locations: TodDailyKpiLocation[];
    metric: TodActivityMetric;
    zoneDefinitions: TodZoneDefinition[];
  }) => (
    <div
      data-testid="tod-map"
      data-metric={metric}
      data-locations={JSON.stringify(locations)}
      data-zone-definitions={JSON.stringify(zoneDefinitions)}
    />
  ),
}));
vi.mock('../hooks/useTodZones', () => ({
  useTodZoneVersionsQuery: () => ({
    data: todZoneQueryState.versions,
    isLoading: false,
    isError: todZoneQueryState.isError,
  }),
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

const definitions: TodZoneDefinition[] = [
  { code: 'A', label: 'Zone A', color: '#117db6', kind: 'permanent', active: true },
  { code: 'B', label: 'Zone B', color: '#f58645', kind: 'permanent', active: true },
];

function version(id: string, effectiveFrom: string, zoneCode: string): TodZoneVersion {
  return {
    id,
    schemaVersion: 4,
    revision: id === 'v1' ? 1 : 2,
    definitions,
    polygons: [],
    connectionStops: [],
    overrides: [],
    effectiveFrom,
    source: 'published test zones',
    reviewNote: 'reviewed',
    publishedBy: 'owner',
    publishedAt: `${effectiveFrom}T12:00:00Z`,
    stopSnapshot: [{ stopId: '1', name: 'Stop 1', lat: 44.38, lon: -79.69, zoneCodes: [zoneCode] }],
  };
}

function renderSection(root: Root): void {
  flushSync(() => root.render(
    <TodDailyKpiSection
      reports={reports}
      locations={locations}
      isLoading={false}
      error={null}
      hasStoredReports
      teamId="team-a"
      userId="owner-a"
      canManageZones
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

  it('renders one automatic activity map without zone-specific controls or panels', () => {
    renderSection(root);

    expect(container.textContent).toContain('Transit On Demand Activity');
    expect(container.textContent).toContain('246 activity');
    expect(container.textContent).toContain('1 imported day');
    expect(container.textContent).not.toContain('Zone performance');
    expect(container.textContent).not.toContain('Published TOD zones');
    expect(container.textContent).not.toContain('Edit zones');
    expect(container.querySelector('[aria-label="TOD zone filter"]')).toBeNull();

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

  it('classifies activity with the published zone and passes its outline colour to the map', () => {
    todZoneQueryState.versions = [version('v1', '2026-07-02', 'A')];
    renderSection(root);

    const map = container.querySelector('[data-testid="tod-map"]');
    expect(map?.getAttribute('data-locations')).toContain('"zoneCodes":["A"]');
    expect(map?.getAttribute('data-zone-definitions')).toContain('"color":"#117db6"');
  });

  it('keeps day-by-day version assignments while rendering one combined map', () => {
    todZoneQueryState.versions = [version('v1', '2026-08-23', 'A'), version('v2', '2026-08-24', 'B')];
    const secondDay = {
      ...reports[0],
      date: '2026-08-24',
      locations: [{ ...locations[0], pickups: 10, dropoffs: 8 }],
    };
    flushSync(() => root.render(
      <TodDailyKpiSection
        reports={[reports[0], secondDay]}
        locations={[{ ...locations[0], pickups: 136, dropoffs: 128 }]}
        isLoading={false}
        error={null}
        hasStoredReports
        teamId="team-a"
      />,
    ));

    const mapped = container.querySelector('[data-testid="tod-map"]')?.getAttribute('data-locations') ?? '';
    expect(mapped).toContain('"pickups":136');
    expect(mapped).toContain('"zoneCodes":["A","B"]');
    expect(container.querySelectorAll('[data-testid="tod-map"]')).toHaveLength(1);
  });

  it('keeps activity visible with neutral assignment data when zone loading fails', () => {
    todZoneQueryState.isError = true;
    renderSection(root);

    expect(container.querySelector('[data-testid="tod-map"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Published TOD zones could not be loaded');
    expect(container.querySelector('[data-testid="tod-map"]')?.getAttribute('data-locations')).toContain('"zoneCodes":[]');
  });
});
