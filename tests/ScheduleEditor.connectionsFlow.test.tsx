import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import type { ConnectionTime } from '../utils/connections/connectionTypes';

const {
  getConnectionLibraryMock,
  saveConnectionLibraryMock,
  getRouteConnectionConfigMock,
  saveRouteConnectionConfigMock,
} = vi.hoisted(() => ({
  getConnectionLibraryMock: vi.fn().mockResolvedValue(null),
  saveConnectionLibraryMock: vi.fn().mockResolvedValue(undefined),
  getRouteConnectionConfigMock: vi.fn().mockResolvedValue(null),
  saveRouteConnectionConfigMock: vi.fn().mockResolvedValue(undefined),
}));

const emptyTimes: ConnectionTime[] = [];

vi.mock('../utils/parsers/masterScheduleParser', async () => {
  const actual = await vi.importActual<typeof import('../utils/parsers/masterScheduleParser')>(
    '../utils/parsers/masterScheduleParser',
  );

  return {
    ...actual,
    buildRoundTripView: vi.fn((
      north?: Pick<MasterRouteTable, 'stops' | 'stopIds'> | null,
      south?: Pick<MasterRouteTable, 'stops' | 'stopIds'> | null,
    ) => ({
      routeName: '10',
      northStops: north?.stops ?? [],
      southStops: south?.stops ?? [],
      northStopIds: north?.stopIds ?? {},
      southStopIds: south?.stopIds ?? {},
      rows: [],
    })),
    validateRouteTable: vi.fn(() => []),
  };
});

vi.mock('../utils/connections/connectionLibraryService', () => ({
  getConnectionLibrary: getConnectionLibraryMock,
  saveConnectionLibrary: saveConnectionLibraryMock,
  getRouteConnectionConfig: getRouteConnectionConfigMock,
  saveRouteConnectionConfig: saveRouteConnectionConfigMock,
}));

vi.mock('../utils/gtfs/goTransitService', () => ({
  QUICK_TEMPLATES: [
    {
      id: 'go-barrie-south-departures',
      name: 'Barrie South GO Departures',
      description: 'Meet trains before departure',
      icon: 'train',
      getData: () => ({
        name: 'Barrie South GO Departures',
        location: 'Barrie South GO',
        stopCode: '725',
        icon: 'train',
        defaultEventType: 'departure',
        times: emptyTimes,
      }),
    },
    {
      id: 'go-barrie-south-arrivals',
      name: 'Barrie South GO Arrivals',
      description: 'Connect after train arrival',
      icon: 'train',
      getData: () => ({
        name: 'Barrie South GO Arrivals',
        location: 'Barrie South GO',
        stopCode: '725',
        icon: 'train',
        defaultEventType: 'arrival',
        times: emptyTimes,
      }),
    },
    {
      id: 'go-allandale-waterfront-departures',
      name: 'Allandale Waterfront GO Departures',
      description: 'Meet trains before departure',
      icon: 'train',
      getData: () => ({
        name: 'Allandale Waterfront GO Departures',
        location: 'Allandale Waterfront GO',
        stopCode: '9003',
        icon: 'train',
        defaultEventType: 'departure',
        times: emptyTimes,
      }),
    },
    {
      id: 'go-allandale-waterfront-arrivals',
      name: 'Allandale Waterfront GO Arrivals',
      description: 'Connect after train arrival',
      icon: 'train',
      getData: () => ({
        name: 'Allandale Waterfront GO Arrivals',
        location: 'Allandale Waterfront GO',
        stopCode: '9003',
        icon: 'train',
        defaultEventType: 'arrival',
        times: emptyTimes,
      }),
    },
    {
      id: 'georgian',
      name: 'Georgian College Classes',
      description: 'Class start & end times',
      icon: 'clock',
      getData: () => ({
        name: 'Georgian College Classes',
        location: 'Georgian College',
        stopCode: '330',
        icon: 'clock',
        times: emptyTimes,
      }),
    },
  ],
  fetchGoTransitGTFS: vi.fn().mockResolvedValue(undefined),
  getBarrieGoStops: vi.fn().mockReturnValue([
    { id: 'barrie-south', name: 'Barrie South GO', stopCode: '725' },
    { id: 'allandale-waterfront', name: 'Barrie Allandale Waterfront GO', stopCode: '9003' },
  ]),
  getCachedData: vi.fn().mockReturnValue(null),
  isCacheFresh: vi.fn().mockReturnValue(false),
  getCacheAge: vi.fn().mockReturnValue(null),
}));

