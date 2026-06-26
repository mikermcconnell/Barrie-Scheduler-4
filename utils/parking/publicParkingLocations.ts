import type { ParkingRevenueLocationSummary } from './parkingTypes';

export const BARRIE_PUBLIC_PARKING_VIEWER_URL = 'https://experience.arcgis.com/experience/353a60ed9f3748c0a4858d7413a108a1';
export const BARRIE_PUBLIC_PARKING_ARCGIS_LAYER_URL = 'https://gispublic.barrie.ca/arcgis/rest/services/Public/Proposed_Parking_WA_Dynamic/MapServer/0';

export interface PublicParkingLocation {
  id: string;
  objectIds: number[];
  hotspotId: string;
  parkingId: string;
  name: string;
  commonName: string;
  address: string;
  latitude: number;
  longitude: number;
  numSpaces: number | null;
  type: string;
  classification: string;
  sourceUrl: string;
}

export interface PublicParkingLocationMatch {
  location: PublicParkingLocation;
  matchType: 'hotspot-id' | 'name';
  confidence: 'high' | 'medium';
}

interface ArcGisParkingFeature {
  attributes?: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
  };
}

interface ArcGisParkingResponse {
  features?: ArcGisParkingFeature[];
  error?: {
    message?: string;
  };
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim().replace(/\.0$/, '').toUpperCase();
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(parking|lot|p d|pay|display|street|st)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function polygonCenter(rings: number[][][] | undefined): { latitude: number; longitude: number } | null {
  const points = (rings || []).flat().filter(point => (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  ));
  if (points.length === 0) return null;
  const longitude = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const latitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return { latitude, longitude };
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPublicLocation(feature: ArcGisParkingFeature): PublicParkingLocation | null {
  const attributes = feature.attributes || {};
  const center = polygonCenter(feature.geometry?.rings);
  if (!center) return null;
  const objectId = asNumber(attributes.OBJECTID);
  const hotspotId = normalizeId(attributes.HOTSPOT_ID);
  const parkingId = normalizeId(attributes.PARKINGID);
  const commonName = String(attributes.CARTONAME || '').trim();
  const name = String(attributes.PARKING_NAME || commonName || '').trim();
  const address = String(attributes.ADDRESS || '').trim();
  const id = hotspotId ? `hotspot-${hotspotId}` : `public-${objectId ?? `${center.latitude},${center.longitude}`}`;
  return {
    id,
    objectIds: objectId == null ? [] : [objectId],
    hotspotId,
    parkingId,
    name,
    commonName,
    address,
    latitude: center.latitude,
    longitude: center.longitude,
    numSpaces: asNumber(attributes.NUMSPACES),
    type: String(attributes.TYPE || '').trim(),
    classification: String(attributes.CLASSIFICATION || '').trim(),
    sourceUrl: BARRIE_PUBLIC_PARKING_VIEWER_URL,
  };
}

function mergePublicLocations(locations: PublicParkingLocation[]): PublicParkingLocation[] {
  const grouped = new Map<string, PublicParkingLocation[]>();
  for (const location of locations) {
    const key = location.hotspotId ? `hotspot-${location.hotspotId}` : location.id;
    grouped.set(key, [...(grouped.get(key) || []), location]);
  }

  return [...grouped.entries()].map(([id, group]) => {
    const firstNamed = group.find(location => location.commonName || location.name) || group[0];
    const totalWeight = group.reduce((sum, location) => sum + (location.numSpaces || 1), 0) || group.length;
    const weightedLatitude = group.reduce((sum, location) => sum + location.latitude * (location.numSpaces || 1), 0) / totalWeight;
    const weightedLongitude = group.reduce((sum, location) => sum + location.longitude * (location.numSpaces || 1), 0) / totalWeight;
    const totalSpaces = group.some(location => location.numSpaces != null)
      ? group.reduce((sum, location) => sum + (location.numSpaces || 0), 0)
      : null;
    return {
      ...firstNamed,
      id,
      objectIds: group.flatMap(location => location.objectIds),
      latitude: weightedLatitude,
      longitude: weightedLongitude,
      numSpaces: totalSpaces,
    };
  }).sort((a, b) => (a.commonName || a.name).localeCompare(b.commonName || b.name));
}

export async function fetchBarriePublicParkingLocations(fetchImpl: typeof fetch = fetch): Promise<PublicParkingLocation[]> {
  const params = new URLSearchParams({
    f: 'json',
    where: 'HOTSPOT_ID IS NOT NULL OR PARKING_NAME IS NOT NULL',
    outFields: 'OBJECTID,PARKINGID,PARKING_NAME,ADDRESS,HOTSPOT_ID,NUMSPACES,TYPE,CLASSIFICATION,CARTONAME,LABEL',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '2000',
  });
  const response = await fetchImpl(`${BARRIE_PUBLIC_PARKING_ARCGIS_LAYER_URL}/query?${params.toString()}`);
  if (!response.ok) throw new Error(`City parking source returned ${response.status}.`);
  const data = await response.json() as ArcGisParkingResponse;
  if (data.error?.message) throw new Error(data.error.message);
  return mergePublicLocations((data.features || []).map(buildPublicLocation).filter(Boolean) as PublicParkingLocation[]);
}

export function findPublicParkingLocationFallback(
  location: ParkingRevenueLocationSummary,
  publicLocations: PublicParkingLocation[],
): PublicParkingLocationMatch | null {
  const sourceIds = new Set(location.sourceIds.map(ref => normalizeId(ref.sourceId)).filter(Boolean));
  const hotspotMatch = publicLocations.find(publicLocation => publicLocation.hotspotId && sourceIds.has(publicLocation.hotspotId));
  if (hotspotMatch) {
    return { location: hotspotMatch, matchType: 'hotspot-id', confidence: 'high' };
  }

  const locationNames = [
    location.displayName,
    ...location.sourceIds.map(ref => ref.label || ''),
  ].map(normalizeName).filter(Boolean);

  const nameMatch = publicLocations.find(publicLocation => {
    const publicNames = [publicLocation.commonName, publicLocation.name, publicLocation.address].map(normalizeName).filter(Boolean);
    return publicNames.some(publicName => locationNames.some(name => publicName === name || publicName.includes(name) || name.includes(publicName)));
  });
  return nameMatch ? { location: nameMatch, matchType: 'name', confidence: 'medium' } : null;
}
