import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../components/NewSchedule/connections/ConnectionLibraryPanel', () => ({
  ConnectionLibraryPanel: () => <div>Library panel</div>
}));

vi.mock('../components/NewSchedule/connections/RouteConnectionPanel', () => ({
  RouteConnectionPanel: (props: { onCreateTarget?: () => void }) => (
    <button onClick={props.onCreateTarget}>Create new goal</button>
  )
}));

vi.mock('../components/NewSchedule/connections/OptimizationPanel', () => ({
  OptimizationPanel: () => <div>Optimization panel</div>
}));

vi.mock('../components/NewSchedule/connections/ConnectionAddChooser', () => ({
  ConnectionAddChooser: (props: { isOpen: boolean; onSelectManual: () => void; onClose: () => void }) =>
    props.isOpen ? (
      <div>
        <button onClick={props.onSelectManual}>Manual</button>
        <button onClick={props.onClose}>Close chooser</button>
      </div>
    ) : null
}));

vi.mock('../components/NewSchedule/connections/AddTargetModal', () => ({
  AddTargetModal: (props: { isOpen: boolean; onAdd: (target: any) => void }) =>
    props.isOpen ? (
      <button
        onClick={() => props.onAdd({
          name: 'GO Departures',
          type: 'manual',
          location: 'Allandale Waterfront GO',
          stopCode: '9003',
          stopName: 'Allandale Waterfront GO',
          icon: 'train',
          times: [{ id: 'time-1', time: 480, daysActive: ['Weekday'], enabled: true }],
          color: 'green',
          defaultEventType: 'departure'
        })}
      >
        Save target
      </button>
    ) : null
}));

vi.mock('../components/NewSchedule/connections/ImportRouteModal', () => ({
  ImportRouteModal: () => null
}));

vi.mock('../components/connections/ConnectionStatusPanel', () => ({
  ConnectionStatusPanel: () => <div>Status panel</div>
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
    totalConnections: 0,
    connectionsMet: 0,
    connectionsMissed: 0,
    gaps: []
  }))
}));

import { Step5Connections } from '../components/NewSchedule/steps/Step5Connections';
import type { ConnectionLibrary, RouteConnectionConfig } from '../utils/connections/connectionTypes';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const schedules: MasterRouteTable[] = [
  {
    routeName: 'Route 400',
    direction: 'North',
    serviceDays: ['Weekday'],
    stops: ['Allandale Waterfront GO', 'Downtown Terminal'],
    stopIds: {
      'Allandale Waterfront GO': '9003',
      'Downtown Terminal': '1000'
    },
    trips: []
  } as unknown as MasterRouteTable
];

const library: ConnectionLibrary = {
  targets: [],
  updatedAt: new Date().toISOString(),
  updatedBy: 'tester'
};

const config: RouteConnectionConfig = {
  routeIdentity: '400-Weekday',
  connections: [],
  optimizationMode: 'hybrid'
};

const click = (element: Element | null) => {
  if (!element) throw new Error('Missing click target');
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('Step5Connections route-first create flow', () => {
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

  it('creates a target from the route panel and auto-attaches it to the current route', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const setConnectionLibrary = vi.fn();
    const setRouteConnectionConfig = vi.fn();

    flushSync(() => {
      root?.render(
        <Step5Connections
          schedules={schedules}
          routeIdentity="400-Weekday"
          dayType="Weekday"
          connectionLibrary={library}
          setConnectionLibrary={setConnectionLibrary}
          routeConnectionConfig={config}
          setRouteConnectionConfig={setRouteConnectionConfig}
          onOptimize={() => {}}
          onReset={() => {}}
          teamId="team-1"
          userId="user-1"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    flushSync(() => click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Create new goal') ?? null));
    flushSync(() => click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save target') ?? null));

    expect(setConnectionLibrary).toHaveBeenCalledTimes(1);
    expect(setRouteConnectionConfig).toHaveBeenCalledTimes(1);
    expect(setRouteConnectionConfig.mock.calls[0][0]).toMatchObject({
      routeIdentity: '400-Weekday',
      connections: [
        {
          targetId: expect.stringMatching(/^target_/),
          connectionType: 'meet_departing',
          bufferMinutes: 5,
          stopCode: '9003',
          stopName: 'Allandale Waterfront GO',
          priority: 1,
          enabled: true
        }
      ]
    });
  });
});
