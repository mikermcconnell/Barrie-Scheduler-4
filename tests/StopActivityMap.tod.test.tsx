import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { StopMetrics } from '../utils/performanceDataTypes';

vi.mock('react-map-gl/mapbox', () => ({
  Layer: (): null => null,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Source: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../utils/gtfs/gtfsStopLookup', () => ({ findStopCoords: (): null => null }));
vi.mock('../utils/gtfs/gtfsShapesLoader', () => ({ loadGtfsRouteShapes: (): never[] => [] }));
vi.mock('../components/shared', () => ({
  MapBase: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  HeatmapDotLayer: ({ points }: { points: unknown[] }) => <div data-testid="heatmap-points" data-points={JSON.stringify(points)} />,
  LassoControl: (): null => null,
  RouteOverlay: (): null => null,
  toGeoJSON: ([lat, lon]: [number, number]) => [lon, lat],
  pointInPolygon: () => false,
}));

import { StopActivityMap } from '../components/Performance/StopActivityMap';

function stop(): StopMetrics {
  return {
    stopName: 'Stop 777', stopId: '777', lat: 44.38, lon: -79.69, isTimepoint: true,
    otp: { total: 1, onTime: 1, early: 0, late: 0, onTimePercent: 100, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 },
    boardings: 20, alightings: 10, avgLoad: 0, routeCount: 1, routes: ['10'],
  };
}

describe('StopActivityMap Transit On Demand integration', () => {
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

  it('defaults to combined activity and removes TOD from a fixed-route selection', () => {
    flushSync(() => root.render(
      <StopActivityMap
        stops={[stop()]}
        todLocations={[
          { id: 'stop-777', name: 'Stop 777', lat: 44.38, lon: -79.69, pickups: 3, dropoffs: 4 },
          { id: 'hospital', name: 'Hospital Zone', lat: 44.4, lon: -79.67, pickups: 5, dropoffs: 6 },
        ]}
      />,
    ));

    const activityButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Activity');
    expect(activityButton?.className).toContain('bg-cyan-50');
    expect(container.querySelector('[data-testid="heatmap-points"]')?.getAttribute('data-points')).toContain('"value":37');
    expect(container.querySelector('[data-testid="heatmap-points"]')?.getAttribute('data-points')).toContain('"value":11');
    expect(container.textContent).toContain('2 TOD locations included.');

    const routeSelect = container.querySelector('select');
    expect(routeSelect).not.toBeNull();
    flushSync(() => {
      if (routeSelect) {
        routeSelect.value = '10';
        routeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const routePoints = container.querySelector('[data-testid="heatmap-points"]')?.getAttribute('data-points') || '';
    expect(routePoints).toContain('"value":30');
    expect(routePoints).not.toContain('"value":37');
    expect(routePoints).not.toContain('"value":11');
    expect(container.textContent).toContain('TOD hidden: On Demand activity has no fixed-route attribution.');
  });
});
