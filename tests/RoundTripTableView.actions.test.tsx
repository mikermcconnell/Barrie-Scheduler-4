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
      onDeleteTrip?: (...args: any[]) => void;
      onMenuOpen?: (...args: any[]) => void;
    }
  ) => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={schedules}
          onCellEdit={vi.fn()}
          onAddTrip={props?.onAddTrip}
          onDeleteTrip={props?.onDeleteTrip}
          onMenuOpen={props?.onMenuOpen}
        />
      );
    });
  };

  it('uses the row northbound trip when adding from the combined row', () => {
    const onAddTrip = vi.fn();

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
      { onAddTrip }
    );

    const addButton = container?.querySelector('button[aria-label="Add trip"]') as HTMLButtonElement | null;
    expect(addButton).not.toBeNull();

    addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onAddTrip).toHaveBeenCalledWith('north-trip');
  });

  it('shows the row actions menu button even on south-only rows', () => {
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

    const editButtons = Array.from(container?.querySelectorAll('button[aria-label="Round-trip actions"]') ?? []);
    expect(editButtons.length).toBeGreaterThan(1);

    const southOnlyEdit = editButtons.find(
      (button) => button.closest('tr')?.textContent?.includes('10-2')
    ) as HTMLButtonElement | undefined;

    expect(southOnlyEdit).toBeTruthy();

    southOnlyEdit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onMenuOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'south-only-trip',
        direction: 'South',
        blockId: '10-2',
        rowTripIds: ['south-only-trip'],
        hideTripSpecificActions: true
      })
    );
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
});
