import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('react-map-gl/mapbox', () => ({
  Layer: (): null => null,
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
});
