import { describe, expect, it } from 'vitest';
import {
  buildAddTripPresets,
  applyAddTripResultToSchedules,
  applyEditTripResultToSchedules,
  buildAddTripSuggestions,
  buildAddTripModalContext,
  buildEditTripModalContext,
  buildEditTripSuggestions,
  type AddTripModalContext,
  type AddTripResult
} from '../utils/schedule/addTripPlanner';

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
    tripNumber: 1,
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
        tripNumber: 1,
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
          tripNumber: 1,
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
        },
        {
          id: 'south-2',
          blockId: '2-WD-2',
          direction: 'South',
          tripNumber: 2,
          rowId: 4,
          startTime: 455,
          endTime: 485,
          recoveryTime: 5,
          travelTime: 30,
          cycleTime: 35,
          stops: { Downtown: '7:35 AM', 'Park Place': '8:05 AM' },
          arrivalTimes: { Downtown: '7:35 AM', 'Park Place': '8:05 AM' }
        }
      ]
    }
  ] as any,
  routeBaseName: '2 (Weekday)'
});

const build400Context = (): AddTripModalContext => ({
  referenceTrip: {
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
  },
  nextTrip: {
    id: '400-north-2',
    blockId: '400-WD-2',
    direction: 'North',
    tripNumber: 1,
    rowId: 2,
    startTime: 410,
    endTime: 432,
    recoveryTime: 8,
    travelTime: 22,
    cycleTime: 30,
    stops: { 'Park Place': '6:50 AM', 'RVH Main Entrance': '7:12 AM' },
    arrivalTimes: { 'Park Place': '6:50 AM', 'RVH Main Entrance': '7:12 AM' },
    stopMinutes: { 'Park Place': 410, 'RVH Main Entrance': 432 }
  },
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
        recoveryTime: 8,
        travelTime: 22,
        cycleTime: 30,
        stops: { 'Park Place': '6:20 AM', 'RVH Main Entrance': '6:42 AM' },
        arrivalTimes: { 'Park Place': '6:20 AM', 'RVH Main Entrance': '6:42 AM' },
        stopMinutes: { 'Park Place': 380, 'RVH Main Entrance': 402 }
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
  routeBaseName: '400 (Weekday)'
});

const buildLoopRouteContext = (): AddTripModalContext => ({
  referenceTrip: {
    id: '10-loop-template',
    blockId: '10-1',
    direction: 'North',
    tripNumber: 2,
    rowId: 2,
    startTime: 490,
    endTime: 550,
    recoveryTime: 5,
    travelTime: 60,
    cycleTime: 65,
    recoveryTimes: {
      'Leacock at Frost': 3,
      'Wal-Mart Plaza': 3,
      'Georgian College': 5,
      'Downtown Hub (2)': 5
    },
    stops: {
      'Downtown Hub': '8:10 AM',
      'Leacock at Frost': '8:26 AM',
      'Wal-Mart Plaza': '8:39 AM',
      'Georgian College': '8:52 AM',
      'Downtown Hub (2)': '9:10 AM'
    },
    arrivalTimes: {
      'Downtown Hub': '8:10 AM',
      'Leacock at Frost': '8:23 AM',
      'Wal-Mart Plaza': '8:36 AM',
      'Georgian College': '8:47 AM',
      'Downtown Hub (2)': '9:05 AM'
    },
    stopMinutes: {
      'Downtown Hub': 490,
      'Leacock at Frost': 506,
      'Wal-Mart Plaza': 519,
      'Georgian College': 532,
      'Downtown Hub (2)': 550
    }
  },
  nextTrip: null,
  targetTable: {
    routeName: '10 (Sunday) (North)',
    stops: ['Downtown Hub', 'Leacock at Frost', 'Wal-Mart Plaza', 'Georgian College', 'Downtown Hub (2)'],
    stopIds: {
      'Downtown Hub': '2',
      'Leacock at Frost': '899',
      'Wal-Mart Plaza': '454',
      'Georgian College': '335',
      'Downtown Hub (2)': '2'
    },
    trips: [
      {
        id: '10-loop-template',
        blockId: '10-1',
        direction: 'North',
        tripNumber: 2,
        rowId: 2,
        startTime: 490,
        endTime: 550,
        recoveryTime: 5,
        travelTime: 60,
        cycleTime: 65,
        recoveryTimes: {
          'Leacock at Frost': 3,
          'Wal-Mart Plaza': 3,
          'Georgian College': 5,
          'Downtown Hub (2)': 5
        },
        stops: {
          'Downtown Hub': '8:10 AM',
          'Leacock at Frost': '8:26 AM',
          'Wal-Mart Plaza': '8:39 AM',
          'Georgian College': '8:52 AM',
          'Downtown Hub (2)': '9:10 AM'
        },
        arrivalTimes: {
          'Downtown Hub': '8:10 AM',
          'Leacock at Frost': '8:23 AM',
          'Wal-Mart Plaza': '8:36 AM',
          'Georgian College': '8:47 AM',
          'Downtown Hub (2)': '9:05 AM'
        },
        stopMinutes: {
          'Downtown Hub': 490,
          'Leacock at Frost': 506,
          'Wal-Mart Plaza': 519,
          'Georgian College': 532,
          'Downtown Hub (2)': 550
        }
      }
    ]
  },
  allSchedules: [
    {
      routeName: '10 (Sunday) (North)',
      stops: ['Downtown Hub', 'Leacock at Frost', 'Wal-Mart Plaza', 'Georgian College', 'Downtown Hub (2)'],
      stopIds: {
        'Downtown Hub': '2',
        'Leacock at Frost': '899',
        'Wal-Mart Plaza': '454',
        'Georgian College': '335',
        'Downtown Hub (2)': '2'
      },
      trips: [
        {
          id: '10-loop-template',
          blockId: '10-1',
          direction: 'North',
          tripNumber: 2,
          rowId: 2,
          startTime: 490,
          endTime: 550,
          recoveryTime: 5,
          travelTime: 60,
          cycleTime: 65,
          recoveryTimes: {
            'Leacock at Frost': 3,
            'Wal-Mart Plaza': 3,
            'Georgian College': 5,
            'Downtown Hub (2)': 5
          },
          stops: {
            'Downtown Hub': '8:10 AM',
            'Leacock at Frost': '8:26 AM',
            'Wal-Mart Plaza': '8:39 AM',
            'Georgian College': '8:52 AM',
            'Downtown Hub (2)': '9:10 AM'
          },
          arrivalTimes: {
            'Downtown Hub': '8:10 AM',
            'Leacock at Frost': '8:23 AM',
            'Wal-Mart Plaza': '8:36 AM',
            'Georgian College': '8:47 AM',
            'Downtown Hub (2)': '9:05 AM'
          },
          stopMinutes: {
            'Downtown Hub': 490,
            'Leacock at Frost': 506,
            'Wal-Mart Plaza': 519,
            'Georgian College': 532,
            'Downtown Hub (2)': 550
          }
        }
      ]
    }
  ] as any,
  routeBaseName: '10 (Sunday)'
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
  routeBaseName: '400 (Weekday)'
});

const buildAliasCycleContext = (): AddTripModalContext => ({
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
  routeBaseName: '7 (Sunday)'
});

