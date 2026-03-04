// Geometry Utilities — routing-relevant subset
// Ported from BTTP src/utils/geometryUtils.js

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Calculate the Haversine distance between two coordinates in meters */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/** Null-safe haversine distance — returns Infinity for null inputs */
export function safeHaversineDistance(
  lat1: number | null | undefined,
  lon1: number | null | undefined,
  lat2: number | null | undefined,
  lon2: number | null | undefined
): number {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  return haversineDistance(lat1, lon1, lat2, lon2);
}

/**
 * Ray-casting point-in-ring test for a single ring.
 * Ring is an array of [lng, lat] pairs (GeoJSON coordinate order).
 */
export function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1]; // lat
    const yi = ring[i][0]; // lng
    const xj = ring[j][1]; // lat
    const yj = ring[j][0]; // lng

    const intersect =
      yi > lon !== yj > lon &&
      lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon test supporting GeoJSON polygons with holes.
 * Coordinates use GeoJSON order: [lng, lat].
 * The first ring is the outer boundary; subsequent rings are holes.
 */
export function pointInPolygon(lat: number, lon: number, coordinates: [number, number][][]): boolean {
  if (!coordinates || coordinates.length === 0) return false;

  // Must be inside the outer ring
  if (!pointInRing(lat, lon, coordinates[0])) return false;

  // Must NOT be inside any hole
  for (let i = 1; i < coordinates.length; i++) {
    if (pointInRing(lat, lon, coordinates[i])) return false;
  }

  return true;
}
