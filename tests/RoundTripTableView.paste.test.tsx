import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const navState = vi.hoisted(() => ({
  callbacks: null as any
}));

vi.mock('../utils/parsers/masterScheduleParser', async () => {
  const actual = await vi.importActual<typeof import('../utils/parsers/masterScheduleParser')>(
    '../utils/parsers/masterScheduleParser'
  );

  return {
    ...actual,
    buildRoundTripView: vi.fn(() => ({
      routeName: '10',
      northStops: ['North Terminal'],
      southStops: ['South Terminal'],
      northStopIds: {},
      southStopIds: {},
      rows: [
        {
          blockId: '10-1',
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
              stops: { 'North Terminal': '7:00 AM' },
              arrivalTimes: { 'North Terminal': '7:00 AM' },
              stopMinutes: { 'North Terminal': 420 }
            },
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
              stops: { 'South Terminal': '7:35 AM' },
              arrivalTimes: { 'South Terminal': '7:35 AM' },
              stopMinutes: { 'South Terminal': 455 }
            }
          ],
          totalTravelTime: 60,
          totalRecoveryTime: 0,
          totalCycleTime: 60,
          pairIndex: 0,
        }
      ]
    })),
  };
});

vi.mock('../hooks/useGridNavigation', () => ({
  useGridNavigation: ({ callbacks }: any) => {
    navState.callbacks = callbacks;
    return {
      containerRef: { current: null },
      handleKeyDown: vi.fn(),
      isCellActive: () => false,
      isRowActive: () => false,
      activateCell: vi.fn(),
      isEditing: false,
      clearActiveCell: vi.fn(),
      cancelEdit: vi.fn(),
      commitEdit: vi.fn(),
      completeEditAndNavigate: vi.fn(),
    };
  }
}));

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

describe('RoundTripTableView paste parsing', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    navState.callbacks = null;
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

  it('uses the existing cell period when pasting an ambiguous time', () => {
    const onCellEdit = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['North Terminal'],
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
                  stops: { 'North Terminal': '7:00 AM' },
                  arrivalTimes: { 'North Terminal': '7:00 AM' },
                  stopMinutes: { 'North Terminal': 420 }
                }
              ]
            },
            {
              routeName: '10 (Weekday) (South)',
              stops: ['South Terminal'],
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
                  stops: { 'South Terminal': '7:35 AM' },
                  arrivalTimes: { 'South Terminal': '7:35 AM' },
                  stopMinutes: { 'South Terminal': 455 }
                }
              ]
            }
          ] as any}
          onCellEdit={onCellEdit}
        />
      );
    });

    navState.callbacks.onPaste(
      {
        rowIndex: 0,
        colIndex: 0,
        tripId: 'north-trip',
        stopName: 'North Terminal',
        cellType: 'dep',
        direction: 'North'
      },
      '730'
    );

    expect(onCellEdit).toHaveBeenCalledWith('north-trip', 'North Terminal', '7:30 AM');
  });
});
