import { describe, expect, it } from 'vitest';
import {
  buildAddTripPresets,
  applyAddTripResultToSchedules,
  buildAddTripSuggestions,
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

describe('addTripPlanner', () => {
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
    expect(newTrip?.deltaSourceTripId).toBe('south-2');
    expect(newTrip?.deltaSourceRouteName).toBe('2 (Weekday) (South)');
    expect(Object.keys(newTrip?.stops ?? {})).toEqual(['Downtown']);
    expect(newTrip?.endStopIndex).toBe(0);
    expect(newTrip?.recoveryTime).toBe(0);
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
});
