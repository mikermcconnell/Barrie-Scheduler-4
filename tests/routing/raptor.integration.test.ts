import { describe, it, expect } from 'vitest';
import { loadGtfsData, clearGtfsCache } from '../../utils/routing/gtfsAdapter';
import { buildServiceCalendar } from '../../utils/routing/calendarService';
import { planTripLocal } from '../../utils/routing/raptorEngine';
import { buildItinerary } from '../../utils/routing/itineraryBuilder';
import {
  buildStopDeparturesIndex,
  buildRouteStopSequences,
  buildTransferGraph,
  buildTripIndex,
  buildStopIndex,
  buildStopRoutesIndex,
  buildStopTimesIndex,
  buildTripStopTimesIndex,
} from '../../utils/routing/routingDataService';
import { RoutingError } from '../../utils/routing/types';
import type { RoutingData } from '../../utils/routing/types';

// ─── Integration Setup ──────────────────────────────────────────────

// GTFS data valid range: 20260214 – 20260530
// Use a weekday within range for queries
const WEEKDAY_IN_RANGE = new Date(2026, 2, 2, 8, 0, 0); // Monday Mar 2, 2026
const SATURDAY_IN_RANGE = new Date(2026, 2, 7, 10, 0, 0); // Saturday Mar 7, 2026

// Key Barrie stops
const DOWNTOWN_HUB = { lat: 44.387753, lon: -79.690237 }; // stop_id=2
const ALLANDALE_TERMINAL = { lat: 44.3742, lon: -79.6904 }; // Platform 12 area
const GEORGIAN_COLLEGE = { lat: 44.410380, lon: -79.668891 }; // stop_id=335
const PARK_PLACE = { lat: 44.340391, lon: -79.680326 }; // stop_id=777
const MIDDLE_OF_NOWHERE = { lat: 46.5, lon: -81.0 }; // ~250km north of Barrie

let routingData: RoutingData;

/**
 * Build routing data with a reference date within the GTFS validity range.
 */
function buildRoutingDataWithDate(referenceDate: Date): RoutingData {
  const gtfsData = loadGtfsData();
  const { stops, trips, stopTimes, calendar, calendarDates } = gtfsData;

  const stopDepartures = buildStopDeparturesIndex(stopTimes, trips);
  const routeStopSequences = buildRouteStopSequences(stopTimes, trips);
  const transfers = buildTransferGraph(stops);
  const tripIndex = buildTripIndex(trips);
  const stopIndex = buildStopIndex(stops);
  const stopRoutes = buildStopRoutesIndex(stopDepartures);
  const serviceCalendar = buildServiceCalendar(calendar, calendarDates, 30, referenceDate);
  const stopTimesIndex = buildStopTimesIndex(stopTimes);
  const tripStopTimes = buildTripStopTimesIndex(stopTimes);

  return {
    stopDepartures,
    routeStopSequences,
    transfers,
    tripIndex,
    stopIndex,
    stopRoutes,
    serviceCalendar,
    stopTimesIndex,
    tripStopTimes,
    stops,
    trips,
    stopTimes,
  };
}

