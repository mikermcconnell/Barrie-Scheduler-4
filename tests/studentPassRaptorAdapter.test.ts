import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Itinerary, RoutingData } from '../utils/routing/types';

const planTripLocalMock = vi.fn();
const buildItineraryMock = vi.fn();

const zoneOrigin: [number, number] = [44.4, -79.7];
const school = {
  id: 'school-1',
  name: 'Test School',
  lat: 44.41,
  lon: -79.68,
  bellStart: '08:00',
  bellEnd: '14:20',
};

const zoneStops = Array.from({ length: 10 }, (_, index) => ({
  stop_id: `stop-${index + 1}`,
  stop_name: `Stop ${index + 1}`,
  lat: 44.4 + index * 0.001,
  lon: -79.7 + index * 0.001,
}));

function makeItinerary(
  searchKind: 'morning' | 'afternoon',
  stopId: string,
  options: {
    routeShortName?: string;
    tripId?: string;
    durationMinutes?: number;
  } = {}
): Itinerary {
  const startTime = searchKind === 'morning'
    ? new Date(2026, 2, 2, 7, 30).getTime()
    : new Date(2026, 2, 2, 14, 20).getTime();
  const durationMinutes = options.durationMinutes ?? 20;
  const endTime = startTime + (durationMinutes * 60 * 1000);
  const routeShortName = options.routeShortName ?? '1';
  const tripId = options.tripId ?? 'T1';

  return {
    id: `${searchKind}-${stopId}`,
    duration: durationMinutes * 60,
    startTime,
    endTime,
    walkTime: 8 * 60,
    transitTime: Math.max((durationMinutes - 8), 1) * 60,
    waitingTime: 0,
    walkDistance: 600,
    transfers: 0,
    legs: [{
      mode: 'BUS',
      startTime: startTime + (searchKind === 'morning' ? 5 * 60 * 1000 : 0),
      endTime: endTime - (searchKind === 'morning' ? 0 : 5 * 60 * 1000),
      duration: Math.max((durationMinutes - 8), 1) * 60,
      distance: 2500,
      from: { name: `From ${stopId}`, stopId, lat: 44.4, lon: -79.7 },
      to: { name: searchKind === 'morning' ? school.name : `To ${stopId}`, stopId: searchKind === 'morning' ? 'school-stop' : stopId, lat: school.lat, lon: school.lon },
      route: { id: `R${routeShortName}`, shortName: routeShortName, longName: `Route ${routeShortName}`, color: '0000FF' },
      headsign: school.name,
      tripId,
      intermediateStops: [],
      legGeometry: null,
    }],
  };
}

const routingData: RoutingData = {
  stopDepartures: {
    'stop-1': [{
      tripId: 'T1',
      routeId: 'R1',
      serviceId: 'WD',
      directionId: 0,
      patternId: 'pattern-1',
      headsign: school.name,
      departureTime: 27000,
      arrivalTime: 28200,
      stopSequence: 1,
      pickupType: 0,
    }],
  },
  routePatterns: {},
  transfers: {},
  tripIndex: {
    T1: { tripId: 'T1', routeId: 'R1', serviceId: 'WD', directionId: 0, headsign: school.name },
  },
  routeIndex: {
    R1: { routeId: 'R1', routeShortName: '1', routeLongName: 'Route 1', routeColor: '0000FF' },
  },
  tripPatternIndex: { T1: 'pattern-1' },
  stopIndex: Object.fromEntries(zoneStops.map((stop) => [stop.stop_id, {
    stopId: stop.stop_id,
    stopName: stop.stop_name,
    lat: stop.lat,
    lon: stop.lon,
  }])),
  stopRoutes: {},
  stopTimesIndex: {},
  tripStopTimes: {},
  serviceCalendar: {
    '20260302': new Set(['WD']),
  },
  stops: zoneStops.map((stop) => ({
    stopId: stop.stop_id,
    stopName: stop.stop_name,
    lat: stop.lat,
    lon: stop.lon,
  })),
  trips: [{ tripId: 'T1', routeId: 'R1', serviceId: 'WD', directionId: 0, headsign: school.name }],
  routes: [{ routeId: 'R1', routeShortName: '1', routeLongName: 'Route 1', routeColor: '0000FF' }],
  stopTimes: [],
};

vi.mock('../utils/routing/gtfsAdapter', () => ({
  loadGtfsData: vi.fn(() => ({
    stops: [],
    trips: [],
    stopTimes: [],
    routes: [],
    calendar: [],
    calendarDates: [],
  })),
}));

vi.mock('../utils/routing/routingDataService', () => ({
  buildRoutingData: vi.fn(() => routingData),
}));

vi.mock('../utils/routing/raptorEngine', () => ({
  planTripLocal: planTripLocalMock,
}));

vi.mock('../utils/routing/itineraryBuilder', () => ({
  buildItinerary: buildItineraryMock,
}));

vi.mock('../utils/gtfs/gtfsStopLookup', () => ({
  getAllStopsWithCoords: vi.fn(() => [
    ...zoneStops,
    { stop_id: 'school-stop', stop_name: school.name, lat: school.lat, lon: school.lon },
  ]),
}));

