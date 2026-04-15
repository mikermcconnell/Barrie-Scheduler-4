import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { ConnectionLibraryPanel } from '../components/NewSchedule/connections/ConnectionLibraryPanel';
import type { ConnectionLibrary } from '../utils/connections/connectionTypes';

vi.mock('../components/NewSchedule/connections/AddTargetModal', () => ({
  AddTargetModal: () => null
}));

vi.mock('../utils/gtfs/goTransitService', () => ({
  fetchGoTransitGTFS: vi.fn().mockResolvedValue(undefined),
  getCachedData: vi.fn().mockReturnValue(null),
  getCacheAge: vi.fn().mockReturnValue(null)
}));

const click = (element: Element | null) => {
  if (!element) throw new Error('Missing click target');
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const buildLibrary = (): ConnectionLibrary => ({
  targets: [
    {
      id: 'target-1',
      name: 'GO Departures',
      type: 'manual',
      stopCode: '9003',
      stopName: 'Allandale Waterfront GO',
      location: 'Allandale Waterfront GO',
      defaultEventType: 'departure',
      times: [{ id: 'time-1', time: 480, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'target-3',
      name: 'College Bells',
      type: 'manual',
      stopCode: '330',
      stopName: 'Georgian College',
      location: 'Georgian College',
      defaultEventType: 'departure',
      times: [{ id: 'time-3', time: 600, daysActive: ['Sunday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'target-2',
      name: 'Route 8B Downtown arrivals',
      type: 'route',
      routeIdentity: '8B-Weekday',
      stopCode: '9003',
      stopName: 'Allandale Waterfront GO',
      direction: 'North',
      times: [{ id: 'time-2', time: 540, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  changeLog: [
    {
      id: 'change-1',
      version: 1,
      timestamp: new Date().toISOString(),
      action: 'add_target',
      userId: 'user-1',
      details: 'Added GO Departures'
    }
  ],
  updatedAt: new Date().toISOString(),
  updatedBy: 'user-1'
});

describe('ConnectionLibraryPanel compact admin mode', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  it('starts with route-relevant saved services and keeps maintenance collapsed', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ConnectionLibraryPanel
          library={buildLibrary()}
          onUpdateLibrary={() => {}}
          onAddTarget={() => {}}
          onImportRoute={() => {}}
          schedules={[]}
          validStopCodes={['9003']}
          availableStops={[{ code: '9003', name: 'Allandale Waterfront GO' }]}
          userId="user-1"
          dayType="Weekday"
          compactAdminMode
          compactAdminContextLabel="Route 11"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Showing saved services that match Route 11 on Weekday');
    expect(container.textContent).toContain('Show all saved services');
    expect(container.textContent).toContain('Manual saved services');
    expect(container.textContent).toContain('Route-derived saved services');
    expect(container.textContent).toContain('Stops match route');
    expect(container.textContent).toContain('1 active weekday time');
    expect(container.textContent).toContain('Library maintenance');
    expect(container.textContent).not.toContain('College Bells');
    expect(container.textContent).not.toContain('Connection Timing Settings');
    expect(container.textContent).not.toContain('Recent Changes');

    const showAllButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Show all saved services')
    );

    flushSync(() => {
      click(showAllButton ?? null);
    });

    expect(container.textContent).toContain('College Bells');
    expect(container.textContent).toContain('No route stop match');
    expect(container.textContent).toContain('No active weekday times');

    const goIndex = container.textContent?.indexOf('GO Departures') ?? -1;
    const bellsIndex = container.textContent?.indexOf('College Bells') ?? -1;
    expect(goIndex).toBeGreaterThanOrEqual(0);
    expect(bellsIndex).toBeGreaterThan(goIndex);

    const maintenanceToggle = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Library maintenance')
    );

    flushSync(() => {
      click(maintenanceToggle ?? null);
    });

    expect(container.textContent).toContain('Connection Timing Settings');
    expect(container.textContent).toContain('Recent Changes');
  });
});
