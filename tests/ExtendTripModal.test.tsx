import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ExtendTripModal } from '../components/modals/ExtendTripModal';
import type { ExtendTripModalContext } from '../utils/schedule/extendTripPlanner';

describe('ExtendTripModal', () => {
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

  const buildContext = (): ExtendTripModalContext => ({
    trip: {
      id: 'south-short',
      blockId: '8A-2',
      direction: 'South',
      tripNumber: 2,
      rowId: 2,
      startTime: 1406,
      endTime: 1419,
      recoveryTime: 0,
      travelTime: 13,
      cycleTime: 13,
      stops: {
        'Barrie South GO': '11:26 PM',
        'South Park Place': '11:39 PM'
      },
      arrivalTimes: {
        'Barrie South GO': '11:26 PM',
        'South Park Place': '11:39 PM'
      },
      stopMinutes: {
        'Barrie South GO': 1406,
        'South Park Place': 1419
      },
      startStopIndex: 2
    },
    targetTable: {
      routeName: '8A (Weekday) (South)',
      stops: ['Downtown Stop 1', 'Mapleview', 'Barrie South GO', 'South Park Place'],
      stopIds: {
        'Downtown Stop 1': '1',
        Mapleview: '2',
        'Barrie South GO': '3',
        'South Park Place': '4'
      },
      trips: [
        {
          id: 'south-full',
          blockId: '8A-1',
          direction: 'South',
          tripNumber: 1,
          rowId: 1,
          startTime: 1380,
          endTime: 1419,
          recoveryTime: 5,
          travelTime: 39,
          cycleTime: 44,
          stops: {
            'Downtown Stop 1': '11:00 PM',
            Mapleview: '11:12 PM',
            'Barrie South GO': '11:26 PM',
            'South Park Place': '11:39 PM'
          },
          arrivalTimes: {
            'Downtown Stop 1': '11:00 PM',
            Mapleview: '11:12 PM',
            'Barrie South GO': '11:26 PM',
            'South Park Place': '11:39 PM'
          },
          stopMinutes: {
            'Downtown Stop 1': 1380,
            Mapleview: 1392,
            'Barrie South GO': 1406,
            'South Park Place': 1419
          }
        },
        {
          id: 'south-short',
          blockId: '8A-2',
          direction: 'South',
          tripNumber: 2,
          rowId: 2,
          startTime: 1406,
          endTime: 1419,
          recoveryTime: 0,
          travelTime: 13,
          cycleTime: 13,
          stops: {
            'Barrie South GO': '11:26 PM',
            'South Park Place': '11:39 PM'
          },
          arrivalTimes: {
            'Barrie South GO': '11:26 PM',
            'South Park Place': '11:39 PM'
          },
          stopMinutes: {
            'Barrie South GO': 1406,
            'South Park Place': 1419
          },
          startStopIndex: 2
        }
      ]
    },
    allSchedules: [
      {
        routeName: '8A (Weekday) (South)',
        stops: ['Downtown Stop 1', 'Mapleview', 'Barrie South GO', 'South Park Place'],
        stopIds: {
          'Downtown Stop 1': '1',
          Mapleview: '2',
          'Barrie South GO': '3',
          'South Park Place': '4'
        },
        trips: [
          {
            id: 'south-full',
            blockId: '8A-1',
            direction: 'South',
            tripNumber: 1,
            rowId: 1,
            startTime: 1380,
            endTime: 1419,
            recoveryTime: 5,
            travelTime: 39,
            cycleTime: 44,
            stops: {
              'Downtown Stop 1': '11:00 PM',
              Mapleview: '11:12 PM',
              'Barrie South GO': '11:26 PM',
              'South Park Place': '11:39 PM'
            },
            arrivalTimes: {
              'Downtown Stop 1': '11:00 PM',
              Mapleview: '11:12 PM',
              'Barrie South GO': '11:26 PM',
              'South Park Place': '11:39 PM'
            },
            stopMinutes: {
              'Downtown Stop 1': 1380,
              Mapleview: 1392,
              'Barrie South GO': 1406,
              'South Park Place': 1419
            }
          },
          {
            id: 'south-short',
            blockId: '8A-2',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 1406,
            endTime: 1419,
            recoveryTime: 0,
            travelTime: 13,
            cycleTime: 13,
            stops: {
              'Barrie South GO': '11:26 PM',
              'South Park Place': '11:39 PM'
            },
            arrivalTimes: {
              'Barrie South GO': '11:26 PM',
              'South Park Place': '11:39 PM'
            },
            stopMinutes: {
              'Barrie South GO': 1406,
              'South Park Place': 1419
            },
            startStopIndex: 2
          }
        ]
      }
    ] as any,
    routeBaseName: '8A (Weekday)',
    currentStartIndex: 2,
    currentEndIndex: 3,
    templateTrip: {
      id: 'south-full',
      blockId: '8A-1',
      direction: 'South',
      tripNumber: 1,
      rowId: 1,
      startTime: 1380,
      endTime: 1419,
      recoveryTime: 5,
      travelTime: 39,
      cycleTime: 44,
      stops: {
        'Downtown Stop 1': '11:00 PM',
        Mapleview: '11:12 PM',
        'Barrie South GO': '11:26 PM',
        'South Park Place': '11:39 PM'
      },
      arrivalTimes: {
        'Downtown Stop 1': '11:00 PM',
        Mapleview: '11:12 PM',
        'Barrie South GO': '11:26 PM',
        'South Park Place': '11:39 PM'
      },
      stopMinutes: {
        'Downtown Stop 1': 1380,
        Mapleview: 1392,
        'Barrie South GO': 1406,
        'South Park Place': 1419
      }
    }
  });

  it('shows the extend workflow with a live schedule preview', () => {
    flushSync(() => {
      root?.render(
        <ExtendTripModal
          context={buildContext()}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    expect(container?.textContent).toContain('Extend Trip');
    expect(container?.textContent).toContain('Bring earlier');
    expect(container?.textContent).toContain('Extend later');
    expect(container?.textContent).toContain('Current trip: Barrie South GO → South Park Place');
    expect(container?.textContent).toContain('Result if applied');
    expect(container?.textContent).toContain('Mapleview → South Park Place');
    expect(container?.textContent).toContain('1 stop upstream');
    expect(container?.textContent).toContain('Schedule');
    expect(container?.textContent).toContain('Timeline');
    expect(container?.textContent).toContain('Travel Times');
  });

  it('confirms the chosen extension stop and mode', () => {
    const onConfirm = vi.fn();

    flushSync(() => {
      root?.render(
        <ExtendTripModal
          context={buildContext()}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });

    const earlierButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Bring earlier')
    ) as HTMLButtonElement | undefined;
    const select = container?.querySelector('select') as HTMLSelectElement | null;
    const applyButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Apply extension')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      earlierButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    flushSync(() => {
      setter?.call(select, 'Downtown Stop 1');
      select?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    flushSync(() => {
      applyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'earlier',
      stopName: 'Downtown Stop 1'
    }, expect.objectContaining({
      routeBaseName: '8A (Weekday)',
      trip: expect.objectContaining({
        id: 'south-short'
      })
    }));
  });
});
