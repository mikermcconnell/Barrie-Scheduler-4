import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { SingleRouteView } from '../components/schedule/SingleRouteView';

describe('SingleRouteView layout', () => {
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

  it('does not freeze the first schedule column', () => {
    flushSync(() => {
      root?.render(
        <SingleRouteView
          table={{
            routeName: '10 (Weekday) (North)',
            stops: ['North Terminal'],
            stopIds: { 'North Terminal': '1001' },
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
                stops: { 'North Terminal': '7:00 AM' },
                arrivalTimes: { 'North Terminal': '7:00 AM' },
                stopMinutes: { 'North Terminal': 420 },
                recoveryTimes: {}
              }
            ]
          } as any}
          onCellEdit={vi.fn()}
        />
      );
    });

    const stickyCells = Array.from(container?.querySelectorAll('th, td') ?? []).filter((element) => {
      const className = element.getAttribute('class') ?? '';
      return className.includes('sticky left-0');
    });

    expect(stickyCells).toHaveLength(0);
  });

  it('places connection icons using the saved route connection type, not just the target event type', () => {
    flushSync(() => {
      root?.render(
        <SingleRouteView
          table={{
            routeName: '11 (Weekday) (North)',
            stops: ['Barrie South GO'],
            stopIds: { 'Barrie South GO': '725' },
            trips: [
              {
                id: 'trip-1',
                blockId: '11-1',
                direction: 'North',
                tripNumber: 1,
                rowId: 1,
                startTime: 360,
                endTime: 390,
                recoveryTime: 3,
                travelTime: 30,
                cycleTime: 33,
                stops: { 'Barrie South GO': '6:05 AM' },
                arrivalTimes: { 'Barrie South GO': '6:05 AM' },
                stopMinutes: { 'Barrie South GO': 365 },
                recoveryTimes: { 'Barrie South GO': 3 }
              }
            ]
          } as any}
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
              }
            ]
          }}
          onCellEdit={vi.fn()}
        />
      );
    });

    const arrivalCell = Array.from(container?.querySelectorAll('td') ?? []).find((cell) =>
      cell.textContent?.includes('6:05 AM')
    );
    const departureInput = Array.from(container?.querySelectorAll('input') ?? []).find(
      (input) => (input as HTMLInputElement).value === '6:08 AM'
    );
    const departureCell = departureInput?.closest('td');

    expect(arrivalCell?.querySelector('button[aria-label*="Barrie South GO Departures"]')).toBeNull();
    expect(departureCell?.querySelector('button[aria-label*="Barrie South GO Departures"]')).not.toBeNull();
  });

  it('keeps to-other-route connections off the first departure-only timepoint', () => {
    flushSync(() => {
      root?.render(
        <SingleRouteView
          table={{
            routeName: '100 (Weekday) (North)',
            stops: ['Downtown Hub', 'Bayfield St'],
            stopIds: { 'Downtown Hub': '1001', 'Bayfield St': '1002' },
            trips: [
              {
                id: 'trip-1',
                blockId: '100-1',
                direction: 'North',
                tripNumber: 1,
                rowId: 1,
                startTime: 420,
                endTime: 450,
                recoveryTime: 0,
                travelTime: 30,
                cycleTime: 30,
                stops: { 'Downtown Hub': '7:00 AM', 'Bayfield St': '7:10 AM' },
                arrivalTimes: { 'Bayfield St': '7:10 AM' },
                stopMinutes: { 'Downtown Hub': 420, 'Bayfield St': 430 },
                recoveryTimes: {}
              }
            ]
          } as any}
          connectionLibrary={{
            targets: [
              {
                id: 'route-400-n',
                name: 'Route 400 (North)',
                type: 'route',
                routeIdentity: '400-Weekday',
                stopCode: '1001',
                stopName: 'Downtown Hub',
                direction: 'North',
                icon: 'bus',
                defaultEventType: 'departure',
                createdAt: '2026-03-30T00:00:00.000Z',
                updatedAt: '2026-03-30T00:00:00.000Z',
                times: [
                  {
                    id: 'route-400-n-1',
                    time: 425,
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
            routeIdentity: '100-Weekday',
            optimizationMode: 'hybrid',
            connections: [
              {
                id: 'conn-route-400-n',
                targetId: 'route-400-n',
                connectionType: 'meet_departing',
                bufferMinutes: 5,
                stopCode: '1001',
                stopName: 'Downtown Hub',
                priority: 1,
                enabled: true
              }
            ]
          }}
          onCellEdit={vi.fn()}
        />
      );
    });

    const firstDepartureOnlyInput = Array.from(container?.querySelectorAll('input') ?? []).find(
      (input) => (input as HTMLInputElement).value === '7:00 AM'
    );
    const firstDepartureOnlyCell = firstDepartureOnlyInput?.closest('td');

    expect(firstDepartureOnlyCell).not.toBeNull();
    expect(firstDepartureOnlyCell?.querySelector('button[aria-label*="Route 400 (North)"]')).toBeNull();
  });
});
