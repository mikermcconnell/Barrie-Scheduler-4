import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../utils/parsers/masterScheduleParser', async () => {
  const actual = await vi.importActual<typeof import('../utils/parsers/masterScheduleParser')>(
    '../utils/parsers/masterScheduleParser'
  );

  return actual;
});

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

describe('RoundTripTableView row actions', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
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

  const render = (
    schedules: any[],
    props?: {
      onAddTrip?: (...args: any[]) => void;
      onExtendTrip?: (...args: any[]) => void;
      onDeleteTrip?: (...args: any[]) => void;
      onMenuOpen?: (...args: any[]) => void;
      originalSchedules?: any[];
    }
  ) => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={schedules}
          originalSchedules={props?.originalSchedules}
          onCellEdit={vi.fn()}
          onAddTrip={props?.onAddTrip}
          onExtendTrip={props?.onExtendTrip}
          onDeleteTrip={props?.onDeleteTrip}
          onMenuOpen={props?.onMenuOpen}
        />
      );
    });
  };

  it('uses the row northbound trip when adding from the combined row', () => {
    const onMenuOpen = vi.fn();

    render(
      [
        {
          routeName: '10 (Weekday) (North)',
          stops: ['North Terminal'],
          stopIds: { 'North Terminal': '1001' },
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
          stopIds: { 'South Terminal': '2001' },
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
      ],
      { onMenuOpen }
    );

    const addButton = container?.querySelector('button[aria-label="Trip actions"]') as HTMLButtonElement | null;
    expect(addButton).not.toBeNull();

    addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onMenuOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'south-trip',
        beforeTripId: 'north-trip',
        afterTripId: 'south-trip',
        rowTripIds: ['north-trip', 'south-trip'],
        quickAddActionsOnly: true
      })
    );
  });

  it('shows the row trip actions button even on south-only rows', () => {
    const onMenuOpen = vi.fn();

    render(
      [
        {
          routeName: '10 (Weekday) (North)',
          stops: ['North Terminal'],
          stopIds: { 'North Terminal': '1001' },
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
          stopIds: { 'South Terminal': '2001' },
          trips: [
            {
              id: 'south-only-trip',
              blockId: '10-2',
              direction: 'South',
              tripNumber: 1,
              rowId: 1,
              startTime: 500,
              endTime: 530,
              recoveryTime: 0,
              travelTime: 30,
              cycleTime: 30,
              stops: { 'South Terminal': '8:20 AM' },
              arrivalTimes: { 'South Terminal': '8:20 AM' },
              stopMinutes: { 'South Terminal': 500 }
            }
          ]
        }
      ],
      { onMenuOpen }
    );

    const editButtons = Array.from(container?.querySelectorAll('button[aria-label="Trip actions"]') ?? []);
    expect(editButtons.length).toBeGreaterThan(1);

    const southOnlyEdit = editButtons.find(
      (button) => button.closest('tr')?.textContent?.includes('10-2')
    ) as HTMLButtonElement | undefined;

    expect(southOnlyEdit).toBeTruthy();

    southOnlyEdit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onMenuOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'south-only-trip',
        beforeTripId: 'south-only-trip',
        afterTripId: 'south-only-trip',
        direction: 'South',
        blockId: '10-2',
        rowTripIds: ['south-only-trip'],
        hideTripSpecificActions: true,
        quickAddActionsOnly: true
      })
    );
  });

  it('keeps the delete round-trip button visible beside the new trip actions button', () => {
    const onDeleteTrip = vi.fn();
    const onMenuOpen = vi.fn();

    render(
      [
        {
          routeName: '10 (Weekday) (North)',
          stops: ['North Terminal'],
          stopIds: { 'North Terminal': '1001' },
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
          stopIds: { 'South Terminal': '2001' },
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
      ],
      { onDeleteTrip, onMenuOpen }
    );

    const tripActionsButton = container?.querySelector('button[aria-label="Trip actions"]') as HTMLButtonElement | null;
    const deleteButton = container?.querySelector('button[aria-label="Delete round trip"]') as HTMLButtonElement | null;

    expect(tripActionsButton).not.toBeNull();
    expect(deleteButton).not.toBeNull();
  });

  it('deletes the whole round-trip row from the row actions button', () => {
    const onDeleteTrip = vi.fn();

    render(
      [
        {
          routeName: '10 (Weekday) (North)',
          stops: ['North Terminal'],
          stopIds: { 'North Terminal': '1001' },
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
          stopIds: { 'South Terminal': '2001' },
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
      ],
      { onDeleteTrip }
    );

    const deleteButton = container?.querySelector('button[aria-label="Delete round trip"]') as HTMLButtonElement | null;
    expect(deleteButton).not.toBeNull();

    deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onDeleteTrip).toHaveBeenCalledWith(['north-trip', 'south-trip'], { treatAsRoundTrip: true });
  });

  it('shows dynamic BEGIN and END markers from the current live block sequence', () => {
    render([
      {
        routeName: '400 (Weekday) (North)',
        stops: ['Park Place', 'RVH Main Entrance'],
        stopIds: { 'Park Place': 'P4', 'RVH Main Entrance': 'RVH' },
        trips: [
          {
            id: 'north-1',
            blockId: '400-2',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 920,
            endTime: 944,
            recoveryTime: 6,
            travelTime: 24,
            cycleTime: 30,
            stops: { 'Park Place': '3:20 PM', 'RVH Main Entrance': '3:44 PM' },
            arrivalTimes: { 'Park Place': '3:20 PM', 'RVH Main Entrance': '3:44 PM' },
            stopMinutes: { 'Park Place': 920, 'RVH Main Entrance': 944 }
          },
          {
            id: 'north-2',
            blockId: '400-2',
            direction: 'North',
            tripNumber: 3,
            rowId: 3,
            startTime: 980,
            endTime: 1004,
            recoveryTime: 6,
            travelTime: 24,
            cycleTime: 30,
            stops: { 'Park Place': '4:20 PM', 'RVH Main Entrance': '4:44 PM' },
            arrivalTimes: { 'Park Place': '4:20 PM', 'RVH Main Entrance': '4:44 PM' },
            stopMinutes: { 'Park Place': 980, 'RVH Main Entrance': 1004 }
          },
          {
            id: 'north-3',
            blockId: '400-2',
            direction: 'North',
            tripNumber: 5,
            rowId: 5,
            startTime: 1040,
            endTime: 1064,
            recoveryTime: 6,
            travelTime: 24,
            cycleTime: 30,
            stops: { 'Park Place': '5:20 PM', 'RVH Main Entrance': '5:44 PM' },
            arrivalTimes: { 'Park Place': '5:20 PM', 'RVH Main Entrance': '5:44 PM' },
            stopMinutes: { 'Park Place': 1040, 'RVH Main Entrance': 1064 }
          }
        ]
      },
      {
        routeName: '400 (Weekday) (South)',
        stops: ['RVH Main Entrance', 'Park Place'],
        stopIds: { 'RVH Main Entrance': 'RVH', 'Park Place': 'P4' },
        trips: [
          {
            id: 'south-1',
            blockId: '400-2',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 950,
            endTime: 976,
            recoveryTime: 4,
            travelTime: 26,
            cycleTime: 30,
            stops: { 'RVH Main Entrance': '3:50 PM', 'Park Place': '4:16 PM' },
            arrivalTimes: { 'RVH Main Entrance': '3:50 PM', 'Park Place': '4:16 PM' },
            stopMinutes: { 'RVH Main Entrance': 950, 'Park Place': 976 }
          },
          {
            id: 'south-2',
            blockId: '400-2',
            direction: 'South',
            tripNumber: 4,
            rowId: 4,
            startTime: 1010,
            endTime: 1036,
            recoveryTime: 0,
            travelTime: 26,
            cycleTime: 26,
            stops: { 'RVH Main Entrance': '4:50 PM', 'Park Place': '5:16 PM' },
            arrivalTimes: { 'RVH Main Entrance': '4:50 PM', 'Park Place': '5:16 PM' },
            stopMinutes: { 'RVH Main Entrance': 1010, 'Park Place': 1036 }
          },
          {
            id: 'south-3',
            blockId: '400-2',
            direction: 'South',
            tripNumber: 6,
            rowId: 6,
            startTime: 1070,
            endTime: 1096,
            recoveryTime: 0,
            travelTime: 26,
            cycleTime: 26,
            stops: { 'RVH Main Entrance': '5:50 PM', 'Park Place': '6:16 PM' },
            arrivalTimes: { 'RVH Main Entrance': '5:50 PM', 'Park Place': '6:16 PM' },
            stopMinutes: { 'RVH Main Entrance': 1070, 'Park Place': 1096 }
          }
        ]
      }
    ]);

    const rows = Array.from(container?.querySelectorAll('tbody tr') ?? []);
    const rowsForBlock = rows.filter((row) => row.textContent?.includes('400-2'));

    expect(rowsForBlock).toHaveLength(3);
    expect(rowsForBlock[0]?.textContent).toContain('BEGIN');
    expect(rowsForBlock[0]?.textContent).not.toContain('END');
    expect(rowsForBlock[1]?.textContent).not.toContain('BEGIN');
    expect(rowsForBlock[1]?.textContent).not.toContain('END');
    expect(rowsForBlock[2]?.textContent).toContain('END');
  });

  it('shows non-master deltas on newly added trips when they inherit a delta source', () => {
    render(
      [
        {
          routeName: '400 (Weekday) (North)',
          stops: ['Park Place', 'RVH Main Entrance'],
          stopIds: { 'Park Place': 'P4', 'RVH Main Entrance': 'RVH' },
          trips: [
            {
              id: 'north-added',
              lineageId: 'ln:new-trip',
              deltaSourceTripId: 'north-original',
              deltaSourceLineageId: 'ln:orig-trip',
              deltaSourceRouteName: '400 (Weekday) (North)',
              blockId: '400-2',
              direction: 'North',
              tripNumber: 1,
              rowId: 10,
              startTime: 1051,
              endTime: 1075,
              recoveryTime: 5,
              travelTime: 24,
              cycleTime: 29,
              stops: { 'Park Place': '5:31 PM', 'RVH Main Entrance': '5:55 PM' },
              arrivalTimes: { 'Park Place': '5:31 PM', 'RVH Main Entrance': '5:55 PM' },
              stopMinutes: { 'Park Place': 1051, 'RVH Main Entrance': 1075 }
            }
          ]
        },
        {
          routeName: '400 (Weekday) (South)',
          stops: ['RVH Main Entrance', 'Park Place'],
          stopIds: { 'RVH Main Entrance': 'RVH', 'Park Place': 'P4' },
          trips: []
        }
      ],
      {
        originalSchedules: [
          {
            routeName: '400 (Weekday) (North)',
            stops: ['Park Place', 'RVH Main Entrance'],
            stopIds: { 'Park Place': 'P4', 'RVH Main Entrance': 'RVH' },
            trips: [
              {
                id: 'north-original',
                lineageId: 'ln:orig-trip',
                blockId: '400-1',
                direction: 'North',
                tripNumber: 1,
                rowId: 1,
                startTime: 1050,
                endTime: 1074,
                recoveryTime: 5,
                travelTime: 24,
                cycleTime: 29,
                stops: { 'Park Place': '5:30 PM', 'RVH Main Entrance': '5:54 PM' },
                arrivalTimes: { 'Park Place': '5:30 PM', 'RVH Main Entrance': '5:54 PM' },
                stopMinutes: { 'Park Place': 1050, 'RVH Main Entrance': 1074 }
              }
            ]
          }
        ]
      }
    );

    const rowsForBlock = Array.from(container?.querySelectorAll('tbody tr') ?? []).filter(
      (row) => row.textContent?.includes('400-2')
    );

    expect(rowsForBlock).toHaveLength(1);
    expect(rowsForBlock[0]?.textContent).toContain('+1');
  });
});
