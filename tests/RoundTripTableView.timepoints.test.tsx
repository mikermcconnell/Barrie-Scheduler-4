import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

describe('RoundTripTableView timepoint toggle', () => {
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

  it('keeps all authored stops when timepoints are authoritative', () => {
    const northStops = ['North Terminal', 'Mapleview', 'Harvie', 'Bayfield', 'South Terminal'];
    const southStops = ['South Terminal', 'Bayfield', 'Harvie', 'Mapleview', 'North Terminal'];

    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
            {
              routeName: '10 (Weekday) (North)',
              stops: northStops,
              stopIds: Object.fromEntries(northStops.map((stop, index) => [stop, `N${index + 1}`])),
              trips: [
                {
                  id: 'north-trip',
                  blockId: '10-1',
                  direction: 'North',
                  tripNumber: 1,
                  rowId: 1,
                  startTime: 420,
                  endTime: 460,
                  recoveryTime: 0,
                  travelTime: 40,
                  cycleTime: 40,
                  stops: {
                    'North Terminal': '7:00 AM',
                    Mapleview: '7:10 AM',
                    Harvie: '7:20 AM',
                    Bayfield: '7:30 AM',
                    'South Terminal': '7:40 AM'
                  },
                  arrivalTimes: {
                    'North Terminal': '7:00 AM',
                    Mapleview: '7:10 AM',
                    Harvie: '7:20 AM',
                    Bayfield: '7:30 AM',
                    'South Terminal': '7:40 AM'
                  },
                  stopMinutes: {
                    'North Terminal': 420,
                    Mapleview: 430,
                    Harvie: 440,
                    Bayfield: 450,
                    'South Terminal': 460
                  }
                }
              ]
            },
            {
              routeName: '10 (Weekday) (South)',
              stops: southStops,
              stopIds: Object.fromEntries(southStops.map((stop, index) => [stop, `S${index + 1}`])),
              trips: [
                {
                  id: 'south-trip',
                  blockId: '10-1',
                  direction: 'South',
                  tripNumber: 2,
                  rowId: 2,
                  startTime: 470,
                  endTime: 510,
                  recoveryTime: 0,
                  travelTime: 40,
                  cycleTime: 40,
                  stops: {
                    'South Terminal': '7:50 AM',
                    Bayfield: '8:00 AM',
                    Harvie: '8:10 AM',
                    Mapleview: '8:20 AM',
                    'North Terminal': '8:30 AM'
                  },
                  arrivalTimes: {
                    'South Terminal': '7:50 AM',
                    Bayfield: '8:00 AM',
                    Harvie: '8:10 AM',
                    Mapleview: '8:20 AM',
                    'North Terminal': '8:30 AM'
                  },
                  stopMinutes: {
                    'South Terminal': 470,
                    Bayfield: 480,
                    Harvie: 490,
                    Mapleview: 500,
                    'North Terminal': 510
                  }
                }
              ]
            }
          ] as any}
          useAuthoritativeTimepoints
          onCellEdit={vi.fn()}
        />
      );
    });

    const timepointsButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      button => button.textContent?.trim() === 'Timepoints'
    ) as HTMLButtonElement | undefined;

    expect(timepointsButton).toBeDefined();

    flushSync(() => {
      timepointsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const tableText = container?.textContent ?? '';
    expect(tableText).toContain('Mapleview');
    expect(tableText).toContain('Harvie');
    expect(tableText).toContain('Bayfield');
  });
});
