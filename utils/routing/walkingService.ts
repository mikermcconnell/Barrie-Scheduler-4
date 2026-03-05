// Walking Service — Mapbox Directions API for street-level walking paths
// Fallback to haversine × buffer estimate when API unavailable

import { ROUTING_CONFIG } from './constants';
import { haversineDistance } from './geometryUtils';
import type { WalkingDirections, WalkStep, Itinerary, Leg, WalkLeg } from './types';

// ─── Cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  directions: WalkingDirections;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const COORD_PRECISION = 3; // ~110m grid for cache keys

const cache = new Map<string, CacheEntry>();

function roundCoord(val: number): number {
  return Math.round(val * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
}

function cacheKey(fromLat: number, fromLon: number, toLat: number, toLon: number): string {
  return `${roundCoord(fromLat)},${roundCoord(fromLon)}_${roundCoord(toLat)},${roundCoord(toLon)}`;
}

function getCached(key: string): WalkingDirections | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.directions;
}

function setCache(key: string, directions: WalkingDirections): void {
  cache.set(key, { directions, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Clear all cached walking directions (useful for testing) */
export function clearWalkingCache(): void {
  cache.clear();
}

// ─── Fallback Estimate ───────────────────────────────────────────────

function estimateWalking(fromLat: number, fromLon: number, toLat: number, toLon: number): WalkingDirections {
  const straightLine = haversineDistance(fromLat, fromLon, toLat, toLon);
  const distance = straightLine * ROUTING_CONFIG.WALK_DISTANCE_BUFFER;
  const duration = Math.round(distance / ROUTING_CONFIG.WALK_SPEED);

  return {
    distance: Math.round(distance),
    duration,
    geometry: null,
    steps: [],
    source: 'estimate',
  };
}

// ─── Mapbox API ──────────────────────────────────────────────────────

function getMapboxToken(): string | null {
  return import.meta.env?.VITE_MAPBOX_TOKEN ?? null;
}

interface MapboxLeg {
  distance: number;
  duration: number;
  steps: MapboxStep[];
}

interface MapboxStep {
  maneuver: {
    instruction: string;
    type: string;
    modifier?: string;
  };
  distance: number;
  duration: number;
  name: string;
}

interface MapboxRoute {
  geometry: string;
  legs: MapboxLeg[];
  distance: number;
  duration: number;
}

interface MapboxResponse {
  code: string;
  routes: MapboxRoute[];
}

/**
 * Get walking directions between two points.
 * Uses Mapbox Directions API with haversine fallback.
 */
export async function getWalkingDirections(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<WalkingDirections> {
  const key = cacheKey(fromLat, fromLon, toLat, toLon);
  const cached = getCached(key);
  if (cached) return cached;

  const token = getMapboxToken();
  if (!token) {
    const est = estimateWalking(fromLat, fromLon, toLat, toLon);
    setCache(key, est);
    return est;
  }

  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${fromLon},${fromLat};${toLon},${toLat}?geometries=polyline&steps=true&access_token=${token}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Mapbox API returned ${response.status}`);
    }

    const data: MapboxResponse = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error(`Mapbox returned code: ${data.code}`);
    }

    const route = data.routes[0];
    const steps: WalkStep[] = [];

    for (const leg of route.legs) {
      for (const step of leg.steps) {
        steps.push({
          instruction: step.maneuver.instruction,
          distance: step.distance,
          duration: step.duration,
          type: step.maneuver.type,
          modifier: step.maneuver.modifier ?? null,
          name: step.name,
        });
      }
    }

    const directions: WalkingDirections = {
      distance: Math.round(route.distance),
      duration: Math.round(route.duration),
      geometry: route.geometry,
      steps,
      source: 'mapbox',
    };

    setCache(key, directions);
    return directions;
  } catch {
    const est = estimateWalking(fromLat, fromLon, toLat, toLon);
    setCache(key, est);
    return est;
  }
}

/**
 * Enrich an itinerary's walk legs with real walking directions.
 * Replaces estimate-based distances/durations with Mapbox data.
 */
export async function enrichItinerary(itinerary: Itinerary): Promise<Itinerary> {
  const enrichedLegs: Leg[] = [];

  for (const leg of itinerary.legs) {
    if (leg.mode === 'WALK' && leg.from.lat && leg.to.lat) {
      const directions = await getWalkingDirections(
        leg.from.lat,
        leg.from.lon,
        leg.to.lat,
        leg.to.lon
      );

      const enrichedLeg: WalkLeg = {
        ...leg,
        distance: directions.distance,
        duration: directions.duration,
        endTime: leg.startTime + directions.duration * 1000,
        legGeometry: directions.geometry
          ? { points: directions.geometry, length: directions.distance }
          : null,
      };
      enrichedLegs.push(enrichedLeg);
    } else {
      enrichedLegs.push(leg);
    }
  }

  // Recalculate totals
  let walkTime = 0;
  let walkDistance = 0;
  let transitTime = 0;

  for (const leg of enrichedLegs) {
    if (leg.mode === 'WALK') {
      walkTime += leg.duration;
      walkDistance += leg.distance;
    } else {
      transitTime += leg.duration;
    }
  }

  const startTime = enrichedLegs[0]?.startTime ?? itinerary.startTime;
  const endTime = enrichedLegs[enrichedLegs.length - 1]?.endTime ?? itinerary.endTime;
  const duration = Math.round((endTime - startTime) / 1000);
  const waitingTime = Math.max(0, duration - walkTime - transitTime);

  return {
    ...itinerary,
    legs: enrichedLegs,
    walkTime,
    walkDistance: Math.round(walkDistance),
    transitTime,
    waitingTime,
    duration,
    startTime,
    endTime,
  };
}
