import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AddTripModal, type AddTripModalContext } from '../components/modals/AddTripModal';

describe('AddTripModal', () => {
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

  const buildContext = (): AddTripModalContext => ({
    referenceTrip: {
      id: 'north-1',
      blockId: '2-WD-1',
      direction: 'North',
      tripNumber: 1,
      rowId: 1,
      startTime: 360,
      endTime: 390,
      recoveryTime: 5,
      travelTime: 30,
      cycleTime: 35,
      stops: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' },
      arrivalTimes: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' }
    },
    nextTrip: {
      id: 'north-2',
      blockId: '2-WD-2',
      direction: 'North',
      tripNumber: 2,
      rowId: 2,
      startTime: 420,
      endTime: 450,
      recoveryTime: 5,
      travelTime: 30,
      cycleTime: 35,
      stops: { 'Park Place': '7:00 AM', Downtown: '7:30 AM' },
      arrivalTimes: { 'Park Place': '7:00 AM', Downtown: '7:30 AM' }
    },
    targetTable: {
      routeName: '2 (Weekday) (North)',
      stops: ['Park Place', 'Downtown'],
      stopIds: { 'Park Place': '777', Downtown: '1' },
      trips: [
        {
          id: 'north-1',
          blockId: '2-WD-1',
          direction: 'North',
          tripNumber: 1,
          rowId: 1,
          startTime: 360,
          endTime: 390,
          recoveryTime: 5,
          travelTime: 30,
          cycleTime: 35,
          stops: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' },
          arrivalTimes: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' }
        },
        {
          id: 'north-2',
          blockId: '2-WD-2',
          direction: 'North',
          tripNumber: 2,
          rowId: 2,
          startTime: 420,
          endTime: 450,
          recoveryTime: 5,
          travelTime: 30,
          cycleTime: 35,
          stops: { 'Park Place': '7:00 AM', Downtown: '7:30 AM' },
          arrivalTimes: { 'Park Place': '7:00 AM', Downtown: '7:30 AM' }
        }
      ]
    },
    allSchedules: [
      {
        routeName: '2 (Weekday) (North)',
        stops: ['Park Place', 'Downtown'],
        stopIds: { 'Park Place': '777', Downtown: '1' },
        trips: [
          {
            id: 'north-1',
            blockId: '2-WD-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 360,
            endTime: 390,
            recoveryTime: 5,
            travelTime: 30,
            cycleTime: 35,
            stops: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' },
            arrivalTimes: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' }
          },
          {
            id: 'north-2',
            blockId: '2-WD-2',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 420,
            endTime: 450,
            recoveryTime: 5,
            travelTime: 30,
            cycleTime: 35,
            stops: { 'Park Place': '7:00 AM', Downtown: '7:30 AM' },
            arrivalTimes: { 'Park Place': '7:00 AM', Downtown: '7:30 AM' }
          }
        ]
      },
      {
        routeName: '2 (Weekday) (South)',
        stops: ['Downtown', 'Park Place'],
        stopIds: { Downtown: '1', 'Park Place': '777' },
        trips: [
          {
            id: 'south-1',
            blockId: '2-WD-1',
            direction: 'South',
            tripNumber: 2,
            rowId: 3,
            startTime: 395,
            endTime: 425,
            recoveryTime: 5,
            travelTime: 30,
            cycleTime: 35,
            stops: { Downtown: '6:35 AM', 'Park Place': '7:05 AM' },
            arrivalTimes: { Downtown: '6:35 AM', 'Park Place': '7:05 AM' }
          }
        ]
      }
    ] as any,
    routeBaseName: '2 (Weekday)'
  });

  it('shows planner-focused impact information and updates preview for shorthand time input', () => {
    flushSync(() => {
      root?.render(
        <AddTripModal
          context={buildContext()}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    expect(container?.textContent).toContain('Planner impact');
    expect(container?.textContent).toContain('Peak buses');
    expect(container?.textContent).toContain('Trips to add');

    const input = container?.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const setInputValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    flushSync(() => {
      setInputValue?.call(input, '5:57a');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect((input as HTMLInputElement).value).toBe('5:57a');
    expect(container?.textContent).toContain('5:57 AM');
  });

  it('lets the planner switch direction and confirm a short turn', () => {
    const onConfirm = vi.fn();

    flushSync(() => {
      root?.render(
        <AddTripModal
          context={buildContext()}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });

    const southButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Southbound')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      southButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const selects = Array.from(container?.querySelectorAll('select') ?? []) as HTMLSelectElement[];
    const startStopSelect = selects[0];
    const endStopSelect = selects[1];

    const setSelectValue = (element: HTMLSelectElement | undefined, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      flushSync(() => {
        setter?.call(element, value);
        element?.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };

    setSelectValue(startStopSelect, 'Downtown');
    setSelectValue(endStopSelect, 'Downtown');

    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Add 1 Trip')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      targetDirection: 'South',
      targetRouteName: '2 (Weekday) (South)',
      startStopName: 'Downtown',
      endStopName: 'Downtown'
    }));
  });
});
