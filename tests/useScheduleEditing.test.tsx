import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../utils/blocks/blockAssignmentCore', async () => {
  const actual = await vi.importActual<typeof import('../utils/blocks/blockAssignmentCore')>(
    '../utils/blocks/blockAssignmentCore'
  );

  return {
    ...actual,
    reassignBlocksForTables: vi.fn(),
    MatchConfigPresets: actual.MatchConfigPresets
  };
});

import { useScheduleEditing, type CascadeMode } from '../hooks/useScheduleEditing';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const buildSchedules = (): MasterRouteTable[] => ([
  {
    routeName: '10 (Weekday) (North)',
    stops: ['Stop 1', 'Stop 2', 'Stop 3'],
    stopIds: {},
    trips: [
      {
        id: 'north-trip',
        blockId: '10-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 420,
        endTime: 480,
        recoveryTime: 5,
        recoveryTimes: { 'Stop 2': 5 },
        travelTime: 55,
        cycleTime: 60,
        stops: {
          'Stop 1': '7:00 AM',
          'Stop 2': '7:30 AM',
          'Stop 3': '8:00 AM',
        },
        arrivalTimes: {
          'Stop 1': '7:00 AM',
          'Stop 2': '7:25 AM',
          'Stop 3': '8:00 AM',
        },
      },
      {
        id: 'north-trip-2',
        blockId: '10-1',
        direction: 'North',
        tripNumber: 3,
        rowId: 3,
        startTime: 520,
        endTime: 580,
        recoveryTime: 5,
        recoveryTimes: { 'Stop 2': 5 },
        travelTime: 55,
        cycleTime: 60,
        stops: {
          'Stop 1': '8:40 AM',
          'Stop 2': '9:10 AM',
          'Stop 3': '9:40 AM',
        },
        arrivalTimes: {
          'Stop 1': '8:40 AM',
          'Stop 2': '9:05 AM',
          'Stop 3': '9:40 AM',
        },
      },
    ],
  },
  {
    routeName: '10 (Weekday) (South)',
    stops: ['Stop A', 'Stop B'],
    stopIds: {},
    trips: [
      {
        id: 'south-trip',
        blockId: '10-1',
        direction: 'South',
        tripNumber: 2,
        rowId: 2,
        startTime: 485,
        endTime: 515,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: {
          'Stop A': '8:05 AM',
          'Stop B': '8:35 AM',
        },
        arrivalTimes: {
          'Stop A': '8:05 AM',
          'Stop B': '8:35 AM',
        },
      },
    ],
  },
]) as any;

const Harness: React.FC = () => {
  const [schedules, setSchedules] = useState<MasterRouteTable[]>(buildSchedules());
  const [cascadeMode, setCascadeMode] = useState<CascadeMode>('always');
  const { handleCellEdit, handleRecoveryEdit, handleDuplicateTrip } = useScheduleEditing(schedules, setSchedules, { cascadeMode });

  return (
    <div>
      <button data-testid="mode-always" onClick={() => setCascadeMode('always')}>always</button>
      <button data-testid="mode-within-trip" onClick={() => setCascadeMode('within-trip')}>within-trip</button>
      <button data-testid="mode-none" onClick={() => setCascadeMode('none')}>none</button>
      <button data-testid="edit-departure" onClick={() => handleCellEdit('north-trip', 'Stop 1', '7:05 AM')}>
        edit departure
      </button>
      <button data-testid="edit-arrival-mid" onClick={() => handleCellEdit('north-trip', 'Stop 2__ARR', '7:27 AM')}>
        edit arrival mid
      </button>
      <button data-testid="edit-departure-mid" onClick={() => handleCellEdit('north-trip', 'Stop 2', '7:33 AM')}>
        edit departure mid
      </button>
      <button data-testid="edit-recovery" onClick={() => handleRecoveryEdit('north-trip', 'Stop 2', 2)}>
        edit recovery
      </button>
      <button data-testid="edit-terminal-recovery" onClick={() => handleRecoveryEdit('north-trip', 'Stop 3', 2)}>
        edit terminal recovery
      </button>
      <button data-testid="duplicate-trip" onClick={() => handleDuplicateTrip('north-trip')}>
        duplicate trip
      </button>
      <pre data-testid="state">{JSON.stringify(schedules)}</pre>
    </div>
  );
};

