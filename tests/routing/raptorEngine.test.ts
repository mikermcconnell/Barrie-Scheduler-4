import { describe, it, expect } from 'vitest';
import { planTripLocal } from '../../utils/routing/raptorEngine';
import { buildRoutingData } from '../../utils/routing/routingDataService';
import type { GtfsData, GtfsStop, GtfsTrip, GtfsStopTime, CalendarEntry, GtfsRoute } from '../../utils/routing/types';
import { RoutingError } from '../../utils/routing/types';

// ─── Synthetic GTFS Fixture Helpers ──────────────────────────────────

function makeStop(id: string, lat: number, lon: number): GtfsStop {
  return { stopId: id, stopName: `Stop ${id}`, lat, lon };
}

function makeTrip(id: string, routeId: string, serviceId = 'WD'): GtfsTrip {
  return {
    tripId: id,
    routeId,
    serviceId,
    directionId: 0,
    headsign: `Route ${routeId}`,
  };
}

function makeStopTime(
  tripId: string,
  stopId: string,
  sequence: number,
  arrivalSec: number,
  departureSec?: number
): GtfsStopTime {
  return {
    tripId,
    stopId,
    stopSequence: sequence,
    arrivalTime: arrivalSec,
    departureTime: departureSec ?? arrivalSec,
  };
}

