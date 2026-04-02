import React, { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { reassignBlocksForTablesMock, validateRouteTableMock } = vi.hoisted(() => ({
  reassignBlocksForTablesMock: vi.fn(),
  validateRouteTableMock: vi.fn(() => []),
}));

vi.mock('../utils/parsers/masterScheduleParser', async () => {
  const actual = await vi.importActual<typeof import('../utils/parsers/masterScheduleParser')>(
    '../utils/parsers/masterScheduleParser'
  );

  return {
    ...actual,
    validateRouteTable: validateRouteTableMock
  };
});

vi.mock('../utils/blocks/blockAssignmentCore', () => ({
  reassignBlocksForTables: reassignBlocksForTablesMock,
  MatchConfigPresets: {
    editor: { mode: 'editor' }
  }
}));

import { useTravelTimeGrid } from '../hooks/useTravelTimeGrid';
import { calculateGridTravelMinutes } from '../utils/schedule/travelTimeGridUtils';

type HarnessApi = ReturnType<typeof useTravelTimeGrid>;

function Harness({
  schedules,
  onChange,
  onReady
}: {
  schedules: any[];
  onChange: (next: any[]) => void;
  onReady: (api: HarnessApi) => void;
}): null {
  const api = useTravelTimeGrid(schedules, onChange, vi.fn());

  useLayoutEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

const buildSchedules = () => ([
  {
    routeName: '2 (Weekday) (North)',
    stops: ['A', 'B', 'C'],
    stopIds: {},
    trips: [
      {
        id: 'north-trip',
        blockId: '2-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 420,
        endTime: 480,
        recoveryTime: 3,
        recoveryTimes: { B: 3 },
        travelTime: 57,
        cycleTime: 60,
        stops: {
          A: '7:00 AM',
          B: '7:33 AM',
          C: '8:00 AM'
        },
        arrivalTimes: {
          A: '7:00 AM',
          B: '7:30 AM',
          C: '8:00 AM'
        },
        stopMinutes: {
          A: 420,
          B: 453,
          C: 480
        }
      }
    ]
  },
  {
    routeName: '2 (Weekday) (South)',
    stops: ['A', 'B', 'C'],
    stopIds: {},
    trips: [
      {
        id: 'south-trip',
        blockId: '2-1',
        direction: 'South',
        tripNumber: 2,
        rowId: 2,
        startTime: 490,
        endTime: 550,
        recoveryTime: 0,
        travelTime: 60,
        cycleTime: 60,
        stops: {
          A: '8:10 AM',
          B: '8:40 AM',
          C: '9:10 AM'
        },
        arrivalTimes: {
          A: '8:10 AM',
          B: '8:40 AM',
          C: '9:10 AM'
        }
      }
    ]
  }
]) as any[];

describe('useTravelTimeGrid', () => {
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
    reassignBlocksForTablesMock.mockClear();
    validateRouteTableMock.mockClear();
  });

  it('keeps recovery edits internally consistent and reassigns related blocks', () => {
    const schedules = buildSchedules();
    let latest: any[] | null = null;
    let api: HarnessApi | null = null;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Harness
          schedules={schedules}
          onChange={next => {
            latest = next;
          }}
          onReady={value => {
            api = value;
          }}
        />
      );
    });

    expect(api).not.toBeNull();

    flushSync(() => {
      api!.handleBulkAdjustRecoveryTime('B', -5, '2 (Weekday) (North)');
    });

    expect(validateRouteTableMock).toHaveBeenCalledTimes(2);
    expect(reassignBlocksForTablesMock).toHaveBeenCalledTimes(1);
    expect(reassignBlocksForTablesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ routeName: '2 (Weekday) (North)' }),
        expect.objectContaining({ routeName: '2 (Weekday) (South)' })
      ]),
      '2',
      { mode: 'editor' }
    );

    const updatedNorth = latest?.find(table => table.routeName === '2 (Weekday) (North)');
    const updatedSouth = latest?.find(table => table.routeName === '2 (Weekday) (South)');
    const trip = updatedNorth?.trips[0];
    const southTrip = updatedSouth?.trips[0];

    expect(trip.recoveryTimes.B).toBe(0);
    expect(trip.recoveryTime).toBe(0);
    expect(trip.stops.B).toBe('7:30 AM');
    expect(trip.stops.C).toBe('7:57 AM');
    expect(trip.arrivalTimes.C).toBe('7:57 AM');
    expect(trip.stopMinutes.B).toBe(450);
    expect(trip.stopMinutes.C).toBe(477);
    expect(southTrip.stops.A).toBe('8:07 AM');
    expect(southTrip.stops.B).toBe('8:37 AM');
  });

  it('updates segment travel times when a travel adjustment shifts the destination stop', () => {
    const schedules = buildSchedules();
    schedules[0].trips.push({
      id: 'north-trip-later',
      blockId: '2-1',
      direction: 'North',
      tripNumber: 3,
      rowId: 3,
      startTime: 560,
      endTime: 620,
      recoveryTime: 0,
      travelTime: 60,
      cycleTime: 60,
      stops: {
        A: '9:20 AM',
        B: '9:50 AM',
        C: '10:20 AM'
      },
      arrivalTimes: {
        A: '9:20 AM',
        B: '9:50 AM',
        C: '10:20 AM'
      }
    });
    let latest: any[] | null = null;
    let api: HarnessApi | null = null;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Harness
          schedules={schedules}
          onChange={next => {
            latest = next;
          }}
          onReady={value => {
            api = value;
          }}
        />
      );
    });

    expect(api).not.toBeNull();

    flushSync(() => {
      api!.handleSingleTripTravelAdjust('north-trip', 'B', 5, '2 (Weekday) (North)');
    });

    const updatedNorth = latest?.find(table => table.routeName === '2 (Weekday) (North)');
    const updatedSouth = latest?.find(table => table.routeName === '2 (Weekday) (South)');
    const trip = updatedNorth?.trips[0];
    const laterNorthTrip = updatedNorth?.trips.find((candidate: any) => candidate.id === 'north-trip-later');
    const southTrip = updatedSouth?.trips[0];

    expect(trip.stops.B).toBe('7:38 AM');
    expect(trip.arrivalTimes.B).toBe('7:35 AM');
    expect(trip.arrivalTimes.C).toBe('8:05 AM');
    expect(trip.stopMinutes.B).toBe(458);
    expect(trip.stopMinutes.C).toBe(485);
    expect(calculateGridTravelMinutes(trip, 'A', 'B')).toBe(35);
    expect(southTrip.stops.A).toBe('8:15 AM');
    expect(southTrip.stops.B).toBe('8:45 AM');
    expect(laterNorthTrip.stops.A).toBe('9:20 AM');
    expect(laterNorthTrip.stops.B).toBe('9:50 AM');
  });

  it('applies bulk travel adjustments with the same destination-forward shift behavior as single-trip edits', () => {
    const schedules = buildSchedules();
    schedules[0].trips.push({
      id: 'north-trip-2',
      blockId: '2-2',
      direction: 'North',
      tripNumber: 2,
      rowId: 3,
      startTime: 450,
      endTime: 510,
      recoveryTime: 2,
      recoveryTimes: { B: 2 },
      travelTime: 58,
      cycleTime: 60,
      stops: {
        A: '7:30 AM',
        B: '8:02 AM',
        C: '8:30 AM'
      },
      arrivalTimes: {
        A: '7:30 AM',
        B: '8:00 AM',
        C: '8:30 AM'
      },
      stopMinutes: {
        A: 450,
        B: 482,
        C: 510
      }
    });

    let latest: any[] | null = null;
    let api: HarnessApi | null = null;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Harness
          schedules={schedules}
          onChange={next => {
            latest = next;
          }}
          onReady={value => {
            api = value;
          }}
        />
      );
    });

    expect(api).not.toBeNull();

    flushSync(() => {
      api!.handleBulkAdjustTravelTime('A', 'B', 5, '2 (Weekday) (North)');
    });

    expect(validateRouteTableMock).toHaveBeenCalledTimes(2);
    expect(reassignBlocksForTablesMock).toHaveBeenCalledTimes(1);

    const updatedNorth = latest?.find(table => table.routeName === '2 (Weekday) (North)');
    const [firstTrip, secondTrip] = updatedNorth?.trips ?? [];

    expect(firstTrip.stops.A).toBe('7:00 AM');
    expect(firstTrip.stops.B).toBe('7:38 AM');
    expect(firstTrip.arrivalTimes.B).toBe('7:35 AM');
    expect(firstTrip.stops.C).toBe('8:05 AM');
    expect(firstTrip.stopMinutes.B).toBe(458);
    expect(firstTrip.stopMinutes.C).toBe(485);
    expect(calculateGridTravelMinutes(firstTrip, 'A', 'B')).toBe(35);

    expect(secondTrip.stops.A).toBe('7:30 AM');
    expect(secondTrip.stops.B).toBe('8:07 AM');
    expect(secondTrip.arrivalTimes.B).toBe('8:05 AM');
    expect(secondTrip.stops.C).toBe('8:35 AM');
    expect(secondTrip.stopMinutes.B).toBe(487);
    expect(secondTrip.stopMinutes.C).toBe(515);
    expect(calculateGridTravelMinutes(secondTrip, 'A', 'B')).toBe(35);
  });

  it('skips trips that do not actually serve the edited travel segment during bulk adjustments', () => {
    const schedules = [
      {
        routeName: '7 (Weekday) (North)',
        stops: ['A', 'B', 'C', 'D'],
        stopIds: {},
        trips: [
          {
            id: 'full-trip',
            blockId: '7-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 420,
            endTime: 480,
            recoveryTime: 0,
            travelTime: 60,
            cycleTime: 60,
            stops: {
              A: '7:00 AM',
              B: '7:15 AM',
              C: '7:30 AM',
              D: '8:00 AM'
            },
            arrivalTimes: {
              A: '7:00 AM',
              B: '7:15 AM',
              C: '7:30 AM',
              D: '8:00 AM'
            },
            stopMinutes: {
              A: 420,
              B: 435,
              C: 450,
              D: 480
            }
          },
          {
            id: 'short-turn-trip',
            blockId: '7-2',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 430,
            endTime: 470,
            recoveryTime: 0,
            travelTime: 40,
            cycleTime: 40,
            stops: {
              A: '',
              B: '',
              C: '7:40 AM',
              D: '7:50 AM'
            },
            arrivalTimes: {
              A: '',
              B: '',
              C: '7:40 AM',
              D: '7:50 AM'
            },
            stopMinutes: {
              C: 460,
              D: 470
            }
          }
        ]
      }
    ] as any[];

    let latest: any[] | null = null;
    let api: HarnessApi | null = null;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Harness
          schedules={schedules}
          onChange={next => {
            latest = next;
          }}
          onReady={value => {
            api = value;
          }}
        />
      );
    });

    expect(api).not.toBeNull();

    flushSync(() => {
      api!.handleBulkAdjustTravelTime('A', 'B', 1, '7 (Weekday) (North)');
    });

    const updatedNorth = latest?.find(table => table.routeName === '7 (Weekday) (North)');
    const fullTrip = updatedNorth?.trips.find((trip: any) => trip.id === 'full-trip');
    const shortTurnTrip = updatedNorth?.trips.find((trip: any) => trip.id === 'short-turn-trip');

    expect(fullTrip.stops.B).toBe('7:16 AM');
    expect(fullTrip.stops.C).toBe('7:31 AM');
    expect(shortTurnTrip.stops.C).toBe('7:40 AM');
    expect(shortTurnTrip.stops.D).toBe('7:50 AM');
  });
});
