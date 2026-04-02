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
  roundTripAdjustMock,
} = vi.hoisted(() => ({
  getConnectionLibraryMock: vi.fn().mockResolvedValue(null),
  reassignBlocksForTablesMock: vi.fn(),
  showSuccessToastMock: vi.fn(),
  onSaveVersionMock: vi.fn(),
  onSchedulesChangeMock: vi.fn(),
  timelineChangeMock: vi.fn((): [string, number, number] => ['north-trip', 430, 30]),
  roundTripAdjustMock: vi.fn((): null | { tripId: string; stopName: string; delta: number } => null),
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
  RoundTripTableView: (props: { onTimeAdjust?: (tripId: string, stopName: string, delta: number) => void }) => {
    const adjustment = roundTripAdjustMock();
    return (
      <div data-testid="round-trip-table">
        {adjustment && (
          <button
            data-testid="round-trip-adjust"
            onClick={() => props.onTimeAdjust?.(adjustment.tripId, adjustment.stopName, adjustment.delta)}
          >
            Trigger round trip adjust
          </button>
        )}
      </div>
    );
  }
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

const buildRecoverySchedules = (arrival: string, departure: string, recovery: number) => [
  {
    routeName: '10 (Weekday) (North)',
    stops: ['Stop 1', 'Stop 2', 'Stop 3'],
    stopIds: {},
    trips: [
      {
        id: 'north-trip',
        blockId: '10-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 420,
        endTime: 480,
        recoveryTime: recovery,
        travelTime: 60,
        cycleTime: 60,
        recoveryTimes: {
          'Stop 2': recovery
        },
        stops: {
          'Stop 1': '7:00 AM',
          'Stop 2': departure,
          'Stop 3': '8:00 AM'
        },
        arrivalTimes: {
          'Stop 1': '7:00 AM',
          'Stop 2': arrival,
          'Stop 3': '8:00 AM'
        }
      }
    ]
  },
  {
    routeName: '10 (Weekday) (South)',
    stops: ['Stop 1', 'Stop 2', 'Stop 3'],
    stopIds: {},
    trips: [
      {
        id: 'south-trip',
        blockId: '10-1',
        direction: 'South',
        tripNumber: 2,
        rowId: 2,
        startTime: 485,
        endTime: 545,
        recoveryTime: 0,
        travelTime: 60,
        cycleTime: 60,
        stops: {
          'Stop 1': '8:05 AM',
          'Stop 2': '8:35 AM',
          'Stop 3': '9:05 AM'
        },
        arrivalTimes: {
          'Stop 1': '8:05 AM',
          'Stop 2': '8:35 AM',
          'Stop 3': '9:05 AM'
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
    roundTripAdjustMock.mockReset();
    roundTripAdjustMock.mockReturnValue(null);
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

  it('cascades large negative Step 4 edits through suffixed downstream stops', async () => {
    roundTripAdjustMock.mockReturnValue({
      tripId: 'north-trip',
      stopName: 'Stop 2',
      delta: -30
    });

    const suffixedSchedules = [
      {
        routeName: '10 (Weekday) (North)',
        stops: ['Stop 1', 'Stop 2', 'Stop 3 (2)', 'Stop 4 (2)'],
        stopIds: {},
        trips: [
          {
            id: 'north-trip',
            blockId: '10-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 480,
            endTime: 540,
            recoveryTime: 0,
            travelTime: 60,
            cycleTime: 60,
            stopMinutes: {
              'Stop 1': 480,
              'Stop 2': 500,
              'Stop 3': 520,
              'Stop 4': 540,
            },
            stops: {
              'Stop 1': '8:00 AM',
              'Stop 2': '8:20 AM',
              'Stop 3': '8:40 AM',
              'Stop 4': '9:00 AM'
            },
            arrivalTimes: {
              'Stop 1': '8:00 AM',
              'Stop 2': '8:20 AM',
              'Stop 3': '8:40 AM',
              'Stop 4': '9:00 AM'
            }
          }
        ]
      },
      {
        routeName: '10 (Weekday) (South)',
        stops: ['South 1', 'South 2'],
        stopIds: {},
        trips: [
          {
            id: 'south-trip',
            blockId: '10-1',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 545,
            endTime: 575,
            recoveryTime: 0,
            travelTime: 30,
            cycleTime: 30,
            stopMinutes: {
              'South 1': 545,
              'South 2': 575,
            },
            stops: {
              'South 1': '9:05 AM',
              'South 2': '9:35 AM'
            },
            arrivalTimes: {
              'South 1': '9:05 AM',
              'South 2': '9:35 AM'
            }
          }
        ]
      }
    ] as any;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ScheduleEditor
          schedules={suffixedSchedules}
          teamId="team-1"
          userId="user-1"
          onSchedulesChange={onSchedulesChangeMock}
          onSaveVersion={onSaveVersionMock}
          showSuccessToast={showSuccessToastMock}
        />
      );
    });

    await flushPromises();

    const adjustButton = container?.querySelector('[data-testid="round-trip-adjust"]');
    flushSync(() => {
      adjustButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const updatedSchedules = onSchedulesChangeMock.mock.calls.at(-1)?.[0];
    const updatedNorthTrip = updatedSchedules?.[0]?.trips?.[0];
    const updatedSouthTrip = updatedSchedules?.[1]?.trips?.[0];

    expect(updatedNorthTrip?.stops?.['Stop 2']).toBe('7:50 AM');
    expect(updatedNorthTrip?.stops?.['Stop 3']).toBe('8:10 AM');
    expect(updatedNorthTrip?.stops?.['Stop 4']).toBe('8:30 AM');
    expect(updatedNorthTrip?.endTime).toBe(510);
    expect(updatedSouthTrip?.startTime).toBe(515);
    expect(updatedSouthTrip?.stops?.['South 1']).toBe('8:35 AM');
  });

  it('keeps arrival fixed when nudging a departure at a stop with recovery time', async () => {
    const cases = [
      {
        delta: -1,
        departure: '7:34 AM',
        recovery: 4
      },
      {
        delta: 1,
        departure: '7:36 AM',
        recovery: 6
      }
    ] as const;

    for (const testCase of cases) {
      onSchedulesChangeMock.mockReset();
      roundTripAdjustMock.mockReset();
      roundTripAdjustMock.mockReturnValue({
        tripId: 'north-trip',
        stopName: 'Stop 2',
        delta: testCase.delta
      });

      const recoverySchedules = buildRecoverySchedules('7:30 AM', '7:35 AM', 5);

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      flushSync(() => {
        root?.render(
          <ScheduleEditor
            schedules={recoverySchedules}
            teamId="team-1"
            userId="user-1"
            onSchedulesChange={onSchedulesChangeMock}
            onSaveVersion={onSaveVersionMock}
            showSuccessToast={showSuccessToastMock}
          />
        );
      });

      await flushPromises();

      const adjustButton = container?.querySelector('[data-testid="round-trip-adjust"]');
      flushSync(() => {
        adjustButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const updatedSchedules = onSchedulesChangeMock.mock.calls.at(-1)?.[0];
      const updatedNorthTrip = updatedSchedules?.[0]?.trips?.[0];

      expect(updatedNorthTrip?.arrivalTimes?.['Stop 2']).toBe('7:30 AM');
      expect(updatedNorthTrip?.stops?.['Stop 2']).toBe(testCase.departure);
      expect(updatedNorthTrip?.recoveryTimes?.['Stop 2']).toBe(testCase.recovery);

      flushSync(() => {
        root?.unmount();
      });
      container?.remove();
      root = null;
      container = null;
    }
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
