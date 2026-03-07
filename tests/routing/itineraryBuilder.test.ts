import { describe, it, expect } from 'vitest';
import { buildItinerary } from '../../utils/routing/itineraryBuilder';
import { buildRoutingData } from '../../utils/routing/routingDataService';
import type {
  GtfsData,
  GtfsStop,
  GtfsTrip,
  GtfsStopTime,
  GtfsRoute,
  CalendarEntry,
  RaptorResult,
  RoutingData,
  TransitSegment,
} from '../../utils/routing/types';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeStop(id: string, lat: number, lon: number): GtfsStop {
  return { stopId: id, stopName: `Stop ${id}`, lat, lon };
}

function makeTrip(id: string, routeId: string): GtfsTrip {
  return {
    tripId: id,
    routeId,
    serviceId: 'WD',
    directionId: 0,
    headsign: `Route ${routeId}`,
  };
}

function makeStopTime(
  tripId: string,
  stopId: string,
  sequence: number,
  arrSec: number,
  depSec?: number
): GtfsStopTime {
  return {
    tripId,
    stopId,
    stopSequence: sequence,
    arrivalTime: arrSec,
    departureTime: depSec ?? arrSec,
  };
}

function makeRoute(routeId: string): GtfsRoute {
  return { routeId, routeShortName: routeId, routeLongName: `Route ${routeId}` };
}

function makeCalendar(): CalendarEntry {
  return {
    serviceId: 'WD',
    startDate: '20260101',
    endDate: '20261231',
    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
    saturday: false, sunday: false,
  };
}

const DATE = new Date(2026, 2, 2);

// Stops ~2km apart (same layout as raptorEngine tests)
const STOPS = {
  A: makeStop('A', 44.39, -79.700),
  B: makeStop('B', 44.39, -79.675),
  C: makeStop('C', 44.39, -79.650),
  D: makeStop('D', 44.39, -79.625),
  E: makeStop('E', 44.39, -79.600),
};