describe('useScheduleEditing cascade modes', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root?.render(<Harness />);
    });
  });

  afterEach(() => {
    if (root) {
      flushSync(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  const getState = () => JSON.parse(container?.querySelector('[data-testid="state"]')?.textContent ?? '[]');

  it('defaults to cascading downstream trip times', () => {
    const editButton = container?.querySelector('[data-testid="edit-departure"]') as HTMLButtonElement | null;

    flushSync(() => {
      editButton?.click();
    });

    const schedules = getState();
    const northTrip = schedules[0].trips[0];
    const southTrip = schedules[1].trips[0];
    const laterNorthTrip = schedules[0].trips[1];

    expect(northTrip.stops['Stop 1']).toBe('7:05 AM');
    expect(northTrip.stops['Stop 2']).toBe('7:35 AM');
    expect(northTrip.stops['Stop 3']).toBe('8:05 AM');
    expect(southTrip.stops['Stop A']).toBe('8:10 AM');
    expect(laterNorthTrip.stops['Stop 1']).toBe('8:45 AM');
  });

  it('cascades within the current round-trip row only when trip-only mode is selected', () => {
    const modeWithinTripButton = container?.querySelector('[data-testid="mode-within-trip"]') as HTMLButtonElement | null;
    const editButton = container?.querySelector('[data-testid="edit-departure"]') as HTMLButtonElement | null;

    flushSync(() => {
      modeWithinTripButton?.click();
    });

    flushSync(() => {
      editButton?.click();
    });

    const schedules = getState();
    const northTrip = schedules[0].trips[0];
    const southTrip = schedules[1].trips[0];
    const laterNorthTrip = schedules[0].trips[1];

    expect(northTrip.stops['Stop 1']).toBe('7:05 AM');
    expect(northTrip.stops['Stop 2']).toBe('7:35 AM');
    expect(northTrip.stops['Stop 3']).toBe('8:05 AM');
    expect(southTrip.stops['Stop A']).toBe('8:10 AM');
    expect(laterNorthTrip.stops['Stop 1']).toBe('8:40 AM');
  });

  it('turns cascading off for recovery edits when single-cell mode is selected', () => {
    const modeNoneButton = container?.querySelector('[data-testid="mode-none"]') as HTMLButtonElement | null;
    const recoveryButton = container?.querySelector('[data-testid="edit-recovery"]') as HTMLButtonElement | null;

    flushSync(() => {
      modeNoneButton?.click();
    });

    flushSync(() => {
      recoveryButton?.click();
    });

    const schedules = getState();
    const northTrip = schedules[0].trips[0];
    const southTrip = schedules[1].trips[0];
    const laterNorthTrip = schedules[0].trips[1];

    expect(northTrip.recoveryTimes['Stop 2']).toBe(7);
    expect(northTrip.recoveryTime).toBe(7);
    expect(northTrip.stops['Stop 3']).toBe('8:00 AM');
    expect(southTrip.stops['Stop A']).toBe('8:05 AM');
    expect(laterNorthTrip.stops['Stop 1']).toBe('8:40 AM');
  });

  it('turns cascading off for arrival edits without mutating departure or later trips', () => {
    const modeNoneButton = container?.querySelector('[data-testid="mode-none"]') as HTMLButtonElement | null;
    const arrivalButton = container?.querySelector('[data-testid="edit-arrival-mid"]') as HTMLButtonElement | null;

    flushSync(() => {
      modeNoneButton?.click();
    });

    flushSync(() => {
      arrivalButton?.click();
    });

    const schedules = getState();
    const northTrip = schedules[0].trips[0];
    const southTrip = schedules[1].trips[0];
    const laterNorthTrip = schedules[0].trips[1];

    expect(northTrip.arrivalTimes['Stop 2']).toBe('7:27 AM');
    expect(northTrip.stops['Stop 2']).toBe('7:30 AM');
    expect(northTrip.recoveryTimes['Stop 2']).toBe(5);
    expect(northTrip.stops['Stop 3']).toBe('8:00 AM');
    expect(southTrip.stops['Stop A']).toBe('8:05 AM');
    expect(laterNorthTrip.stops['Stop 1']).toBe('8:40 AM');
  });

  it('turns cascading off for departure edits without mutating arrival or recovery', () => {
    const modeNoneButton = container?.querySelector('[data-testid="mode-none"]') as HTMLButtonElement | null;
    const departureButton = container?.querySelector('[data-testid="edit-departure-mid"]') as HTMLButtonElement | null;

    flushSync(() => {
      modeNoneButton?.click();
    });

    flushSync(() => {
      departureButton?.click();
    });

    const schedules = getState();
    const northTrip = schedules[0].trips[0];
    const southTrip = schedules[1].trips[0];
    const laterNorthTrip = schedules[0].trips[1];

    expect(northTrip.stops['Stop 2']).toBe('7:33 AM');
    expect(northTrip.arrivalTimes['Stop 2']).toBe('7:25 AM');
    expect(northTrip.recoveryTimes['Stop 2']).toBe(5);
    expect(northTrip.stops['Stop 3']).toBe('8:00 AM');
    expect(southTrip.stops['Stop A']).toBe('8:05 AM');
    expect(laterNorthTrip.stops['Stop 1']).toBe('8:40 AM');
  });

  it('propagates terminal recovery to the paired return trip in trip-only mode without touching later rows', () => {
    const modeWithinTripButton = container?.querySelector('[data-testid="mode-within-trip"]') as HTMLButtonElement | null;
    const terminalRecoveryButton = container?.querySelector('[data-testid="edit-terminal-recovery"]') as HTMLButtonElement | null;

    flushSync(() => {
      modeWithinTripButton?.click();
    });

    flushSync(() => {
      terminalRecoveryButton?.click();
    });

    const schedules = getState();
    const northTrip = schedules[0].trips[0];
    const southTrip = schedules[1].trips[0];
    const laterNorthTrip = schedules[0].trips[1];

    expect(northTrip.recoveryTimes['Stop 3']).toBe(2);
    expect(southTrip.stops['Stop A']).toBe('8:07 AM');
    expect(southTrip.stops['Stop B']).toBe('8:37 AM');
    expect(laterNorthTrip.stops['Stop 1']).toBe('8:40 AM');
  });

  it('keeps travel and cycle metrics consistent after a cascaded edit', () => {
    const editButton = container?.querySelector('[data-testid="edit-departure"]') as HTMLButtonElement | null;

    flushSync(() => {
      editButton?.click();
    });

    const schedules = getState();
    const northTrip = schedules[0].trips[0];

    expect(northTrip.startTime).toBe(425);
    expect(northTrip.endTime).toBe(485);
    expect(northTrip.travelTime).toBe(55);
    expect(northTrip.cycleTime).toBe(60);
  });

  it('assigns duplicated trips a new lineage and clears delta source anchors', () => {
    const duplicateButton = container?.querySelector('[data-testid="duplicate-trip"]') as HTMLButtonElement | null;

    flushSync(() => {
      duplicateButton?.click();
    });

    const schedules = getState();
    const originalTrip = schedules[0].trips.find((trip: any) => trip.id === 'north-trip');
    const duplicatedTrip = schedules[0].trips.find((trip: any) => String(trip.id).startsWith('north-trip-dup-'));

    expect(duplicatedTrip).toBeTruthy();
    expect(duplicatedTrip.lineageId).toBeTruthy();
    expect(duplicatedTrip.lineageId).not.toBe(originalTrip.lineageId);
    expect(duplicatedTrip.deltaSourceTripId).toBeUndefined();
    expect(duplicatedTrip.deltaSourceLineageId).toBeUndefined();
    expect(duplicatedTrip.deltaSourceRouteName).toBeUndefined();
  });
});