const buildBlockRecoveryMirrorContext = (): AddTripModalContext => ({
  referenceTrip: {
    id: '7-north-template',
    blockId: '7-2',
    direction: 'North',
    tripNumber: 1,
    rowId: 1,
    startTime: 421,
    endTime: 451,
    recoveryTime: 2,
    recoveryTimes: { 'Rose Street': 2 },
    travelTime: 30,
    cycleTime: 32,
    stops: {
      'Park Place': '7:01 AM',
      'Downtown Hub': '7:15 AM',
      'Rose Street': '7:31 AM'
    },
    arrivalTimes: {
      'Park Place': '7:01 AM',
      'Downtown Hub': '7:15 AM',
      'Rose Street': '7:31 AM'
    },
    stopMinutes: {
      'Park Place': 421,
      'Downtown Hub': 435,
      'Rose Street': 451
    }
  },
  nextTrip: {
    id: '7-north-block',
    blockId: '7-1',
    direction: 'North',
    tripNumber: 2,
    rowId: 2,
    startTime: 512,
    endTime: 542,
    recoveryTime: 9,
    recoveryTimes: { 'Rose Street': 9 },
    travelTime: 30,
    cycleTime: 39,
    stops: {
      'Park Place': '8:32 AM',
      'Downtown Hub': '8:46 AM',
      'Rose Street': '9:02 AM'
    },
    arrivalTimes: {
      'Park Place': '8:32 AM',
      'Downtown Hub': '8:46 AM',
      'Rose Street': '9:02 AM'
    },
    stopMinutes: {
      'Park Place': 512,
      'Downtown Hub': 526,
      'Rose Street': 542
    }
  },
  targetTable: {
    routeName: '7 (Sunday) (North)',
    stops: ['Park Place', 'Downtown Hub', 'Rose Street'],
    stopIds: { 'Park Place': '777', 'Downtown Hub': '2', 'Rose Street': '251' },
    trips: [
      {
        id: '7-north-template',
        blockId: '7-2',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 421,
        endTime: 451,
        recoveryTime: 2,
        recoveryTimes: { 'Rose Street': 2 },
        travelTime: 30,
        cycleTime: 32,
        stops: {
          'Park Place': '7:01 AM',
          'Downtown Hub': '7:15 AM',
          'Rose Street': '7:31 AM'
        },
        arrivalTimes: {
          'Park Place': '7:01 AM',
          'Downtown Hub': '7:15 AM',
          'Rose Street': '7:31 AM'
        },
        stopMinutes: {
          'Park Place': 421,
          'Downtown Hub': 435,
          'Rose Street': 451
        }
      },
      {
        id: '7-north-block',
        blockId: '7-1',
        direction: 'North',
        tripNumber: 2,
        rowId: 2,
        startTime: 512,
        endTime: 542,
        recoveryTime: 9,
        recoveryTimes: { 'Rose Street': 9 },
        travelTime: 30,
        cycleTime: 39,
        stops: {
          'Park Place': '8:32 AM',
          'Downtown Hub': '8:46 AM',
          'Rose Street': '9:02 AM'
        },
        arrivalTimes: {
          'Park Place': '8:32 AM',
          'Downtown Hub': '8:46 AM',
          'Rose Street': '9:02 AM'
        },
        stopMinutes: {
          'Park Place': 512,
          'Downtown Hub': 526,
          'Rose Street': 542
        }
      }
    ]
  },
  allSchedules: [
    {
      routeName: '7 (Sunday) (North)',
      stops: ['Park Place', 'Downtown Hub', 'Rose Street'],
      stopIds: { 'Park Place': '777', 'Downtown Hub': '2', 'Rose Street': '251' },
      trips: [
        {
          id: '7-north-template',
          blockId: '7-2',
          direction: 'North',
          tripNumber: 1,
          rowId: 1,
          startTime: 421,
          endTime: 451,
          recoveryTime: 2,
          recoveryTimes: { 'Rose Street': 2 },
          travelTime: 30,
          cycleTime: 32,
          stops: {
            'Park Place': '7:01 AM',
            'Downtown Hub': '7:15 AM',
            'Rose Street': '7:31 AM'
          },
          arrivalTimes: {
            'Park Place': '7:01 AM',
            'Downtown Hub': '7:15 AM',
            'Rose Street': '7:31 AM'
          },
          stopMinutes: {
            'Park Place': 421,
            'Downtown Hub': 435,
            'Rose Street': 451
          }
        },
        {
          id: '7-north-block',
          blockId: '7-1',
          direction: 'North',
          tripNumber: 2,
          rowId: 2,
          startTime: 512,
          endTime: 542,
          recoveryTime: 9,
          recoveryTimes: { 'Rose Street': 9 },
          travelTime: 30,
          cycleTime: 39,
          stops: {
            'Park Place': '8:32 AM',
            'Downtown Hub': '8:46 AM',
            'Rose Street': '9:02 AM'
          },
          arrivalTimes: {
            'Park Place': '8:32 AM',
            'Downtown Hub': '8:46 AM',
            'Rose Street': '9:02 AM'
          },
          stopMinutes: {
            'Park Place': 512,
            'Downtown Hub': 526,
            'Rose Street': 542
          }
        }
      ]
    }
  ] as any,
  routeBaseName: '7 (Sunday)'
});

const buildDerivedMidpointRecoveryContext = (): AddTripModalContext => ({
  referenceTrip: {
    id: '2-north-template',
    blockId: '2-1',
    direction: 'North',
    tripNumber: 7,
    rowId: 7,
    startTime: 635,
    endTime: 678,
    recoveryTime: 11,
    travelTime: 43,
    cycleTime: 54,
    stops: {
      'Park Place': '10:35 AM',
      "Veteran's at Essa": '10:44 AM',
      'Cuthbert Street': '10:49 AM',
      'Sproule at Kraus': '10:56 AM',
      'Dunlop at Ferndale': '11:02 AM',
      'Downtown Hub': '11:18 AM'
    },
    arrivalTimes: {
      'Park Place': '10:35 AM',
      "Veteran's at Essa": '10:44 AM',
      'Cuthbert Street': '10:47 AM',
      'Sproule at Kraus': '10:56 AM',
      'Dunlop at Ferndale': '11:02 AM',
      'Downtown Hub': '11:09 AM'
    }
  },
  nextTrip: null,
  targetTable: {
    routeName: '2 (Sunday) (North)',
    stops: ['Park Place', "Veteran's at Essa", 'Cuthbert Street', 'Sproule at Kraus', 'Dunlop at Ferndale', 'Downtown Hub'],
    stopIds: {
      'Park Place': '777',
      "Veteran's at Essa": '662',
      'Cuthbert Street': '829',
      'Sproule at Kraus': '627',
      'Dunlop at Ferndale': '271',
      'Downtown Hub': '1'
    },
    trips: [
      {
        id: '2-north-template',
        blockId: '2-1',
        direction: 'North',
        tripNumber: 7,
        rowId: 7,
        startTime: 635,
        endTime: 678,
        recoveryTime: 11,
        travelTime: 43,
        cycleTime: 54,
        stops: {
          'Park Place': '10:35 AM',
          "Veteran's at Essa": '10:44 AM',
          'Cuthbert Street': '10:49 AM',
          'Sproule at Kraus': '10:56 AM',
          'Dunlop at Ferndale': '11:02 AM',
          'Downtown Hub': '11:18 AM'
        },
        arrivalTimes: {
          'Park Place': '10:35 AM',
          "Veteran's at Essa": '10:44 AM',
          'Cuthbert Street': '10:47 AM',
          'Sproule at Kraus': '10:56 AM',
          'Dunlop at Ferndale': '11:02 AM',
          'Downtown Hub': '11:09 AM'
        }
      }
    ]
  },
  allSchedules: [
    {
      routeName: '2 (Sunday) (North)',
      stops: ['Park Place', "Veteran's at Essa", 'Cuthbert Street', 'Sproule at Kraus', 'Dunlop at Ferndale', 'Downtown Hub'],
      stopIds: {
        'Park Place': '777',
        "Veteran's at Essa": '662',
        'Cuthbert Street': '829',
        'Sproule at Kraus': '627',
        'Dunlop at Ferndale': '271',
        'Downtown Hub': '1'
      },
      trips: [
        {
          id: '2-north-template',
          blockId: '2-1',
          direction: 'North',
          tripNumber: 7,
          rowId: 7,
          startTime: 635,
          endTime: 678,
          recoveryTime: 11,
          travelTime: 43,
          cycleTime: 54,
          stops: {
            'Park Place': '10:35 AM',
            "Veteran's at Essa": '10:44 AM',
            'Cuthbert Street': '10:49 AM',
            'Sproule at Kraus': '10:56 AM',
            'Dunlop at Ferndale': '11:02 AM',
            'Downtown Hub': '11:18 AM'
          },
          arrivalTimes: {
            'Park Place': '10:35 AM',
            "Veteran's at Essa": '10:44 AM',
            'Cuthbert Street': '10:47 AM',
            'Sproule at Kraus': '10:56 AM',
            'Dunlop at Ferndale': '11:02 AM',
            'Downtown Hub': '11:09 AM'
          }
        }
      ]
    }
  ] as any,
  routeBaseName: '2 (Sunday)'
});

