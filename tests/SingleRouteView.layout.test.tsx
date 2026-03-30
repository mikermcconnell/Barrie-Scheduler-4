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

  it('shows departure-train connections on arrival and arrival-train connections on departure', () => {
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

    const arrivalCell = Array.from(container?.querySelectorAll('td') ?? []).find((cell) =>
      cell.textContent?.includes('6:05 AM')
    );
    const departureInput = container?.querySelector('input[value="6:08 AM"]');
    const departureCell = departureInput?.closest('td');

    expect(arrivalCell?.textContent).toContain('12 min before departure');
    expect(arrivalCell?.textContent).not.toContain('3 min after arrival');
    expect(departureCell?.textContent).toContain('3 min after arrival');
    expect(departureCell?.textContent).not.toContain('12 min before departure');
  });
});
