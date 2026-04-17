import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useAddTrip } from '../hooks/useAddTrip';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const buildSchedules = (): MasterRouteTable[] => ([
  {
    routeName: '2 (Weekday) (North)',
    stops: ['Park Place', 'Downtown'],
    stopIds: { 'Park Place': '777', Downtown: '1' },
    trips: [
      {
        id: 'north-1',
        blockId: '2-WD-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 360,
        endTime: 390,
        recoveryTime: 5,
        travelTime: 30,
        cycleTime: 35,
        stops: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' },
        arrivalTimes: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' }
      }
    ]
  },
  {
    routeName: '2 (Weekday) (South)',
    stops: ['Downtown', 'Park Place'],
    stopIds: { Downtown: '1', 'Park Place': '777' },
    trips: [
      {
        id: 'south-1',
        blockId: '2-WD-1',
        direction: 'South',
        tripNumber: 2,
        rowId: 2,
        startTime: 395,
        endTime: 425,
        recoveryTime: 5,
        travelTime: 30,
        cycleTime: 35,
        stops: { Downtown: '6:35 AM', 'Park Place': '7:05 AM' },
        arrivalTimes: { Downtown: '6:35 AM', 'Park Place': '7:05 AM' }
      }
    ]
  }
]) as MasterRouteTable[];

describe('useAddTrip', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latestModalContext: ReturnType<typeof useAddTrip>['modalContext'] = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestModalContext = null;
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

  it('defaults row-triggered paired routes to custom trip mode', () => {
    const Harness: React.FC = () => {
      const [schedules] = React.useState(buildSchedules());
      const addTrip = useAddTrip({
        schedules,
        setSchedules: () => {}
      });

      latestModalContext = addTrip.modalContext;

      return (
        <button
          type="button"
          onClick={() => addTrip.openModal('north-1', { north: schedules[0], south: schedules[1] }, 'after')}
        >
          Open
        </button>
      );
    };

    flushSync(() => {
      root?.render(<Harness />);
    });

    const openButton = container?.querySelector('button') as HTMLButtonElement | null;

    flushSync(() => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(latestModalContext?.preferredServiceMode).toBe('custom');
  });

  it('opens edit mode with the current trip start time and stop span preloaded', () => {
    const Harness: React.FC = () => {
      const [schedules] = React.useState(buildSchedules());
      const addTrip = useAddTrip({
        schedules,
        setSchedules: () => {}
      });

      latestModalContext = addTrip.modalContext;

      return (
        <button
          type="button"
          onClick={() => addTrip.openEditModal('north-1')}
        >
          Edit
        </button>
      );
    };

    flushSync(() => {
      root?.render(<Harness />);
    });

    const editButton = container?.querySelector('button') as HTMLButtonElement | null;

    flushSync(() => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(latestModalContext?.actionMode).toBe('edit');
    expect(latestModalContext?.initialStartTime).toBe(360);
    expect(latestModalContext?.initialStopSelection).toEqual({
      startStopName: 'Park Place',
      endStopName: 'Downtown'
    });
  });
});
