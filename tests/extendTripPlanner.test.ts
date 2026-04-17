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

  it('extends an 8A trip later using the current end-stop departure time when recovery exists there', () => {
    const context = buildExtendTripModalContext([
      {
        routeName: '8A (Weekday) (South)',
        stops: ['Barrie South GO', 'Downtown', 'Park Place'],
        stopIds: { 'Barrie South GO': '1', Downtown: '2', 'Park Place': '3' },
        trips: [
          {
            id: '8a-template',
            blockId: '8A-1',
            direction: 'South',
            tripNumber: 1,
            rowId: 1,
            startTime: 438,
            endTime: 452,
            recoveryTime: 4,
            travelTime: 14,
            cycleTime: 18,
            stops: {
              'Barrie South GO': '7:18 AM',
              Downtown: '7:23 AM',
              'Park Place': '7:32 AM'
            },
            arrivalTimes: {
              'Barrie South GO': '7:18 AM',
              Downtown: '7:18 AM',
              'Park Place': '7:32 AM'
            },
            stopMinutes: {
              'Barrie South GO': 438,
              Downtown: 443,
              'Park Place': 452
            },
            recoveryTimes: {
              Downtown: 5,
              'Park Place': 4
            }
          },
          {
            id: '8a-short',
            blockId: '8A-2',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 438,
            endTime: 443,
            recoveryTime: 5,
            travelTime: 5,
            cycleTime: 10,
            stops: {
              'Barrie South GO': '7:18 AM',
              Downtown: '7:23 AM'
            },
            arrivalTimes: {
              'Barrie South GO': '7:18 AM',
              Downtown: '7:18 AM'
            },
            stopMinutes: {
              'Barrie South GO': 438,
              Downtown: 443
            },
            recoveryTimes: {
              Downtown: 5
            },
            endStopIndex: 1
          }
        ]
      }
    ] as any, '8a-short');

    const preview = buildExtendTripPreview(context!, {
      mode: 'later',
      stopName: 'Park Place'
    });

    expect(preview.updatedTrip.stops.ParkPlace).toBeUndefined();
    expect(preview.updatedTrip.stops['Park Place']).toBe('7:32 AM');
    expect(preview.updatedTrip.arrivalTimes['Park Place']).toBe('7:32 AM');
    expect(preview.updatedTrip.endTime).toBe(452);
  });

  it('extends an 8B trip later using the current end-stop departure time when recovery exists there', () => {
    const context = buildExtendTripModalContext([
      {
        routeName: '8B (Weekday) (South)',
        stops: ['Barrie South GO', 'Downtown', 'Park Place'],
        stopIds: { 'Barrie South GO': '1', Downtown: '2', 'Park Place': '3' },
        trips: [
          {
            id: '8b-template',
            blockId: '8B-1',
            direction: 'South',
            tripNumber: 1,
            rowId: 1,
            startTime: 558,
            endTime: 572,
            recoveryTime: 4,
            travelTime: 14,
            cycleTime: 18,
            stops: {
              'Barrie South GO': '9:18 AM',
              Downtown: '9:23 AM',
              'Park Place': '9:32 AM'
            },
            arrivalTimes: {
              'Barrie South GO': '9:18 AM',
              Downtown: '9:18 AM',
              'Park Place': '9:32 AM'
            },
            stopMinutes: {
              'Barrie South GO': 558,
              Downtown: 563,
              'Park Place': 572
            },
            recoveryTimes: {
              Downtown: 5,
              'Park Place': 4
            }
          },
          {
            id: '8b-short',
            blockId: '8B-2',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 558,
            endTime: 563,
            recoveryTime: 5,
            travelTime: 5,
            cycleTime: 10,
            stops: {
              'Barrie South GO': '9:18 AM',
              Downtown: '9:23 AM'
            },
            arrivalTimes: {
              'Barrie South GO': '9:18 AM',
              Downtown: '9:18 AM'
            },
            stopMinutes: {
              'Barrie South GO': 558,
              Downtown: 563
            },
            recoveryTimes: {
              Downtown: 5
            },
            endStopIndex: 1
          }
        ]
      }
    ] as any, '8b-short');

    const preview = buildExtendTripPreview(context!, {
      mode: 'later',
      stopName: 'Park Place'
    });

    expect(preview.updatedTrip.stops['Park Place']).toBe('9:32 AM');
    expect(preview.updatedTrip.arrivalTimes['Park Place']).toBe('9:32 AM');
    expect(preview.updatedTrip.endTime).toBe(572);
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
    expect(updatedTrip.recoveryTime).toBe(5);
    expect(updatedTrip.recoveryTimes).toEqual({
      'South Park Place': 5
    });
  });

  it('extends earlier on repeated-stop loop patterns without treating suffixed later stops as earlier active stops', () => {
    const repeatedStopSchedules = [
      {
        routeName: '8A (Weekday) (South)',
        stops: ['Park Place', 'Peggy Hill', 'Allandale GO', 'Downtown', 'Georgian College', 'Georgian Mall', 'Anne at Donald', 'Allandale GO (3)', 'Barrie South GO (2)'],
        stopIds: {
          'Park Place': '1',
          'Peggy Hill': '2',
          'Allandale GO': '3',
          Downtown: '4',
          'Georgian College': '5',
          'Georgian Mall': '6',
          'Anne at Donald': '7',
          'Allandale GO (3)': '8',
          'Barrie South GO (2)': '9'
        },
        trips: [
          {
            id: '8a-template',
            blockId: '8A-1',
            direction: 'South',
            tripNumber: 1,
            rowId: 1,
            startTime: 426,
            endTime: 558,
            recoveryTime: 6,
            travelTime: 132,
            cycleTime: 138,
            stops: {
              'Park Place': '7:06 AM',
              'Peggy Hill': '7:25 AM',
              'Allandale GO': '7:43 AM',
              Downtown: '7:51 AM',
              'Georgian College': '8:14 AM',
              'Georgian Mall': '8:24 AM',
              'Anne at Donald': '8:39 AM',
              'Allandale GO (3)': '8:50 AM',
              'Barrie South GO (2)': '9:18 AM'
            },
            arrivalTimes: {
              'Park Place': '7:06 AM',
              'Peggy Hill': '7:25 AM',
              'Allandale GO': '7:43 AM',
              Downtown: '7:51 AM',
              'Georgian College': '8:14 AM',
              'Georgian Mall': '8:24 AM',
              'Anne at Donald': '8:39 AM',
              'Allandale GO (3)': '8:50 AM',
              'Barrie South GO (2)': '9:18 AM'
            },
            stopMinutes: {
              'Park Place': 426,
              'Peggy Hill': 445,
              'Allandale GO': 463,
              Downtown: 471,
              'Georgian College': 494,
              'Georgian Mall': 504,
              'Anne at Donald': 519,
              'Allandale GO (3)': 530,
              'Barrie South GO (2)': 558
            },
            recoveryTimes: {
              'Barrie South GO (2)': 6
            }
          },
          {
            id: '8a-short',
            blockId: '8A-2',
            direction: 'South',
            tripNumber: 2,
            rowId: 2,
            startTime: 519,
            endTime: 558,
            recoveryTime: 6,
            travelTime: 39,
            cycleTime: 45,
            stops: {
              'Anne at Donald': '8:39 AM',
              'Allandale GO (3)': '8:50 AM',
              'Barrie South GO (2)': '9:18 AM'
            },
            arrivalTimes: {
              'Anne at Donald': '8:39 AM',
              'Allandale GO (3)': '8:50 AM',
              'Barrie South GO (2)': '9:18 AM'
            },
            stopMinutes: {
              'Anne at Donald': 519,
              'Allandale GO (3)': 530,
              'Barrie South GO (2)': 558
            },
            recoveryTimes: {
              'Barrie South GO (2)': 6
            }
          }
        ]
      }
    ] as any;

    const context = buildExtendTripModalContext(repeatedStopSchedules, '8a-short');

    expect(context?.currentStartIndex).toBe(6);
    expect(context?.currentEndIndex).toBe(8);

    const preview = buildExtendTripPreview(context!, {
      mode: 'earlier',
      stopName: 'Park Place'
    });

    expect(preview.availableEarlierStops).toEqual([
      'Park Place',
      'Peggy Hill',
      'Allandale GO',
      'Downtown',
      'Georgian College',
      'Georgian Mall'
    ]);
    expect(preview.updatedTrip.startTime).toBe(426);
    expect(preview.updatedTrip.stops['Park Place']).toBe('7:06 AM');
    expect(preview.updatedTrip.stops['Georgian College']).toBe('8:14 AM');
    expect(preview.updatedTrip.stops['Georgian Mall']).toBe('8:24 AM');
    expect(preview.updatedTrip.stops['Anne at Donald']).toBe('8:39 AM');
    expect(preview.updatedTrip.stops['Allandale GO (3)']).toBe('8:50 AM');
    expect(preview.updatedTrip.stops['Barrie South GO (2)']).toBe('9:18 AM');
    expect(preview.blockConflict).toBeNull();
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
    expect(preview.updatedTrip.recoveryTime).toBe(8);
    expect(preview.updatedTrip.recoveryTimes).toEqual({
      'Arrive Downtown': 8
    });
    expect(preview.blockConflict).toBeNull();
  });

  it('allows an earlier extension to consume recovery on the previous same-block trip', () => {
    const schedulesWithRecoveryGap = [
      {
        routeName: '2 (Sunday) (North)',
        stops: ['Park Place', 'Sproule at Kraus', 'Downtown Hub'],
        stopIds: {
          'Park Place': '1',
          'Sproule at Kraus': '2',
          'Downtown Hub': '3'
        },
        trips: [
          {
            id: 'north-template',
            blockId: '2-9',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 485,
            endTime: 519,
            recoveryTime: 0,
            travelTime: 34,
            cycleTime: 34,
            stops: {
              'Park Place': '8:05 AM',
              'Sproule at Kraus': '8:26 AM',
              'Downtown Hub': '8:39 AM'
            },
            arrivalTimes: {
              'Park Place': '8:05 AM',
              'Sproule at Kraus': '8:26 AM',
              'Downtown Hub': '8:39 AM'
            },
            stopMinutes: {
              'Park Place': 485,
              'Sproule at Kraus': 506,
              'Downtown Hub': 519
            }
          },
          {
            id: 'north-short',
            blockId: '2-1',
            direction: 'North',
            tripNumber: 3,
            rowId: 3,
            startTime: 506,
            endTime: 519,
            recoveryTime: 0,
            travelTime: 13,
            cycleTime: 13,
            stops: {
              'Sproule at Kraus': '8:26 AM',
              'Downtown Hub': '8:39 AM'
            },
            arrivalTimes: {
              'Sproule at Kraus': '8:26 AM',
              'Downtown Hub': '8:39 AM'
            },
            stopMinutes: {
              'Sproule at Kraus': 506,
              'Downtown Hub': 519
            },
            startStopIndex: 1
          }
        ]
      },
      {
        routeName: '2 (Sunday) (South)',
        stops: ['Downtown Hub', 'Ferndale Woods Public School', 'Park Place'],
        stopIds: {
          'Downtown Hub': '4',
          'Ferndale Woods Public School': '5',
          'Park Place': '6'
        },
        trips: [
          {
            id: 'south-before',
            blockId: '2-1',
            direction: 'South',
            tripNumber: 1,
            rowId: 1,
            startTime: 438,
            endTime: 474,
            recoveryTime: 20,
            cycleTime: 56,
            travelTime: 36,
            stops: {
              'Downtown Hub': '7:18 AM',
              'Ferndale Woods Public School': '7:40 AM',
              'Park Place': '7:54 AM'
            },
            arrivalTimes: {
              'Downtown Hub': '7:18 AM',
              'Ferndale Woods Public School': '7:40 AM',
              'Park Place': '7:54 AM'
            },
            stopMinutes: {
              'Downtown Hub': 438,
              'Ferndale Woods Public School': 460,
              'Park Place': 474
            },
            recoveryTimes: {
              'Park Place': 20
            }
          }
        ]
      }
    ] as any;

    const context = buildExtendTripModalContext(schedulesWithRecoveryGap, 'north-short');
    const preview = buildExtendTripPreview(context!, {
      mode: 'earlier',
      stopName: 'Park Place'
    });
    const previousTrip = preview.schedules[1].trips.find((trip: any) => trip.id === 'south-before');

    expect(preview.updatedTrip.startTime).toBe(485);
    expect(preview.blockConflict).toBeNull();
    expect(previousTrip?.recoveryTime).toBe(11);
    expect(previousTrip?.cycleTime).toBe(47);
    expect(previousTrip?.recoveryTimes).toEqual({
      'Park Place': 11
    });
  });

  it('derives intermediate recovery for earlier extensions from the template arrival/departure split', () => {
    const schedulesWithDerivedRecovery = [
      {
        routeName: '7 (Sunday) (North)',
        stops: ['Park Place', 'Allandale Terminal', 'Downtown Hub', 'Georgian College', 'Rose Street'],
        stopIds: {
          'Park Place': '777',
          'Allandale Terminal': '9006',
          'Downtown Hub': '2',
          'Georgian College': '331',
          'Rose Street': '251'
        },
        trips: [
          {
            id: 'north-template',
            blockId: '7-2',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 512,
            endTime: 575,
            recoveryTime: 8,
            travelTime: 63,
            cycleTime: 71,
            stops: {
              'Park Place': '8:32 AM',
              'Allandale Terminal': '9:08 AM',
              'Downtown Hub': '9:17 AM',
              'Georgian College': '9:29 AM',
              'Rose Street': '9:35 AM'
            },
            arrivalTimes: {
              'Park Place': '8:32 AM',
              'Allandale Terminal': '9:06 AM',
              'Downtown Hub': '9:15 AM',
              'Georgian College': '9:29 AM',
              'Rose Street': '9:31 AM'
            }
          },
          {
            id: 'north-short',
            blockId: '7-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 569,
            endTime: 575,
            recoveryTime: 4,
            travelTime: 6,
            cycleTime: 10,
            stops: {
              'Georgian College': '9:29 AM',
              'Rose Street': '9:35 AM'
            },
            arrivalTimes: {
              'Georgian College': '9:29 AM',
              'Rose Street': '9:31 AM'
            },
            stopMinutes: {
              'Georgian College': 569,
              'Rose Street': 575
            },
            recoveryTimes: {
              'Rose Street': 4
            },
            startStopIndex: 3
          }
        ]
      }
    ] as any;

    const context = buildExtendTripModalContext(schedulesWithDerivedRecovery, 'north-short');
    const preview = buildExtendTripPreview(context!, {
      mode: 'earlier',
      stopName: 'Park Place'
    });

    expect(preview.updatedTrip.stops['Park Place']).toBe('8:32 AM');
    expect(preview.updatedTrip.arrivalTimes['Allandale Terminal']).toBe('9:06 AM');
    expect(preview.updatedTrip.recoveryTimes).toEqual({
      'Allandale Terminal': 2,
      'Downtown Hub': 2,
      'Rose Street': 4
    });
    expect(preview.updatedTrip.stops['Allandale Terminal']).toBe('9:08 AM');
    expect(preview.updatedTrip.stops['Downtown Hub']).toBe('9:17 AM');
    expect(preview.updatedTrip.recoveryTime).toBe(8);
  });

  it('preserves intermediate recovery when same-block absorption trims only the terminal recovery', () => {
    const schedulesWithImmediateReturn = [
      {
        routeName: '7 (Sunday) (North)',
        stops: ['Park Place', 'Peggy Hill Community Centre', 'Barrie Allandale Transit Terminal', 'Downtown Hub', 'Georgian College', 'Rose Street'],
        stopIds: {
          'Park Place': '777',
          'Peggy Hill Community Centre': '880',
          'Barrie Allandale Transit Terminal': '9006',
          'Downtown Hub': '2',
          'Georgian College': '331',
          'Rose Street': '251'
        },
        trips: [
          {
            id: 'north-short',
            blockId: '7-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 569,
            endTime: 571,
            recoveryTime: 0,
            travelTime: 2,
            cycleTime: 2,
            stops: {
              'Georgian College': '9:29 AM',
              'Rose Street': '9:31 AM'
            },
            arrivalTimes: {
              'Georgian College': '9:29 AM',
              'Rose Street': '9:31 AM'
            },
            recoveryTimes: {
              'Rose Street': 0
            },
            startStopIndex: 4
          },
          {
            id: 'north-template',
            blockId: '7-2',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 572,
            endTime: 631,
            recoveryTime: 5,
            travelTime: 59,
            cycleTime: 64,
            stops: {
              'Park Place': '9:32 AM',
              'Peggy Hill Community Centre': '9:49 AM',
              'Barrie Allandale Transit Terminal': '10:06 AM',
              'Downtown Hub': '10:15 AM',
              'Georgian College': '10:29 AM',
              'Rose Street': '10:31 AM'
            },
            arrivalTimes: {
              'Park Place': '9:32 AM',
              'Peggy Hill Community Centre': '9:49 AM',
              'Barrie Allandale Transit Terminal': '10:06 AM',
              'Downtown Hub': '10:15 AM',
              'Georgian College': '10:29 AM',
              'Rose Street': '10:31 AM'
            },
            recoveryTimes: {
              'Barrie Allandale Transit Terminal': 4,
              'Downtown Hub': 1,
              'Rose Street': 0
            }
          }
        ]
      },
      {
        routeName: '7 (Sunday) (South)',
        stops: ['Rose Street', 'Downtown Hub', 'Barrie Allandale Transit Terminal', 'Peggy Hill Community Centre', 'Park Place'],
        stopIds: {
          'Rose Street': '251',
          'Downtown Hub': '1',
          'Barrie Allandale Transit Terminal': '9006',
          'Peggy Hill Community Centre': '880',
          'Park Place': '777'
        },
        trips: [
          {
            id: 'south-immediate',
            blockId: '7-1',
            direction: 'South',
            tripNumber: 2,
            rowId: 3,
            startTime: 571,
            endTime: 627,
            recoveryTime: 11,
            travelTime: 56,
            cycleTime: 67,
            stops: {
              'Rose Street': '9:31 AM',
              'Downtown Hub': '9:41 AM',
              'Barrie Allandale Transit Terminal': '9:49 AM',
              'Peggy Hill Community Centre': '10:10 AM',
              'Park Place': '10:27 AM'
            },
            arrivalTimes: {
              'Rose Street': '9:31 AM',
              'Downtown Hub': '9:41 AM',
              'Barrie Allandale Transit Terminal': '9:49 AM',
              'Peggy Hill Community Centre': '10:10 AM',
              'Park Place': '10:27 AM'
            },
            recoveryTimes: {
              'Downtown Hub': 2,
              'Barrie Allandale Transit Terminal': 4,
              'Park Place': 5
            }
          }
        ]
      }
    ] as any;

    const context = buildExtendTripModalContext(schedulesWithImmediateReturn, 'north-short');
    const preview = buildExtendTripPreview(context!, {
      mode: 'earlier',
      stopName: 'Park Place'
    });

    expect(preview.updatedTrip.startTime).toBe(512);
    expect(preview.updatedTrip.endTime).toBe(571);
    expect(preview.updatedTrip.recoveryTimes).toEqual({
      'Barrie Allandale Transit Terminal': 4,
      'Downtown Hub': 1,
      'Rose Street': 0
    });
    expect(preview.updatedTrip.recoveryTime).toBe(5);
    expect(preview.updatedTrip.cycleTime).toBe(64);
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

  it('allows a later extension to consume the updated trip recovery before the next same-block trip', () => {
    const schedulesWithSlackRecovery = [
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
            endTime: 386,
            recoveryTime: 6,
            travelTime: 26,
            cycleTime: 32,
            stops: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM', College: '6:26 AM' },
            arrivalTimes: { Terminal: '6:00 AM', 'Stop B': '6:10 AM', 'Stop C': '6:20 AM', College: '6:26 AM' },
            stopMinutes: { Terminal: 360, 'Stop B': 370, 'Stop C': 380, College: 386 },
            recoveryTimes: { College: 6 }
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
            recoveryTimes: { 'Stop C': 10 },
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

    const context = buildExtendTripModalContext(schedulesWithSlackRecovery, 'north-short');
    const preview = buildExtendTripPreview(context!, {
      mode: 'later',
      stopName: 'College'
    });
    const updatedTrip = preview.schedules[0].trips.find((trip: any) => trip.id === 'north-short');

    expect(preview.updatedTrip.endTime).toBe(386);
    expect(preview.blockConflict).toBeNull();
    expect(updatedTrip?.recoveryTime).toBe(2);
    expect(updatedTrip?.cycleTime).toBe(28);
    expect(updatedTrip?.recoveryTimes).toEqual({
      College: 2
    });
  });
});
