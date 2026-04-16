import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../hooks/useAddTrip', () => ({
  useAddTrip: () => ({
    modalContext: null as any,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    handleConfirm: vi.fn(),
  }),
}));

vi.mock('../components/AuditLogPanel', () => ({
  useAuditLog: () => ({ entries: [] as any[], logAction: vi.fn((): void => undefined) }),
  AuditLogPanel: (): null => null,
}));

vi.mock('../components/NewSchedule/TripContextMenu', () => ({
  TripContextMenu: (): null => null,
}));

vi.mock('../components/ui/CascadeModeSelector', () => ({
  CascadeModeSelector: (): null => null,
}));

import { ScheduleEditor } from '../components/ScheduleEditor';

describe('ScheduleEditor integration', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const onSchedulesChange = vi.fn();

  beforeEach(() => {
    onSchedulesChange.mockReset();
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

  it('mounts the real round-trip grid inside ScheduleEditor and commits an inline time edit', () => {
    flushSync(() => {
      root?.render(
        <ScheduleEditor
          embedded
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['North Terminal', 'South Terminal'],
              stopIds: { 'North Terminal': '1001', 'South Terminal': '1002' },
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
                  stops: {
                    'North Terminal': '7:00 AM',
                    'South Terminal': '7:30 AM',
                  },
                  arrivalTimes: {
                    'North Terminal': '7:00 AM',
                    'South Terminal': '7:30 AM',
                  },
                },
              ],
            },
            {
              routeName: '10 (Weekday) (South)',
              stops: ['South Terminal', 'North Terminal'],
              stopIds: { 'South Terminal': '2001', 'North Terminal': '2002' },
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
                  stops: {
                    'South Terminal': '7:35 AM',
                    'North Terminal': '8:05 AM',
                  },
                  arrivalTimes: {
                    'South Terminal': '7:35 AM',
                    'North Terminal': '8:05 AM',
                  },
                },
              ],
            },
          ] as any}
          onSchedulesChange={onSchedulesChange}
        />,
      );
    });

    const gridRegion = container?.querySelector('[role="region"][aria-label="Round-trip schedule editor grid"]');
    expect(gridRegion).not.toBeNull();

    const departureButton = container?.querySelector(
      'button[aria-label*="North Terminal"][aria-label*="departure time"]',
    ) as HTMLButtonElement | null;

    expect(departureButton).not.toBeNull();

    flushSync(() => {
      departureButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = container?.querySelector(
      'input[aria-label*="North Terminal"][aria-label*="departure time"]',
    ) as HTMLInputElement | null;

    expect(input).not.toBeNull();

    const setInputValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;

    flushSync(() => {
      setInputValue?.call(input, '7:05 AM');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const updatedSchedules = onSchedulesChange.mock.calls.at(-1)?.[0];
    const updatedNorthTrip = updatedSchedules?.find((table: any) => table.routeName === '10 (Weekday) (North)')?.trips?.[0];
    const updatedSouthTrip = updatedSchedules?.find((table: any) => table.routeName === '10 (Weekday) (South)')?.trips?.[0];

    expect(updatedNorthTrip?.stops?.['North Terminal']).toBe('7:05 AM');
    expect(updatedNorthTrip?.stops?.['South Terminal']).toBe('7:35 AM');
    expect(updatedNorthTrip?.startTime).toBe(425);
    expect(updatedNorthTrip?.endTime).toBe(455);
    expect(updatedSouthTrip?.stops?.['South Terminal']).toBe('7:40 AM');
  });
});
