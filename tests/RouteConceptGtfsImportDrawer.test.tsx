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
});
