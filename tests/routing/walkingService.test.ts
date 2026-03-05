import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWalkingDirections, enrichItinerary, clearWalkingCache } from '../../utils/routing/walkingService';
import type { Itinerary, WalkLeg, TransitLeg } from '../../utils/routing/types';

const MAPBOX_SUCCESS_RESPONSE = {
  code: 'Ok',
  routes: [
    {
      geometry: 'encodedPolyline123',
      distance: 450,
      duration: 375,
      legs: [
        {
          distance: 450,
          duration: 375,
          steps: [
            {
              maneuver: {
                instruction: 'Head north on Main St',
                type: 'depart',
                modifier: undefined,
              },
              distance: 200,
              duration: 167,
              name: 'Main St',
            },
            {
              maneuver: {
                instruction: 'Turn right onto Oak Ave',
                type: 'turn',
                modifier: 'right',
              },
              distance: 250,
              duration: 208,
              name: 'Oak Ave',
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  clearWalkingCache();
  vi.restoreAllMocks();
  vi.stubEnv('VITE_MAPBOX_TOKEN', 'test-token');
});

describe('Walking Service', () => {
  describe('successful API response', () => {
    it('returns Mapbox directions with geometry and steps', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MAPBOX_SUCCESS_RESPONSE),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await getWalkingDirections(44.39, -79.70, 44.395, -79.695);

      expect(result.source).toBe('mapbox');
      expect(result.distance).toBe(450);
      expect(result.duration).toBe(375);
      expect(result.geometry).toBe('encodedPolyline123');
      expect(result.steps.length).toBe(2);
      expect(result.steps[0].instruction).toBe('Head north on Main St');
      expect(result.steps[1].modifier).toBe('right');

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toContain('mapbox.com/directions');
    });
  });

  describe('API failure → fallback estimate', () => {
    it('returns haversine estimate when fetch fails', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      const result = await getWalkingDirections(44.39, -79.70, 44.395, -79.695);

      expect(result.source).toBe('estimate');
      expect(result.distance).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.geometry).toBeNull();
      expect(result.steps).toEqual([]);
    });

    it('returns estimate when API returns non-Ok status', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 'NoRoute', routes: [] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await getWalkingDirections(44.39, -79.70, 44.395, -79.695);

      expect(result.source).toBe('estimate');
    });

    it('returns estimate when HTTP response is not ok', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await getWalkingDirections(44.39, -79.70, 44.395, -79.695);

      expect(result.source).toBe('estimate');
    });
  });

  describe('cache', () => {
    it('returns cached result without calling fetch again', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MAPBOX_SUCCESS_RESPONSE),
      });
      vi.stubGlobal('fetch', fetchMock);

      // First call — hits API
      const result1 = await getWalkingDirections(44.39, -79.70, 44.395, -79.695);
      expect(fetchMock).toHaveBeenCalledOnce();

      // Second call — same coords → cache hit
      const result2 = await getWalkingDirections(44.39, -79.70, 44.395, -79.695);
      expect(fetchMock).toHaveBeenCalledOnce(); // Still just 1 call

      expect(result1).toEqual(result2);
    });

    it('cache hit works for nearby coordinates (within rounding precision)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MAPBOX_SUCCESS_RESPONSE),
      });
      vi.stubGlobal('fetch', fetchMock);

      await getWalkingDirections(44.3901, -79.7001, 44.3951, -79.6951);
      await getWalkingDirections(44.3904, -79.7004, 44.3954, -79.6954);

      // Both round to same key → only 1 fetch
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe('enrichItinerary', () => {
    it('enriches walk legs with Mapbox directions', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MAPBOX_SUCCESS_RESPONSE),
      });
      vi.stubGlobal('fetch', fetchMock);

      const walkLeg: WalkLeg = {
        mode: 'WALK',
        startTime: 1000000,
        endTime: 1300000,
        duration: 300,
        distance: 400,
        from: { name: 'Origin', lat: 44.39, lon: -79.70 },
        to: { name: 'Stop A', stopId: 'A', lat: 44.395, lon: -79.695 },
        route: null,
        headsign: null,
        tripId: null,
        intermediateStops: null,
        legGeometry: null,
      };

      const transitLeg: TransitLeg = {
        mode: 'BUS',
        startTime: 1300000,
        endTime: 1900000,
        duration: 600,
        distance: 2000,
        from: { name: 'Stop A', stopId: 'A', lat: 44.395, lon: -79.695 },
        to: { name: 'Stop B', stopId: 'B', lat: 44.40, lon: -79.68 },
        route: { id: 'R1', shortName: '1', longName: 'Route 1', color: '0000FF' },
        headsign: 'Downtown',
        tripId: 'T1',
        intermediateStops: [],
        legGeometry: null,
      };

      const itinerary: Itinerary = {
        id: 'test-1',
        duration: 900,
        startTime: 1000000,
        endTime: 1900000,
        walkTime: 300,
        transitTime: 600,
        waitingTime: 0,
        walkDistance: 400,
        transfers: 0,
        legs: [walkLeg, transitLeg],
      };

      const enriched = await enrichItinerary(itinerary);

      // Walk leg should be enriched
      expect(enriched.legs[0].mode).toBe('WALK');
      const enrichedWalk = enriched.legs[0] as WalkLeg;
      expect(enrichedWalk.distance).toBe(450); // From Mapbox
      expect(enrichedWalk.duration).toBe(375);
      expect(enrichedWalk.legGeometry?.points).toBe('encodedPolyline123');

      // Transit leg unchanged
      expect(enriched.legs[1]).toEqual(transitLeg);

      // Totals recalculated
      expect(enriched.walkDistance).toBe(450);
      expect(enriched.walkTime).toBe(375);
    });
  });
});
