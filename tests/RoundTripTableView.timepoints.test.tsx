import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

const buildAuthoritativeSchedule = () => {
  const northStops = ['North Terminal', 'Mapleview', 'Harvie', 'Bayfield', 'South Terminal'];
  const southStops = ['South Terminal', 'Bayfield', 'Harvie', 'Mapleview', 'North Terminal'];

  return [
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
  ] as any;
};

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
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={buildAuthoritativeSchedule()}
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

  it('can condense authoritative stops for the Step 4 performance view', () => {
    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={buildAuthoritativeSchedule()}
          useAuthoritativeTimepoints
          initialTimepointOnly
          condensedTimepointView
          onCellEdit={vi.fn()}
        />
      );
    });

    const tableText = container?.textContent ?? '';
    expect(tableText).not.toContain('Mapleview');
    expect(tableText).toContain('Harvie');
    expect(tableText).not.toContain('Bayfield');
  });

  it('keeps Sproule at Kraus in condensed route 2 timepoints', () => {
    const northStops = ['Park Place', "Veteran's at Essa", 'Cuthbert Street', 'Sproule at Kraus', 'Dunlop at Ferndale', 'Downtown Hub'];
    const southStops = ['Downtown Hub', 'Ferndale Drive', 'Sproule at Kraus', 'Ferndale Woods Public School', "Veteran's at Essa", 'Park Place'];

    flushSync(() => {
      root?.render(
        <RoundTripTableView
          schedules={[
            {
              routeName: '2 (Weekday) (North)',
              stops: northStops,
              stopIds: Object.fromEntries(northStops.map((stop, index) => [stop, `N${index + 1}`])),
              trips: [{
                id: 'route-2-north',
                blockId: '2-1',
                direction: 'North',
                tripNumber: 1,
                rowId: 1,
                startTime: 420,
                endTime: 450,
                recoveryTime: 0,
                travelTime: 30,
                cycleTime: 30,
                stops: Object.fromEntries(northStops.map((stop, index) => [stop, `7:${String(index * 5).padStart(2, '0')} AM`])),
                arrivalTimes: Object.fromEntries(northStops.map((stop, index) => [stop, `7:${String(index * 5).padStart(2, '0')} AM`])),
              }]
            },
            {
              routeName: '2 (Weekday) (South)',
              stops: southStops,
              stopIds: Object.fromEntries(southStops.map((stop, index) => [stop, `S${index + 1}`])),
              trips: [{
                id: 'route-2-south',
                blockId: '2-1',
                direction: 'South',
                tripNumber: 2,
                rowId: 2,
                startTime: 455,
                endTime: 485,
                recoveryTime: 0,
                travelTime: 30,
                cycleTime: 30,
                stops: Object.fromEntries(southStops.map((stop, index) => [stop, `8:${String(index * 5).padStart(2, '0')} AM`])),
                arrivalTimes: Object.fromEntries(southStops.map((stop, index) => [stop, `8:${String(index * 5).padStart(2, '0')} AM`])),
              }]
            }
          ] as any}
          useAuthoritativeTimepoints
          initialTimepointOnly
          condensedTimepointView
          onCellEdit={vi.fn()}
        />
      );
    });

    const tableText = container?.textContent ?? '';
    expect(tableText).toContain('Sproule');
    expect(tableText).not.toContain('Cuthbert');
    expect(tableText).not.toContain('Ferndale Woods');
  });
});