function buildTestRoutingData(config: {
  stops: GtfsStop[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
}): RoutingData {
  const gtfsData: GtfsData = {
    stops: config.stops,
    trips: config.trips,
    stopTimes: config.stopTimes,
    routes: config.trips
      .map((t) => makeRoute(t.routeId))
      .filter((r, i, arr) => arr.findIndex((x) => x.routeId === r.routeId) === i),
    calendar: [makeCalendar()],
    calendarDates: [],
  };
  return buildRoutingData(gtfsData);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Itinerary Builder', () => {
  describe('direct walk result', () => {
    it('builds a single walk leg when RAPTOR returns a walk-only result', () => {
      const routingData = buildTestRoutingData({
        stops: [STOPS.A, STOPS.B],
        trips: [],
        stopTimes: [],
      });

      const result: RaptorResult = {
        destinationStopId: '',
        walkToDestSeconds: 180,
        arrivalTime: 28980,
        path: [],
        directWalkMeters: 220,
      };

      const itin = buildItinerary(result, routingData, DATE, 44.391, -79.701, 44.389, -79.699);

      expect(itin.legs).toHaveLength(1);
      expect(itin.legs[0].mode).toBe('WALK');
      expect(itin.duration).toBe(180);
      expect(itin.walkDistance).toBe(220);
    });
  });

  describe('walk-only itinerary', () => {
    it('produces a walk-only itinerary when path has no transit', () => {
      const routingData = buildTestRoutingData({
        stops: [STOPS.A, STOPS.B],
        trips: [],
        stopTimes: [],
      });

      const result: RaptorResult = {
        destinationStopId: 'A',
        walkToDestSeconds: 120,
        arrivalTime: 28920, // 08:02
        path: [
          { type: 'ORIGIN_WALK', toStopId: 'A', walkSeconds: 120 },
        ],
      };

      const itin = buildItinerary(result, routingData, DATE, 44.391, -79.701, 44.389, -79.699);

      expect(itin.legs.length).toBe(2); // walk to stop + walk from stop
      expect(itin.legs[0].mode).toBe('WALK');
      expect(itin.legs[1].mode).toBe('WALK');
      expect(itin.transfers).toBe(0);
    });
  });

  describe('single transit leg with walk to/from', () => {
    it('produces walk → transit → walk itinerary', () => {
      const trips = [makeTrip('T1', 'R1')];
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),  // 08:00
        makeStopTime('T1', 'B', 2, 29100, 29100),   // 08:05
        makeStopTime('T1', 'C', 3, 29400, 29400),   // 08:10
      ];

      const routingData = buildTestRoutingData({
        stops: [STOPS.A, STOPS.B, STOPS.C],
        trips,
        stopTimes,
      });

      const result: RaptorResult = {
        destinationStopId: 'C',
        walkToDestSeconds: 60,
        arrivalTime: 29460,
        path: [
          { type: 'ORIGIN_WALK', toStopId: 'A', walkSeconds: 30 },
          {
            type: 'TRANSIT',
            tripId: 'T1',
            routeId: 'R1',
            directionId: 0,
            headsign: 'Route R1',
            boardingStopId: 'A',
            alightingStopId: 'C',
            boardingTime: 28800,
            alightingTime: 29400,
          },
        ],
      };

      const itin = buildItinerary(result, routingData, DATE, 44.391, -79.701, 44.389, -79.649);

      // Walk → Transit → Walk
      expect(itin.legs.length).toBe(3);
      expect(itin.legs[0].mode).toBe('WALK');
      expect(itin.legs[1].mode).toBe('BUS');
      expect(itin.legs[2].mode).toBe('WALK');

      // Transit leg details
      const transitLeg = itin.legs[1];
      expect(transitLeg.mode === 'BUS' && transitLeg.tripId).toBe('T1');
      expect(transitLeg.mode === 'BUS' && transitLeg.route?.id).toBe('R1');
      expect(transitLeg.duration).toBe(600); // 10 minutes

      // One intermediate stop (B)
      expect(transitLeg.mode === 'BUS' && transitLeg.intermediateStops?.length).toBe(1);

      expect(itin.transfers).toBe(0);
    });
  });

  describe('same-route leg merging', () => {
    it('merges consecutive transit legs on the same trip', () => {
      const trips = [makeTrip('T1', 'R1')];
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'B', 2, 29100, 29100),
        makeStopTime('T1', 'C', 3, 29400, 29400),
      ];

      const routingData = buildTestRoutingData({
        stops: [STOPS.A, STOPS.B, STOPS.C],
        trips,
        stopTimes,
      });

      // Simulate two consecutive TRANSIT segments on the same trip
      // (this can happen with RAPTOR's round-based approach)
      const result: RaptorResult = {
        destinationStopId: 'C',
        walkToDestSeconds: 0,
        arrivalTime: 29400,
        path: [
          { type: 'ORIGIN_WALK', toStopId: 'A', walkSeconds: 0 },
          {
            type: 'TRANSIT',
            tripId: 'T1',
            routeId: 'R1',
            directionId: 0,
            headsign: 'Route R1',
            boardingStopId: 'A',
            alightingStopId: 'B',
            boardingTime: 28800,
            alightingTime: 29100,
          },
          {
            type: 'TRANSIT',
            tripId: 'T1',
            routeId: 'R1',
            directionId: 0,
            headsign: 'Route R1',
            boardingStopId: 'B',
            alightingStopId: 'C',
            boardingTime: 29100,
            alightingTime: 29400,
          },
        ],
      };

      const itin = buildItinerary(result, routingData, DATE);

      // Should merge into a single transit leg A → C
      const transitLegs = itin.legs.filter((l) => l.mode === 'BUS');
      expect(transitLegs.length).toBe(1);
      expect(transitLegs[0].mode === 'BUS' && transitLegs[0].from.stopId).toBe('A');
      expect(transitLegs[0].mode === 'BUS' && transitLegs[0].to.stopId).toBe('C');
    });
  });

  describe('transfer produces walk leg', () => {
    it('inserts a walk leg between two transit legs for a transfer', () => {
      const trips = [makeTrip('T1', 'R1'), makeTrip('T2', 'R2')];
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),
        makeStopTime('T1', 'B', 2, 29100, 29100),
        makeStopTime('T2', 'B', 1, 29700, 29700),  // 08:15
        makeStopTime('T2', 'C', 2, 30000, 30000),   // 08:20
      ];

      // B and B2 at same location (simulating platform transfer)
      const stopB2 = makeStop('B2', STOPS.B.lat, STOPS.B.lon + 0.001); // ~80m away
      const routingData = buildTestRoutingData({
        stops: [STOPS.A, STOPS.B, stopB2, STOPS.C],
        trips,
        stopTimes: [
          ...stopTimes.slice(0, 2),
          makeStopTime('T2', 'B2', 1, 29700, 29700),
          makeStopTime('T2', 'C', 2, 30000, 30000),
        ],
      });

      const result: RaptorResult = {
        destinationStopId: 'C',
        walkToDestSeconds: 0,
        arrivalTime: 30000,
        path: [
          { type: 'ORIGIN_WALK', toStopId: 'A', walkSeconds: 0 },
          {
            type: 'TRANSIT',
            tripId: 'T1',
            routeId: 'R1',
            directionId: 0,
            headsign: 'Route R1',
            boardingStopId: 'A',
            alightingStopId: 'B',
            boardingTime: 28800,
            alightingTime: 29100,
          },
          {
            type: 'TRANSFER',
            fromStopId: 'B',
            toStopId: 'B2',
            walkSeconds: 90,
            walkMeters: 80,
          },
          {
            type: 'TRANSIT',
            tripId: 'T2',
            routeId: 'R2',
            directionId: 0,
            headsign: 'Route R2',
            boardingStopId: 'B2',
            alightingStopId: 'C',
            boardingTime: 29700,
            alightingTime: 30000,
          },
        ],
      };

      const itin = buildItinerary(result, routingData, DATE);

      // Should have: transit → walk → transit
      const legModes = itin.legs.map((l) => l.mode);
      expect(legModes).toContain('BUS');
      expect(legModes).toContain('WALK');

      const transitLegs = itin.legs.filter((l) => l.mode === 'BUS');
      expect(transitLegs.length).toBe(2);
      expect(itin.transfers).toBe(1);
    });
  });

  describe('duration/distance/transfer calculations', () => {
    it('calculates totals correctly for a two-transfer trip', () => {
      const trips = [
        makeTrip('T1', 'R1'),
        makeTrip('T2', 'R2'),
      ];
      const stopTimes = [
        makeStopTime('T1', 'A', 1, 28800, 28800),   // 08:00
        makeStopTime('T1', 'C', 2, 29400, 29400),   // 08:10
        makeStopTime('T2', 'C', 1, 29700, 29700),   // 08:15
        makeStopTime('T2', 'E', 2, 30300, 30300),   // 08:25
      ];

      const routingData = buildTestRoutingData({
        stops: [STOPS.A, STOPS.C, STOPS.E],
        trips,
        stopTimes,
      });

      const result: RaptorResult = {
        destinationStopId: 'E',
        walkToDestSeconds: 45,
        arrivalTime: 30345,
        path: [
          { type: 'ORIGIN_WALK', toStopId: 'A', walkSeconds: 30 },
          {
            type: 'TRANSIT',
            tripId: 'T1',
            routeId: 'R1',
            directionId: 0,
            headsign: 'Route R1',
            boardingStopId: 'A',
            alightingStopId: 'C',
            boardingTime: 28800,
            alightingTime: 29400,
          },
          {
            type: 'TRANSFER',
            fromStopId: 'C',
            toStopId: 'C',
            walkSeconds: 60,
            walkMeters: 0,
          },
          {
            type: 'TRANSIT',
            tripId: 'T2',
            routeId: 'R2',
            directionId: 0,
            headsign: 'Route R2',
            boardingStopId: 'C',
            alightingStopId: 'E',
            boardingTime: 29700,
            alightingTime: 30300,
          },
        ],
      };

      const itin = buildItinerary(result, routingData, DATE, 44.391, -79.701, 44.389, -79.599);

      expect(itin.transfers).toBe(1);
      expect(itin.transitTime).toBe(1200); // 600 + 600 seconds
      expect(itin.walkTime).toBe(30 + 60 + 45); // origin walk + transfer + dest walk
      expect(itin.walkDistance).toBeGreaterThan(0);
      expect(itin.duration).toBeGreaterThan(0);
      expect(itin.startTime).toBeLessThan(itin.endTime);
    });
  });
});
