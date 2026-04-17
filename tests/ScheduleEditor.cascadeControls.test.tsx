import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../hooks/useAddTrip', () => ({
  useAddTrip: () => ({
    modalContext: null as any,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    handleConfirm: vi.fn(),
  }),
}));

vi.mock('../components/AuditLogPanel', () => ({
  useAuditLog: () => ({ entries: [] as any[], logAction: vi.fn((): void => undefined) }),
  AuditLogPanel: (): null => null,
}));

vi.mock('../components/NewSchedule/TripContextMenu', () => ({
  TripContextMenu: (): null => null,
}));

vi.mock('../components/connections/ConnectionsPanel', () => ({
  ConnectionsPanel: (): null => null,
}));

vi.mock('../components/ai/AIReviewPanel', () => ({
  AIReviewPanel: (): null => null,
}));

vi.mock('../components/RouteSummary', () => ({
  RouteSummary: (): null => null,
}));

vi.mock('../components/TravelTimeGrid', () => ({
  TravelTimeGrid: (): null => null,
}));

vi.mock('../components/NewSchedule/TimelineView', () => ({
  TimelineView: (): null => null,
}));

vi.mock('../components/modals/AddTripModal', () => ({
  AddTripModal: (): null => null,
}));

vi.mock('../components/modals/ExtendTripModal', () => ({
  ExtendTripModal: (): null => null,
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
  WorkspaceHeader: (): null => null,
}));

vi.mock('../components/schedule/RoundTripTableView', () => ({
  RoundTripTableView: (): React.ReactElement => <div data-testid="round-trip-table" />,
}));

import { ScheduleEditor } from '../components/ScheduleEditor';
import { Step4Schedule } from '../components/NewSchedule/steps/Step4Schedule';

describe('ScheduleEditor cascade controls', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      flushSync(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('shows the cascade on/off control in the schedule grid by default', () => {
    flushSync(() => {
      root?.render(
        <ScheduleEditor
          embedded
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['North Terminal', 'South Terminal'],
              stopIds: {},
              trips: [{
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
                stops: { 'North Terminal': '7:00 AM', 'South Terminal': '7:30 AM' },
                arrivalTimes: { 'North Terminal': '7:00 AM', 'South Terminal': '7:30 AM' },
              }],
            },
            {
              routeName: '10 (Weekday) (South)',
              stops: ['South Terminal', 'North Terminal'],
              stopIds: {},
              trips: [{
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
                stops: { 'South Terminal': '7:35 AM', 'North Terminal': '8:05 AM' },
                arrivalTimes: { 'South Terminal': '7:35 AM', 'North Terminal': '8:05 AM' },
              }],
            },
          ] as any}
          onSchedulesChange={vi.fn()}
        />
      );
    });

    expect(container?.textContent).toContain('Cascading');
    expect(container?.textContent).toContain('Cascade On');

    const toggleButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.includes('Cascade On')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('This Trip Only');
    expect(container?.textContent).toContain('Cascade Off');
  });

  it('shows the same cascade control when the editor is rendered through Step 4', () => {
    flushSync(() => {
      root?.render(
        <Step4Schedule
          initialSchedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['North Terminal', 'South Terminal'],
              stopIds: {},
              trips: [{
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
                stops: { 'North Terminal': '7:00 AM', 'South Terminal': '7:30 AM' },
                arrivalTimes: { 'North Terminal': '7:00 AM', 'South Terminal': '7:30 AM' },
              }],
            },
            {
              routeName: '10 (Weekday) (South)',
              stops: ['South Terminal', 'North Terminal'],
              stopIds: {},
              trips: [{
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
                stops: { 'South Terminal': '7:35 AM', 'North Terminal': '8:05 AM' },
                arrivalTimes: { 'South Terminal': '7:35 AM', 'North Terminal': '8:05 AM' },
              }],
            },
          ] as any}
          originalSchedules={[]}
          editorSessionKey={1}
          bands={[]}
          analysis={[]}
          segmentNames={[]}
          onUpdateSchedules={vi.fn()}
          projectName="Test Project"
        />
      );
    });

    expect(container?.textContent).toContain('Cascading');
    expect(container?.textContent).toContain('Cascade On');
  });
});