const buildPairedBlockRecoveryMirrorContext = (): AddTripModalContext => ({
  referenceTrip: {
    id: '7-north-template',
    blockId: '7-2',
    direction: 'North',
    tripNumber: 1,
    rowId: 1,
    startTime: 421,
    endTime: 451,
    recoveryTime: 2,
    recoveryTimes: { 'Rose Street': 2 },
    travelTime: 30,
    cycleTime: 32,
    stops: {
      'Park Place': '7:01 AM',
      'Downtown Hub': '7:15 AM',
      'Rose Street': '7:31 AM'
    },
    arrivalTimes: {
      'Park Place': '7:01 AM',
      'Downtown Hub': '7:15 AM',
      'Rose Street': '7:31 AM'
    },
    stopMinutes: {
      'Park Place': 421,
      'Downtown Hub': 435,
      'Rose Street': 451
    }
  },
  nextTrip: {
    id: '7-north-block',
    blockId: '7-1',
    direction: 'North',
    tripNumber: 2,
    rowId: 2,
    startTime: 512,
    endTime: 542,
    recoveryTime: 9,
    recoveryTimes: { 'Rose Street': 9 },
    travelTime: 30,
    cycleTime: 39,
    stops: {
      'Park Place': '8:32 AM',
      'Downtown Hub': '8:46 AM',
      'Rose Street': '9:02 AM'
    },
    arrivalTimes: {
      'Park Place': '8:32 AM',
      'Downtown Hub': '8:46 AM',
      'Rose Street': '9:02 AM'
    },
    stopMinutes: {
      'Park Place': 512,
      'Downtown Hub': 526,
      'Rose Street': 542
    }
  },
  targetTable: {
    routeName: '7 (Sunday) (North)',
    stops: ['Park Place', 'Downtown Hub', 'Rose Street'],
    stopIds: { 'Park Place': '777', 'Downtown Hub': '2', 'Rose Street': '251' },
    trips: [
      {
        id: '7-north-template',
        blockId: '7-2',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 421,
        endTime: 451,
        recoveryTime: 2,
        recoveryTimes: { 'Rose Street': 2 },
        travelTime: 30,
        cycleTime: 32,
        stops: {
          'Park Place': '7:01 AM',
          'Downtown Hub': '7:15 AM',
          'Rose Street': '7:31 AM'
        },
        arrivalTimes: {
          'Park Place': '7:01 AM',
          'Downtown Hub': '7:15 AM',
          'Rose Street': '7:31 AM'
        },
        stopMinutes: {
          'Park Place': 421,
          'Downtown Hub': 435,
          'Rose Street': 451
        }
      },
      {
        id: '7-north-block',
        blockId: '7-1',
        direction: 'North',
        tripNumber: 2,
        rowId: 2,
        startTime: 512,
        endTime: 542,
        recoveryTime: 9,
        recoveryTimes: { 'Rose Street': 9 },
        travelTime: 30,
        cycleTime: 39,
        stops: {
          'Park Place': '8:32 AM',
          'Downtown Hub': '8:46 AM',
          'Rose Street': '9:02 AM'
        },
        arrivalTimes: {
          'Park Place': '8:32 AM',
          'Downtown Hub': '8:46 AM',
          'Rose Street': '9:02 AM'
        },
        stopMinutes: {
          'Park Place': 512,
          'Downtown Hub': 526,
          'Rose Street': 542
        }
      }
    ]
  },
  allSchedules: [
    {
      routeName: '7 (Sunday) (North)',
      stops: ['Park Place', 'Downtown Hub', 'Rose Street'],
      stopIds: { 'Park Place': '777', 'Downtown Hub': '2', 'Rose Street': '251' },
      trips: [
        {
          id: '7-north-template',
          blockId: '7-2',
          direction: 'North',
          tripNumber: 1,
          rowId: 1,
          startTime: 421,
          endTime: 451,
          recoveryTime: 2,
          recoveryTimes: { 'Rose Street': 2 },
          travelTime: 30,
          cycleTime: 32,
          stops: {
            'Park Place': '7:01 AM',
            'Downtown Hub': '7:15 AM',
            'Rose Street': '7:31 AM'
          },
          arrivalTimes: {
            'Park Place': '7:01 AM',
            'Downtown Hub': '7:15 AM',
            'Rose Street': '7:31 AM'
          },
          stopMinutes: {
            'Park Place': 421,
            'Downtown Hub': 435,
            'Rose Street': 451
          }
        },
        {
          id: '7-north-block',
          blockId: '7-1',
          direction: 'North',
          tripNumber: 2,
          rowId: 2,
          startTime: 512,
          endTime: 542,
          recoveryTime: 9,
          recoveryTimes: { 'Rose Street': 9 },
          travelTime: 30,
          cycleTime: 39,
          stops: {
            'Park Place': '8:32 AM',
            'Downtown Hub': '8:46 AM',
            'Rose Street': '9:02 AM'
          },
          arrivalTimes: {
            'Park Place': '8:32 AM',
            'Downtown Hub': '8:46 AM',
            'Rose Street': '9:02 AM'
          },
          stopMinutes: {
            'Park Place': 512,
            'Downtown Hub': 526,
            'Rose Street': 542
          }
        }
      ]
    },
    {
      routeName: '7 (Sunday) (South)',
      stops: ['Rose Street', 'Downtown Hub', 'Park Place'],
      stopIds: { 'Rose Street': '251', 'Downtown Hub': '2', 'Park Place': '777' },
      trips: [
        {
          id: '7-south-block',
          blockId: '7-1',
          direction: 'South',
          tripNumber: 3,
          rowId: 3,
          startTime: 554,
          endTime: 584,
          recoveryTime: 4,
          recoveryTimes: { 'Park Place': 4 },
          travelTime: 30,
          cycleTime: 34,
          stops: {
            'Rose Street': '9:14 AM',
            'Downtown Hub': '9:28 AM',
            'Park Place': '9:44 AM'
          },
          arrivalTimes: {
            'Rose Street': '9:14 AM',
            'Downtown Hub': '9:28 AM',
            'Park Place': '9:44 AM'
          },
          stopMinutes: {
            'Rose Street': 554,
            'Downtown Hub': 568,
            'Park Place': 584
          }
        }
      ]
    }
  ] as any,
  routeBaseName: '7 (Sunday)'
});

