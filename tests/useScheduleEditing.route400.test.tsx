import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useScheduleEditing } from '../hooks/useScheduleEditing';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const loadRoute400Weekday = (): MasterRouteTable[] => [{
  routeName: '400 (Weekday)',
  stops: ['Park Place', 'RVH', 'Park Place (2)'],
  stopIds: { 'Park Place': '777', RVH: '612', 'Park Place (2)': '777' },
  trips: [
    {
      id: '400-T-4', blockId: '400-1', direction: 'North', tripNumber: 1, rowId: 4,
      startTime: 410, endTime: 440, recoveryTime: 5, recoveryTimes: { 'Park Place (2)': 5 },
      travelTime: 25, cycleTime: 30,
      stops: { 'Park Place': '6:50 AM', RVH: '7:00 AM', 'Park Place (2)': '7:20 AM' },
      stopMinutes: { 'Park Place': 410, RVH: 420, 'Park Place (2)': 440 },
    },
    {
      id: '400-T-5', blockId: '400-2', direction: 'North', tripNumber: 1, rowId: 5,
      startTime: 410, endTime: 470, recoveryTime: 13,
      recoveryTimes: { RVH: 6, 'Park Place (2)': 7 },
      travelTime: 47, cycleTime: 60,
      stops: { 'Park Place': '6:50 AM', RVH: '7:18 AM', 'Park Place (2)': '7:50 AM' },
      stopMinutes: { 'Park Place': 410, RVH: 438, 'Park Place (2)': 470 },
    },
    {
      id: '400-T-6', blockId: '400-1', direction: 'North', tripNumber: 2, rowId: 6,
      startTime: 440, endTime: 500, recoveryTime: 13,
      recoveryTimes: { RVH: 6, 'Park Place (2)': 7 },
      travelTime: 47, cycleTime: 60,
      stops: { 'Park Place': '7:20 AM', RVH: '7:48 AM', 'Park Place (2)': '8:20 AM' },
      stopMinutes: { 'Park Place': 440, RVH: 468, 'Park Place (2)': 500 },
    },
    {
      id: '400-T-7', blockId: '400-2', direction: 'North', tripNumber: 2, rowId: 7,
      startTime: 470, endTime: 530, recoveryTime: 13,
      recoveryTimes: { RVH: 9, 'Park Place (2)': 4 },
      travelTime: 47, cycleTime: 60,
      stops: { 'Park Place': '7:50 AM', RVH: '8:21 AM', 'Park Place (2)': '8:50 AM' },
      stopMinutes: { 'Park Place': 470, RVH: 501, 'Park Place (2)': 530 },
    },
  ],
}];

const Harness: React.FC<{ initialSchedules: MasterRouteTable[] }> = ({ initialSchedules }) => {
  const [schedules, setSchedules] = useState(initialSchedules);
  const { handleTimeAdjust } = useScheduleEditing(schedules, setSchedules);

  return (
    <div>
      <button type="button" onClick={() => handleTimeAdjust('400-T-5', 'RVH', 1)}>
        Move block 400-2 at stop 612
      </button>
      <pre data-testid="state">{JSON.stringify(schedules)}</pre>
    </div>
  );
};

describe('useScheduleEditing Route 400 block continuity', () => {
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

  it('keeps the two imported blocks intact after a one-minute RVH edit', () => {
    const schedules = loadRoute400Weekday();
    const originalAssignments = schedules[0].trips.map(({ id, blockId, tripNumber }) => ({
      id,
      blockId,
      tripNumber,
    }));

    flushSync(() => {
      root?.render(<Harness initialSchedules={schedules} />);
    });

    const editButton = container?.querySelector('button') as HTMLButtonElement | null;
    flushSync(() => editButton?.click());

    const updatedSchedules = JSON.parse(
      container?.querySelector('[data-testid="state"]')?.textContent ?? '[]',
    ) as MasterRouteTable[];
    const updatedTrips = updatedSchedules[0].trips;

    expect(updatedTrips.find((trip) => trip.id === '400-T-5')?.stops.RVH).toBe('7:19 AM');
    expect(updatedTrips.find((trip) => trip.id === '400-T-7')?.stops.RVH).toBe('8:22 AM');
    expect(updatedTrips.map(({ id, blockId, tripNumber }) => ({ id, blockId, tripNumber })))
      .toEqual(originalAssignments);
    expect(new Set(updatedTrips.map((trip) => trip.blockId))).toEqual(new Set(['400-1', '400-2']));
  });
});
