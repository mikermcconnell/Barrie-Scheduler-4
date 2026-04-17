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

  const build400SouthContext = (): AddTripModalContext => ({
    referenceTrip: {
      id: '400-south-1',
      blockId: '400-WD-1',
      direction: 'South',
      tripNumber: 2,
      rowId: 2,
      startTime: 410,
      endTime: 432,
      recoveryTime: 8,
      travelTime: 22,
      cycleTime: 30,
      stops: { 'RVH Main Entrance': '6:50 AM', 'Park Place': '7:12 AM' },
      arrivalTimes: { 'RVH Main Entrance': '6:50 AM', 'Park Place': '7:12 AM' },
      stopMinutes: { 'RVH Main Entrance': 410, 'Park Place': 432 }
    },
    nextTrip: null,
    targetTable: {
      routeName: '400 (Weekday) (South)',
      stops: ['RVH Main Entrance', 'Park Place'],
      stopIds: { 'RVH Main Entrance': 'RVH', 'Park Place': 'P4' },
      trips: [
        {
          id: '400-south-1',
          blockId: '400-WD-1',
          direction: 'South',
          tripNumber: 2,
          rowId: 2,
          startTime: 410,
          endTime: 432,
          recoveryTime: 8,
          travelTime: 22,
          cycleTime: 30,
          stops: { 'RVH Main Entrance': '6:50 AM', 'Park Place': '7:12 AM' },
          arrivalTimes: { 'RVH Main Entrance': '6:50 AM', 'Park Place': '7:12 AM' },
          stopMinutes: { 'RVH Main Entrance': 410, 'Park Place': 432 }
        }
      ]
    },
    allSchedules: [
      {
        routeName: '400 (Weekday) (North)',
        stops: ['Park Place', 'RVH Main Entrance'],
        stopIds: { 'Park Place': 'P4', 'RVH Main Entrance': 'RVH' },
        trips: [
          {
            id: '400-north-1',
            blockId: '400-WD-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 380,
            endTime: 402,
            recoveryTime: 8,
            travelTime: 22,
            cycleTime: 30,
            stops: { 'Park Place': '6:20 AM', 'RVH Main Entrance': '6:42 AM' },
            arrivalTimes: { 'Park Place': '6:20 AM', 'RVH Main Entrance': '6:42 AM' },
            stopMinutes: { 'Park Place': 380, 'RVH Main Entrance': 402 }
          }
        ]
      },
      {
        routeName: '400 (Weekday) (South)',
        stops: ['RVH Main Entrance', 'Park Place'],
        stopIds: { 'RVH Main Entrance': 'RVH', 'Park Place': 'P4' },
        trips: [
          {
            id: '400-south-1',
            blockId: '400-WD-1',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 410,
            endTime: 432,
            recoveryTime: 8,
            travelTime: 22,
            cycleTime: 30,
            stops: { 'RVH Main Entrance': '6:50 AM', 'Park Place': '7:12 AM' },
            arrivalTimes: { 'RVH Main Entrance': '6:50 AM', 'Park Place': '7:12 AM' },
            stopMinutes: { 'RVH Main Entrance': 410, 'Park Place': 432 }
          }
        ]
      }
    ] as any,
    routeBaseName: '400 (Weekday)',
    preferredServiceMode: 'cycle'
  });

  const build400GapContext = (): AddTripModalContext => ({
    referenceTrip: {
      id: '400-north-gap-1',
      blockId: '400-WD-2',
      direction: 'North',
      tripNumber: 3,
      rowId: 3,
      startTime: 408,
      endTime: 430,
      recoveryTime: 7,
      travelTime: 22,
      cycleTime: 29,
      stops: { 'Park Place': '6:48 AM', 'RVH Main Entrance': '7:10 AM' },
      arrivalTimes: { 'Park Place': '6:48 AM', 'RVH Main Entrance': '7:10 AM' },
      stopMinutes: { 'Park Place': 408, 'RVH Main Entrance': 430 }
    },
    nextTrip: null,
    targetTable: {
      routeName: '400 (Weekday) (North)',
      stops: ['Park Place', 'RVH Main Entrance'],
      stopIds: { 'Park Place': 'P4', 'RVH Main Entrance': 'RVH' },
      trips: [
        {
          id: '400-north-1',
          blockId: '400-WD-1',
          direction: 'North',
          tripNumber: 1,
          rowId: 1,
          startTime: 380,
          endTime: 402,
          recoveryTime: 7,
          travelTime: 22,
          cycleTime: 29,
          stops: { 'Park Place': '6:20 AM', 'RVH Main Entrance': '6:42 AM' },
          arrivalTimes: { 'Park Place': '6:20 AM', 'RVH Main Entrance': '6:42 AM' },
          stopMinutes: { 'Park Place': 380, 'RVH Main Entrance': 402 }
        },
        {
          id: '400-north-gap-1',
          blockId: '400-WD-2',
          direction: 'North',
          tripNumber: 3,
          rowId: 3,
          startTime: 408,
          endTime: 430,
          recoveryTime: 7,
          travelTime: 22,
          cycleTime: 29,
          stops: { 'Park Place': '6:48 AM', 'RVH Main Entrance': '7:10 AM' },
          arrivalTimes: { 'Park Place': '6:48 AM', 'RVH Main Entrance': '7:10 AM' },
          stopMinutes: { 'Park Place': 408, 'RVH Main Entrance': 430 }
        }
      ]
    },
    allSchedules: [
      {
        routeName: '400 (Weekday) (North)',
        stops: ['Park Place', 'RVH Main Entrance'],
        stopIds: { 'Park Place': 'P4', 'RVH Main Entrance': 'RVH' },
        trips: [
          {
            id: '400-north-1',
            blockId: '400-WD-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 380,
            endTime: 402,
            recoveryTime: 7,
            travelTime: 22,
            cycleTime: 29,
            stops: { 'Park Place': '6:20 AM', 'RVH Main Entrance': '6:42 AM' },
            arrivalTimes: { 'Park Place': '6:20 AM', 'RVH Main Entrance': '6:42 AM' },
            stopMinutes: { 'Park Place': 380, 'RVH Main Entrance': 402 }
          },
          {
            id: '400-north-gap-1',
            blockId: '400-WD-2',
            direction: 'North',
            tripNumber: 3,
            rowId: 3,
            startTime: 408,
            endTime: 430,
            recoveryTime: 7,
            travelTime: 22,
            cycleTime: 29,
            stops: { 'Park Place': '6:48 AM', 'RVH Main Entrance': '7:10 AM' },
            arrivalTimes: { 'Park Place': '6:48 AM', 'RVH Main Entrance': '7:10 AM' },
            stopMinutes: { 'Park Place': 408, 'RVH Main Entrance': 430 }
          }
        ]
      },
      {
        routeName: '400 (Weekday) (South)',
        stops: ['RVH Main Entrance', 'Park Place'],
        stopIds: { 'RVH Main Entrance': 'RVH', 'Park Place': 'P4' },
        trips: [
          {
            id: '400-south-1',
            blockId: '400-WD-1',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 410,
            endTime: 432,
            recoveryTime: 7,
            travelTime: 22,
            cycleTime: 29,
            stops: { 'RVH Main Entrance': '6:50 AM', 'Park Place': '7:12 AM' },
            arrivalTimes: { 'RVH Main Entrance': '6:50 AM', 'Park Place': '7:12 AM' },
            stopMinutes: { 'RVH Main Entrance': 410, 'Park Place': 432 }
          },
          {
            id: '400-south-gap-1',
            blockId: '400-WD-2',
            direction: 'South',
            tripNumber: 4,
            rowId: 4,
            startTime: 437,
            endTime: 459,
            recoveryTime: 7,
            travelTime: 22,
            cycleTime: 29,
            stops: { 'RVH Main Entrance': '7:17 AM', 'Park Place': '7:39 AM' },
            arrivalTimes: { 'RVH Main Entrance': '7:17 AM', 'Park Place': '7:39 AM' },
            stopMinutes: { 'RVH Main Entrance': 437, 'Park Place': 459 }
          }
        ]
      }
    ] as any,
    routeBaseName: '400 (Weekday)',
    preferredServiceMode: 'cycle'
  });

  const buildAliasCustomContext = (): AddTripModalContext => ({
    referenceTrip: {
      id: '7-south-1',
      blockId: '7-2',
      direction: 'South',
      tripNumber: 2,
      rowId: 2,
      startTime: 490,
      endTime: 520,
      recoveryTime: 0,
      travelTime: 30,
      cycleTime: 30,
      stops: {
        'Rose Street': '8:10 AM',
        'Downtown Hub': '8:22 AM',
        'Park Place': '8:40 AM'
      }
    },
    nextTrip: null,
    targetTable: {
      routeName: '7 (Sunday) (South)',
      stops: ['DEPART ROSE STREET', 'Downtown Hub', 'Park Place'],
      stopIds: { 'DEPART ROSE STREET': '251', 'Downtown Hub': '2', 'Park Place': '777' },
      trips: [
        {
          id: '7-south-1',
          blockId: '7-2',
          direction: 'South',
          tripNumber: 2,
          rowId: 2,
          startTime: 490,
          endTime: 520,
          recoveryTime: 0,
          travelTime: 30,
          cycleTime: 30,
          stops: {
            'Rose Street': '8:10 AM',
            'Downtown Hub': '8:22 AM',
            'Park Place': '8:40 AM'
          }
        }
      ]
    },
    allSchedules: [
      {
        routeName: '7 (Sunday) (North)',
        stops: ['Park Place', 'ARRIVE DOWNTOWN HUB', 'Rose Street'],
        stopIds: { 'Park Place': '777', 'ARRIVE DOWNTOWN HUB': '2', 'Rose Street': '251' },
        trips: [
          {
            id: '7-north-1',
            blockId: '7-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 451,
            endTime: 481,
            recoveryTime: 0,
            travelTime: 30,
            cycleTime: 30,
            stops: {
              'Park Place': '7:31 AM',
              'Downtown Hub': '7:35 AM',
              'Rose Street': '8:01 AM'
            }
          }
        ]
      },
      {
        routeName: '7 (Sunday) (South)',
        stops: ['DEPART ROSE STREET', 'Downtown Hub', 'Park Place'],
        stopIds: { 'DEPART ROSE STREET': '251', 'Downtown Hub': '2', 'Park Place': '777' },
        trips: [
          {
            id: '7-south-1',
            blockId: '7-2',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 490,
            endTime: 520,
            recoveryTime: 0,
            travelTime: 30,
            cycleTime: 30,
            stops: {
              'Rose Street': '8:10 AM',
              'Downtown Hub': '8:22 AM',
              'Park Place': '8:40 AM'
            }
          }
        ]
      }
    ] as any,
    routeBaseName: '7 (Sunday)',
    preferredServiceMode: 'custom'
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

    expect(container?.textContent).toContain('Planned change');
    expect(container?.textContent).toContain('Add new trip');
    expect(container?.textContent).toContain('Choose where the new trip goes in the preview.');
    expect(container?.textContent).toContain('Placement');
    expect(container?.textContent).toContain('Anchor trip');
    expect(container?.textContent).toContain('Anchor block');
    expect(container?.textContent).toContain('Northbound · 6:00 AM → 6:30 AM');
    expect(container?.textContent).toContain('2-WD-1');
    expect(container?.textContent).toContain('Trips to add');
    expect(container?.textContent).toContain('Advanced planner controls');

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

  it('defaults the preview schedule to timepoints view', () => {
    flushSync(() => {
      root?.render(
        <AddTripModal
          context={buildContext()}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    const timepointsButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.trim() === 'Timepoints'
    ) as HTMLButtonElement | undefined;

    expect(timepointsButton).toBeTruthy();
    expect(timepointsButton?.className).toContain('bg-blue-50');
    expect(timepointsButton?.className).toContain('text-blue-700');
  });

  it('shows bus / block controls before trip type in the main planner flow', () => {
    flushSync(() => {
      root?.render(
        <AddTripModal
          context={buildContext()}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    const labels = Array.from(container?.querySelectorAll('label') ?? []);
    const addNewTripLabel = labels.find(label => label.textContent?.includes('Add new trip'));
    const busBlockLabel = labels.find(label => label.textContent?.includes('Bus / block'));
    const tripTypeLabel = labels.find(label => label.textContent?.includes('Trip type'));

    expect(addNewTripLabel).toBeTruthy();
    expect(busBlockLabel).toBeTruthy();
    expect(tripTypeLabel).toBeTruthy();
    expect(
      addNewTripLabel?.compareDocumentPosition(busBlockLabel as Node) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      busBlockLabel?.compareDocumentPosition(tripTypeLabel as Node) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('keeps advanced planner details collapsed until the planner expands them', () => {
    flushSync(() => {
      root?.render(
        <AddTripModal
          context={buildContext()}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    expect(container?.textContent).toContain('Advanced planner controls');
    expect(container?.textContent).not.toContain('Planner impact');

    const advancedButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Advanced planner controls')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      advancedButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Planner impact');
    expect(container?.textContent).toContain('Peak buses');
  });

  it('preserves a manual custom time instead of snapping back to the template trip time', () => {
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

    const customTimeButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Custom time')
    ) as HTMLButtonElement | undefined;
    const input = container?.querySelector('input[type="text"]') as HTMLInputElement | null;
    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Add 1 Trip')
    ) as HTMLButtonElement | undefined;

    const setInputValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    flushSync(() => {
      customTimeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    flushSync(() => {
      setInputValue?.call(input, '11:40 PM');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect((input as HTMLInputElement).value).toBe('11:40 PM');

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      startTime: 23 * 60 + 40
    }), expect.objectContaining({
      routeBaseName: '2 (Weekday)'
    }));
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

    const stopSelects = Array.from(container?.querySelectorAll('select') ?? []).filter(select =>
      Array.from(select.options).some(option => option.value === 'Downtown' || option.value === 'Park Place')
    ) as HTMLSelectElement[];
    const startStopSelect = stopSelects[0];
    const endStopSelect = stopSelects[1];

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
      serviceMode: 'trip',
      blockMode: 'existing',
      blockId: '2-WD-2',
      startStopName: 'Downtown',
      endStopName: 'Downtown'
    }), expect.objectContaining({
      routeBaseName: '2 (Weekday)'
    }));
  });

  it('defaults block assignment to an existing block when one is available', () => {
    flushSync(() => {
      root?.render(
        <AddTripModal
          context={buildContext()}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    const existingButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Choose another block')
    ) as HTMLButtonElement | undefined;
    const referenceButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Use same block')
    ) as HTMLButtonElement | undefined;
    const blockSelect = Array.from(container?.querySelectorAll('select') ?? []).find(select =>
      Array.from(select.options).some(option => option.value === '2-WD-2')
    ) as HTMLSelectElement | undefined;

    expect(existingButton?.className).toContain('border-blue-300');
    expect(referenceButton?.className).not.toContain('border-blue-300');
    expect(blockSelect?.value).toBe('2-WD-2');
    expect(container?.textContent).toContain('2-WD-2 (1 trip)');
  });

  it('supports confirming a full cycle from the highlighted planner controls', () => {
    const onConfirm = vi.fn();

    flushSync(() => {
      root?.render(
        <AddTripModal
          context={{ ...buildContext(), preferredServiceMode: 'cycle' }}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });

    const cycleButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Round trip')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      cycleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const switchButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Use new block 2-WD-3')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      switchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Add 1 Cycle')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('2 total trips will be added.');
    expect(container?.textContent).toContain('Northbound planning');
    expect(container?.textContent).toContain('Schedule');
    expect(container?.textContent).toContain('Timeline');
    expect(container?.textContent).toContain('Travel Times');
    expect(container?.textContent).not.toContain('Route Editor');
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      serviceMode: 'cycle',
      blockMode: 'new',
      blockId: '2-WD-3',
      targetDirection: 'North',
      startStopName: 'Park Place',
      endStopName: 'Downtown'
    }), expect.objectContaining({
      routeBaseName: '2 (Weekday)'
    }));
  });

  it('defaults to custom paired-trip planning when opened in paired custom mode', () => {
    flushSync(() => {
      root?.render(
        <AddTripModal
          context={{ ...buildContext(), preferredServiceMode: 'custom' }}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    const customButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Custom trip')
    ) as HTMLButtonElement | undefined;

    expect(customButton?.className).toContain('border-blue-300');
    expect(container?.textContent).toContain('Custom trips to add');
    expect(container?.textContent).toContain('2 total trips will be added.');
    expect(container?.textContent).toContain('Start timepoint');
    expect(container?.textContent).toContain('End timepoint');

    const switchButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Use new block 2-WD-3')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      switchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Add 1 Custom Trip');
  });

  it('shows timepoints from either direction in custom trip selectors', () => {
    flushSync(() => {
      root?.render(
        <AddTripModal
          context={buildAliasCustomContext()}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    const stopSelects = Array.from(container?.querySelectorAll('select') ?? []).filter(select =>
      Array.from(select.options).some(option => option.value === 'ARRIVE DOWNTOWN HUB' || option.value === 'DEPART ROSE STREET')
    ) as HTMLSelectElement[];

    expect(stopSelects).toHaveLength(2);

    stopSelects.forEach(select => {
      const values = Array.from(select.options).map(option => option.value);
      expect(values).toContain('ARRIVE DOWNTOWN HUB');
      expect(values).toContain('DEPART ROSE STREET');
      expect(values).toContain('Park Place');
      expect(values).toContain('Downtown Hub');
    });

    expect(container?.textContent).toContain('Choose any timepoint from either direction.');
  });

  it('lets the planner confirm a custom paired trip with separate outbound and return endpoints', () => {
    const onConfirm = vi.fn();

    flushSync(() => {
      root?.render(
        <AddTripModal
          context={{ ...buildContext(), preferredServiceMode: 'custom' }}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });

    const stopSelects = Array.from(container?.querySelectorAll('select') ?? []).filter(select =>
      Array.from(select.options).some(option => option.value === 'Downtown' || option.value === 'Park Place')
    ) as HTMLSelectElement[];
    const startStopSelect = stopSelects[0];
    const endStopSelect = stopSelects[1];

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
      button.textContent?.includes('Add 1 Custom Trip')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      serviceMode: 'custom',
      targetDirection: 'North',
      targetRouteName: '2 (Weekday) (North)',
      blockMode: 'existing',
      blockId: '2-WD-2',
      startStopName: 'Downtown',
      endStopName: 'Downtown'
    }), expect.objectContaining({
      routeBaseName: '2 (Weekday)'
    }));
  });

  it('defaults to full cycle when opened from a paired round-trip context', () => {
    flushSync(() => {
      root?.render(
        <AddTripModal
          context={{ ...buildContext(), preferredServiceMode: 'cycle' }}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      );
    });

    expect(container?.textContent).toContain('Resolve Block Conflict');
    expect(container?.textContent).toContain('2 total trips will be added.');
    expect(container?.textContent).toContain('Schedule');
    expect(container?.textContent).not.toContain('Route Editor');
    expect(container?.textContent).toContain('Selected block already has overlapping work.');
  });

  it('keeps full cycle northbound-first even when opened from the southbound side', () => {
    const onConfirm = vi.fn();

    flushSync(() => {
      root?.render(
        <AddTripModal
          context={build400SouthContext()}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });

    expect(container?.textContent).toContain('Northbound planning');
    expect(container?.textContent).toContain('RVH Main Entrance');
    expect(container?.textContent).toContain('Park Place');
    expect(container?.textContent).not.toContain('Route Editor');

    const southButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Southbound')
    ) as HTMLButtonElement | undefined;

    expect(southButton?.disabled).toBe(true);

    const switchButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Use new block 400-WD-2')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      switchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Add 1 Cycle')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      serviceMode: 'cycle',
      targetDirection: 'North',
      targetRouteName: '400 (Weekday) (North)',
      startStopName: 'Park Place',
      endStopName: 'RVH Main Entrance'
    }), expect.objectContaining({
      routeBaseName: '400 (Weekday)'
    }));
  });

  it('blocks duplicate full cycles on the same block and lets the planner switch to a new block', () => {
    const onConfirm = vi.fn();

    flushSync(() => {
      root?.render(
        <AddTripModal
          context={build400SouthContext()}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });

    expect(container?.textContent).toContain('Selected block already has overlapping work.');
    expect(container?.textContent).toContain('Use new block 400-WD-2');

    const actionButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Resolve Block Conflict')
    ) as HTMLButtonElement | undefined;

    expect(actionButton?.disabled).toBe(true);

    const switchButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Use new block 400-WD-2')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      switchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).not.toContain('Selected block already has overlapping work.');

    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Add 1 Cycle')
    ) as HTMLButtonElement | undefined;

    expect(addButton?.disabled).toBe(false);

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      blockMode: 'new',
      blockId: '400-WD-2',
      serviceMode: 'cycle'
    }), expect.objectContaining({
      routeBaseName: '400 (Weekday)'
    }));
  });

  it('shows a short same-block continuity gap and lets the planner absorb it into recovery', () => {
    const onConfirm = vi.fn();

    flushSync(() => {
      root?.render(
        <AddTripModal
          context={build400GapContext()}
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });

    const referenceButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Use same block')
    ) as HTMLButtonElement | undefined;
    flushSync(() => {
      referenceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const advancedButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Advanced planner controls')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      advancedButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const minusSixtyButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('-60 min')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      minusSixtyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Block continuity:');
    expect(container?.textContent).toContain('2 min idle gap before the next trip on this block at 6:48 AM.');

    const absorbButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Absorb 2 min into recovery')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      absorbButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Absorbing 2 min into recovery');

    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Add 1 Cycle')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      serviceMode: 'cycle',
      blockMode: 'reference',
      blockId: '400-WD-2',
      absorbShortTrailingGapIntoRecovery: true,
      targetDirection: 'North'
    }), expect.objectContaining({
      routeBaseName: '400 (Weekday)'
    }));
  });

  it('lets the planner switch to a new block from the bus / block controls', () => {
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

    const createNewBlockButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Create new block')
    ) as HTMLButtonElement | undefined;
    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Add 1 Trip')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      createNewBlockButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Create new block');
    expect(container?.textContent).toContain('new block 2-WD-3');

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      serviceMode: 'trip',
      blockMode: 'new',
      blockId: '2-WD-3'
    }), expect.objectContaining({
      routeBaseName: '2 (Weekday)'
    }));
  });

  it('lets the planner change the insertion point from the preview before confirming', () => {
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

    const aboveFirstRowButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Above first row')
    ) as HTMLButtonElement | undefined;
    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(button =>
      button.textContent?.includes('Add 1 Trip')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      aboveFirstRowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Insertion point: Insert before the first visible trip');

    flushSync(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      serviceMode: 'trip'
    }), expect.objectContaining({
      anchorTripId: 'north-1',
      insertionPlacement: 'before'
    }));
  });
});