const buildCustomRecoveryContext = (): AddTripModalContext => ({
  referenceTrip: {
    id: '9-north-1',
    blockId: '9-1',
    direction: 'North',
    tripNumber: 1,
    rowId: 1,
    startTime: 480,
    endTime: 510,
    recoveryTime: 6,
    travelTime: 30,
    cycleTime: 36,
    stops: {
      'South Terminal': '8:00 AM',
      Downtown: '8:12 AM',
      'North Terminal': '8:30 AM'
    },
    arrivalTimes: {
      'South Terminal': '8:00 AM',
      Downtown: '8:12 AM',
      'North Terminal': '8:30 AM'
    },
    stopMinutes: {
      'South Terminal': 480,
      Downtown: 492,
      'North Terminal': 510
    }
  },
  nextTrip: null,
  targetTable: {
    routeName: '9 (Weekday) (North)',
    stops: ['South Terminal', 'Downtown', 'North Terminal'],
    stopIds: { 'South Terminal': 'S', Downtown: 'D', 'North Terminal': 'N' },
    trips: [
      {
        id: '9-north-1',
        blockId: '9-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 480,
        endTime: 510,
        recoveryTime: 6,
        travelTime: 30,
        cycleTime: 36,
        stops: {
          'South Terminal': '8:00 AM',
          Downtown: '8:12 AM',
          'North Terminal': '8:30 AM'
        },
        arrivalTimes: {
          'South Terminal': '8:00 AM',
          Downtown: '8:12 AM',
          'North Terminal': '8:30 AM'
        },
        stopMinutes: {
          'South Terminal': 480,
          Downtown: 492,
          'North Terminal': 510
        }
      }
    ]
  },
  allSchedules: [
    {
      routeName: '9 (Weekday) (North)',
      stops: ['South Terminal', 'Downtown', 'North Terminal'],
      stopIds: { 'South Terminal': 'S', Downtown: 'D', 'North Terminal': 'N' },
      trips: [
        {
          id: '9-north-1',
          blockId: '9-1',
          direction: 'North',
          tripNumber: 1,
          rowId: 1,
          startTime: 480,
          endTime: 510,
          recoveryTime: 6,
          travelTime: 30,
          cycleTime: 36,
          stops: {
            'South Terminal': '8:00 AM',
            Downtown: '8:12 AM',
            'North Terminal': '8:30 AM'
          },
          arrivalTimes: {
            'South Terminal': '8:00 AM',
            Downtown: '8:12 AM',
            'North Terminal': '8:30 AM'
          },
          stopMinutes: {
            'South Terminal': 480,
            Downtown: 492,
            'North Terminal': 510
          }
        }
      ]
    },
    {
      routeName: '9 (Weekday) (South)',
      stops: ['North Terminal', 'Downtown', 'South Terminal'],
      stopIds: { 'North Terminal': 'N', Downtown: 'D', 'South Terminal': 'S' },
      trips: [
        {
          id: '9-south-1',
          blockId: '9-1',
          direction: 'South',
          tripNumber: 2,
          rowId: 2,
          startTime: 516,
          endTime: 546,
          recoveryTime: 6,
          travelTime: 30,
          cycleTime: 36,
          stops: {
            'North Terminal': '8:36 AM',
            Downtown: '8:48 AM',
            'South Terminal': '9:06 AM'
          },
          arrivalTimes: {
            'North Terminal': '8:36 AM',
            Downtown: '8:48 AM',
            'South Terminal': '9:06 AM'
          },
          stopMinutes: {
            'North Terminal': 516,
            Downtown: 528,
            'South Terminal': 546
          }
        }
      ]
    }
  ] as any,
  routeBaseName: '9 (Weekday)'
});

const buildCustomZeroTerminalRecoveryContext = (): AddTripModalContext => ({
  referenceTrip: {
    id: '7-north-template',
    blockId: '7-2',
    direction: 'North',
    tripNumber: 1,
    rowId: 1,
    startTime: 452,
    endTime: 511,
    recoveryTime: 5,
    travelTime: 54,
    cycleTime: 59,
    recoveryTimes: {
      'Allandale Terminal': 4,
      'Downtown Hub': 1,
      'Rose Street': 0
    },
    stops: {
      'Park Place': '7:32 AM',
      'Allandale Terminal': '8:10 AM',
      'Downtown Hub': '8:16 AM',
      'Georgian College': '8:29 AM',
      'Rose Street': '8:31 AM'
    },
    arrivalTimes: {
      'Park Place': '7:32 AM',
      'Allandale Terminal': '8:06 AM',
      'Downtown Hub': '8:15 AM',
      'Georgian College': '8:29 AM',
      'Rose Street': '8:31 AM'
    }
  },
  nextTrip: null,
  targetTable: {
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
        id: '7-north-template',
        blockId: '7-2',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 452,
        endTime: 511,
        recoveryTime: 5,
        travelTime: 54,
        cycleTime: 59,
        recoveryTimes: {
          'Allandale Terminal': 4,
          'Downtown Hub': 1,
          'Rose Street': 0
        },
        stops: {
          'Park Place': '7:32 AM',
          'Allandale Terminal': '8:10 AM',
          'Downtown Hub': '8:16 AM',
          'Georgian College': '8:29 AM',
          'Rose Street': '8:31 AM'
        },
        arrivalTimes: {
          'Park Place': '7:32 AM',
          'Allandale Terminal': '8:06 AM',
          'Downtown Hub': '8:15 AM',
          'Georgian College': '8:29 AM',
          'Rose Street': '8:31 AM'
        }
      }
    ]
  },
  allSchedules: [
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
          id: '7-north-template',
          blockId: '7-2',
          direction: 'North',
          tripNumber: 1,
          rowId: 1,
          startTime: 452,
          endTime: 511,
          recoveryTime: 5,
          travelTime: 54,
          cycleTime: 59,
          recoveryTimes: {
            'Allandale Terminal': 4,
            'Downtown Hub': 1,
            'Rose Street': 0
          },
          stops: {
            'Park Place': '7:32 AM',
            'Allandale Terminal': '8:10 AM',
            'Downtown Hub': '8:16 AM',
            'Georgian College': '8:29 AM',
            'Rose Street': '8:31 AM'
          },
          arrivalTimes: {
            'Park Place': '7:32 AM',
            'Allandale Terminal': '8:06 AM',
            'Downtown Hub': '8:15 AM',
            'Georgian College': '8:29 AM',
            'Rose Street': '8:31 AM'
          }
        }
      ]
    },
    {
      routeName: '7 (Sunday) (South)',
      stops: ['Rose Street', 'Downtown Hub', 'Allandale Terminal', 'Park Place'],
      stopIds: {
        'Rose Street': '251',
        'Downtown Hub': '1',
        'Allandale Terminal': '9006',
        'Park Place': '777'
      },
      trips: [
        {
          id: '7-south-template',
          blockId: '7-2',
          direction: 'South',
          tripNumber: 2,
          rowId: 2,
          startTime: 516,
          endTime: 577,
          recoveryTime: 5,
          travelTime: 61,
          cycleTime: 66,
          recoveryTimes: {
            'Downtown Hub': 2,
            'Allandale Terminal': 4,
            'Park Place': 5
          },
          stops: {
            'Rose Street': '8:36 AM',
            'Downtown Hub': '8:48 AM',
            'Allandale Terminal': '8:58 AM',
            'Park Place': '9:37 AM'
          },
          arrivalTimes: {
            'Rose Street': '8:36 AM',
            'Downtown Hub': '8:46 AM',
            'Allandale Terminal': '8:54 AM',
            'Park Place': '9:32 AM'
          }
        }
      ]
    }
  ] as any,
  routeBaseName: '7 (Sunday)'
});

