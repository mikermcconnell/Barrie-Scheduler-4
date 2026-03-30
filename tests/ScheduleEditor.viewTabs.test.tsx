import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

vi.mock('../utils/parsers/masterScheduleParser', async () => {
  const actual = await vi.importActual<typeof import('../utils/parsers/masterScheduleParser')>(
    '../utils/parsers/masterScheduleParser'
  );

  return {
    ...actual,
    buildRoundTripView: vi.fn(() => ({
      routeName: '10',
      northStops: [],
      southStops: [],
      northStopIds: {},
      southStopIds: {},
      rows: []
    })),
    validateRouteTable: vi.fn(() => [])
  };
});

vi.mock('../utils/connections/connectionLibraryService', () => ({
  getConnectionLibrary: vi.fn().mockResolvedValue(null)
}));

vi.mock('../hooks/useAddTrip', () => ({
  useAddTrip: (): {
    modalContext: null;
    openModal: () => void;
    closeModal: () => void;
    handleConfirm: () => void;
  } => ({
    modalContext: null,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    handleConfirm: vi.fn()
  })
}));

vi.mock('../hooks/useTravelTimeGrid', () => ({
  useTravelTimeGrid: () => ({
    handleBulkAdjustTravelTime: vi.fn(),
    handleBulkAdjustRecoveryTime: vi.fn(),
    handleSingleTripTravelAdjust: vi.fn(),
    handleSingleRecoveryAdjust: vi.fn()
  })
}));

vi.mock('../components/layout/WorkspaceHeader', () => ({
  WorkspaceHeader: (props: { onViewChange?: (view: string) => void }) => (
    <div data-testid="workspace-header">
      <button data-testid="switch-editor" onClick={() => props.onViewChange('editor')}>
        Schedule
      </button>
      <button data-testid="switch-timeline" onClick={() => props.onViewChange('timeline')}>
        Timeline
      </button>
      <button data-testid="switch-matrix" onClick={() => props.onViewChange('matrix')}>
        Travel Times
      </button>
    </div>
  )
}));

vi.mock('../components/schedule/RoundTripTableView', () => ({
  RoundTripTableView: () => <div data-testid="round-trip-table" />
}));

vi.mock('../components/TravelTimeGrid', () => ({
  TravelTimeGrid: () => <div data-testid="travel-time-grid" />
}));

vi.mock('../components/NewSchedule/TimelineView', () => ({
  TimelineView: () => <div data-testid="timeline-view" />
}));

vi.mock('../components/connections/ConnectionsPanel', () => ({
  ConnectionsPanel: () => <div data-testid="connections-panel" />
}));

vi.mock('../components/RouteSummary', () => ({
  RouteSummary: () => <div data-testid="route-summary" />
}));

vi.mock('../components/AuditLogPanel', () => ({
  useAuditLog: (): { entries: unknown[]; logAction: () => void } => ({ entries: [], logAction: vi.fn() }),
  AuditLogPanel: () => <div data-testid="audit-log-panel" />
}));

vi.mock('../components/modals/AddTripModal', () => ({
  AddTripModal: (): null => null
}));

vi.mock('../components/NewSchedule/TripContextMenu', () => ({
  TripContextMenu: (): null => null
}));

vi.mock('../components/ui/CascadeModeSelector', () => ({
  CascadeModeSelector: (): null => null
}));

import { ScheduleEditor } from '../components/ScheduleEditor';

const schedules = [
  {
    routeName: '10 (Weekday) (North)',
    stops: ['Stop 1', 'Stop 2'],
    stopIds: {},
    trips: [
      {
        id: 'north-trip',
        blockId: '10-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 420,
        endTime: 450,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: {
          'Stop 1': '7:00 AM',
          'Stop 2': '7:30 AM'
        },
        arrivalTimes: {
          'Stop 1': '7:00 AM',
          'Stop 2': '7:30 AM'
        }
      }
    ]
  },
  {
    routeName: '10 (Weekday) (South)',
    stops: ['Stop 1', 'Stop 2'],
    stopIds: {},
    trips: [
      {
        id: 'south-trip',
        blockId: '10-1',
        direction: 'South',
        tripNumber: 2,
        rowId: 2,
        startTime: 455,
        endTime: 485,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: {
          'Stop 1': '7:35 AM',
          'Stop 2': '8:05 AM'
        },
        arrivalTimes: {
          'Stop 1': '7:35 AM',
          'Stop 2': '8:05 AM'
        }
      }
    ]
  }
] as any;

describe('ScheduleEditor view tabs', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

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

  it('keeps Timeline and Travel Times tabs wired to the current editor views', () => {
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
        />
      );
    });

    const get = (id: string) => container?.querySelector(`[data-testid="${id}"]`);

    expect(get('round-trip-table')).not.toBeNull();
    expect(get('timeline-view')).toBeNull();
    expect(get('travel-time-grid')).toBeNull();

    flushSync(() => {
      get('switch-timeline')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(get('timeline-view')).not.toBeNull();
    expect(get('round-trip-table')).toBeNull();
    expect(get('travel-time-grid')).toBeNull();

    flushSync(() => {
      get('switch-matrix')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(get('travel-time-grid')).not.toBeNull();
    expect(get('timeline-view')).toBeNull();
    expect(get('round-trip-table')).toBeNull();

    flushSync(() => {
      get('switch-editor')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(get('round-trip-table')).not.toBeNull();
    expect(get('timeline-view')).toBeNull();
    expect(get('travel-time-grid')).toBeNull();
  });
});
