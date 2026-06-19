import { describe, expect, it } from 'vitest';
import {
  cascadeTripTimes,
  endBlockAtTrip,
  setTripEndStop,
  setTripStartStop,
  updateSegmentTime,
} from '../components/NewSchedule/utils/timeCascade';

const buildSchedules = () => [
  {
    routeName: 'Route 2 North',
    stops: ['Park Place', 'Downtown', 'Georgian'],
    trips: [
      {
        id: 'n-1',
        blockId: 'block-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 360,
        endTime: 390,
        travelTime: 30,
        recoveryTime: 5,
        cycleTime: 35,
        stops: {
          'Park Place': '6:00 AM',
          Downtown: '6:20 AM',
          Georgian: '6:30 AM',
        },
        arrivalTimes: {
          Downtown: '6:18 AM',
          Georgian: '6:30 AM',
        },
        stopMinutes: {
          'Park Place': 360,
          Downtown: 380,
          Georgian: 390,
        },
        recoveryTimes: {
          Georgian: 5,
        },
      },
      {
        id: 'n-2',
        blockId: 'block-1',
        direction: 'North',
        tripNumber: 3,
        rowId: 3,
        startTime: 420,
        endTime: 450,
        travelTime: 30,
        recoveryTime: 5,
        cycleTime: 35,
        stops: {
          'Park Place': '7:00 AM',
          Downtown: '7:20 AM',
          Georgian: '7:30 AM',
        },
        arrivalTimes: {
          Downtown: '7:18 AM',
          Georgian: '7:30 AM',
        },
        stopMinutes: {
          'Park Place': 420,
          Downtown: 440,
          Georgian: 450,
        },
      },
      {
        id: 'n-other-block',
        blockId: 'block-2',
        direction: 'North',
        tripNumber: 4,
        rowId: 4,
        startTime: 430,
        endTime: 460,
        travelTime: 30,
        recoveryTime: 5,
        cycleTime: 35,
        stops: {
          'Park Place': '7:10 AM',
          Downtown: '7:30 AM',
          Georgian: '7:40 AM',
        },
      },
    ],
  },
  {
    routeName: 'Route 2 South',
    stops: ['Georgian', 'Downtown', 'Park Place'],
    trips: [
      {
        id: 's-1',
        blockId: 'block-1',
        direction: 'South',
        tripNumber: 2,
        rowId: 2,
        startTime: 395,
        endTime: 425,
        travelTime: 30,
        recoveryTime: 5,
        cycleTime: 35,
        stops: {
          Georgian: '6:35 AM',
          Downtown: '6:55 AM',
          'Park Place': '7:05 AM',
        },
        stopMinutes: {
          Georgian: 395,
          Downtown: 415,
          'Park Place': 425,
        },
      },
    ],
  },
] as any[];

describe('timeCascade', () => {
  it('cascades later trips in the same block without mutating the original schedule', () => {
    const schedules = buildSchedules();

    const updated = cascadeTripTimes(schedules, 'n-1', 7);

    expect(updated).not.toBe(schedules);
    expect(updated[0].trips[0].startTime).toBe(360);
    expect(updated[1].trips[0].startTime).toBe(402);
    expect(updated[1].trips[0].stops.Georgian).toBe('6:42 AM');
    expect(updated[0].trips[1].startTime).toBe(427);
    expect(updated[0].trips[1].arrivalTimes.Downtown).toBe('7:25 AM');
    expect(updated[0].trips[2].startTime).toBe(430);
    expect(schedules[1].trips[0].startTime).toBe(395);
  });

  it('updates a segment and then cascades later trips in the same block', () => {
    const updated = updateSegmentTime(buildSchedules(), 'n-1', 'Downtown', 5);

    expect(updated[0].trips[0].stops['Park Place']).toBe('6:00 AM');
    expect(updated[0].trips[0].stops.Downtown).toBe('6:25 AM');
    expect(updated[0].trips[0].stops.Georgian).toBe('6:35 AM');
    expect(updated[0].trips[0].endTime).toBe(395);
    expect(updated[1].trips[0].startTime).toBe(400);
    expect(updated[0].trips[1].stopMinutes.Downtown).toBe(445);
  });

  it('removes only later trips from the selected block', () => {
    const updated = endBlockAtTrip(buildSchedules(), 's-1');

    expect(updated[0].trips.map((trip: any) => trip.id)).toEqual(['n-1', 'n-other-block']);
    expect(updated[1].trips.map((trip: any) => trip.id)).toEqual(['s-1']);
  });

  it('sets a partial-trip start and clears orphaned earlier stop data', () => {
    const updated = setTripStartStop(buildSchedules(), 'n-1', 1);
    const trip = updated[0].trips[0];

    expect(trip.startStopIndex).toBe(1);
    expect(trip.startTime).toBe(380);
    expect(trip.stops['Park Place']).toBeUndefined();
    expect(trip.stopMinutes['Park Place']).toBeUndefined();
    expect(trip.stops.Downtown).toBe('6:20 AM');
  });

  it('sets a partial-trip end and clears orphaned later stop data', () => {
    const updated = setTripEndStop(buildSchedules(), 'n-1', 1);
    const trip = updated[0].trips[0];

    expect(trip.endStopIndex).toBe(1);
    expect(trip.endTime).toBe(380);
    expect(trip.stops.Georgian).toBeUndefined();
    expect(trip.arrivalTimes.Georgian).toBeUndefined();
    expect(trip.recoveryTimes.Georgian).toBeUndefined();
  });

  it('returns a cloned schedule unchanged when the target trip or stop is missing', () => {
    const schedules = buildSchedules();

    expect(cascadeTripTimes(schedules, 'missing', 5)).toEqual(schedules);
    expect(updateSegmentTime(schedules, 'n-1', 'Missing stop', 5)).toEqual(schedules);
    expect(endBlockAtTrip(schedules, 'missing')).toEqual(schedules);
    expect(setTripStartStop(schedules, 'missing', 1)).toEqual(schedules);
    expect(setTripEndStop(schedules, 'missing', 1)).toEqual(schedules);
  });
});
