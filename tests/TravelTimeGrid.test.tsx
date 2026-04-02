import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TravelTimeGrid } from '../components/TravelTimeGrid';

const schedules = [
  {
    routeName: '2 (Weekday) (North)',
    stops: ['A', 'B'],
    stopIds: {},
    trips: [
      {
        id: 'overnight-trip',
        blockId: '2-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 24 * 60 + 30,
        endTime: 25 * 60 + 3,
        recoveryTime: 3,
        recoveryTimes: { B: 3 },
        travelTime: 30,
        cycleTime: 33,
        stops: {
          A: '12:30 AM',
          B: '1:03 AM'
        },
        arrivalTimes: {
          A: '12:30 AM',
          B: '1:00 AM'
        },
        stopMinutes: {
          A: 24 * 60 + 30,
          B: 25 * 60 + 3
        }
      }
    ]
  }
] as any[];

describe('TravelTimeGrid', () => {
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

  it('renders post-midnight rows using the first displayed segment hour', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(<TravelTimeGrid schedules={schedules} />);
    });

    expect(container?.textContent).toContain('25:00');
    expect(container?.textContent).toContain('30');
  });

  it('exposes per-cell controls to keyboard focus', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(<TravelTimeGrid schedules={schedules} />);
    });

    const travelDownButtons = container?.querySelectorAll('button[title="-1 travel"]');
    const recoveryDownButtons = container?.querySelectorAll('button[title="-1 recovery"]');
    const travelDownButton = travelDownButtons?.[travelDownButtons.length - 1] as HTMLButtonElement | null;
    const recoveryDownButton = recoveryDownButtons?.[recoveryDownButtons.length - 1] as HTMLButtonElement | null;

    expect(travelDownButton?.className).toContain('group-focus-within/cell:opacity-100');
    expect(travelDownButton?.className).toContain('focus:opacity-100');
    expect(recoveryDownButton?.className).toContain('group-focus-within/cell:opacity-100');
    expect(recoveryDownButton?.className).toContain('focus:opacity-100');
  });

  it('keeps each hourly row tied to one trip context instead of mixing trips', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TravelTimeGrid
          schedules={[
            {
              routeName: '2 (Weekday) (North)',
              stops: ['A', 'B', 'C'],
              stopIds: {},
              trips: [
                {
                  id: 'trip-1',
                  blockId: '2-1',
                  direction: 'North',
                  tripNumber: 1,
                  rowId: 1,
                  startTime: 420,
                  endTime: 433,
                  recoveryTime: 0,
                  travelTime: 13,
                  cycleTime: 13,
                  stops: {
                    A: '7:00 AM',
                    B: '7:13 AM',
                    C: ''
                  },
                  arrivalTimes: {
                    A: '7:00 AM',
                    B: '7:13 AM',
                    C: ''
                  },
                  stopMinutes: {
                    A: 420,
                    B: 433
                  }
                },
                {
                  id: 'trip-2',
                  blockId: '2-2',
                  direction: 'North',
                  tripNumber: 2,
                  rowId: 2,
                  startTime: 435,
                  endTime: 464,
                  recoveryTime: 0,
                  travelTime: 29,
                  cycleTime: 29,
                  stops: {
                    A: '',
                    B: '7:15 AM',
                    C: '7:44 AM'
                  },
                  arrivalTimes: {
                    A: '',
                    B: '7:15 AM',
                    C: '7:44 AM'
                  },
                  stopMinutes: {
                    B: 435,
                    C: 464
                  }
                }
              ]
            }
          ] as any}
        />
      );
    });

    const firstRow = container?.querySelector('tbody tr') as HTMLTableRowElement | null;
    expect(firstRow?.textContent).toContain('13');
    expect(firstRow?.textContent).not.toContain('29');
    expect(container?.textContent).toContain('First displayed segment data in hour');
  });

  it('buckets by the first displayed segment data hour instead of the raw trip start time', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TravelTimeGrid
          schedules={[
            {
              routeName: '2 (Weekday) (North)',
              stops: ['Depot', 'Depot (Platform)', 'Main'],
              stopIds: {},
              trips: [
                {
                  id: 'trip-boundary',
                  blockId: '2-1',
                  direction: 'North',
                  tripNumber: 1,
                  rowId: 1,
                  startTime: 415, // 6:55 AM
                  endTime: 430,
                  recoveryTime: 0,
                  travelTime: 15,
                  cycleTime: 15,
                  stops: {
                    Depot: '6:55 AM',
                    'Depot (Platform)': '7:00 AM',
                    Main: '7:10 AM'
                  },
                  arrivalTimes: {
                    Depot: '6:55 AM',
                    'Depot (Platform)': '7:00 AM',
                    Main: '7:10 AM'
                  },
                  stopMinutes: {
                    Depot: 415,
                    'Depot (Platform)': 420,
                    Main: 430
                  }
                }
              ]
            }
          ] as any}
        />
      );
    });

    expect(container?.textContent).not.toContain('6 AM');
    expect(container?.textContent).toContain('7 AM');
    expect(container?.textContent).toContain('10');
  });
});
