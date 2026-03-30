import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const { getConnectionLibraryMock } = vi.hoisted(() => ({
  getConnectionLibraryMock: vi.fn().mockResolvedValue(null)
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
  WorkspaceHeader: (props: { onPublish?: () => void; publishLabel?: string }) => (
    <div data-testid="workspace-header">
      <button data-testid="publish-button" onClick={props.onPublish}>
        {props.publishLabel || 'Publish'}
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

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ScheduleEditor upload safety', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    getConnectionLibraryMock.mockClear();
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

  const renderEditor = () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ScheduleEditor
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['Stop 1', 'Stop 2'],
              stopIds: {},
              trips: []
            } as any,
            {
              routeName: '10 (Weekday) (South)',
              stops: ['Stop 1', 'Stop 2'],
              stopIds: {},
              trips: []
            } as any
          ]}
          teamId="team-1"
          userId="user-1"
          onPublish={vi.fn()}
          publishLabel="Publish"
        />
      );
    });
  };

  it('keeps the editor on the draft -> publish path and does not render direct master upload actions', async () => {
    renderEditor();
    await flushPromises();

    expect(container?.querySelector('[data-testid="publish-button"]')).not.toBeNull();
    expect(container?.textContent).not.toContain('Upload to Master');
    expect(container?.querySelector('[title^="Upload Route"]')).toBeNull();
    expect(container?.querySelector('[data-testid="bulk-upload-modal"]')).toBeNull();
    expect(container?.querySelector('[data-testid="single-upload-modal"]')).toBeNull();
  });
});
