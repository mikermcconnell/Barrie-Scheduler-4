import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TimelineView } from '../components/NewSchedule/TimelineView';

describe('TimelineView', () => {
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

  it('shows next-day hour labels for post-midnight service', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TimelineView
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['Stop 1', 'Stop 2'],
              stopIds: {},
              trips: [
                {
                  id: 'trip-1',
                  blockId: '10-1',
                  direction: 'North',
                  tripNumber: 1,
                  rowId: 1,
                  startTime: 1470,
                  endTime: 1500,
                  recoveryTime: 0,
                  travelTime: 30,
                  cycleTime: 30,
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
            }
          ] as any}
        />
      );
    });

    expect(container?.textContent).toContain('12 AM +1');
    expect(container?.textContent).toContain('1 AM +1');
  });

  it('counts recovery-time collisions as overlapping trips', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TimelineView
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['Stop 1', 'Stop 2'],
              stopIds: {},
              trips: [
                {
                  id: 'trip-1',
                  blockId: '10-1',
                  direction: 'North',
                  tripNumber: 1,
                  rowId: 1,
                  startTime: 420,
                  endTime: 450,
                  recoveryTime: 10,
                  travelTime: 30,
                  cycleTime: 40,
                  stops: {
                    'Stop 1': '7:00 AM',
                    'Stop 2': '7:30 AM'
                  },
                  arrivalTimes: {
                    'Stop 1': '7:00 AM',
                    'Stop 2': '7:30 AM'
                  }
                },
                {
                  id: 'trip-2',
                  blockId: '10-1',
                  direction: 'North',
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
          ] as any}
        />
      );
    });

    expect(container?.textContent).toContain('2 overlapping trips');
  });

  it('only commits dragged trip changes when the drag ends', () => {
    const onTripTimeChange = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TimelineView
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['Stop 1', 'Stop 2'],
              stopIds: {},
              trips: [
                {
                  id: 'trip-1',
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
            }
          ] as any}
          onTripTimeChange={onTripTimeChange}
        />
      );
    });

    const tripBar = container?.querySelector('[aria-label^="Trip 10-1 North"]') as HTMLElement | null;
    expect(tripBar).not.toBeNull();

    flushSync(() => {
      tripBar?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
    });

    expect(onTripTimeChange).not.toHaveBeenCalled();

    flushSync(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 130 }));
    });

    expect(onTripTimeChange).not.toHaveBeenCalled();
    expect(tripBar?.getAttribute('aria-label')).toContain('7:15 AM');

    flushSync(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 130 }));
    });

    expect(onTripTimeChange).toHaveBeenCalledTimes(1);
    expect(onTripTimeChange).toHaveBeenCalledWith('trip-1', 435, 30);
  });

  it('supports keyboard nudging for focused trips', () => {
    const onTripTimeChange = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TimelineView
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['Stop 1', 'Stop 2'],
              stopIds: {},
              trips: [
                {
                  id: 'trip-1',
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
            }
          ] as any}
          onTripTimeChange={onTripTimeChange}
        />
      );
    });

    const tripBar = container?.querySelector('[aria-label^="Trip 10-1 North"]') as HTMLElement | null;
    expect(tripBar).not.toBeNull();

    tripBar?.focus();

    flushSync(() => {
      tripBar?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });

    expect(onTripTimeChange).toHaveBeenCalledTimes(1);
    expect(onTripTimeChange).toHaveBeenCalledWith('trip-1', 421, 30);
  });
});
