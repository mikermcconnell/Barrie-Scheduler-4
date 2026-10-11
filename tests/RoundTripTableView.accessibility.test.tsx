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
                  assignedBand: 'A',
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
    expect(region?.className).not.toContain('space-y-8');
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

  it('shows the actions column by default in editable schedule views', () => {
    const onAddTrip = vi.fn();

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
                  assignedBand: 'A',
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
          onAddTrip={onAddTrip}
        />
      );
    });

    const addTripButtons = Array.from(
      container?.querySelectorAll('button[aria-label="Add trip"]') ?? [],
    );
    expect(addTripButtons.length).toBeGreaterThan(0);
  });

  it('can hide and show the compact review sidebar tools', () => {
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
                  assignedBand: 'A',
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
          toolbarMode="sidebar"
          reviewToolsSlot={<div>Master compare tool</div>}
        />
      );
    });

    expect(container?.textContent).toContain('Master compare tool');
    expect(container?.querySelector('[aria-label="Time band A"]')?.className).toContain('bg-red-100/75');

    const hideButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.includes('Hide tools')
    ) as HTMLButtonElement | undefined;
    expect(hideButton).toBeTruthy();

    flushSync(() => {
      hideButton?.click();
    });

    expect(container?.textContent).not.toContain('Master compare tool');
    expect(container?.textContent).toContain('Show tools');

    const showButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.includes('Show tools')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      showButton?.click();
    });

    expect(container?.textContent).toContain('Master compare tool');
  });

  it('keeps block identity and key metrics visible while the schedule scrolls horizontally', () => {
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

    const blockHeader = Array.from(container?.querySelectorAll('th') ?? []).find(
      header => header.textContent?.trim() === 'Block'
    );
    const cycleHeader = Array.from(container?.querySelectorAll('th') ?? []).find(
      header => header.textContent?.trim() === 'Cycle'
    );
    const runHeader = container?.querySelector('th[title="Run time and assigned time band"]');
    const recoveryHeader = container?.querySelector('th[title="Recovery minutes and recovery ratio"]');
    const blockCell = Array.from(container?.querySelectorAll('tbody td') ?? []).find(
      cell => cell.textContent?.includes('10-1')
    );
    const runCell = container?.querySelector('tbody td.sticky.right-\\[176px\\]') as HTMLTableCellElement | null;

    expect(container?.querySelector('[data-testid="round-trip-scroll-region"]')).not.toBeNull();
    expect(blockHeader?.className).toContain('sticky left-0');
    expect(blockCell?.className).toContain('sticky left-0');
    expect(blockCell?.querySelector('[aria-label="Trip #1"]')).not.toBeNull();
    expect(blockCell?.closest('tr')?.className).toContain('h-11');
    expect(runHeader?.className).toContain('sticky right-[176px]');
    expect(recoveryHeader?.className).toContain('sticky right-[112px]');
    expect(cycleHeader?.className).toContain('sticky right-0');
    expect(runCell?.className).toContain('z-30');
    expect(runCell?.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(Array.from(container?.querySelectorAll('th') ?? []).some(
      header => header.textContent?.trim() === 'Trip #'
    )).toBe(false);
  });

  it('uses the route colour and labels partial-start rows without changing trip data', () => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
            {
              routeName: '12 (Weekday) (North)',
              stops: ['Georgian Mall', 'Downtown Hub'],
              stopIds: {},
              trips: [{
                id: 'north-partial', blockId: '12-1', direction: 'North', tripNumber: 1, rowId: 1,
                startTime: 360, endTime: 390, recoveryTime: 5, travelTime: 30, cycleTime: 35,
                startStopIndex: 1,
                stops: { 'Downtown Hub': '6:00 AM' },
                arrivalTimes: { 'Downtown Hub': '6:00 AM' },
                stopMinutes: { 'Downtown Hub': 360 }
              }]
            },
            {
              routeName: '12 (Weekday) (South)',
              stops: ['Downtown Hub', 'Georgian Mall'],
              stopIds: {},
              trips: [{
                id: 'south-trip', blockId: '12-1', direction: 'South', tripNumber: 2, rowId: 2,
                startTime: 395, endTime: 425, recoveryTime: 0, travelTime: 30, cycleTime: 30,
                stops: { 'Downtown Hub': '6:35 AM', 'Georgian Mall': '7:05 AM' },
                arrivalTimes: { 'Downtown Hub': '6:35 AM', 'Georgian Mall': '7:05 AM' },
                stopMinutes: { 'Downtown Hub': 395, 'Georgian Mall': 425 }
              }]
            }
          ] as any}
          onCellEdit={vi.fn()}
        />
      );
    });

    const routeBadge = Array.from(container?.querySelectorAll('span') ?? []).find(
      element => element.textContent?.trim() === 'Route 12'
    ) as HTMLSpanElement | undefined;
    const northHeader = container?.querySelector('th.border-blue-400') as HTMLTableCellElement | null;
    const southHeader = container?.querySelector('th.border-orange-400') as HTMLTableCellElement | null;

    expect(routeBadge?.style.backgroundColor).toBe('rgb(248, 161, 190)');
    expect(northHeader?.className).toContain('bg-blue-50/50');
    expect(southHeader?.className).toContain('bg-orange-50/50');
    expect(northHeader?.style.backgroundColor).not.toBe('rgb(248, 161, 190)');
    expect(southHeader?.style.backgroundColor).not.toBe('rgb(248, 161, 190)');
    expect(container?.querySelector('[aria-label="Partial start"]')?.textContent).toContain('PARTIAL');
    expect(container?.textContent).toContain('2 one-way trips');
    expect(container?.textContent).not.toContain('h cycle');
  });

  it('provides larger, descriptive minute adjustment controls', () => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: ['North Terminal', 'Downtown'],
              stopIds: {},
              trips: [{
                id: 'north-trip', blockId: '10-1', direction: 'North', tripNumber: 1, rowId: 1,
                startTime: 420, endTime: 450, recoveryTime: 5, travelTime: 30, cycleTime: 35,
                stops: { 'North Terminal': '7:00 AM', Downtown: '7:30 AM' },
                arrivalTimes: { 'North Terminal': '7:00 AM', Downtown: '7:30 AM' },
                recoveryTimes: { Downtown: 5 }, stopMinutes: { 'North Terminal': 420, Downtown: 450 }
              }]
            },
            { routeName: '10 (Weekday) (South)', stops: ['Downtown'], stopIds: {}, trips: [] }
          ] as any}
          onCellEdit={vi.fn()}
          onTimeAdjust={vi.fn()}
          onRecoveryEdit={vi.fn()}
        />
      );
    });

    const earlierButton = container?.querySelector('button[aria-label="Move North Terminal departure 1 minute earlier"]');
    const recoveryButton = container?.querySelector('button[aria-label="Increase Downtown recovery by 1 minute"]');

    expect(earlierButton?.className).toContain('w-5');
    expect(recoveryButton?.className).toContain('w-5');
  });

  it('places round-trip connection icons using the saved route connection type', () => {
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
                    time: 367,
                    enabled: true,
                    daysActive: ['Weekday'],
                    eventType: 'departure'
                  }
                ]
              },
              {
                id: 'route-12b',
                name: 'Route 12B Departures',
                type: 'route',
                routeIdentity: '12B-Weekday',
                stopCode: '725',
                defaultEventType: 'departure',
                icon: 'bus',
                direction: 'South',
                createdAt: '2026-03-30T00:00:00.000Z',
                updatedAt: '2026-03-30T00:00:00.000Z',
                times: [
                  {
                    id: 'route-12b-1',
                    time: 368,
                    enabled: true,
                    daysActive: ['Weekday'],
                    eventType: 'departure'
                  }
                ]
              }
            ],
            updatedAt: '2026-03-30T00:00:00.000Z',
            updatedBy: 'tester'
          }}
          routeConnectionConfig={{
            routeIdentity: '11-Weekday',
            optimizationMode: 'hybrid',
            connections: [
              {
                id: 'conn-dep',
                targetId: 'go-departure',
                connectionType: 'feed_arriving',
                bufferMinutes: 5,
                stopCode: '725',
                stopName: 'Barrie South GO',
                priority: 1,
                enabled: true
              },
              {
                id: 'conn-route-12b',
                targetId: 'route-12b',
                connectionType: 'feed_arriving',
                bufferMinutes: 5,
                stopCode: '725',
                stopName: 'Barrie South GO',
                priority: 2,
                enabled: true
              }
            ]
          }}
          onCellEdit={vi.fn()}
        />
      );
    });

    const arrivalCells = Array.from(container?.querySelectorAll('[aria-label*="arrival time"]') ?? []);
    const departureCells = Array.from(container?.querySelectorAll('[aria-label*="departure time"]') ?? []);
    const arrivalCell = arrivalCells.find((cell) =>
      cell.querySelector('button[aria-label*="Barrie South GO Departures"]')
    );
    const departureCell = departureCells.find((cell) =>
      cell.querySelector('button[aria-label*="Barrie South GO Departures"]')
    );
    const routeConnection = container?.querySelector('button[aria-label*="Route 12B Departures"]');

    expect(arrivalCell).toBeUndefined();
    expect(departureCell).not.toBeUndefined();
    expect(routeConnection).not.toBeNull();
    expect(departureCell?.querySelector('button[aria-label*="Barrie South GO Arrivals"]')).toBeNull();

    const connectionsToggle = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.getAttribute('aria-label') === 'Hide schedule connections'
    ) as HTMLButtonElement | undefined;
    expect(connectionsToggle).toBeTruthy();
    expect(connectionsToggle?.getAttribute('aria-pressed')).toBe('true');

    flushSync(() => {
      connectionsToggle?.click();
    });

    expect(container?.querySelector('button[aria-label*="Barrie South GO Departures"]')).toBeNull();
    expect(container?.querySelector('button[aria-label*="Route 12B Departures"]')).toBeNull();
    expect(container?.querySelector('button[aria-label^="1 connection"]')).toBeNull();
    expect(container?.querySelector('button[aria-label^="2 connections"]')).toBeNull();
    expect(connectionsToggle?.getAttribute('aria-pressed')).toBe('false');
  });
});