vi.mock('../utils/services/masterScheduleService', () => ({
  getMasterSchedule: vi.fn().mockResolvedValue(null),
  getAllMasterSchedules: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/connections/connectionOptimizer', () => ({
  checkConnections: vi.fn(() => ({
    totalConnections: 0,
    connectionsMet: 0,
    connectionsMissed: 0,
    gaps: [],
  })),
  optimizeForConnections: vi.fn(),
}));

vi.mock('../hooks/useAddTrip', () => ({
  useAddTrip: () => ({
    modalContext: null,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    handleConfirm: vi.fn(),
  }),
}));

vi.mock('../hooks/useTravelTimeGrid', () => ({
  useTravelTimeGrid: () => ({
    handleBulkAdjustTravelTime: vi.fn(),
    handleBulkAdjustRecoveryTime: vi.fn(),
    handleSingleTripTravelAdjust: vi.fn(),
    handleSingleRecoveryAdjust: vi.fn(),
  }),
}));

vi.mock('../components/layout/WorkspaceHeader', () => ({
  WorkspaceHeader: (props: { onOpenConnections?: () => void }) => (
    <div data-testid="workspace-header">
      <button data-testid="open-connections" onClick={props.onOpenConnections}>
        Connections
      </button>
    </div>
  ),
}));

vi.mock('../components/schedule/RoundTripTableView', () => ({
  RoundTripTableView: () => <div data-testid="round-trip-table" />,
}));

vi.mock('../components/TravelTimeGrid', () => ({
  TravelTimeGrid: () => <div data-testid="travel-time-grid" />,
}));

vi.mock('../components/NewSchedule/TimelineView', () => ({
  TimelineView: () => <div data-testid="timeline-view" />,
}));

vi.mock('../components/RouteSummary', () => ({
  RouteSummary: () => <div data-testid="route-summary" />,
}));

vi.mock('../components/AuditLogPanel', () => ({
  useAuditLog: () => ({ entries: [], logAction: vi.fn() }),
  AuditLogPanel: () => null,
}));

vi.mock('../components/modals/AddTripModal', () => ({
  AddTripModal: () => null,
}));

vi.mock('../components/NewSchedule/TripContextMenu', () => ({
  TripContextMenu: () => null,
}));

vi.mock('../components/ui/CascadeModeSelector', () => ({
  CascadeModeSelector: () => null,
}));

vi.mock('../components/NewSchedule/connections/ImportRouteModal', () => ({
  ImportRouteModal: () => null,
}));

import { ScheduleEditor } from '../components/ScheduleEditor';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

const click = (element: Element | null) => {
  if (!element) throw new Error('Missing click target');
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const schedules = [
  {
    routeName: '10 (Weekday) (North)',
    stops: ['Allandale Waterfront GO', 'Downtown Terminal'],
    stopIds: {
      'Allandale Waterfront GO': '9003',
      'Downtown Terminal': '1001',
    },
    trips: [],
  },
  {
    routeName: '10 (Weekday) (South)',
    stops: ['Downtown Terminal', 'Allandale Waterfront GO'],
    stopIds: {
      'Downtown Terminal': '1001',
      'Allandale Waterfront GO': '9003',
    },
    trips: [],
  },
] as any;

describe('ScheduleEditor connections flow', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    getConnectionLibraryMock.mockClear();
    saveConnectionLibraryMock.mockClear();
    getRouteConnectionConfigMock.mockClear();
    saveRouteConnectionConfigMock.mockClear();
  });

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
  });

  it('opens route-first Connections and then Create new connection builder without crashing', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ScheduleEditor
          schedules={schedules}
          teamId="team-1"
          userId="user-1"
          onSchedulesChange={vi.fn()}
        />,
      );
    });

    await flushPromises();

    const openConnectionsButton = container.querySelector('[data-testid="open-connections"]');
    flushSync(() => {
      click(openConnectionsButton);
    });

    await flushPromises();

    expect(container.textContent).toContain('Connections');
    expect(container.textContent).toContain('Route Connections');
    expect(container.textContent).toContain('Use existing connection');
    expect(container.textContent).toContain('Create new connection');
    expect(container.textContent).toContain('Manage connections');
    expect(container.textContent).not.toContain('Saved services are ready for this route');
    expect(container.textContent).not.toContain('Advanced saved-service tools');

    const createGoalButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Create new connection'),
    );

    flushSync(() => {
      click(createGoalButton ?? null);
    });

    await flushPromises();

    expect(container.textContent).toContain('Create connection for Route 10');
    expect(container.textContent).toContain('Step 1 · Route connection setup');
    expect(container.textContent).toContain('Route timepoint *');
    expect(container.textContent).toContain('Step 2 · Connection time(s) *');
    expect(container.textContent).toContain('Step 3 · Connection name *');
  });
});
