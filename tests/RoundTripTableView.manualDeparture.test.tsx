import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

describe('RoundTripTableView manual departure display', () => {
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

  it('shows an explicit zero-recovery departure override instead of forcing arrival time', () => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
            {
              routeName: '7 (Sunday) (North)',
              stops: ['Park Place', 'Rose Street', 'Downtown Hub'],
              stopIds: {
                'Park Place': 'N1',
                'Rose Street': 'N2',
                'Downtown Hub': 'N3',
              },
              trips: [
                {
                  id: 'north-trip',
                  blockId: '7-1',
                  direction: 'North',
                  tripNumber: 1,
                  rowId: 1,
                  startTime: 452,
                  endTime: 526,
                  recoveryTime: 2,
                  recoveryTimes: { 'Rose Street': 0, 'Downtown Hub': 2 },
                  travelTime: 72,
                  cycleTime: 74,
                  stops: {
                    'Park Place': '7:32 AM',
                    'Rose Street': '8:36 AM',
                    'Downtown Hub': '8:48 AM',
                  },
                  arrivalTimes: {
                    'Park Place': '7:32 AM',
                    'Rose Street': '8:31 AM',
                    'Downtown Hub': '8:46 AM',
                  },
                  stopMinutes: {
                    'Park Place': 452,
                    'Rose Street': 516,
                    'Downtown Hub': 528,
                  },
                },
              ],
            },
            {
              routeName: '7 (Sunday) (South)',
              stops: ['Downtown Hub', 'Park Place'],
              stopIds: {
                'Downtown Hub': 'S1',
                'Park Place': 'S2',
              },
              trips: [
                {
                  id: 'south-trip',
                  blockId: '7-1',
                  direction: 'South',
                  tripNumber: 2,
                  rowId: 2,
                  startTime: 528,
                  endTime: 614,
                  recoveryTime: 0,
                  travelTime: 86,
                  cycleTime: 86,
                  stops: {
                    'Downtown Hub': '8:48 AM',
                    'Park Place': '10:14 AM',
                  },
                  arrivalTimes: {
                    'Downtown Hub': '8:46 AM',
                    'Park Place': '10:14 AM',
                  },
                  stopMinutes: {
                    'Downtown Hub': 528,
                    'Park Place': 614,
                  },
                },
              ],
            },
          ] as any}
          onCellEdit={() => {}}
        />
      );
    });

    const departureButton = container?.querySelector(
      'button[aria-label*="North Rose Street"][aria-label*="departure time"][aria-label*="Current value 8:36 AM."]'
    );

    expect(departureButton).not.toBeNull();
  });
});
