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

describe('RoundTripTableView accessibility polish', () => {
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

  it('exposes a labeled grid region and selects the first populated cell on focus', () => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
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
          ] as any}
          onCellEdit={vi.fn()}
        />
      );
    });

    const region = container?.querySelector('[role="region"][aria-label="Round-trip schedule editor grid"]') as HTMLDivElement | null;
    const grid = container?.querySelector('table[role="grid"]');

    expect(region).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(region?.getAttribute('aria-describedby')).toBeTruthy();

    flushSync(() => {
      region?.focus();
    });

    const activeCellId = region?.getAttribute('aria-activedescendant');
    expect(activeCellId).toBeTruthy();

    const activeCell = activeCellId ? container?.querySelector(`[id="${activeCellId}"]`) : null;
    expect(activeCell).not.toBeNull();
    expect(activeCell?.getAttribute('aria-selected')).toBe('true');
    expect(activeCell?.getAttribute('aria-label')).toContain('Press Enter, F2, or Space to edit.');

    const timeButton = container?.querySelector('button[aria-label*="Press Enter, F2, or Space to edit."]');
    expect(timeButton).not.toBeNull();
  });

  it('does not freeze the first schedule column in the combined view', () => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
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
          ] as any}
          onCellEdit={vi.fn()}
        />
      );
    });

    const stickyCells = Array.from(container?.querySelectorAll('th, td') ?? []).filter((element) => {
      const className = element.getAttribute('class') ?? '';
      return className.includes('sticky left-0') || className.includes('sticky left-14');
    });

    expect(stickyCells).toHaveLength(0);
  });

  it('shows departure-train matches on arrival cells and arrival-train matches on departure cells', () => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
            {
              routeName: '11 (Weekday) (North)',
              stops: ['Park Place', 'Barrie South GO'],
              stopIds: { 'Park Place': '777', 'Barrie South GO': '725' },
              trips: [
                {
                  id: 'north-trip',
                  blockId: '11-1',
                  direction: 'North',
                  tripNumber: 1,
                  rowId: 1,
                  startTime: 360,
                  endTime: 390,
                  recoveryTime: 3,
                  travelTime: 30,
                  cycleTime: 33,
                  stops: { 'Park Place': '5:54 AM', 'Barrie South GO': '6:05 AM' },
                  arrivalTimes: { 'Barrie South GO': '6:05 AM' },
                  stopMinutes: { 'Park Place': 354, 'Barrie South GO': 365 },
                  recoveryTimes: { 'Barrie South GO': 3 }
                }
              ]
            },
            {
              routeName: '11 (Weekday) (South)',
              stops: ['Downtown Terminal'],
              stopIds: { 'Downtown Terminal': '001' },
              trips: [
                {
                  id: 'south-trip',
                  blockId: '11-1',
                  direction: 'South',
                  tripNumber: 2,
                  rowId: 2,
                  startTime: 455,
                  endTime: 485,
                  recoveryTime: 0,
                  travelTime: 30,
                  cycleTime: 30,
                  stops: { 'Downtown Terminal': '7:35 AM' },
                  arrivalTimes: { 'Downtown Terminal': '7:35 AM' },
                  stopMinutes: { 'Downtown Terminal': 455 }
                }
              ]
            }
          ] as any}
          connectionLibrary={{
            targets: [
              {
                id: 'go-departure',
                name: 'Barrie South GO Departures',
                type: 'manual',
                stopCode: '725',
                defaultEventType: 'departure',
                icon: 'train',
                createdAt: '2026-03-30T00:00:00.000Z',
                updatedAt: '2026-03-30T00:00:00.000Z',
                times: [
                  {
                    id: 'dep-1',
                    time: 377,
                    enabled: true,
                    daysActive: ['Weekday'],
                    eventType: 'departure'
                  }
                ]
              },
              {
                id: 'go-arrival',
                name: 'Barrie South GO Arrivals',
                type: 'manual',
                stopCode: '725',
                defaultEventType: 'arrival',
                icon: 'train',
                createdAt: '2026-03-30T00:00:00.000Z',
                updatedAt: '2026-03-30T00:00:00.000Z',
                times: [
                  {
                    id: 'arr-1',
                    time: 365,
                    enabled: true,
                    daysActive: ['Weekday'],
                    eventType: 'arrival'
                  }
                ]
              }
            ],
            updatedAt: '2026-03-30T00:00:00.000Z',
            updatedBy: 'tester'
          }}
          onCellEdit={vi.fn()}
        />
      );
    });

    const arrivalCells = Array.from(container?.querySelectorAll('[aria-label*="arrival time"]') ?? []);
    const departureCells = Array.from(container?.querySelectorAll('[aria-label*="departure time"]') ?? []);
    const arrivalCell = arrivalCells.find((cell) => cell.textContent?.includes('12 min before departure'));
    const departureCell = departureCells.find((cell) => cell.textContent?.includes('3 min after arrival'));

    expect(arrivalCell).not.toBeUndefined();
    expect(departureCell).not.toBeUndefined();
    expect(arrivalCell?.textContent).not.toContain('3 min after arrival');
    expect(departureCell?.textContent).not.toContain('12 min before departure');
  });
});
