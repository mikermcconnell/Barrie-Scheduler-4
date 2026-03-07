import { describe, expect, it } from 'vitest';
import { buildRoutingData } from '../utils/routing/routingDataService';
import type {
  CalendarEntry,
  GtfsData,
  GtfsRoute,
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
  RoutingData,
} from '../utils/routing/types';
import type { TripLeg } from '../utils/transit-app/studentPassUtils';
import { optimizeSharedTransferStops } from '../utils/transit-app/studentPassTransferOptimization';

function makeStop(id: string, name: string, lat: number, lon: number): GtfsStop {
  return { stopId: id, stopName: name, lat, lon };
}

function makeTrip(id: string, routeId: string): GtfsTrip {
  return {
    tripId: id,
    routeId,
    serviceId: 'WD',
    directionId: 0,
    headsign: routeId,
  };
}

function makeStopTime(
  tripId: string,
  stopId: string,
  sequence: number,
  hhmmss: string
): GtfsStopTime {
  const [hours, minutes, seconds] = hhmmss.split(':').map(Number);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return {
    tripId,
    stopId,
    stopSequence: sequence,
    arrivalTime: totalSeconds,
    departureTime: totalSeconds,
  };
}

function makeRoute(routeId: string): GtfsRoute {
  return {
    routeId,
    routeShortName: routeId,
    routeLongName: routeId,
  };
}

function makeCalendar(): CalendarEntry {
  return {
    serviceId: 'WD',
    startDate: '20260101',
    endDate: '20261231',
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  };
}

function buildTestRoutingData(stops: GtfsStop[], trips: GtfsTrip[], stopTimes: GtfsStopTime[]): RoutingData {
  const gtfsData: GtfsData = {
    stops,
    trips,
    stopTimes,
    routes: trips
      .map((trip) => makeRoute(trip.routeId))
      .filter((route, index, arr) => arr.findIndex((item) => item.routeId === route.routeId) === index),
    calendar: [makeCalendar()],
    calendarDates: [],
  };
  return buildRoutingData(gtfsData);
}

