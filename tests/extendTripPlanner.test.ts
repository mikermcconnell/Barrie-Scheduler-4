import { describe, expect, it } from 'vitest';
import {
  applyExtendTripResultToSchedules,
  buildExtendTripModalContext,
  buildExtendTripPreview
} from '../utils/schedule/extendTripPlanner';

describe('extendTripPlanner', () => {
  const schedules = [
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
    },
    {
      routeName: '8A (Weekday) (North)',
      stops: ['South Park Place', 'Barrie South GO', 'Mapleview', 'Downtown Stop 1'],
      stopIds: {
        'South Park Place': '4',
        'Barrie South GO': '3',
        Mapleview: '2',
        'Downtown Stop 1': '1'
      },
      trips: []
    }
  ] as any;

  it('builds extend context with the missing earlier stops', () => {
    const context = buildExtendTripModalContext(schedules, 'south-short');

    expect(context).not.toBeNull();
    expect(context?.currentStartIndex).toBe(2);
    expect(context?.currentEndIndex).toBe(3);

    const preview = buildExtendTripPreview(context!, {
      mode: 'earlier',
      stopName: 'Downtown Stop 1'
    });

    expect(preview.canExtendEarlier).toBe(true);
    expect(preview.availableEarlierStops).toEqual(['Downtown Stop 1', 'Mapleview']);
    expect(preview.updatedTrip.startTime).toBe(1380);
    expect(preview.updatedTrip.startStopIndex).toBeUndefined();
    expect(preview.updatedTrip.stops['Downtown Stop 1']).toBe('11:00 PM');
    expect(preview.updatedTrip.stops.Mapleview).toBe('11:12 PM');
  });

  it('extends a trip later to a downstream stop and updates the end timing in place', () => {
    const context = buildExtendTripModalContext([
      {
        routeName: '5 (Weekday) (North)',
        stops: ['Terminal', 'Stop B', 'Stop C', 'College'],
        stopIds: { Terminal: '1', 'Stop B': '2', 'Stop C': '3', College: '4' },
        trips: [
          {
            id: 'north-full',
            blockId: '5-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 360,
            endTime: 390,
            recoveryTime: 6,
            travelTime: 30,
            cycleTime: 36,
            stops: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM', College: '6:30 AM' },
            arrivalTimes: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM', College: '6:30 AM' },
            stopMinutes: { Terminal: 360, 'Stop B': 370, 'Stop C': 380, College: 390 }
          },
          {
            id: 'north-short',
            blockId: '5-2',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 360,
            endTime: 380,
            recoveryTime: 0,
            travelTime: 20,
            cycleTime: 20,
            stops: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM' },
            arrivalTimes: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM' },
            stopMinutes: { Terminal: 360, 'Stop B': 370, 'Stop C': 380 },
            endStopIndex: 2
          }
        ]
      }
    ] as any, 'north-short');

    const applied = applyExtendTripResultToSchedules(context!.allSchedules, context!, {
      mode: 'later',
      stopName: 'College'
    });
    const updatedTrip = applied.schedules[0].trips.find((trip: any) => trip.id === 'north-short');

    expect(updatedTrip).toBeTruthy();
    expect(updatedTrip.endTime).toBe(390);
    expect(updatedTrip.endStopIndex).toBeUndefined();
    expect(updatedTrip.recoveryTime).toBe(6);
    expect(updatedTrip.stops.College).toBe('6:30 AM');
    expect(updatedTrip.arrivalTimes.College).toBe('6:30 AM');
  });

  it('extends a trip earlier and keeps the existing downstream times untouched', () => {
    const context = buildExtendTripModalContext(schedules, 'south-short');
    const applied = applyExtendTripResultToSchedules(context!.allSchedules, context!, {
      mode: 'earlier',
      stopName: 'Mapleview'
    });
    const updatedTrip = applied.schedules[0].trips.find((trip: any) => trip.id === 'south-short');

    expect(updatedTrip.startStopIndex).toBe(1);
    expect(updatedTrip.startTime).toBe(1392);
    expect(updatedTrip.stops['Barrie South GO']).toBe('11:26 PM');
    expect(updatedTrip.stops['South Park Place']).toBe('11:39 PM');
    expect(updatedTrip.stops.Mapleview).toBe('11:12 PM');
    expect(updatedTrip.recoveryTime).toBe(0);
  });

  it('does not flag a block conflict when an earlier extension does not worsen an existing paired-block overlap', () => {
    const pairedSchedules = [
      {
        routeName: '2 (Weekday) (North)',
        stops: ['Park Place', 'Sproule at Kraus', 'Dunlop at Ferndale', 'Arrive Downtown'],
        stopIds: {
          'Park Place': '1',
          'Sproule at Kraus': '2',
          'Dunlop at Ferndale': '3',
          'Arrive Downtown': '4'
        },
        trips: [
          {
            id: 'north-template',
            blockId: '2-2',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 305,
            endTime: 340,
            recoveryTime: 11,
            travelTime: 35,
            cycleTime: 46,
            stops: {
              'Park Place': '5:05 AM',
              'Sproule at Kraus': '5:27 AM',
              'Dunlop at Ferndale': '5:33 AM',
              'Arrive Downtown': '5:40 AM'
            },
            arrivalTimes: {
              'Park Place': '5:05 AM',
              'Sproule at Kraus': '5:27 AM',
              'Dunlop at Ferndale': '5:33 AM',
              'Arrive Downtown': '5:40 AM'
            },
            stopMinutes: {
              'Park Place': 305,
              'Sproule at Kraus': 327,
              'Dunlop at Ferndale': 333,
              'Arrive Downtown': 340
            }
          },
          {
            id: 'north-short',
            blockId: '2-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 327,
            endTime: 340,
            recoveryTime: 0,
            travelTime: 13,
            cycleTime: 13,
            stops: {
              'Sproule at Kraus': '5:27 AM',
              'Dunlop at Ferndale': '5:33 AM',
              'Arrive Downtown': '5:40 AM'
            },
            arrivalTimes: {
              'Sproule at Kraus': '5:27 AM',
              'Dunlop at Ferndale': '5:33 AM',
              'Arrive Downtown': '5:40 AM'
            },
            stopMinutes: {
              'Sproule at Kraus': 327,
              'Dunlop at Ferndale': 333,
              'Arrive Downtown': 340
            },
            startStopIndex: 1
          }
        ]
      },
      {
        routeName: '2 (Weekday) (South)',
        stops: ['Depart Downtown', 'Ferndale Drive', 'Sproule at Kraus'],
        stopIds: {
          'Depart Downtown': '5',
          'Ferndale Drive': '6',
          'Sproule at Kraus': '7'
        },
        trips: [
          {
            id: 'south-paired',
            blockId: '2-1',
            direction: 'South',
            tripNumber: 1,
            rowId: 3,
            startTime: 348,
            endTime: 386,
            recoveryTime: 0,
            travelTime: 38,
            cycleTime: 38,
            stops: {
              'Depart Downtown': '5:48 AM',
              'Ferndale Drive': '5:55 AM',
              'Sproule at Kraus': '6:26 AM'
            },
            arrivalTimes: {
              'Depart Downtown': '5:48 AM',
              'Ferndale Drive': '5:55 AM',
              'Sproule at Kraus': '6:26 AM'
            },
            stopMinutes: {
              'Depart Downtown': 348,
              'Ferndale Drive': 355,
              'Sproule at Kraus': 386
            }
          }
        ]
      }
    ] as any;

    const context = buildExtendTripModalContext(pairedSchedules, 'north-short');
    const preview = buildExtendTripPreview(context!, {
      mode: 'earlier',
      stopName: 'Park Place'
    });

    expect(preview.updatedTrip.startTime).toBe(305);
    expect(preview.updatedTrip.recoveryTime).toBe(0);
    expect(preview.blockConflict).toBeNull();
  });

  it('still flags a block conflict when a later extension worsens the overlap on the same block', () => {
    const schedulesWithNextTrip = [
      {
        routeName: '5 (Weekday) (North)',
        stops: ['Terminal', 'Stop B', 'Stop C', 'College'],
        stopIds: { Terminal: '1', 'Stop B': '2', 'Stop C': '3', College: '4' },
        trips: [
          {
            id: 'north-template',
            blockId: '5-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 360,
            endTime: 390,
            recoveryTime: 6,
            travelTime: 30,
            cycleTime: 36,
            stops: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM', College: '6:30 AM' },
            arrivalTimes: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM', College: '6:30 AM' },
            stopMinutes: { Terminal: 360, 'Stop B': 370, 'Stop C': 380, College: 390 }
          },
          {
            id: 'north-short',
            blockId: '5-2',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 360,
            endTime: 380,
            recoveryTime: 10,
            travelTime: 20,
            cycleTime: 30,
            stops: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM' },
            arrivalTimes: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM' },
            stopMinutes: { Terminal: 360, 'Stop B': 370, 'Stop C': 380 },
            endStopIndex: 2
          },
          {
            id: 'next-block-trip',
            blockId: '5-2',
            direction: 'North',
            tripNumber: 3,
            rowId: 3,
            startTime: 388,
            endTime: 410,
            recoveryTime: 0,
            travelTime: 22,
            cycleTime: 22,
            stops: { Terminal: '6:28 AM', 'Stop B': '6:38 AM', 'Stop C': '6:50 AM' },
            arrivalTimes: { Terminal: '6:28 AM', 'Stop B': '6:38 AM', 'Stop C': '6:50 AM' },
            stopMinutes: { Terminal: 388, 'Stop B': 398, 'Stop C': 410 }
          }
        ]
      }
    ] as any;

    const context = buildExtendTripModalContext(schedulesWithNextTrip, 'north-short');
    const preview = buildExtendTripPreview(context!, {
      mode: 'later',
      stopName: 'College'
    });

    expect(preview.updatedTrip.endTime).toBe(390);
    expect(preview.blockConflict).not.toBeNull();
    expect(preview.blockConflict?.tripId).toBe('next-block-trip');
  });
});
