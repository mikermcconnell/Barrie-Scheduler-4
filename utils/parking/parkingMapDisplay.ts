import type { ParkingRevenueLocationSummary } from './parkingTypes';
import type { PublicParkingLocationMatch } from './publicParkingLocations';

export type ParkingMapMetric = 'revenue' | 'sessions' | 'averageStay' | 'revenuePerSpace';

export interface ParkingMapCapacityInfo {
  spaces: number | null;
  sourceLabel?: string;
}

export interface ParkingRevenueMapDisplayLocation {
  key: string;
  displayName: string;
  latitude: number;
  longitude: number;
  coordinateSource: 'reviewed' | 'public' | 'mixed';
  sourceLocationKeys: string[];
  sourceIds: ParkingRevenueLocationSummary['sourceIds'];
  rowCount: number;
  totalRevenue: number;
  totalPaid: number;
  averageStayMinutes: number;
  uniquePlateCount: number;
  hotspotRevenue: number;
  qrRevenue: number;
  peakHour: number | null;
  peakDay: string;
  publicMatch: PublicParkingLocationMatch | null;
  aggregateCount: number;
  capacitySpaces: number | null;
  primaryLocation: ParkingRevenueLocationSummary;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return 0;
  return Math.round(values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight);
}

function mergeSourceIds(locations: ParkingRevenueLocationSummary[]): ParkingRevenueLocationSummary['sourceIds'] {
  const refs = new Map<string, ParkingRevenueLocationSummary['sourceIds'][number]>();
  for (const location of locations) {
    for (const ref of location.sourceIds) {
      refs.set(`${ref.source}:${ref.sourceId}`, ref);
    }
  }
  return [...refs.values()];
}

function peakByRevenue(locations: ParkingRevenueLocationSummary[]): ParkingRevenueLocationSummary {
  return locations.slice().sort((a, b) => b.totalRevenue - a.totalRevenue || b.rowCount - a.rowCount || a.displayName.localeCompare(b.displayName))[0];
}

function combineLocations(
  key: string,
  locations: ParkingRevenueLocationSummary[],
  latitude: number,
  longitude: number,
  coordinateSource: ParkingRevenueMapDisplayLocation['coordinateSource'],
  publicMatch: PublicParkingLocationMatch | null,
  capacitySpaces: number | null,
): ParkingRevenueMapDisplayLocation {
  const primaryLocation = peakByRevenue(locations);
  const rowCount = locations.reduce((sum, location) => sum + location.rowCount, 0);
  const displayName = publicMatch
    ? publicMatch.location.commonName || publicMatch.location.name || primaryLocation.displayName
    : primaryLocation.displayName;
  const aggregateSuffix = locations.length > 1 ? ` (${locations.length} IDs)` : '';

  return {
    key,
    displayName: `${displayName}${aggregateSuffix}`,
    latitude,
    longitude,
    coordinateSource,
    sourceLocationKeys: locations.map(location => location.key),
    sourceIds: mergeSourceIds(locations),
    rowCount,
    totalRevenue: roundMoney(locations.reduce((sum, location) => sum + location.totalRevenue, 0)),
    totalPaid: roundMoney(locations.reduce((sum, location) => sum + location.totalPaid, 0)),
    averageStayMinutes: weightedAverage(locations.map(location => ({ value: location.averageStayMinutes, weight: Math.max(location.rowCount, 1) }))),
    uniquePlateCount: locations.reduce((sum, location) => sum + location.uniquePlateCount, 0),
    hotspotRevenue: roundMoney(locations.reduce((sum, location) => sum + location.hotspotRevenue, 0)),
    qrRevenue: roundMoney(locations.reduce((sum, location) => sum + location.qrRevenue, 0)),
    peakHour: primaryLocation.peakHour,
    peakDay: primaryLocation.peakDay,
    publicMatch,
    aggregateCount: locations.length,
    capacitySpaces,
    primaryLocation,
  };
}

export function buildParkingRevenueMapDisplayLocations(
  locationSummaries: ParkingRevenueLocationSummary[],
  publicMatchesByKey: Map<string, PublicParkingLocationMatch>,
  capacityByLocationKey: Record<string, ParkingMapCapacityInfo> = {},
): ParkingRevenueMapDisplayLocation[] {
  const displayLocations: ParkingRevenueMapDisplayLocation[] = [];
  const fallbackGroups = new Map<string, {
    publicMatch: PublicParkingLocationMatch;
    locations: ParkingRevenueLocationSummary[];
  }>();

  for (const location of locationSummaries) {
    if (location.isMapped && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
      displayLocations.push(combineLocations(
        location.key,
        [location],
        location.latitude,
        location.longitude,
        'reviewed',
        null,
        capacityByLocationKey[location.key]?.spaces ?? null,
      ));
      continue;
    }

    const publicMatch = publicMatchesByKey.get(location.key);
    if (!publicMatch) continue;
    const fallbackKey = `public:${publicMatch.location.id}`;
    const current = fallbackGroups.get(fallbackKey) || { publicMatch, locations: [] };
    current.locations.push(location);
    fallbackGroups.set(fallbackKey, current);
  }

  for (const [key, group] of fallbackGroups.entries()) {
    const capacitySpaces = group.publicMatch.location.numSpaces
      ?? group.locations.map(location => capacityByLocationKey[location.key]?.spaces).find((spaces): spaces is number => typeof spaces === 'number')
      ?? null;
    displayLocations.push(combineLocations(
      key,
      group.locations,
      group.publicMatch.location.latitude,
      group.publicMatch.location.longitude,
      'public',
      group.publicMatch,
      capacitySpaces,
    ));
  }

  return displayLocations.sort((a, b) => b.totalRevenue - a.totalRevenue || b.rowCount - a.rowCount || a.displayName.localeCompare(b.displayName));
}

export function getParkingMapMetricValue(location: ParkingRevenueMapDisplayLocation, metric: ParkingMapMetric): number {
  if (metric === 'sessions') return location.rowCount;
  if (metric === 'averageStay') return location.averageStayMinutes;
  if (metric === 'revenuePerSpace') {
    return location.capacitySpaces ? location.totalRevenue / location.capacitySpaces : 0;
  }
  return location.totalRevenue;
}

export function getParkingMapMetricLabel(metric: ParkingMapMetric): string {
  if (metric === 'sessions') return 'Sessions';
  if (metric === 'averageStay') return 'Average stay';
  if (metric === 'revenuePerSpace') return 'Revenue/space';
  return 'Revenue';
}
