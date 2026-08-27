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
  HeatmapDotLayer: ({ points, outlineWidth }: { points: unknown[]; outlineWidth?: number }) => (
    <div data-testid="heatmap-points" data-points={JSON.stringify(points)} data-outline-width={outlineWidth} />
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

  it('uses the published zone colour as the activity-bubble outline without zone overlays', () => {
    const locations = [
      { id: '58', name: 'Stop 58', lat: 44.38, lon: -79.69, pickups: 3, dropoffs: 2, zoneCodes: ['A'] },
      { id: '68', name: 'Stop 68', lat: 44.39, lon: -79.68, pickups: 4, dropoffs: 3, zoneCodes: ['B'] },
      { id: 'other', name: 'Other', lat: 44.37, lon: -79.67, pickups: 1, dropoffs: 1, zoneCodes: [] },
    ];
    const definitions = [
      { code: 'A', label: 'Zone A', color: '#117db6', kind: 'permanent' as const, active: true },
      { code: 'B', label: 'Zone B', color: '#f58645', kind: 'permanent' as const, active: true },
    ];

    flushSync(() => root.render(<TodActivityMap locations={locations} metric="activity" zoneDefinitions={definitions} />));

    const activity = container.querySelector('[data-testid="heatmap-points"]');
    const points = JSON.parse(activity?.getAttribute('data-points') ?? '[]') as Array<{ id: string; outlineColor: string }>;
    expect(points.find(point => point.id === '58')?.outlineColor).toBe('#117db6');
    expect(points.find(point => point.id === '68')?.outlineColor).toBe('#f58645');
    expect(points.find(point => point.id === 'other')?.outlineColor).toBe('#374151');
    expect(activity?.getAttribute('data-outline-width')).toBe('2.5');
    expect(container.textContent).not.toContain('Connection stop');
    expect(container.querySelector('[data-layer-id^="tod-zone-"]')).toBeNull();
  });
});
