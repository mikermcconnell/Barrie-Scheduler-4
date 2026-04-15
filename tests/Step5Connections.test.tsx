import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../components/NewSchedule/connections/ConnectionLibraryPanel', () => ({
  ConnectionLibraryPanel: () => <div data-testid="library-panel">Library panel</div>
}));

vi.mock('../components/NewSchedule/connections/RouteConnectionPanel', () => ({
  RouteConnectionPanel: () => <div data-testid="route-panel">Route panel</div>
}));

vi.mock('../components/NewSchedule/connections/OptimizationPanel', () => ({
  OptimizationPanel: () => <div data-testid="optimization-panel">Optimization panel</div>
}));

vi.mock('../components/NewSchedule/connections/AddTargetModal', () => ({
  AddTargetModal: () => null
}));

vi.mock('../components/NewSchedule/connections/ImportRouteModal', () => ({
  ImportRouteModal: () => null
}));

vi.mock('../components/NewSchedule/connections/ConnectionAddChooser', () => ({
  ConnectionAddChooser: () => null
}));

vi.mock('../components/connections/ConnectionStatusPanel', () => ({
  ConnectionStatusPanel: () => <div data-testid="status-panel">Status panel</div>
}));

vi.mock('../utils/connections/connectionLibraryService', () => ({
  getConnectionLibrary: vi.fn(),
  saveConnectionLibrary: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../utils/services/masterScheduleService', () => ({
  getMasterSchedule: vi.fn()
}));

vi.mock('../utils/connections/connectionOptimizer', () => ({
  optimizeForConnections: vi.fn(),
  checkConnections: vi.fn(() => ({
    summary: { met: 0, missed: 0 }
  }))
}));

vi.mock('../utils/connections/connectionLibraryUtils', async () => {
  const actual = await vi.importActual('../utils/connections/connectionLibraryUtils');
  return actual;
});

import { Step5Connections } from '../components/NewSchedule/steps/Step5Connections';
import type { ConnectionLibrary, RouteConnectionConfig } from '../utils/connections/connectionTypes';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const schedules: MasterRouteTable[] = [
  {
    routeName: 'Route 11',
    direction: 'North',
    serviceDays: ['Weekday'],
    stops: ['Downtown Terminal', 'Allandale Waterfront GO'],
    stopIds: {
      'Downtown Terminal': '1000',
      'Allandale Waterfront GO': '9003'
    },
    trips: []
  } as unknown as MasterRouteTable
];

const library: ConnectionLibrary = {
  targets: [
    {
      id: 'target-1',
      name: 'GO Departures',
      type: 'manual',
      stopCode: '9003',
      stopName: 'Allandale Waterfront GO',
      times: [{ id: 'time-1', time: 480, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  updatedAt: new Date().toISOString(),
  updatedBy: 'tester'
};

const config: RouteConnectionConfig = {
  routeIdentity: '11-Weekday',
  connections: [],
  optimizationMode: 'hybrid'
};

const emptyLibrary: ConnectionLibrary = {
  targets: [],
  updatedAt: new Date().toISOString(),
  updatedBy: 'tester'
};

const click = (element: Element | null) => {
  if (!element) throw new Error('Missing click target');
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('Step5Connections', () => {
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

  it('opens the route connection panel first when saved targets exist for the route', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Step5Connections
          schedules={schedules}
          routeIdentity="11-Weekday"
          dayType="Weekday"
          connectionLibrary={library}
          setConnectionLibrary={() => {}}
          routeConnectionConfig={config}
          setRouteConnectionConfig={() => {}}
          onOptimize={() => {}}
          onReset={() => {}}
          teamId="team-1"
          userId="user-1"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Saved services are ready for this route');
    expect(container.textContent).toContain('Route 11');
    expect(container.textContent).toContain('Advanced saved-service tools');
    expect(container.textContent).toContain('Manage saved services');
    expect(container.querySelector('[data-testid="route-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-panel"]')).toBeNull();
  });

  it('keeps the route panel primary even when no saved targets exist yet', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Step5Connections
          schedules={schedules}
          routeIdentity="11-Weekday"
          dayType="Weekday"
          connectionLibrary={emptyLibrary}
          setConnectionLibrary={() => {}}
          routeConnectionConfig={config}
          setRouteConnectionConfig={() => {}}
          onOptimize={() => {}}
          onReset={() => {}}
          teamId="team-1"
          userId="user-1"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Start in Route Connections');
    expect(container.textContent).toContain('Create a new goal directly from the route panel first.');
    expect(container.querySelector('[data-testid="route-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-panel"]')).toBeNull();
  });

  it('keeps the saved service library in an advanced modal until opened', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Step5Connections
          schedules={schedules}
          routeIdentity="11-Weekday"
          dayType="Weekday"
          connectionLibrary={library}
          setConnectionLibrary={() => {}}
          routeConnectionConfig={config}
          setRouteConnectionConfig={() => {}}
          onOptimize={() => {}}
          onReset={() => {}}
          teamId="team-1"
          userId="user-1"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    const openLibraryButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Manage saved services')
    );

    expect(container.querySelector('[data-testid="library-panel"]')).toBeNull();

    flushSync(() => {
      click(openLibraryButton ?? null);
    });

    expect(container.querySelector('[data-testid="library-panel"]')).not.toBeNull();
    expect(container.textContent).toContain('Saved Service Library');
    expect(container.textContent).toContain('Advanced shared-service manager');
  });
});
