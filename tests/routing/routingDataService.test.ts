import { describe, it, expect } from 'vitest';
import {
  buildStopDeparturesIndex,
  buildRoutePatterns,
  buildTransferGraph,
  buildStopIndex,
  buildTripIndex,
  buildStopTimesIndex,
  buildStopRoutesIndex,
  findNearbyStops,
  getDeparturesAfter,
  getNextDepartureForRoute,
} from '../../utils/routing/routingDataService';
import type { GtfsStop, GtfsTrip, GtfsStopTime } from '../../utils/routing/types';

// ─── Synthetic Test Data ────────────────────────────────────────────

const STOPS: GtfsStop[] = [
  { stopId: 'S1', stopName: 'Terminal', lat: 44.3891, lon: -79.6903 },
  { stopId: 'S2', stopName: 'Park Place', lat: 44.3900, lon: -79.6890 },      // ~150m from S1
  { stopId: 'S3', stopName: 'Bayfield Mall', lat: 44.3950, lon: -79.6850 },   // ~700m from S1
  { stopId: 'S4', stopName: 'Far Away Stop', lat: 44.4200, lon: -79.6500 },   // ~4km from S1
];

const TRIPS: GtfsTrip[] = [
  { tripId: 'T1', routeId: 'R1', serviceId: 'WKD', directionId: 0, headsign: 'North' },
  { tripId: 'T2', routeId: 'R1', serviceId: 'WKD', directionId: 0, headsign: 'North' },
  { tripId: 'T3', routeId: 'R2', serviceId: 'WKD', directionId: 0, headsign: 'East' },
  { tripId: 'T4', routeId: 'R1', serviceId: 'WKE', directionId: 1, headsign: 'South' },
];

const STOP_TIMES: GtfsStopTime[] = [
  // Trip T1: S1 -> S2 -> S3
  { tripId: 'T1', stopId: 'S1', arrivalTime: 21600, departureTime: 21600, stopSequence: 1 },  // 06:00
  { tripId: 'T1', stopId: 'S2', arrivalTime: 21900, departureTime: 21900, stopSequence: 2 },  // 06:05
  { tripId: 'T1', stopId: 'S3', arrivalTime: 22200, departureTime: 22200, stopSequence: 3 },  // 06:10
  // Trip T2: S1 -> S2 -> S3 (later)
  { tripId: 'T2', stopId: 'S1', arrivalTime: 25200, departureTime: 25200, stopSequence: 1 },  // 07:00
  { tripId: 'T2', stopId: 'S2', arrivalTime: 25500, departureTime: 25500, stopSequence: 2 },  // 07:05
  { tripId: 'T2', stopId: 'S3', arrivalTime: 25800, departureTime: 25800, stopSequence: 3 },  // 07:10
  // Trip T3: S3 -> S4 (different route)
  { tripId: 'T3', stopId: 'S3', arrivalTime: 22500, departureTime: 22500, stopSequence: 1 },  // 06:15
  { tripId: 'T3', stopId: 'S4', arrivalTime: 23400, departureTime: 23400, stopSequence: 2 },  // 06:30
  // Trip T4: S3 -> S2 -> S1 (reverse, weekend)
  { tripId: 'T4', stopId: 'S3', arrivalTime: 36000, departureTime: 36000, stopSequence: 1 },  // 10:00
  { tripId: 'T4', stopId: 'S2', arrivalTime: 36300, departureTime: 36300, stopSequence: 2 },  // 10:05
  { tripId: 'T4', stopId: 'S1', arrivalTime: 36600, departureTime: 36600, stopSequence: 3 },  // 10:10
];

// ─── Tests ──────────────────────────────────────────────────────────