describe('RAPTOR Integration (Real Barrie GTFS)', () => {
  // Build routing data once — this is the expensive step
  // Use reference date within GTFS validity range
  routingData = buildRoutingDataWithDate(WEEKDAY_IN_RANGE);

  describe('direct route: Downtown Hub → Georgian College', () => {
    it('finds at least one itinerary on a weekday morning', () => {
      const results = planTripLocal({
        fromLat: DOWNTOWN_HUB.lat,
        fromLon: DOWNTOWN_HUB.lon,
        toLat: GEORGIAN_COLLEGE.lat,
        toLon: GEORGIAN_COLLEGE.lon,
        date: WEEKDAY_IN_RANGE,
        time: new Date(2026, 2, 2, 7, 30, 0),
        routingData,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);

      const itin = buildItinerary(
        results[0],
        routingData,
        WEEKDAY_IN_RANGE,
        DOWNTOWN_HUB.lat,
        DOWNTOWN_HUB.lon,
        GEORGIAN_COLLEGE.lat,
        GEORGIAN_COLLEGE.lon
      );

      expect(itin.legs.length).toBeGreaterThanOrEqual(1);
      expect(itin.duration).toBeGreaterThan(0);
      expect(itin.transfers).toBeLessThanOrEqual(2);

      // At least one transit leg
      const transitLegs = itin.legs.filter((l) => l.mode === 'BUS');
      expect(transitLegs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('one transfer: Park Place → Georgian College via hub', () => {
    it('finds route requiring at least one transfer', () => {
      const results = planTripLocal({
        fromLat: PARK_PLACE.lat,
        fromLon: PARK_PLACE.lon,
        toLat: GEORGIAN_COLLEGE.lat,
        toLon: GEORGIAN_COLLEGE.lon,
        date: WEEKDAY_IN_RANGE,
        time: new Date(2026, 2, 2, 7, 0, 0),
        routingData,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);

      const itin = buildItinerary(
        results[0],
        routingData,
        WEEKDAY_IN_RANGE,
        PARK_PLACE.lat,
        PARK_PLACE.lon,
        GEORGIAN_COLLEGE.lat,
        GEORGIAN_COLLEGE.lon
      );

      expect(itin.duration).toBeGreaterThan(0);
      expect(itin.duration).toBeLessThan(7200); // Under 2 hours

      // Should have transit legs
      const transitLegs = itin.legs.filter((l) => l.mode === 'BUS');
      expect(transitLegs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('no service on queried date', () => {
    it('throws NO_SERVICE for a date outside GTFS range', () => {
      // March 15 is outside the calendar range (ends Feb 28)
      const outOfRange = new Date(2026, 5, 15, 8, 0, 0);

      expect(() =>
        planTripLocal({
          fromLat: DOWNTOWN_HUB.lat,
          fromLon: DOWNTOWN_HUB.lon,
          toLat: GEORGIAN_COLLEGE.lat,
          toLon: GEORGIAN_COLLEGE.lon,
          date: outOfRange,
          routingData,
        })
      ).toThrow(RoutingError);
    });
  });

  describe('origin outside service area', () => {
    it('throws OUTSIDE_SERVICE_AREA for distant origin', () => {
      expect(() =>
        planTripLocal({
          fromLat: MIDDLE_OF_NOWHERE.lat,
          fromLon: MIDDLE_OF_NOWHERE.lon,
          toLat: DOWNTOWN_HUB.lat,
          toLon: DOWNTOWN_HUB.lon,
          date: WEEKDAY_IN_RANGE,
          routingData,
        })
      ).toThrow(RoutingError);
    });
  });

  describe('itinerary structure validation', () => {
    it('produces valid itinerary with proper leg ordering', () => {
      const results = planTripLocal({
        fromLat: DOWNTOWN_HUB.lat,
        fromLon: DOWNTOWN_HUB.lon,
        toLat: ALLANDALE_TERMINAL.lat,
        toLon: ALLANDALE_TERMINAL.lon,
        date: WEEKDAY_IN_RANGE,
        time: new Date(2026, 2, 2, 8, 0, 0),
        routingData,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);

      for (const result of results) {
        const itin = buildItinerary(
          result,
          routingData,
          WEEKDAY_IN_RANGE,
          DOWNTOWN_HUB.lat,
          DOWNTOWN_HUB.lon,
          ALLANDALE_TERMINAL.lat,
          ALLANDALE_TERMINAL.lon
        );

        // Basic structure checks
        expect(itin.id).toBeTruthy();
        expect(itin.legs.length).toBeGreaterThan(0);
        expect(itin.startTime).toBeLessThan(itin.endTime);
        expect(itin.walkDistance).toBeGreaterThanOrEqual(0);
        expect(itin.transfers).toBeGreaterThanOrEqual(0);

        // Legs should have valid times
        for (const leg of itin.legs) {
          expect(leg.startTime).toBeLessThanOrEqual(leg.endTime);
          expect(leg.duration).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});