describe('addTripPlanner', () => {
  it('defaults Add Trip Before to the selected trip minus its forward headway', () => {
    const context = buildAddTripModalContext(
      buildContext().allSchedules,
      'north-1',
      'before'
    );

    expect(context?.anchorTripId).toBe('north-1');
    expect(context?.referenceTrip.id).toBe('north-1');
    expect(context?.nextTrip?.id).toBe('north-2');
    expect(context?.initialStartTime).toBe(300);
  });

  it('builds edit-trip context with the current trip span preloaded', () => {
    const context = buildEditTripModalContext(
      buildContext().allSchedules,
      'north-1'
    );

    expect(context?.actionMode).toBe('edit');
    expect(context?.initialStartTime).toBe(360);
    expect(context?.initialStopSelection).toEqual({
      startStopName: 'Park Place',
      endStopName: 'Downtown'
    });
  });

  it('previews editing the current trip in place instead of adding a new trip', () => {
    const context = buildEditTripModalContext(
      buildContext().allSchedules,
      'north-1'
    );

    const suggestions = buildEditTripSuggestions(context!, 350, {
      startStopName: 'Park Place',
      endStopName: 'Downtown'
    });

    expect(suggestions.actualTripCount).toBe(1);
    expect(suggestions.previewItems).toHaveLength(1);
    expect(suggestions.previewItems[0]?.startTime).toBe(350);
    expect(suggestions.previewItems[0]?.startStopName).toBe('Park Place');
    expect(suggestions.previewItems[0]?.endStopName).toBe('Downtown');
    expect(suggestions.blockConflicts).toHaveLength(0);
  });

  it('applies edit-trip changes to the existing trip id', () => {
    const context = buildEditTripModalContext(
      buildContext().allSchedules,
      'north-1'
    );

    const applied = applyEditTripResultToSchedules(context!.allSchedules, context!, {
      startTime: 350,
      tripCount: 1,
      serviceMode: 'trip',
      absorbShortTrailingGapIntoRecovery: false,
      blockMode: 'reference',
      blockId: '2-WD-1',
      targetDirection: 'North',
      targetRouteName: '2 (Weekday) (North)',
      startStopName: 'Park Place',
      endStopName: 'Downtown'
    });

    const northTable = applied.schedules.find(table => table.routeName === '2 (Weekday) (North)');
    const updatedTrip = northTable?.trips.find(trip => trip.id === 'north-1');

    expect(applied.updatedTripId).toBe('north-1');
    expect(applied.blockConflicts).toHaveLength(0);
    expect(northTable?.trips).toHaveLength(2);
    expect(updatedTrip?.startTime).toBe(350);
    expect(updatedTrip?.stops['Park Place']).toBe('5:50 AM');
    expect(updatedTrip?.stops.Downtown).toBe('6:20 AM');
  });

  it('uses fixed quick-offset presets from the selected row start time', () => {
    const context = buildContext();
    const presets = buildAddTripPresets(context, 'North', 390);

    expect(presets.slice(0, 4).map(preset => preset.label)).toEqual([
      '+30 min (6:30 AM)',
      '-30 min (5:30 AM)',
      '+60 min (7:00 AM)',
      '-60 min (5:00 AM)'
    ]);
  });

  it('builds alternating preview items against the correct direction tables', () => {
    const suggestions = buildAddTripSuggestions(
      buildContext(),
      'North',
      390,
      3,
      'trip',
      false,
      'new',
      '',
      {
        startStopName: 'Park Place',
        endStopName: 'Downtown'
      }
    );

    expect(suggestions.previewItems.map(item => item.direction)).toEqual(['North', 'South', 'North']);
    expect(suggestions.previewItems.map(item => item.routeName)).toEqual([
      '2 (Weekday) (North)',
      '2 (Weekday) (South)',
      '2 (Weekday) (North)'
    ]);
  });

  it('keeps unsuffixed block naming when the current schedule already uses route-number blocks', () => {
    const context = {
      referenceTrip: {
        id: 'north-3',
        blockId: '2-3',
        direction: 'North',
        tripNumber: 3,
        rowId: 3,
        startTime: 390,
        endTime: 420,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: { 'Park Place': '6:30 AM', Downtown: '7:00 AM' },
        arrivalTimes: { 'Park Place': '6:30 AM', Downtown: '7:00 AM' }
      },
      nextTrip: null,
      targetTable: {
        routeName: '2 (Weekday) (North)',
        stops: ['Park Place', 'Downtown'],
        stopIds: { 'Park Place': '777', Downtown: '1' },
        trips: [
          {
            id: 'north-1',
            blockId: '2-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 1,
            startTime: 330,
            endTime: 360,
            recoveryTime: 0,
            travelTime: 30,
            cycleTime: 30,
            stops: { 'Park Place': '5:30 AM', Downtown: '6:00 AM' },
            arrivalTimes: { 'Park Place': '5:30 AM', Downtown: '6:00 AM' }
          },
          {
            id: 'north-2',
            blockId: '2-2',
            direction: 'North',
            tripNumber: 2,
            rowId: 2,
            startTime: 360,
            endTime: 390,
            recoveryTime: 0,
            travelTime: 30,
            cycleTime: 30,
            stops: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' },
            arrivalTimes: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' }
          },
          {
            id: 'north-3',
            blockId: '2-3',
            direction: 'North',
            tripNumber: 3,
            rowId: 3,
            startTime: 390,
            endTime: 420,
            recoveryTime: 0,
            travelTime: 30,
            cycleTime: 30,
            stops: { 'Park Place': '6:30 AM', Downtown: '7:00 AM' },
            arrivalTimes: { 'Park Place': '6:30 AM', Downtown: '7:00 AM' }
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
              blockId: '2-1',
              direction: 'North',
              tripNumber: 1,
              rowId: 1,
              startTime: 330,
              endTime: 360,
              recoveryTime: 0,
              travelTime: 30,
              cycleTime: 30,
              stops: { 'Park Place': '5:30 AM', Downtown: '6:00 AM' },
              arrivalTimes: { 'Park Place': '5:30 AM', Downtown: '6:00 AM' }
            },
            {
              id: 'north-2',
              blockId: '2-2',
              direction: 'North',
              tripNumber: 2,
              rowId: 2,
              startTime: 360,
              endTime: 390,
              recoveryTime: 0,
              travelTime: 30,
              cycleTime: 30,
              stops: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' },
              arrivalTimes: { 'Park Place': '6:00 AM', Downtown: '6:30 AM' }
            },
            {
              id: 'north-3',
              blockId: '2-3',
              direction: 'North',
              tripNumber: 3,
              rowId: 3,
              startTime: 390,
              endTime: 420,
              recoveryTime: 0,
              travelTime: 30,
              cycleTime: 30,
              stops: { 'Park Place': '6:30 AM', Downtown: '7:00 AM' },
              arrivalTimes: { 'Park Place': '6:30 AM', Downtown: '7:00 AM' }
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
              blockId: '2-1',
              direction: 'South',
              tripNumber: 1,
              rowId: 4,
              startTime: 365,
              endTime: 395,
              recoveryTime: 0,
              travelTime: 30,
              cycleTime: 30,
              stops: { Downtown: '6:05 AM', 'Park Place': '6:35 AM' },
              arrivalTimes: { Downtown: '6:05 AM', 'Park Place': '6:35 AM' }
            },
            {
              id: 'south-2',
              blockId: '2-2',
              direction: 'South',
              tripNumber: 2,
              rowId: 5,
              startTime: 395,
              endTime: 425,
              recoveryTime: 0,
              travelTime: 30,
              cycleTime: 30,
              stops: { Downtown: '6:35 AM', 'Park Place': '7:05 AM' },
              arrivalTimes: { Downtown: '6:35 AM', 'Park Place': '7:05 AM' }
            },
            {
              id: 'south-3',
              blockId: '2-3',
              direction: 'South',
              tripNumber: 3,
              rowId: 6,
              startTime: 425,
              endTime: 455,
              recoveryTime: 0,
              travelTime: 30,
              cycleTime: 30,
              stops: { Downtown: '7:05 AM', 'Park Place': '7:35 AM' },
              arrivalTimes: { Downtown: '7:05 AM', 'Park Place': '7:35 AM' }
            }
          ]
        }
      ] as any,
      routeBaseName: '2 (Weekday)'
    } as AddTripModalContext;

    const suggestions = buildAddTripSuggestions(
      context,
      'North',
      410,
      1,
      'cycle',
      false,
      'new',
      '',
      {
        startStopName: 'Park Place',
        endStopName: 'Downtown'
      }
    );

    expect(suggestions.newBlockId).toBe('2-4');
  });

  it('forces full-cycle previews to start northbound and expand to the full route even from a collapsed selection', () => {
    const suggestions = buildAddTripSuggestions(
      build400Context(),
      'South',
      380,
      1,
      'cycle',
      false,
      'reference',
      '400-WD-1',
      {
        startStopName: 'RVH Main Entrance',
        endStopName: 'RVH Main Entrance'
      }
    );

    expect(suggestions.actualTripCount).toBe(2);
    expect(suggestions.selectedStartStopName).toBe('Park Place');
    expect(suggestions.selectedEndStopName).toBe('RVH Main Entrance');
    expect(suggestions.previewItems.map(item => `${item.direction}:${item.startStopName}->${item.endStopName}`)).toEqual([
      'North:Park Place->RVH Main Entrance',
      'South:RVH Main Entrance->Park Place'
    ]);
  });

  it('builds custom paired-trip previews from a selected outbound start to a selected return end', () => {
    const suggestions = buildAddTripSuggestions(
      buildAliasCycleContext(),
      'North',
      514,
      1,
      'custom',
      false,
      'new',
      '',
      {
        startStopName: 'ARRIVE DOWNTOWN HUB',
        endStopName: 'Downtown Hub'
      }
    );

    expect(suggestions.actualTripCount).toBe(2);
    expect(suggestions.selectedStartStopName).toBe('ARRIVE DOWNTOWN HUB');
    expect(suggestions.selectedEndStopName).toBe('Downtown Hub');
    expect(suggestions.previewItems.map(item => `${item.direction}:${item.startStopName}->${item.endStopName}`)).toEqual([
      'North:ARRIVE DOWNTOWN HUB->Rose Street',
      'South:DEPART ROSE STREET->Downtown Hub'
    ]);
  });

  it('mirrors recovery from the closest trip already on the selected block when previewing an added trip', () => {
    const suggestions = buildAddTripSuggestions(
      buildBlockRecoveryMirrorContext(),
      'North',
      451, // 7:31 AM
      1,
      'trip',
      false,
      'existing',
      '7-1',
      {
        startStopName: 'Park Place',
        endStopName: 'Rose Street'
      }
    );

    expect(suggestions.previewItems[0]?.recoveryTime).toBe(9);
    expect(suggestions.previewItems[0]?.cycleTime).toBe(39);
    expect(suggestions.impact.templateRecoveryTimeMinutes).toBe(9);
  });

  it('maps custom trip timepoints from either direction onto the active outbound and return legs', () => {
    const suggestions = buildAddTripSuggestions(
      buildAliasCycleContext(),
      'South',
      514,
      1,
      'custom',
      false,
      'new',
      '',
      {
        startStopName: 'ARRIVE DOWNTOWN HUB',
        endStopName: 'ARRIVE DOWNTOWN HUB'
      }
    );

    expect(suggestions.selectedStartStopName).toBe('ARRIVE DOWNTOWN HUB');
    expect(suggestions.selectedEndStopName).toBe('ARRIVE DOWNTOWN HUB');
    expect(suggestions.previewItems.map(item => `${item.direction}:${item.startStopName}->${item.endStopName}`)).toEqual([
      'South:Downtown Hub->Park Place',
      'North:Park Place->ARRIVE DOWNTOWN HUB'
    ]);
  });

  it('creates a short-turn trip with the selected block and stop range', () => {
    const context = buildContext();
    const result: AddTripResult = {
      startTime: 500,
      tripCount: 1,
      blockMode: 'existing',
      blockId: '2-WD-2',
      targetDirection: 'South',
      targetRouteName: '2 (Weekday) (South)',
      startStopName: 'Downtown',
      endStopName: 'Downtown'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const southTable = applied.schedules.find(table => table.routeName === '2 (Weekday) (South)');
    const newTrip = southTable?.trips.find(trip => applied.createdTripIds.includes(trip.id));

    expect(applied.createdTripIds).toHaveLength(1);
    expect(newTrip?.blockId).toBe('2-WD-2');
    expect(newTrip?.direction).toBe('South');
    expect(newTrip?.lineageId).toBeTruthy();
    expect(newTrip?.deltaSourceTripId).toBeUndefined();
    expect(newTrip?.deltaSourceLineageId).toBeUndefined();
    expect(newTrip?.deltaSourceRouteName).toBeUndefined();
    expect(Object.keys(newTrip?.stops ?? {})).toEqual(['Downtown']);
    expect(newTrip?.endStopIndex).toBe(0);
    expect(newTrip?.recoveryTime).toBe(0);
  });

  it('creates unique durable ids for multiple added trips without reusing template ids', () => {
    const context = buildContext();
    const result: AddTripResult = {
      startTime: 500,
      tripCount: 3,
      serviceMode: 'trip',
      blockMode: 'new',
      blockId: '2-WD-99',
      targetDirection: 'North',
      targetRouteName: '2 (Weekday) (North)',
      startStopName: 'Park Place',
      endStopName: 'Downtown'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const createdTrips = applied.schedules
      .flatMap(table => table.trips)
      .filter(trip => applied.createdTripIds.includes(trip.id));

    expect(createdTrips).toHaveLength(3);
    expect(new Set(createdTrips.map(trip => trip.id)).size).toBe(3);
    expect(new Set(createdTrips.map(trip => trip.lineageId)).size).toBe(3);
    expect(createdTrips.every(trip => trip.id.startsWith('trip_'))).toBe(true);
    expect(createdTrips.some(trip => trip.id === context.referenceTrip.id)).toBe(false);
  });

  it('applies a full cycle as paired northbound and southbound trips on the same block', () => {
    const context = build400Context();
    const result: AddTripResult = {
      startTime: 380,
      tripCount: 1,
      serviceMode: 'cycle',
      blockMode: 'reference',
      blockId: '400-WD-1',
      targetDirection: 'North',
      targetRouteName: '400 (Weekday) (North)',
      startStopName: 'Park Place',
      endStopName: 'RVH Main Entrance'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const createdTrips = applied.schedules
      .flatMap(table => table.trips)
      .filter(trip => applied.createdTripIds.includes(trip.id))
      .sort((a, b) => a.startTime - b.startTime);

    expect(applied.createdTripIds).toHaveLength(2);
    expect(createdTrips.map(trip => `${trip.direction}:${Object.keys(trip.stops).join('->')}`)).toEqual([
      'North:Park Place->RVH Main Entrance',
      'South:RVH Main Entrance->Park Place'
    ]);
    expect(new Set(createdTrips.map(trip => trip.blockId))).toEqual(new Set(['400-WD-1']));
  });

  it('mirrors recovery separately for the south leg of a paired trip from the closest same-direction block trip', () => {
    const context = buildPairedBlockRecoveryMirrorContext();
    const result: AddTripResult = {
      startTime: 451, // 7:31 AM
      tripCount: 1,
      serviceMode: 'cycle',
      blockMode: 'existing',
      blockId: '7-1',
      targetDirection: 'North',
      targetRouteName: '7 (Sunday) (North)',
      startStopName: 'Park Place',
      endStopName: 'Rose Street'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const createdTrips = applied.schedules
      .flatMap(table => table.trips)
      .filter(trip => applied.createdTripIds.includes(trip.id))
      .sort((a, b) => a.startTime - b.startTime);

    expect(createdTrips).toHaveLength(2);
    expect(createdTrips[0]).toMatchObject({
      direction: 'North',
      recoveryTime: 9
    });
    expect(createdTrips[1]).toMatchObject({
      direction: 'South',
      recoveryTime: 4
    });
    expect(createdTrips[1]?.recoveryTimes?.['Park Place']).toBe(4);
  });

  it('copies the closest same-block recovery pattern onto a newly added trip', () => {
    const context = buildBlockRecoveryMirrorContext();
    const result: AddTripResult = {
      startTime: 451, // 7:31 AM
      tripCount: 1,
      serviceMode: 'trip',
      blockMode: 'existing',
      blockId: '7-1',
      targetDirection: 'North',
      targetRouteName: '7 (Sunday) (North)',
      startStopName: 'Park Place',
      endStopName: 'Rose Street'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const northTable = applied.schedules.find(table => table.routeName === '7 (Sunday) (North)');
    const createdTrip = northTable?.trips.find(trip => applied.createdTripIds.includes(trip.id));

    expect(createdTrip?.recoveryTime).toBe(9);
    expect(createdTrip?.cycleTime).toBe(39);
    expect(createdTrip?.recoveryTimes?.['Rose Street']).toBe(9);
  });

  it('derives intermediate recovery from arrival/departure timing when the template lacks explicit recoveryTimes', () => {
    const context = buildDerivedMidpointRecoveryContext();
    const result: AddTripResult = {
      startTime: 485, // 8:05 AM
      tripCount: 1,
      serviceMode: 'trip',
      blockMode: 'existing',
      blockId: '2-1',
      targetDirection: 'North',
      targetRouteName: '2 (Sunday) (North)',
      startStopName: 'Park Place',
      endStopName: 'Downtown Hub'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const northTable = applied.schedules.find(table => table.routeName === '2 (Sunday) (North)');
    const createdTrip = northTable?.trips.find(trip => applied.createdTripIds.includes(trip.id));

    expect(createdTrip?.arrivalTimes?.['Cuthbert Street']).toBe('8:17 AM');
    expect(createdTrip?.recoveryTimes?.['Cuthbert Street']).toBe(2);
    expect(createdTrip?.stops?.['Cuthbert Street']).toBe('8:19 AM');
    expect(createdTrip?.stops?.['Sproule at Kraus']).toBe('8:26 AM');
    expect(createdTrip?.recoveryTimes?.['Downtown Hub']).toBe(9);
  });

  it('keeps added Route 2 south trips honest when block recovery comes from a poor same-block template', () => {
    const southTemplate = {
      id: '2-south-template',
      blockId: '2-2',
      direction: 'South' as const,
      tripNumber: 1,
      rowId: 1,
      startTime: 588, // 9:48 AM
      endTime: 624,
      recoveryTime: 13,
      travelTime: 36,
      cycleTime: 49,
      stops: {
        'Downtown Hub': '9:48 AM',
        'Ferndale Drive': '9:56 AM',
        'Sproule at Kraus': '10:01 AM',
        'Ferndale Woods Public School': '10:10 AM',
        "Veteran's at Essa": '10:14 AM',
        'Park Place': '10:24 AM'
      },
      arrivalTimes: {
        'Downtown Hub': '9:48 AM',
        'Ferndale Drive': '9:56 AM',
        'Sproule at Kraus': '10:01 AM',
        'Ferndale Woods Public School': '10:08 AM',
        "Veteran's at Essa": '10:14 AM',
        'Park Place': '10:24 AM'
      },
      recoveryTimes: {
        'Ferndale Woods Public School': 2,
        'Park Place': 11
      }
    };
    const context: AddTripModalContext = {
      referenceTrip: southTemplate,
      nextTrip: null,
      targetTable: {
        routeName: '2 (Sunday) (South)',
        stops: ['Downtown Hub', 'Ferndale Drive', 'Sproule at Kraus', 'Ferndale Woods Public School', "Veteran's at Essa", 'Park Place'],
        stopIds: {},
        trips: [southTemplate]
      },
      allSchedules: [
        {
          routeName: '2 (Sunday) (North)',
          stops: ['Park Place', 'Downtown Hub'],
          stopIds: {},
          trips: [{
            id: 'poor-same-block-template',
            blockId: '2-1',
            direction: 'North',
            tripNumber: 1,
            rowId: 2,
            startTime: 416,
            endTime: 429,
            recoveryTime: 9,
            travelTime: 13,
            cycleTime: 22,
            stops: { 'Park Place': '6:56 AM', 'Downtown Hub': '7:09 AM' },
            arrivalTimes: { 'Park Place': '6:56 AM', 'Downtown Hub': '7:09 AM' },
            recoveryTimes: { 'Downtown Hub': 9 }
          }]
        },
        {
          routeName: '2 (Sunday) (South)',
          stops: ['Downtown Hub', 'Ferndale Drive', 'Sproule at Kraus', 'Ferndale Woods Public School', "Veteran's at Essa", 'Park Place'],
          stopIds: {},
          trips: [southTemplate]
        }
      ],
      routeBaseName: '2 (Sunday)'
    };
    const result: AddTripResult = {
      startTime: 438, // 7:18 AM
      tripCount: 1,
      serviceMode: 'trip',
      blockMode: 'existing',
      blockId: '2-1',
      targetDirection: 'South',
      targetRouteName: '2 (Sunday) (South)',
      startStopName: 'Downtown Hub',
      endStopName: 'Park Place'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const southTable = applied.schedules.find(table => table.routeName === '2 (Sunday) (South)');
    const createdTrip = southTable?.trips.find(trip => applied.createdTripIds.includes(trip.id));

    expect(createdTrip?.arrivalTimes?.['Ferndale Woods Public School']).toBe('7:38 AM');
    expect(createdTrip?.recoveryTimes?.['Ferndale Woods Public School']).toBe(2);
    expect(createdTrip?.stops?.['Ferndale Woods Public School']).toBe('7:40 AM');
    expect(createdTrip?.stops?.["Veteran's at Essa"]).toBe('7:44 AM');
  });

  it('applies a custom paired trip with terminal recovery carried between the two directions', () => {
    const context = buildCustomRecoveryContext();
    const result: AddTripResult = {
      startTime: 504,
      tripCount: 1,
      serviceMode: 'custom',
      blockMode: 'reference',
      blockId: '9-1',
      targetDirection: 'North',
      targetRouteName: '9 (Weekday) (North)',
      startStopName: 'Downtown',
      endStopName: 'Downtown'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const createdTrips = applied.schedules
      .flatMap(table => table.trips)
      .filter(trip => applied.createdTripIds.includes(trip.id))
      .sort((a, b) => a.startTime - b.startTime);

    expect(applied.createdTripIds).toHaveLength(2);
    expect(createdTrips[0]).toMatchObject({
      direction: 'North',
      startTime: 504,
      recoveryTime: 6
    });
    expect(Object.keys(createdTrips[0]?.stops ?? {})).toEqual(['Downtown', 'North Terminal']);
    expect(createdTrips[1]).toMatchObject({
      direction: 'South',
      startTime: createdTrips[0]!.endTime + 6,
      recoveryTime: 0
    });
    expect(Object.keys(createdTrips[1]?.stops ?? {})).toEqual(['North Terminal', 'Downtown']);
  });

  it('keeps generated terminal recovery explicit and timing monotonic', () => {
    const context = buildCustomRecoveryContext();
    const result: AddTripResult = {
      startTime: 504,
      tripCount: 1,
      serviceMode: 'custom',
      blockMode: 'reference',
      blockId: '9-1',
      targetDirection: 'North',
      targetRouteName: '9 (Weekday) (North)',
      startStopName: 'Downtown',
      endStopName: 'Downtown'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const firstCreatedTrip = applied.schedules
      .flatMap(table => table.trips)
      .filter(trip => applied.createdTripIds.includes(trip.id))
      .sort((a, b) => a.startTime - b.startTime)[0];

    expect(firstCreatedTrip?.arrivalTimes?.['North Terminal']).toBe('8:42 AM');
    expect(firstCreatedTrip?.stops?.['North Terminal']).toBe('8:48 AM');
    expect(firstCreatedTrip?.recoveryTimes?.['North Terminal']).toBe(6);
    expect(firstCreatedTrip?.endTime).toBe(504 + 18);
  });

  it('preserves explicit zero terminal recovery entries for custom paired trips', () => {
    const context = buildCustomZeroTerminalRecoveryContext();
    const result: AddTripResult = {
      startTime: 452,
      tripCount: 1,
      serviceMode: 'custom',
      blockMode: 'existing',
      blockId: '7-2',
      targetDirection: 'North',
      targetRouteName: '7 (Sunday) (North)',
      startStopName: 'Park Place',
      endStopName: 'Park Place'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const createdTrips = applied.schedules
      .flatMap(table => table.trips)
      .filter(trip => applied.createdTripIds.includes(trip.id))
      .sort((a, b) => a.startTime - b.startTime);

    expect(createdTrips).toHaveLength(2);
    expect(createdTrips[0]).toMatchObject({
      direction: 'North',
      recoveryTime: 5
    });
    expect(createdTrips[0]?.recoveryTimes).toEqual({
      'Allandale Terminal': 4,
      'Downtown Hub': 1,
      'Rose Street': 0
    });
    expect(createdTrips[1]).toMatchObject({
      direction: 'South',
      startTime: createdTrips[0]!.endTime
    });
  });

  it('flags blocking same-block conflicts for duplicate full cycles on an existing block', () => {
    const suggestions = buildAddTripSuggestions(
      build400Context(),
      'North',
      380,
      1,
      'cycle',
      false,
      'reference',
      '400-WD-1',
      {
        startStopName: 'Park Place',
        endStopName: 'RVH Main Entrance'
      }
    );

    expect(suggestions.impact.hasBlockingBlockConflict).toBe(true);
    expect(suggestions.impact.blockingConflictCount).toBeGreaterThan(0);
    expect(suggestions.blockConflicts.map(conflict => `${conflict.conflictingDirection}:${conflict.conflictingStartTime}`)).toEqual([
      'North:380',
      'South:410'
    ]);
  });

  it('does not double-count terminal recovery already included in an existing trip end time', () => {
    const context = buildContext();
    const markRecoveryIncluded = (trip: any) => {
      if (trip.id !== 'north-1') return;
      trip.travelTime = 25;
      trip.cycleTime = 30;
      trip.recoveryTime = 5;
      trip.recoveryTimes = { Downtown: 5 };
      trip.endTimeIncludesRecovery = true;
      trip.arrivalTimes = { ...trip.arrivalTimes, Downtown: '6:25 AM' };
      trip.stopMinutes = { 'Park Place': 360, Downtown: 390 };
    };
    markRecoveryIncluded(context.referenceTrip);
    context.targetTable.trips.forEach(markRecoveryIncluded);
    context.allSchedules.flatMap(table => table.trips).forEach(markRecoveryIncluded);

    const suggestions = buildAddTripSuggestions(
      context,
      'North',
      392,
      1,
      'trip',
      false,
      'existing',
      '2-WD-1',
      { startStopName: 'Park Place', endStopName: 'Downtown' }
    );

    expect(suggestions.blockConflicts).toHaveLength(0);
    expect(suggestions.impact.hasBlockingBlockConflict).toBe(false);
  });

  it('surfaces a short same-block trailing gap and can absorb it into recovery', () => {
    const withoutAbsorb = buildAddTripSuggestions(
      build400GapContext(),
      'North',
      348,
      1,
      'cycle',
      false,
      'reference',
      '400-WD-2',
      {
        startStopName: 'Park Place',
        endStopName: 'RVH Main Entrance'
      }
    );

    expect(withoutAbsorb.impact.hasBlockingBlockConflict).toBe(false);
    expect(withoutAbsorb.impact.trailingBlockGapMinutes).toBe(2);
    expect(withoutAbsorb.impact.trailingBlockGapNextTripStartTime).toBe(408);
    expect(withoutAbsorb.impact.canAbsorbShortTrailingGap).toBe(true);
    expect(withoutAbsorb.impact.absorbedTrailingGapIntoRecovery).toBe(false);
    expect(withoutAbsorb.previewItems.at(-1)?.recoveryTime).toBe(7);

    const withAbsorb = buildAddTripSuggestions(
      build400GapContext(),
      'North',
      348,
      1,
      'cycle',
      true,
      'reference',
      '400-WD-2',
      {
        startStopName: 'Park Place',
        endStopName: 'RVH Main Entrance'
      }
    );

    expect(withAbsorb.impact.trailingBlockGapMinutes).toBe(2);
    expect(withAbsorb.impact.absorbedTrailingGapIntoRecovery).toBe(true);
    expect(withAbsorb.previewItems.at(-1)?.recoveryTime).toBe(9);
    expect(withAbsorb.previewItems.at(-1)?.cycleTime).toBe(31);
  });

  it('applies absorbed short trailing gap recovery to the last created trip', () => {
    const context = build400GapContext();
    const result: AddTripResult = {
      startTime: 348,
      tripCount: 1,
      serviceMode: 'cycle',
      absorbShortTrailingGapIntoRecovery: true,
      blockMode: 'reference',
      blockId: '400-WD-2',
      targetDirection: 'North',
      targetRouteName: '400 (Weekday) (North)',
      startStopName: 'Park Place',
      endStopName: 'RVH Main Entrance'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const createdTrips = applied.schedules
      .flatMap(table => table.trips)
      .filter(trip => applied.createdTripIds.includes(trip.id))
      .sort((a, b) => a.startTime - b.startTime);
    const lastCreatedTrip = createdTrips.at(-1);

    expect(applied.createdTripIds).toHaveLength(2);
    expect(lastCreatedTrip?.direction).toBe('South');
    expect(lastCreatedTrip?.recoveryTime).toBe(9);
    expect(lastCreatedTrip?.cycleTime).toBe(31);
    expect(lastCreatedTrip?.recoveryTimes?.['Park Place']).toBe(9);
  });

  it('keeps route timing when full-cycle preview uses ARRIVE/DEPART display stop variants without stopMinutes', () => {
    const context = buildAliasCycleContext();
    const result: AddTripResult = {
      startTime: 514, // 8:34 AM
      tripCount: 1,
      serviceMode: 'cycle',
      blockMode: 'reference',
      blockId: '7-2',
      targetDirection: 'North',
      targetRouteName: '7 (Sunday) (North)',
      startStopName: 'Park Place',
      endStopName: 'Rose Street'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const northTable = applied.schedules.find(table => table.routeName === '7 (Sunday) (North)');
    const createdNorthTrip = northTable?.trips.find(trip => applied.createdTripIds.includes(trip.id) && trip.direction === 'North');

    expect(createdNorthTrip?.stops['Park Place']).toBe('8:34 AM');
    expect(createdNorthTrip?.stops['ARRIVE DOWNTOWN HUB']).toBe('8:38 AM');
    expect(createdNorthTrip?.stops['Rose Street']).toBe('9:04 AM');
  });

  it('keeps repeated loop-stop recovery on the correct stop occurrence', () => {
    const context = buildLoopRouteContext();
    const result: AddTripResult = {
      startTime: 430,
      tripCount: 1,
      serviceMode: 'trip',
      blockMode: 'reference',
      blockId: '10-1',
      targetDirection: 'North',
      targetRouteName: '10 (Sunday) (North)',
      startStopName: 'Downtown Hub',
      endStopName: 'Downtown Hub (2)'
    };

    const applied = applyAddTripResultToSchedules(context.allSchedules, context, result);
    const northTable = applied.schedules.find(table => table.routeName === '10 (Sunday) (North)');
    const createdTrip = northTable?.trips.find(trip => applied.createdTripIds.includes(trip.id));

    expect(createdTrip?.startTime).toBe(430);
    expect(createdTrip?.stops?.['Downtown Hub']).toBe('7:10 AM');
    expect(createdTrip?.recoveryTimes?.['Downtown Hub']).toBeUndefined();
    expect(createdTrip?.recoveryTimes?.['Downtown Hub (2)']).toBe(5);
    expect(createdTrip?.stops?.['Downtown Hub (2)']).toBe('8:10 AM');
  });
});
