import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const {
  getConnectionLibraryMock,
  reassignBlocksForTablesMock,
  showSuccessToastMock,
  onSaveVersionMock,
  onSchedulesChangeMock,
  timelineChangeMock,
} = vi.hoisted(() => ({
  getConnectionLibraryMock: vi.fn().mockResolvedValue(null),
  reassignBlocksForTablesMock: vi.fn(),
  showSuccessToastMock: vi.fn(),
  onSaveVersionMock: vi.fn(),
  onSchedulesChangeMock: vi.fn(),
  timelineChangeMock: vi.fn((): [string, number, number] => ['north-trip', 430, 30]),
}));

vi.mock('../utils/parsers/masterScheduleParser', async () => {
  const actual = await vi.importActual<typeof import('../utils/parsers/masterScheduleParser')>(
    '../utils/parsers/masterScheduleParser'
  );

  return {
    ...actual,
    buildRoundTripView: vi.fn((
      north?: Pick<MasterRouteTable, 'stops' | 'stopIds'> | null,
      south?: Pick<MasterRouteTable, 'stops' | 'stopIds'> | null
    ) => ({
      routeName: '10',
      northStops: north?.stops ?? [],
      southStops: south?.stops ?? [],
      northStopIds: north?.stopIds ?? {},
      southStopIds: south?.stopIds ?? {},
      rows: []
    })),
    validateRouteTable: vi.fn(() => [])
  };
});

vi.mock('../utils/connections/connectionLibraryService', () => ({
  getConnectionLibrary: getConnectionLibraryMock
}));

vi.mock('../utils/blocks/blockAssignmentCore', () => ({
  reassignBlocksForTables: reassignBlocksForTablesMock,
  MatchConfigPresets: {
    editor: { mode: 'editor' }
  }
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
      <button data-testid="switch-timeline" onClick={() => props.onViewChange('timeline')}>
        Timeline
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
  TimelineView: (props: { onTripTimeChange?: (tripId: string, startTime: number, duration: number) => void }) => (
    <button
      data-testid="timeline-change"
      onClick={() => {
        const [tripId, startTime, duration] = timelineChangeMock();
        props.onTripTimeChange?.(tripId, startTime, duration);
      }}
    >
      Trigger timeline change
    </button>
  )
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

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

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

describe('ScheduleEditor interactions', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getConnectionLibraryMock.mockClear();
    reassignBlocksForTablesMock.mockClear();
    showSuccessToastMock.mockReset();
    onSaveVersionMock.mockReset();
    onSchedulesChangeMock.mockReset();
    timelineChangeMock.mockReset();
    timelineChangeMock.mockReturnValue(['north-trip', 430, 30]);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();

    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
  });

  const renderEditor = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ScheduleEditor
          schedules={schedules}
          teamId="team-1"
          userId="user-1"
          onSchedulesChange={onSchedulesChangeMock}
          onSaveVersion={onSaveVersionMock}
          showSuccessToast={showSuccessToastMock}
        />
      );
    });
  };

  it('re-runs block reassignment after a timeline trip edit', async () => {
    renderEditor();
    await flushPromises();

    const timelineToggle = container?.querySelector('[data-testid="switch-timeline"]');
    const timelineChange = () => container?.querySelector('[data-testid="timeline-change"]');

    flushSync(() => {
      timelineToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    flushSync(() => {
      timelineChange()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(reassignBlocksForTablesMock).toHaveBeenCalledTimes(1);
    expect(reassignBlocksForTablesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ routeName: '10 (Weekday) (North)' }),
        expect.objectContaining({ routeName: '10 (Weekday) (South)' })
      ]),
      '10',
      { mode: 'editor' }
    );
    expect(onSchedulesChangeMock).toHaveBeenCalledTimes(1);
  });

  it('preserves post-midnight operational timing after a timeline trip edit', async () => {
    timelineChangeMock.mockReturnValue(['north-trip', 1450, 30]);

    const overnightSchedules = [
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
            startTime: 1470,
            endTime: 1500,
            recoveryTime: 0,
            travelTime: 30,
            cycleTime: 30,
            stopMinutes: {
              'Stop 1': 1470,
              'Stop 2': 1500,
            },
            stops: {
              'Stop 1': '12:30 AM',
              'Stop 2': '1:00 AM'
            },
            arrivalTimes: {
              'Stop 1': '12:30 AM',
              'Stop 2': '1:00 AM'
            }
          }
        ]
      },
      {
        routeName: '10 (Weekday) (South)',
        stops: ['Stop 1', 'Stop 2'],
        stopIds: {},
        trips: []
      }
    ] as any;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ScheduleEditor
          schedules={overnightSchedules}
          teamId="team-1"
          userId="user-1"
          onSchedulesChange={onSchedulesChangeMock}
          onSaveVersion={onSaveVersionMock}
          showSuccessToast={showSuccessToastMock}
        />
      );
    });

    await flushPromises();

    const timelineToggle = container?.querySelector('[data-testid="switch-timeline"]');
    const timelineChange = () => container?.querySelector('[data-testid="timeline-change"]');

    flushSync(() => {
      timelineToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    flushSync(() => {
      timelineChange()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const updatedSchedules = onSchedulesChangeMock.mock.calls.at(-1)?.[0];
    const updatedTrip = updatedSchedules?.[0]?.trips?.[0];

    expect(updatedTrip?.startTime).toBe(1450);
    expect(updatedTrip?.endTime).toBe(1480);
    expect(updatedTrip?.stopMinutes?.['Stop 1']).toBe(1450);
    expect(updatedTrip?.stopMinutes?.['Stop 2']).toBe(1480);
  });

  it('shows save success only after Ctrl+S save resolves', async () => {
    onSaveVersionMock.mockResolvedValue(undefined);
    renderEditor();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await flushPromises();

    expect(onSaveVersionMock).toHaveBeenCalledTimes(1);
    expect(showSuccessToastMock).toHaveBeenCalledWith('Version saved');
  });

  it('does not show a save success toast when Ctrl+S save fails', async () => {
    onSaveVersionMock.mockRejectedValue(new Error('save failed'));
    renderEditor();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await flushPromises();

    expect(onSaveVersionMock).toHaveBeenCalledTimes(1);
    expect(showSuccessToastMock).not.toHaveBeenCalledWith('Version saved');
  });
});