function makeCalendar(serviceId = 'WD'): CalendarEntry {
  return {
    serviceId,
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

function makeRoute(routeId: string): GtfsRoute {
  return {
    routeId,
    routeShortName: routeId,
    routeLongName: `Route ${routeId}`,
    routeColor: '0000FF',
  };
}

// Use a Monday within 30 days from now for calendar resolution
function getNextMonday(): Date {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  return d;
}

const QUERY_DATE = getNextMonday();

/** Create a time on the query date */
function makeTime(hours: number, minutes: number): Date {
  const d = new Date(QUERY_DATE.getTime());
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Build a simple GTFS dataset and routing data from stops, trips, and stop times.
 */
function buildTestData(config: {
  stops: GtfsStop[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
  routes?: GtfsRoute[];
  calendar?: CalendarEntry[];
}) {
  const gtfsData: GtfsData = {
    stops: config.stops,
    trips: config.trips,
    stopTimes: config.stopTimes,
    routes: config.routes ?? config.trips.map((t) => makeRoute(t.routeId)).filter(
      (r, i, arr) => arr.findIndex((x) => x.routeId === r.routeId) === i
    ),
    calendar: config.calendar ?? [makeCalendar()],
    calendarDates: [],
  };
  return buildRoutingData(gtfsData);
}

// ─── Stop Layout ─────────────────────────────────────────────────────
//
// Stops arranged in a line, ~2km apart along a constant latitude
// at ~44.39°N (Barrie-ish). Each 0.025° lon ≈ 2km at this latitude.
// Spacing ensures walking is never competitive with transit.
//
// A(-79.700) — B(-79.675) — C(-79.650) — D(-79.625) — E(-79.600)

const STOPS = {
  A: makeStop('A', 44.39, -79.700),
  B: makeStop('B', 44.39, -79.675),
  C: makeStop('C', 44.39, -79.650),
  D: makeStop('D', 44.39, -79.625),
  E: makeStop('E', 44.39, -79.600),
};

// Disconnected stop (far away — no routes, no transfers)
const FAR_STOP = makeStop('FAR', 45.00, -80.00);

describe('RAPTOR Engine', () => {
  describe('direct route (no transfer)', () => {
    it('finds a single-leg trip A → C on Route 1', () => {
      // Route 1: A → B → C, departing at 08:00
      const trip = makeTrip('T1', 'R1');
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),  // 08:00
        makeStopTime('T1', 'B', 2, 29100, 29100),  // 08:05
        makeStopTime('T1', 'C', 3, 29400, 29400),  // 08:10
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.B, STOPS.C],
        trips: [trip],
        stopTimes,
      });

      // Query: near stop A → near stop C, departing 07:55
      const results = planTripLocal({
        fromLat: STOPS.A.lat,
        fromLon: STOPS.A.lon,
        toLat: STOPS.C.lat,
        toLon: STOPS.C.lon,
        date: QUERY_DATE,
        time: makeTime(7, 55),
        routingData,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);

      const best = results[0];
      expect(best.path.length).toBeGreaterThanOrEqual(2); // ORIGIN_WALK + TRANSIT
      const transitLegs = best.path.filter((s) => s.type === 'TRANSIT');
      expect(transitLegs.length).toBe(1);
      expect(transitLegs[0].type === 'TRANSIT' && transitLegs[0].routeId).toBe('R1');
    });
  });

  describe('one transfer', () => {
    it('finds a two-leg trip A → E via transfer at C', () => {
      // Route 1: A → B → C (08:00 → 08:10)
      // Route 2: C → D → E (08:15 → 08:25)
      // Transfer at C (same stop, 0m walk)
      const trips = [
        makeTrip('T1', 'R1'),
        makeTrip('T2', 'R2'),
      ];
      const stopTimes = [
        // Route 1
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'B', 2, 29100, 29100),
        makeStopTime('T1', 'C', 3, 29400, 29400),
        // Route 2
        makeStopTime('T2', 'C', 1, 29700, 29700),  // 08:15
        makeStopTime('T2', 'D', 2, 30000, 30000),
        makeStopTime('T2', 'E', 3, 30300, 30300),  // 08:25
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.B, STOPS.C, STOPS.D, STOPS.E],
        trips,
        stopTimes,
      });

      const results = planTripLocal({
        fromLat: STOPS.A.lat,
        fromLon: STOPS.A.lon,
        toLat: STOPS.E.lat,
        toLon: STOPS.E.lon,
        date: QUERY_DATE,
        time: makeTime(7, 55),
        routingData,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);

      const best = results[0];
      const transitLegs = best.path.filter((s) => s.type === 'TRANSIT');
      expect(transitLegs.length).toBe(2);
      expect(transitLegs[0].type === 'TRANSIT' && transitLegs[0].routeId).toBe('R1');
      expect(transitLegs[1].type === 'TRANSIT' && transitLegs[1].routeId).toBe('R2');
    });
  });

  describe('two transfers', () => {
    it('finds a three-leg trip across three routes', () => {
      // Route 1: A → B (08:00 → 08:05)
      // Route 2: B → C → D (08:10 → 08:20) — transfer at B
      // Route 3: D → E (08:25 → 08:30) — transfer at D
      const trips = [
        makeTrip('T1', 'R1'),
        makeTrip('T2', 'R2'),
        makeTrip('T3', 'R3'),
      ];
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'B', 2, 29100, 29100),
        makeStopTime('T2', 'B', 1, 29400, 29400),  // 08:10
        makeStopTime('T2', 'C', 2, 29700, 29700),
        makeStopTime('T2', 'D', 3, 30000, 30000),  // 08:20
        makeStopTime('T3', 'D', 1, 30300, 30300),  // 08:25
        makeStopTime('T3', 'E', 2, 30600, 30600),  // 08:30
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.B, STOPS.C, STOPS.D, STOPS.E],
        trips,
        stopTimes,
      });

      const results = planTripLocal({
        fromLat: STOPS.A.lat,
        fromLon: STOPS.A.lon,
        toLat: STOPS.E.lat,
        toLon: STOPS.E.lon,
        date: QUERY_DATE,
        time: makeTime(7, 55),
        routingData,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);

      const transitLegs = results[0].path.filter((s) => s.type === 'TRANSIT');
      expect(transitLegs.length).toBeLessThanOrEqual(3); // At most 3 transit legs (MAX_TRANSFERS = 2)
      expect(transitLegs.length).toBeGreaterThanOrEqual(2); // At least 2 legs needed
    });
  });

  describe('no route found', () => {
    it('throws NO_ROUTE_FOUND for disconnected stops', () => {
      // Only Route 1: A → B → C — no way to reach FAR
      const trip = makeTrip('T1', 'R1');
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'B', 2, 29100, 29100),
        makeStopTime('T1', 'C', 3, 29400, 29400),
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.B, STOPS.C, FAR_STOP],
        trips: [trip],
        stopTimes,
      });

      expect(() =>
        planTripLocal({
          fromLat: STOPS.A.lat,
          fromLon: STOPS.A.lon,
          toLat: FAR_STOP.lat,
          toLon: FAR_STOP.lon,
          date: QUERY_DATE,
          time: makeTime(7, 55),
          routingData,
        })
      ).toThrow(RoutingError);
    });
  });

  describe('too close', () => {
    it('returns a walk-only itinerary when origin and destination are within 50m', () => {
      const routingData = buildTestData({
        stops: [STOPS.A],
        trips: [],
        stopTimes: [],
      });

      const results = planTripLocal({
        fromLat: 44.39,
        fromLon: -79.700,
        toLat: 44.39,
        toLon: -79.7001,  // ~8m apart
        date: QUERY_DATE,
        routingData,
      });

      expect(results).toHaveLength(1);
      expect(results[0].path).toEqual([]);
      expect(results[0].walkToDestSeconds).toBeGreaterThan(0);
    });
  });

  describe('no service', () => {
    it('throws NO_SERVICE when no services run on queried date', () => {
      // Calendar is weekday-only, query is Saturday
      const trip = makeTrip('T1', 'R1');
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'C', 2, 29400, 29400),
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.C],
        trips: [trip],
        stopTimes,
      });

      // Next Saturday after QUERY_DATE (Monday + 5 days)
      const saturday = new Date(QUERY_DATE.getTime());
      saturday.setDate(saturday.getDate() + 5);

      expect(() =>
        planTripLocal({
          fromLat: STOPS.A.lat,
          fromLon: STOPS.A.lon,
          toLat: STOPS.C.lat,
          toLon: STOPS.C.lon,
          date: saturday,
          routingData,
        })
      ).toThrow(RoutingError);
    });
  });

  describe('multi-pass diversity', () => {
    it('returns different trips on subsequent passes', () => {
      // Two trips on Route 1: T1 at 08:00, T2 at 08:15
      const trips = [
        makeTrip('T1', 'R1'),
        makeTrip('T2', 'R1'),
      ];
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'C', 2, 29400, 29400),
        makeStopTime('T2', 'A', 1, 29700, 29700),  // 08:15
        makeStopTime('T2', 'C', 2, 30300, 30300),  // 08:25
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.C],
        trips,
        stopTimes,
      });

      const results = planTripLocal({
        fromLat: STOPS.A.lat,
        fromLon: STOPS.A.lon,
        toLat: STOPS.C.lat,
        toLon: STOPS.C.lon,
        date: QUERY_DATE,
        time: makeTime(7, 55),
        routingData,
      });

      expect(results.length).toBe(2);

      // Different trips used in each result
      const trip1 = results[0].path.find((s) => s.type === 'TRANSIT');
      const trip2 = results[1].path.find((s) => s.type === 'TRANSIT');
      expect(trip1?.type === 'TRANSIT' && trip1.tripId).not.toBe(
        trip2?.type === 'TRANSIT' && trip2.tripId
      );
    });

    it('branches on each transit leg so shared downstream trips still produce alternatives', () => {
      const trips = [
        makeTrip('T1', 'R1'),
        makeTrip('T2', 'R1'),
        makeTrip('T3', 'R2'),
        makeTrip('T4', 'R2'),
      ];
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'B', 2, 29100, 29100),
        makeStopTime('T2', 'A', 1, 28920, 28920),
        makeStopTime('T2', 'B', 2, 29220, 29220),
        makeStopTime('T3', 'B', 1, 29400, 29400),
        makeStopTime('T3', 'E', 2, 30000, 30000),
        makeStopTime('T4', 'B', 1, 29520, 29520),
        makeStopTime('T4', 'E', 2, 30120, 30120),
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.B, STOPS.E],
        trips,
        stopTimes,
      });

      const results = planTripLocal({
        fromLat: STOPS.A.lat,
        fromLon: STOPS.A.lon,
        toLat: STOPS.E.lat,
        toLon: STOPS.E.lon,
        date: QUERY_DATE,
        time: makeTime(7, 55),
        routingData,
      });

      const signatures = results.map((result) =>
        result.path
          .filter((segment) => segment.type === 'TRANSIT')
          .map((segment) => segment.tripId)
          .join('>')
      );

      expect(signatures).toContain('T1>T3');
      expect(signatures).toContain('T2>T3');
      expect(signatures).toContain('T1>T4');
    });
  });

  describe('transfer feasibility', () => {
    it('keeps a short transfer feasible instead of adding penalty time to reachability', () => {
      const stopB2 = makeStop('B2', STOPS.B.lat, STOPS.B.lon + 0.0001);
      const trips = [
        makeTrip('T1', 'R1'),
        makeTrip('T2', 'R2'),
      ];
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'B', 2, 29400, 29400), // 08:10
        makeStopTime('T2', 'B2', 1, 29520, 29520), // 08:12
        makeStopTime('T2', 'C', 2, 30120, 30120), // 08:22
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.B, stopB2, STOPS.C],
        trips,
        stopTimes,
      });

      const results = planTripLocal({
        fromLat: STOPS.A.lat,
        fromLon: STOPS.A.lon,
        toLat: STOPS.C.lat,
        toLon: STOPS.C.lon,
        date: QUERY_DATE,
        time: makeTime(7, 55),
        routingData,
      });

      const transitLegs = results[0].path.filter((segment) => segment.type === 'TRANSIT');
      expect(transitLegs).toHaveLength(2);
    });
  });

  describe('GTFS pickup/drop-off restrictions', () => {
    it('does not board at a stop with pickup_type=1', () => {
      const restrictedTrip: GtfsTrip = makeTrip('T1', 'R1');
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        { ...makeStopTime('T1', 'B', 2, 29100, 29100), pickupType: 1 },
        makeStopTime('T1', 'C', 3, 29400, 29400),
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.B, STOPS.C],
        trips: [restrictedTrip],
        stopTimes,
      });

      expect(() =>
        planTripLocal({
          fromLat: STOPS.B.lat,
          fromLon: STOPS.B.lon,
          toLat: STOPS.C.lat,
          toLon: STOPS.C.lon,
          date: QUERY_DATE,
          time: makeTime(8, 4),
          routingData,
        })
      ).toThrow(RoutingError);
    });

    it('does not alight at a stop with drop_off_type=1', () => {
      const restrictedTrip: GtfsTrip = makeTrip('T1', 'R1');
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        { ...makeStopTime('T1', 'C', 2, 29400, 29400), dropOffType: 1 },
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.C],
        trips: [restrictedTrip],
        stopTimes,
      });

      expect(() =>
        planTripLocal({
          fromLat: STOPS.A.lat,
          fromLon: STOPS.A.lon,
          toLat: STOPS.C.lat,
          toLon: STOPS.C.lon,
          date: QUERY_DATE,
          time: makeTime(7, 55),
          routingData,
        })
      ).toThrow(RoutingError);
    });
  });

  describe('route variants', () => {
    it('finds trips on non-canonical patterns of the same route-direction', () => {
      const trips = [
        makeTrip('T1', 'R1'),
        makeTrip('T2', 'R1'),
      ];
      const stopC = makeStop('C_VARIANT', 44.39, -79.640);
      const stopD = makeStop('D_VARIANT', 44.39, -79.620);
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'B', 2, 29100, 29100),
        makeStopTime('T1', 'D_VARIANT', 3, 29700, 29700),
        makeStopTime('T2', 'A', 1, 30000, 30000),
        makeStopTime('T2', 'C_VARIANT', 2, 30300, 30300),
        makeStopTime('T2', 'D_VARIANT', 3, 30900, 30900),
      ];

      const routingData = buildTestData({
        stops: [STOPS.A, STOPS.B, stopC, stopD],
        trips,
        stopTimes,
      });

      const results = planTripLocal({
        fromLat: stopC.lat,
        fromLon: stopC.lon,
        toLat: stopD.lat,
        toLon: stopD.lon,
        date: QUERY_DATE,
        time: makeTime(8, 24),
        routingData,
      });

      expect(results).toHaveLength(1);
      const transitLeg = results[0].path.find((segment) => segment.type === 'TRANSIT');
      expect(transitLeg?.type === 'TRANSIT' && transitLeg.tripId).toBe('T2');
    });
  });
});
