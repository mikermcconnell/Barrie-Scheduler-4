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
    expect(Object.keys(newTrip?.stops ?? {})).toEqual(['Downtown']);
    expect(newTrip?.endStopIndex).toBe(0);
    expect(newTrip?.recoveryTime).toBe(0);
  });
});