describe('routingDataService', () => {
  describe('buildStopDeparturesIndex', () => {
    it('groups departures by stop and sorts by time', () => {
      const index = buildStopDeparturesIndex(STOP_TIMES, TRIPS);

      // S1 has departures from T1, T2, and T4 (reverse direction arrives at S1)
      expect(index['S1']).toHaveLength(3);
      expect(index['S1'][0].departureTime).toBe(21600); // T1 at 06:00
      expect(index['S1'][1].departureTime).toBe(25200); // T2 at 07:00
      expect(index['S1'][2].departureTime).toBe(36600); // T4 at 10:10
    });

    it('includes route and service info from trips', () => {
      const index = buildStopDeparturesIndex(STOP_TIMES, TRIPS);

      expect(index['S1'][0].routeId).toBe('R1');
      expect(index['S1'][0].serviceId).toBe('WKD');
      expect(index['S1'][0].headsign).toBe('North');
    });

    it('handles stops with multiple routes', () => {
      const index = buildStopDeparturesIndex(STOP_TIMES, TRIPS);

      // S3 has departures from T1, T2 (R1), T3 (R2), and T4 (R1 reverse)
      const s3Departures = index['S3'];
      const routeIds = new Set(s3Departures.map((d) => d.routeId));
      expect(routeIds.has('R1')).toBe(true);
      expect(routeIds.has('R2')).toBe(true);
    });
  });

  describe('buildRoutePatterns', () => {
    it('builds ordered stop lists per route-direction pattern', () => {
      const { routePatterns } = buildRoutePatterns(STOP_TIMES, TRIPS);

      expect(routePatterns['R1']['0']).toHaveLength(1);
      expect(routePatterns['R1']['0'][0].stopSequence).toEqual(['S1', 'S2', 'S3']);
      expect(routePatterns['R1']['1'][0].stopSequence).toEqual(['S3', 'S2', 'S1']);
      expect(routePatterns['R2']['0'][0].stopSequence).toEqual(['S3', 'S4']);
    });

    it('retains multiple patterns for the same route-direction', () => {
      const variantTrips: GtfsTrip[] = [
        { tripId: 'V1', routeId: 'R9', serviceId: 'WKD', directionId: 0, headsign: 'Branch A' },
        { tripId: 'V2', routeId: 'R9', serviceId: 'WKD', directionId: 0, headsign: 'Branch B' },
      ];
      const variantStopTimes: GtfsStopTime[] = [
        { tripId: 'V1', stopId: 'S1', arrivalTime: 21600, departureTime: 21600, stopSequence: 1 },
        { tripId: 'V1', stopId: 'S2', arrivalTime: 21900, departureTime: 21900, stopSequence: 2 },
        { tripId: 'V1', stopId: 'S3', arrivalTime: 22200, departureTime: 22200, stopSequence: 3 },
        { tripId: 'V2', stopId: 'S1', arrivalTime: 25200, departureTime: 25200, stopSequence: 1 },
        { tripId: 'V2', stopId: 'S4', arrivalTime: 25500, departureTime: 25500, stopSequence: 2 },
        { tripId: 'V2', stopId: 'S3', arrivalTime: 25800, departureTime: 25800, stopSequence: 3 },
      ];

      const { routePatterns, tripPatternIndex } = buildRoutePatterns(variantStopTimes, variantTrips);

      expect(routePatterns['R9']['0']).toHaveLength(2);
      expect(new Set(Object.values(tripPatternIndex))).toHaveLength(2);
    });
  });

  describe('buildTransferGraph', () => {
    it('links stops within 400m', () => {
      const transfers = buildTransferGraph(STOPS, 400);

      // S1 and S2 are ~150m apart — should be linked
      const s1Transfers = transfers['S1'];
      const toS2 = s1Transfers.find((t) => t.toStopId === 'S2');
      expect(toS2).toBeDefined();
      expect(toS2!.walkMeters).toBeLessThan(400);
    });

    it('does NOT link stops > 400m apart', () => {
      const transfers = buildTransferGraph(STOPS, 400);

      // S1 and S4 are ~4km apart — should NOT be linked
      const s1Transfers = transfers['S1'];
      const toS4 = s1Transfers.find((t) => t.toStopId === 'S4');
      expect(toS4).toBeUndefined();
    });

    it('sorts transfers by distance', () => {
      const transfers = buildTransferGraph(STOPS, 1000);

      const s1Transfers = transfers['S1'];
      for (let i = 1; i < s1Transfers.length; i++) {
        expect(s1Transfers[i].walkMeters).toBeGreaterThanOrEqual(s1Transfers[i - 1].walkMeters);
      }
    });

    it('includes walk seconds with buffer factor', () => {
      const transfers = buildTransferGraph(STOPS, 400);

      const s1Transfers = transfers['S1'];
      const toS2 = s1Transfers.find((t) => t.toStopId === 'S2');
      expect(toS2).toBeDefined();
      // walkSeconds should be > walkMeters / walkSpeed (because of buffer)
      expect(toS2!.walkSeconds).toBeGreaterThan(toS2!.walkMeters / 1.2);
    });
  });

  describe('buildStopTimesIndex', () => {
    it('creates compound key lookup', () => {
      const index = buildStopTimesIndex(STOP_TIMES);

      const st = index['T1_S2'];
      expect(st).toBeDefined();
      expect(st.arrivalTime).toBe(21900); // 06:05
      expect(st.departureTime).toBe(21900);
    });

    it('returns undefined for non-existent key', () => {
      const index = buildStopTimesIndex(STOP_TIMES);
      expect(index['T1_S4']).toBeUndefined();
    });
  });

  describe('buildStopRoutesIndex', () => {
    it('maps stops to their routes', () => {
      const departures = buildStopDeparturesIndex(STOP_TIMES, TRIPS);
      const stopRoutes = buildStopRoutesIndex(departures);

      expect(stopRoutes['S1'].has('R1')).toBe(true);
      expect(stopRoutes['S1'].has('R2')).toBe(false);
      expect(stopRoutes['S3'].has('R1')).toBe(true);
      expect(stopRoutes['S3'].has('R2')).toBe(true);
    });
  });

  describe('findNearbyStops', () => {
    it('finds stops within radius', () => {
      const nearby = findNearbyStops(STOPS, 44.3891, -79.6903, 200);

      // Should find S1 (0m) and S2 (~150m)
      expect(nearby.length).toBeGreaterThanOrEqual(2);
      expect(nearby[0].stop.stopId).toBe('S1');
      expect(nearby[0].walkMeters).toBe(0);
    });

    it('excludes stops beyond radius', () => {
      const nearby = findNearbyStops(STOPS, 44.3891, -79.6903, 200);

      const farStop = nearby.find((n) => n.stop.stopId === 'S4');
      expect(farStop).toBeUndefined();
    });

    it('sorts by distance', () => {
      const nearby = findNearbyStops(STOPS, 44.3891, -79.6903, 5000);

      for (let i = 1; i < nearby.length; i++) {
        expect(nearby[i].walkMeters).toBeGreaterThanOrEqual(nearby[i - 1].walkMeters);
      }
    });
  });

  describe('getDeparturesAfter', () => {
    const departures = buildStopDeparturesIndex(STOP_TIMES, TRIPS);
    const weekdayServices = new Set(['WKD']);
    const weekendServices = new Set(['WKE']);

    it('returns departures after specified time', () => {
      const results = getDeparturesAfter(departures, 'S1', 22000, weekdayServices);

      // T1 departs S1 at 21600 (before 22000), T2 departs at 25200 (after)
      expect(results).toHaveLength(1);
      expect(results[0].tripId).toBe('T2');
    });

    it('filters by active services', () => {
      // Weekend services — only T4 matches
      const results = getDeparturesAfter(departures, 'S3', 0, weekendServices);

      expect(results).toHaveLength(1);
      expect(results[0].tripId).toBe('T4');
    });

    it('respects limit', () => {
      const results = getDeparturesAfter(departures, 'S1', 0, weekdayServices, 1);
      expect(results).toHaveLength(1);
    });

    it('returns empty array for unknown stop', () => {
      const results = getDeparturesAfter(departures, 'UNKNOWN', 0, weekdayServices);
      expect(results).toHaveLength(0);
    });
  });

  describe('getNextDepartureForRoute', () => {
    const departures = buildStopDeparturesIndex(STOP_TIMES, TRIPS);
    const weekdayServices = new Set(['WKD']);

    it('finds next departure for specific route', () => {
      const dep = getNextDepartureForRoute(departures, 'S3', 'R2', 0, weekdayServices);
      expect(dep).not.toBeNull();
      expect(dep!.tripId).toBe('T3');
      expect(dep!.routeId).toBe('R2');
    });

    it('returns null when no matching route', () => {
      const dep = getNextDepartureForRoute(departures, 'S1', 'R2', 0, weekdayServices);
      expect(dep).toBeNull();
    });
  });

  describe('buildTripIndex + buildStopIndex', () => {
    it('indexes trips by tripId', () => {
      const index = buildTripIndex(TRIPS);
      expect(index['T1'].routeId).toBe('R1');
      expect(index['T3'].headsign).toBe('East');
    });

    it('indexes stops by stopId', () => {
      const index = buildStopIndex(STOPS);
      expect(index['S1'].stopName).toBe('Terminal');
      expect(index['S4'].lat).toBe(44.42);
    });
  });
});