vi.mock('../utils/transit-app/studentPassUtils', () => ({
  findStopsInZone: vi.fn(() => zoneStops),
  findStopsNearPoint: vi.fn(() => []),
  getPolygonCentroid: vi.fn(() => zoneOrigin),
  parseTimeToMinutes: vi.fn((value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }),
  minutesToDisplayTime: vi.fn((minutes: number) => `${minutes}`),
  getTransferQuality: vi.fn((waitMinutes: number) => ({
    quality: 'good',
    color: '#22C55E',
    label: 'Good',
    waitMinutes,
  })),
  buildWalkLeg: vi.fn((fromLat: number, fromLon: number, toLat: number, toLon: number, label: string) => ({
    fromLat,
    fromLon,
    toLat,
    toLon,
    distanceKm: 0.4,
    walkMinutes: 5,
    label,
  })),
  getRouteShapeSegment: vi.fn(() => []),
}));

describe('studentPassRaptorAdapter', () => {
  beforeEach(() => {
    planTripLocalMock.mockReset();
    buildItineraryMock.mockReset();

    planTripLocalMock.mockImplementation((options) => [{
      searchKind: options.originStopIds?.length ? 'morning' : 'afternoon',
      stopId: options.originStopIds?.[0] ?? options.destinationStopIds?.[0] ?? 'stop-1',
    }]);

    buildItineraryMock.mockImplementation((result) =>
      makeItinerary(result.searchKind, result.stopId)
    );
  });

  it('evaluates every zone stop and passes door-to-door coordinates into routing', async () => {
    const { findTripOptionsRaptor } = await import('../utils/transit-app/studentPassRaptorAdapter');

    findTripOptionsRaptor([[44.39, -79.71], [44.41, -79.69], [44.4, -79.68]], school, {
      serviceDate: new Date(2026, 2, 2),
      zoneOrigin,
    });

    expect(planTripLocalMock).toHaveBeenCalledTimes(zoneStops.length * 2);

    const morningCalls = planTripLocalMock.mock.calls.filter(
      ([options]) => Array.isArray(options.originStopIds) && options.originStopIds.length > 0
    );
    expect(morningCalls).toHaveLength(zoneStops.length);
    for (const [options] of morningCalls) {
      expect(options.fromLat).toBe(zoneOrigin[0]);
      expect(options.fromLon).toBe(zoneOrigin[1]);
    }

    const afternoonCalls = planTripLocalMock.mock.calls.filter(
      ([options]) => Array.isArray(options.destinationStopIds) && options.destinationStopIds.length > 0
    );
    expect(afternoonCalls).toHaveLength(zoneStops.length);
    for (const [options] of afternoonCalls) {
      expect(options.toLat).toBe(zoneOrigin[0]);
      expect(options.toLon).toBe(zoneOrigin[1]);
    }
  });

  it('deduplicates repeated route families so distinct options can surface', async () => {
    const { findTripOptionsRaptor } = await import('../utils/transit-app/studentPassRaptorAdapter');

    planTripLocalMock.mockImplementation((options) => {
      const stopId = options.originStopIds?.[0] ?? options.destinationStopIds?.[0] ?? 'stop-1';

      if (options.originStopIds?.length) {
        if (stopId !== 'stop-1') return [];
        return [
          { searchKind: 'morning', stopId, tripId: 'AM-11A', routeShortName: '11' },
          { searchKind: 'morning', stopId, tripId: 'AM-11B', routeShortName: '11' },
          { searchKind: 'morning', stopId, tripId: 'AM-10', routeShortName: '10' },
        ];
      }

      if (stopId === 'stop-1') {
        return [{ searchKind: 'afternoon', stopId, tripId: 'PM-11A', routeShortName: '11' }];
      }
      if (stopId === 'stop-2') {
        return [{ searchKind: 'afternoon', stopId, tripId: 'PM-11B', routeShortName: '11' }];
      }
      if (stopId === 'stop-3') {
        return [{ searchKind: 'afternoon', stopId, tripId: 'PM-10', routeShortName: '10' }];
      }
      return [];
    });

    buildItineraryMock.mockImplementation((result) =>
      makeItinerary(result.searchKind, result.stopId, {
        tripId: result.tripId,
        routeShortName: result.routeShortName,
      })
    );

    const options = findTripOptionsRaptor(
      [[44.39, -79.71], [44.41, -79.69], [44.4, -79.68]],
      school,
      { serviceDate: new Date(2026, 2, 2), zoneOrigin }
    );

    expect(options.morningOptions).toHaveLength(2);
    expect(options.morningOptions.map((option) => option.label)).toEqual([
      expect.stringContaining('Rt 11'),
      expect.stringContaining('Rt 10'),
    ]);

    expect(options.afternoonOptions).toHaveLength(2);
    expect(options.afternoonOptions.map((option) => option.label)).toEqual([
      expect.stringContaining('Rt 11'),
      expect.stringContaining('Rt 10'),
    ]);
  });
});