describe('optimizeSharedTransferStops', () => {
  it('prefers the earliest compatible shared stop to avoid downstream backtracking', () => {
    const stops = [
      makeStop('FORD', 'Ford Street', 44.4057, -79.7195),
      makeStop('LIV', 'Livingstone at Bayfield', 44.4074, -79.7091),
      makeStop('GM', 'Georgian Mall', 44.4111, -79.7051),
      makeStop('CEL', 'Celeste Drive', 44.4159, -79.7011),
      makeStop('MEY', 'Meyer Avenue', 44.4180, -79.6961),
      makeStop('SPR', 'Springwater Plaza', 44.4106, -79.7080),
      makeStop('ALL', 'Alliance Boulevard', 44.4073, -79.6848),
    ];

    const trips = [
      makeTrip('trip-10', '10'),
      makeTrip('trip-100', '100'),
    ];

    const stopTimes = [
      makeStopTime('trip-10', 'FORD', 1, '08:03:00'),
      makeStopTime('trip-10', 'LIV', 2, '08:07:00'),
      makeStopTime('trip-10', 'GM', 3, '08:08:00'),
      makeStopTime('trip-10', 'CEL', 4, '08:10:00'),
      makeStopTime('trip-10', 'MEY', 5, '08:11:00'),

      makeStopTime('trip-100', 'SPR', 1, '08:26:00'),
      makeStopTime('trip-100', 'GM', 2, '08:29:00'),
      makeStopTime('trip-100', 'CEL', 3, '08:30:00'),
      makeStopTime('trip-100', 'MEY', 4, '08:31:00'),
      makeStopTime('trip-100', 'ALL', 5, '08:36:00'),
    ];

    const routingData = buildTestRoutingData(stops, trips, stopTimes);
    const inputLegs: TripLeg[] = [
      {
        routeShortName: '10',
        routeColor: '#0000FF',
        tripId: 'trip-10',
        fromStopId: 'FORD',
        toStopId: 'LIV',
        departureMinutes: 8 * 60 + 3,
        arrivalMinutes: 8 * 60 + 7,
        fromStop: 'Ford Street',
        toStop: 'Livingstone at Bayfield',
      },
      {
        routeShortName: '100',
        routeColor: '#FF0000',
        tripId: 'trip-100',
        fromStopId: 'SPR',
        toStopId: 'ALL',
        departureMinutes: 8 * 60 + 26,
        arrivalMinutes: 8 * 60 + 36,
        fromStop: 'Springwater Plaza',
        toStop: 'Alliance Boulevard',
      },
    ];

    const optimized = optimizeSharedTransferStops(inputLegs, routingData);

    expect(optimized.tripLegs[0]?.toStopId).toBe('GM');
    expect(optimized.tripLegs[0]?.toStop).toBe('Georgian Mall');
    expect(optimized.tripLegs[0]?.arrivalMinutes).toBe(8 * 60 + 8);
    expect(optimized.tripLegs[1]?.fromStopId).toBe('GM');
    expect(optimized.tripLegs[1]?.fromStop).toBe('Georgian Mall');
    expect(optimized.tripLegs[1]?.departureMinutes).toBe(8 * 60 + 29);
    expect(optimized.transferWaitOverrides).toEqual([21]);
  });

  it('leaves the transfer alone when there is no later shared stop', () => {
    const stops = [
      makeStop('A', 'Stop A', 44.39, -79.70),
      makeStop('B', 'Stop B', 44.39, -79.69),
      makeStop('C', 'Stop C', 44.39, -79.68),
      makeStop('D', 'Stop D', 44.39, -79.67),
    ];
    const trips = [makeTrip('trip-1', '1'), makeTrip('trip-2', '2')];
    const stopTimes = [
      makeStopTime('trip-1', 'A', 1, '08:00:00'),
      makeStopTime('trip-1', 'B', 2, '08:05:00'),
      makeStopTime('trip-2', 'C', 1, '08:10:00'),
      makeStopTime('trip-2', 'D', 2, '08:20:00'),
    ];
    const routingData = buildTestRoutingData(stops, trips, stopTimes);
    const inputLegs: TripLeg[] = [
      {
        routeShortName: '1',
        routeColor: '#111111',
        tripId: 'trip-1',
        fromStopId: 'A',
        toStopId: 'B',
        departureMinutes: 8 * 60,
        arrivalMinutes: 8 * 60 + 5,
        fromStop: 'Stop A',
        toStop: 'Stop B',
      },
      {
        routeShortName: '2',
        routeColor: '#222222',
        tripId: 'trip-2',
        fromStopId: 'C',
        toStopId: 'D',
        departureMinutes: 8 * 60 + 10,
        arrivalMinutes: 8 * 60 + 20,
        fromStop: 'Stop C',
        toStop: 'Stop D',
      },
    ];

    const optimized = optimizeSharedTransferStops(inputLegs, routingData);

    expect(optimized.tripLegs).toEqual(inputLegs);
    expect(optimized.transferWaitOverrides).toEqual([null]);
  });

  it('moves an already-shared transfer upstream when an earlier common stop avoids backtracking', () => {
    const stops = [
      makeStop('SCH', 'School Stop', 44.401, -79.69),
      makeStop('MID', 'Mid Transfer', 44.409, -79.704),
      makeStop('TOP', 'Top Transfer', 44.417, -79.697),
      makeStop('HOME', 'Ford Street', 44.406, -79.719),
    ];

    const trips = [
      makeTrip('trip-100', '100'),
      makeTrip('trip-11', '11'),
    ];

    const stopTimes = [
      makeStopTime('trip-100', 'SCH', 1, '14:34:00'),
      makeStopTime('trip-100', 'MID', 2, '14:46:00'),
      makeStopTime('trip-100', 'TOP', 3, '14:52:00'),

      makeStopTime('trip-11', 'TOP', 1, '14:52:00'),
      makeStopTime('trip-11', 'MID', 2, '14:58:00'),
      makeStopTime('trip-11', 'HOME', 3, '15:06:00'),
    ];

    const routingData = buildTestRoutingData(stops, trips, stopTimes);
    const inputLegs: TripLeg[] = [
      {
        routeShortName: '100',
        routeColor: '#FF0000',
        tripId: 'trip-100',
        fromStopId: 'SCH',
        toStopId: 'TOP',
        departureMinutes: 14 * 60 + 34,
        arrivalMinutes: 14 * 60 + 52,
        fromStop: 'School Stop',
        toStop: 'Top Transfer',
      },
      {
        routeShortName: '11',
        routeColor: '#A3C82D',
        tripId: 'trip-11',
        fromStopId: 'TOP',
        toStopId: 'HOME',
        departureMinutes: 14 * 60 + 52,
        arrivalMinutes: 15 * 60 + 6,
        fromStop: 'Top Transfer',
        toStop: 'Ford Street',
      },
    ];

    const optimized = optimizeSharedTransferStops(inputLegs, routingData);

    expect(optimized.tripLegs[0]?.toStopId).toBe('MID');
    expect(optimized.tripLegs[0]?.toStop).toBe('Mid Transfer');
    expect(optimized.tripLegs[0]?.arrivalMinutes).toBe(14 * 60 + 46);
    expect(optimized.tripLegs[1]?.fromStopId).toBe('MID');
    expect(optimized.tripLegs[1]?.fromStop).toBe('Mid Transfer');
    expect(optimized.tripLegs[1]?.departureMinutes).toBe(14 * 60 + 58);
    expect(optimized.transferWaitOverrides).toEqual([12]);
  });
});
