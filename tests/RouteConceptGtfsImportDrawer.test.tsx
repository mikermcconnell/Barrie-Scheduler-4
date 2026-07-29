import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouteConceptGtfsImportDrawer } from '../components/Analytics/route-concept-planner/RouteConceptGtfsImportDrawer';
import type { RouteConceptGtfsPatternCandidate } from '../utils/route-concept-planner/routeConceptPlannerGtfsAdapter';

const pattern: RouteConceptGtfsPatternCandidate = {
  id: 'route-1-out', routeId: '1', routeShortName: '1', serviceId: 'weekday', dayType: 'weekday', dayTypeLabel: 'Weekday',
  directionId: 0, tripCount: 10, scheduledRuntimes: [], stops: [
    { id: 'a', gtfsStopId: 'a', name: 'A', lat: 44.38, lng: -79.69, sequence: 1 },
    { id: 'b', gtfsStopId: 'b', name: 'B', lat: 44.39, lng: -79.68, sequence: 2 },
  ], shapePoints: [],
};

const returnPattern: RouteConceptGtfsPatternCandidate = {
  ...pattern,
  id: 'route-1-return',
  directionId: 1,
  tripHeadsign: 'A',
  stops: [...pattern.stops].reverse().map((stop, index) => ({ ...stop, id: `${stop.id}-return`, sequence: index + 1 })),
};

describe('RouteConceptGtfsImportDrawer accessibility', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('focuses the drawer, exposes selection state, and closes on Escape', () => {
    const close = vi.fn();
    act(() => root.render(<button id="opener">Open</button>));
    const opener = container.querySelector('#opener') as HTMLButtonElement;
    opener.focus();
    act(() => root.render(<><button id="opener">Open</button><RouteConceptGtfsImportDrawer open patterns={[pattern]} loading={false} error={null} onClose={close} onRetry={vi.fn()} onImport={vi.fn()} /></>));
    expect((document.activeElement as HTMLElement)?.getAttribute('aria-label')).toBe('Close GTFS import');
    const weekday = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'weekday')!;
    expect(weekday.getAttribute('aria-pressed')).toBe('true');
    const dialog = container.querySelector('[role="dialog"]')!;
    act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(close).toHaveBeenCalledOnce();
  });

  it('shows one complete-route card and imports both directions in one click', () => {
    const onImport = vi.fn();
    const duplicateServicePattern: RouteConceptGtfsPatternCandidate = {
      ...pattern,
      id: 'route-1-out-special-service',
      serviceId: 'special-service-id',
      dayTypeLabel: 'special-service-id',
      tripCount: 20,
    };

    act(() => root.render(
      <RouteConceptGtfsImportDrawer
        open
        patterns={[duplicateServicePattern, pattern, returnPattern]}
        loading={false}
        error={null}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onImport={onImport}
      />,
    ));

    expect(Array.from(container.querySelectorAll('h3')).map((heading) => heading.textContent)).toEqual(['Route 1']);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    const importButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Import Route 1'))!;
    act(() => importButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onImport).toHaveBeenCalledOnce();
    expect(onImport.mock.calls[0]?.[0].map((selected: RouteConceptGtfsPatternCandidate) => selected.id)).toEqual([
      pattern.id,
      returnPattern.id,
    ]);
  });
});
