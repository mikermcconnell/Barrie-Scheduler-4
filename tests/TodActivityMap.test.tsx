import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('react-map-gl/mapbox', () => ({
  Layer: ({ id }: { id?: string }) => <div data-layer-id={id} />,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Source: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/shared', () => ({
  MapBase: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  HeatmapDotLayer: ({ points }: { points: unknown[] }) => (
    <div data-testid="heatmap-points" data-points={JSON.stringify(points)} />
  ),
  toGeoJSON: ([lat, lon]: [number, number]) => [lon, lat],
}));

import { TodActivityMap } from '../components/Performance/TodActivityMap';
import { createTodZoneASeedDraft } from '../utils/todZones/todZoneSeed';

describe('TodActivityMap', () => {
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

  it('uses the selected metric for both the legend and bubble values', () => {
    const locations = [{
      id: 'stop-777',
      name: 'Stop 777',
      lat: 44.38,
      lon: -79.69,
      pickups: 13,
      dropoffs: 19,
    }];

    flushSync(() => root.render(<TodActivityMap locations={locations} metric="activity" />));
    expect(container.textContent).toContain('TOD activity');
    expect(container.querySelector('[data-testid="heatmap-points"]')?.getAttribute('data-points'))
      .toContain('"value":32');

    flushSync(() => root.render(<TodActivityMap locations={locations} metric="pickups" />));
    expect(container.textContent).toContain('TOD pickups');
    expect(container.querySelector('[data-testid="heatmap-points"]')?.getAttribute('data-points'))
      .toContain('"value":13');

    flushSync(() => root.render(<TodActivityMap locations={locations} metric="dropoffs" />));
    expect(container.textContent).toContain('TOD drop-offs');
    expect(container.querySelector('[data-testid="heatmap-points"]')?.getAttribute('data-points'))
      .toContain('"value":19');
  });

  it('keeps the map-specific notice off the map and supports fullscreen with Escape', () => {
    const locations = [{
      id: 'stop-777',
      name: 'Stop 777',
      lat: 44.38,
      lon: -79.69,
      pickups: 13,
      dropoffs: 19,
    }];

    flushSync(() => root.render(<TodActivityMap locations={locations} metric="activity" />));
    expect(container.textContent).not.toContain('Transit On Demand only');

    const fullscreenButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Fullscreen');
    expect(fullscreenButton).toBeDefined();

    flushSync(() => fullscreenButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.firstElementChild?.className).toContain('fixed inset-0');
    expect(container.textContent).toContain('Exit');

    flushSync(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.firstElementChild?.className).not.toContain('fixed inset-0');
  });

  it('renders one connection halo behind the activity point and a close-zoom label', () => {
    const draft = createTodZoneASeedDraft();
    const location = {
      id: '58', name: 'Stop 58', lat: 44.38, lon: -79.69, pickups: 3, dropoffs: 2,
      zoneCodes: ['A'], isConnectionStop: true, connectionZoneCodes: ['A'],
    };
    const version = {
      ...draft,
      id: 'zone-a-v1',
      revision: 1,
      stopSnapshot: [{ stopId: '58', name: 'Stop 58', lat: 44.38, lon: -79.69, zoneCodes: ['A'], isConnectionStop: true, connectionZoneCodes: ['A'] }],
      publishedBy: 'owner-a',
    };

    flushSync(() => root.render(<TodActivityMap locations={[location]} metric="activity" zoneVersion={version} />));
    expect(container.textContent).toContain('Connection stop halo');
    expect(container.textContent).not.toContain('Zone A connection');

    const halo = container.querySelector('[data-layer-id="tod-zone-connection-halos"]');
    const activity = container.querySelector('[data-testid="heatmap-points"]');
    const label = container.querySelector('[data-layer-id="tod-zone-connection-stop-labels"]');
    expect(halo).not.toBeNull();
    expect(label).not.toBeNull();
    expect(container.querySelector('[data-layer-id="tod-zone-shared-connection-stops"]')).toBeNull();
    expect(container.querySelector('[data-layer-id="tod-zone-quinary-connection-stops"]')).toBeNull();
    expect(halo?.compareDocumentPosition(activity as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(activity?.compareDocumentPosition(label as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
