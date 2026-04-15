import React, { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const {
  validateRouteTableMock,
  reassignBlocksForTablesMock,
  createTripLineageIdMock,
} = vi.hoisted(() => ({
  validateRouteTableMock: vi.fn(() => []),
  reassignBlocksForTablesMock: vi.fn(),
  createTripLineageIdMock: vi.fn(() => 'lineage-new'),
}));

vi.mock('../utils/parsers/masterScheduleParser', async () => {
  const actual = await vi.importActual<typeof import('../utils/parsers/masterScheduleParser')>(
    '../utils/parsers/masterScheduleParser',
  );

  return {
    ...actual,
    validateRouteTable: validateRouteTableMock,
  };
});

vi.mock('../utils/blocks/blockAssignmentCore', () => ({
  reassignBlocksForTables: reassignBlocksForTablesMock,
  MatchConfigPresets: {
    editor: { mode: 'editor' },
    merged: { mode: 'merged' },
  },
}));

vi.mock('../utils/schedule/tripLineage', () => ({
  createTripLineageId: createTripLineageIdMock,
}));

import { useScheduleEditing, type UseScheduleEditingOptions } from '../hooks/useScheduleEditing';

type ScheduleEditingApi = ReturnType<typeof useScheduleEditing>;

function Harness({
  schedules,
  onSchedulesChange,
  options,
  onReady,
}: {
  schedules: any[];
  onSchedulesChange: (schedules: any[]) => void;
  options?: UseScheduleEditingOptions;
  onReady: (api: ScheduleEditingApi) => void;
}): null {
  const api = useScheduleEditing(schedules, onSchedulesChange, options);

  useLayoutEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

const buildSchedules = () => ([
  {
    routeName: '2 (Weekday) (North)',
    stops: ['Stop 1', 'Stop 2'],
    stopIds: {},
    trips: [
      {
        id: 'north-1',
        blockId: '2-1',
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
          'Stop 2': '7:30 AM',
        },
        arrivalTimes: {
          'Stop 1': '7:00 AM',
          'Stop 2': '7:30 AM',
        },
      },
    ],
  },
  {
    routeName: '2 (Weekday) (South)',
    stops: ['Stop 1', 'Stop 2'],
    stopIds: {},
    trips: [
      {
        id: 'south-1',
        blockId: '2-1',
        direction: 'South',
        tripNumber: 1,
        rowId: 2,
        startTime: 455,
        endTime: 485,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: {
          'Stop 1': '7:35 AM',
          'Stop 2': '8:05 AM',
        },
        arrivalTimes: {
          'Stop 1': '7:35 AM',
          'Stop 2': '8:05 AM',
        },
      },
    ],
  },
]) as any[];

describe('useScheduleEditing', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let api: ScheduleEditingApi | null = null;
  let latestSchedules: any[] | null = null;
  const onSchedulesChange = vi.fn((next: any[]) => {
    latestSchedules = next;
  });
  const logAction = vi.fn();
  const showSuccessToast = vi.fn();

  beforeEach(() => {
    validateRouteTableMock.mockClear();
    reassignBlocksForTablesMock.mockClear();
    createTripLineageIdMock.mockClear();
    onSchedulesChange.mockClear();
    logAction.mockClear();
    showSuccessToast.mockClear();
    latestSchedules = null;
    api = null;

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
    latestSchedules = null;
    api = null;
    vi.unstubAllGlobals();
  });

  const renderHarness = (schedules = buildSchedules(), options?: UseScheduleEditingOptions) => {
    flushSync(() => {
      root?.render(
        <Harness
          schedules={schedules}
          onSchedulesChange={onSchedulesChange}
          options={options}
          onReady={(value) => {
            api = value;
          }}
        />,
      );
    });
  };

  it('duplicates a trip, shifts its times by one minute, and reassigns related blocks', () => {
    renderHarness(buildSchedules(), { logAction, showSuccessToast });

    flushSync(() => {
      api?.handleDuplicateTrip('north-1');
    });

    const northTable = latestSchedules?.find((table) => table.routeName === '2 (Weekday) (North)');
    const duplicate = northTable?.trips.find((trip: any) => trip.id !== 'north-1');

    expect(northTable?.trips).toHaveLength(2);
    expect(duplicate).toEqual(expect.objectContaining({
      lineageId: 'lineage-new',
      startTime: 421,
      endTime: 451,
      tripNumber: 2,
    }));
    expect(duplicate?.stops?.['Stop 1']).toBe('7:01 AM');
    expect(duplicate?.stops?.['Stop 2']).toBe('7:31 AM');
    expect(reassignBlocksForTablesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ routeName: '2 (Weekday) (North)' }),
        expect.objectContaining({ routeName: '2 (Weekday) (South)' }),
      ]),
      '2',
      { mode: 'merged' },
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Trip duplicated');
  });

  it('deletes a trip after confirmation and validates the changed table', () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderHarness(buildSchedules(), { logAction });

    flushSync(() => {
      api?.handleDeleteTrip('north-1');
    });

    const northTable = latestSchedules?.find((table) => table.routeName === '2 (Weekday) (North)');
    expect(northTable?.trips).toHaveLength(0);
    expect(validateRouteTableMock).toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledWith(
      'delete',
      'Deleted trip from Block 2-1',
      expect.objectContaining({
        tripId: 'north-1',
        blockId: '2-1',
      }),
    );
  });

  it('updates the route name and trip directions when the table direction changes', () => {
    renderHarness(buildSchedules(), { logAction });

    flushSync(() => {
      api?.handleDirectionChange('2 (Weekday) (North)', 'South');
    });

    const updatedTable = latestSchedules?.find((table) => table.routeName === '2 (Weekday) (South)');
    expect(updatedTable).toBeTruthy();
    expect(updatedTable?.trips.every((trip: any) => trip.direction === 'South')).toBe(true);
    expect(logAction).toHaveBeenCalledWith(
      'edit',
      'Set direction to South',
      expect.objectContaining({
        oldValue: '2 (Weekday) (North)',
        newValue: '2 (Weekday) (South)',
      }),
    );
  });

  it('cascades a direct cell edit through the trip and the rest of the block when cascade mode is always', () => {
    renderHarness(buildSchedules(), { logAction });

    flushSync(() => {
      api?.handleCellEdit('north-1', 'Stop 1', '7:05 AM');
    });

    const updatedNorth = latestSchedules?.find((table) => table.routeName === '2 (Weekday) (North)')?.trips?.[0];
    const updatedSouth = latestSchedules?.find((table) => table.routeName === '2 (Weekday) (South)')?.trips?.[0];

    expect(updatedNorth?.stops?.['Stop 1']).toBe('7:05 AM');
    expect(updatedNorth?.stops?.['Stop 2']).toBe('7:35 AM');
    expect(updatedNorth?.startTime).toBe(425);
    expect(updatedNorth?.endTime).toBe(455);
    expect(updatedSouth?.stops?.['Stop 1']).toBe('7:40 AM');
    expect(updatedSouth?.stops?.['Stop 2']).toBe('8:10 AM');
    expect(reassignBlocksForTablesMock).toHaveBeenCalled();
  });

  it('clamps recovery edits at zero and shifts later stops by the actual delta only', () => {
    const schedules = [
      {
        routeName: '2 (Weekday) (North)',
        stops: ['A', 'B', 'C'],
        stopIds: {},
        trips: [
          {
            id: 'north-1',
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
              C: '8:00 AM',
            },
            arrivalTimes: {
              A: '7:00 AM',
              B: '7:30 AM',
              C: '8:00 AM',
            },
          },
        ],
      },
    ] as any[];

    renderHarness(schedules);

    flushSync(() => {
      api?.handleRecoveryEdit('north-1', 'B', -10);
    });

    const updatedNorth = latestSchedules?.[0]?.trips?.[0];

    expect(updatedNorth?.recoveryTimes?.B).toBe(0);
    expect(updatedNorth?.recoveryTime).toBe(0);
    expect(updatedNorth?.stops?.B).toBe('7:33 AM');
    expect(updatedNorth?.stops?.C).toBe('7:57 AM');
    expect(updatedNorth?.arrivalTimes?.C).toBe('7:57 AM');
    expect(updatedNorth?.endTime).toBe(477);
    expect(updatedNorth?.travelTime).toBe(57);
    expect(updatedNorth?.cycleTime).toBe(57);
  });

  it('treats terminal recovery edits as non-propagating and does not reassign blocks', () => {
    const schedules = buildSchedules();
    renderHarness(schedules);

    flushSync(() => {
      api?.handleRecoveryEdit('south-1', 'Stop 2', 2);
    });

    const updatedSouth = latestSchedules?.find((table) => table.routeName === '2 (Weekday) (South)')?.trips?.[0];
    const unchangedNorth = latestSchedules?.find((table) => table.routeName === '2 (Weekday) (North)')?.trips?.[0];

    expect(updatedSouth?.recoveryTimes?.['Stop 2']).toBe(2);
    expect(updatedSouth?.recoveryTime).toBe(2);
    expect(updatedSouth?.stops?.['Stop 2']).toBe('8:05 AM');
    expect(updatedSouth?.arrivalTimes?.['Stop 2']).toBe('8:05 AM');
    expect(updatedSouth?.endTime).toBe(485);
    expect(updatedSouth?.travelTime).toBe(30);
    expect(updatedSouth?.cycleTime).toBe(32);
    expect(unchangedNorth?.stops?.['Stop 1']).toBe('7:00 AM');
    expect(unchangedNorth?.blockId).toBe('2-1');
    expect(reassignBlocksForTablesMock).not.toHaveBeenCalled();
  });

  it('does nothing when trip deletion is cancelled by the user', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    renderHarness(buildSchedules());

    flushSync(() => {
      api?.handleDeleteTrip('north-1');
    });

    expect(onSchedulesChange).not.toHaveBeenCalled();
    expect(latestSchedules).toBeNull();
  });
});
