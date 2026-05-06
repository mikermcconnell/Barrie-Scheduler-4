import {
  getStatsForPeriod,
  scopeStatsToRoute,
  type CorridorSpeedIndex,
  type CorridorSpeedSegment,
  type CorridorSpeedStats,
} from '../gtfs/corridorSpeed';
import type { DayType, TimePeriod } from '../gtfs/corridorHeadway';
import { getAllStopsWithCoords, type GtfsStopWithCoords } from '../gtfs/gtfsStopLookup';
import {
  buildRoutePlanner2StopSegmentPaths,
  buildRoutePlanner2StopVisitSequence,
} from './routePlanner2Segments';
import {
  matchRoutePlanner2StopToGtfsCorridorStops,
  matchRoutePlanner2StopToGtfsStop,
  type RoutePlanner2GtfsStopMatch,
  type RoutePlanner2StopMatchQuality,
} from './routePlanner2StopMatching';
import type {
  RoutePlanner2RuntimeEvidenceMethod,
  RoutePlanner2RuntimeSource,
  RoutePlanner2Scenario,
  RoutePlanner2SegmentConfidence,
  RoutePlanner2SegmentRuntime,
  RoutePlanner2SegmentRuntimeRouteBreakdown,
} from './routePlanner2Types';

const OBSERVED_HIGH_SAMPLE_COUNT = 8;
const OBSERVED_BLEND_SAMPLE_COUNT = 3;

export interface RoutePlanner2RuntimeEvidenceInput {
  scheduledRuntimeMin: number | null;
  observedRuntimeMin: number | null;
  sampleCount: number;
  lowConfidence: boolean;
}

export interface RoutePlanner2RuntimeEvidenceOptions {
  gtfsStops?: readonly GtfsStopWithCoords[];
  now?: string;
  runtimeBasis?: 'best-available' | 'scheduled';
  onDiagnostic?: (diagnostic: RoutePlanner2RuntimeEvidenceDiagnostic) => void;
}

export type RoutePlanner2RuntimeEvidenceMissReason =
  | 'matched'
  | 'from-stop-unmatched'
  | 'to-stop-unmatched'
  | 'no-speed-segment-for-stop-pair'
  | 'no-gtfs-corridor-path'
  | 'no-stats-for-selected-day-period'
  | 'route-not-found-for-segment'
  | 'scheduled-runtime-missing';

export interface RoutePlanner2RuntimeEvidenceSegmentDiagnostic {
  segmentId: string;
  fromStopId: string;
  fromStopName?: string;
  toStopId: string;
  toStopName?: string;
  reason: RoutePlanner2RuntimeEvidenceMissReason;
  fromGtfsMatch?: RoutePlanner2GtfsStopMatch;
  toGtfsMatch?: RoutePlanner2GtfsStopMatch;
  matchedSpeedSegmentId?: string;
  matchedSegmentRoutes?: string[];
  statRoutes?: string[];
  scheduledRuntimeMin?: number | null;
  routeScopedScheduledRuntimeMin?: number | null;
  runtimeMinutes?: number;
  source?: RoutePlanner2RuntimeSource;
  evidenceMethod?: RoutePlanner2RuntimeEvidenceMethod;
  matchedGtfsPathStopIds?: string[];
}

export interface RoutePlanner2RuntimeEvidenceDiagnostic {
  scenarioId: string;
  scenarioName: string;
  preferredRoute: string | null;
  dayType: DayType;
  period: TimePeriod;
  runtimeBasis: 'best-available' | 'scheduled';
  gtfsStopCount: number;
  speedSegmentCount: number;
  statsForSelectedPeriodCount: number;
  segmentCount: number;
  estimateCount: number;
  segments: RoutePlanner2RuntimeEvidenceSegmentDiagnostic[];
}

type RoutePlanner2ResolvedEvidence = {
  runtimeMinutes: number;
  source: Extract<RoutePlanner2RuntimeSource, 'observed-proxy' | 'observed-scheduled-blend' | 'scheduled-proxy'>;
  confidence: RoutePlanner2SegmentConfidence;
};

type RoutePlanner2RuntimeRouteSelection =
  | { mode: 'all' }
  | { mode: 'specific'; routes: string[] };

interface CorridorPathEdge {
  route: string;
  fromStopId: string;
  toStopId: string;
  segmentId: string;
  scheduledRuntimeMin: number;
}

interface CorridorPathCandidate {
  route: string;
  scheduledRuntimeMin: number;
  segmentIds: string[];
  stopIds: string[];
  geometry: [number, number][];
  lengthMeters: number;
}

interface CorridorPathQuality {
  lengthRatio: number;
  maxDistanceMeters: number;
}

interface ShapeOverlapCandidate {
  route: string;
  coveredMeters: number;
  scheduledRuntimeMinutes: number;
  segmentIds: string[];
  stopIds: string[];
  sampleSize: number;
}

const MAX_CORRIDOR_PATH_LENGTH_RATIO = 2.25;
const MAX_CORRIDOR_PATH_EXTRA_METERS = 1200;
const MAX_CORRIDOR_PATH_DISTANCE_METERS = 750;
const SHAPE_OVERLAP_MAX_DISTANCE_METERS = 150;
const SHAPE_OVERLAP_SAMPLE_METERS = 100;
const SHAPE_OVERLAP_MIN_COVERAGE_RATIO = 0.35;
const SHAPE_OVERLAP_MIN_COVERED_METERS = 250;
const PARTIAL_SOURCE_MAX_COVERAGE_RATIO = 0.9;
const PARTIAL_SOURCE_MIN_UNCOVERED_METERS = 250;
const FALLBACK_UNCOVERED_SPEED_KMH = 22;

export function resolveRoutePlanner2RuntimeEvidenceSegment(
  input: RoutePlanner2RuntimeEvidenceInput,
): RoutePlanner2ResolvedEvidence | null {
  const {
    scheduledRuntimeMin,
    observedRuntimeMin,
    sampleCount,
    lowConfidence,
  } = input;

  if (observedRuntimeMin != null && sampleCount >= OBSERVED_HIGH_SAMPLE_COUNT && !lowConfidence) {
    return {
      runtimeMinutes: Math.round(observedRuntimeMin),
      source: 'observed-proxy',
      confidence: 'high',
    };
  }

  if (scheduledRuntimeMin != null && observedRuntimeMin != null && sampleCount >= OBSERVED_BLEND_SAMPLE_COUNT) {
    return {
      runtimeMinutes: Math.round((scheduledRuntimeMin * 0.65) + (observedRuntimeMin * 0.35)),
      source: 'observed-scheduled-blend',
      confidence: 'medium',
    };
  }

  if (scheduledRuntimeMin != null) {
    return {
      runtimeMinutes: Math.round(scheduledRuntimeMin),
      source: 'scheduled-proxy',
      confidence: 'medium',
    };
  }

  if (observedRuntimeMin != null) {
    return {
      runtimeMinutes: Math.round(observedRuntimeMin),
      source: 'observed-proxy',
      confidence: 'medium',
    };
  }

  return null;
}

function resolveWeakerMatchQuality(
  first: RoutePlanner2StopMatchQuality,
  second: RoutePlanner2StopMatchQuality,
): RoutePlanner2StopMatchQuality {
  if (first === 'nearby' || second === 'nearby') return 'nearby';
  if (first === 'name' || second === 'name') return 'name';
  return 'exact-code';
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function toGtfsLatLngCoordinate(coordinate: [number, number]): { lat: number; lng: number } {
  return { lat: coordinate[0], lng: coordinate[1] };
}

function toRoutePlannerLatLngCoordinate(coordinate: [number, number]): { lat: number; lng: number } {
  return { lng: coordinate[0], lat: coordinate[1] };
}

function distanceMetersBetweenLatLng(first: { lat: number; lng: number }, second: { lat: number; lng: number }): number {
  const earthRadiusMeters = 6371000;
  const dLat = (second.lat - first.lat) * Math.PI / 180;
  const dLng = (second.lng - first.lng) * Math.PI / 180;
  const lat1 = first.lat * Math.PI / 180;
  const lat2 = second.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function pathLengthMeters(
  coordinates: readonly [number, number][],
  toLatLng: (coordinate: [number, number]) => { lat: number; lng: number },
): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceMetersBetweenLatLng(toLatLng(coordinates[index - 1]!), toLatLng(coordinates[index]!));
  }
  return total;
}

function interpolateGtfsCoordinate(
  first: [number, number],
  second: [number, number],
  t: number,
): [number, number] {
  return [
    first[0] + ((second[0] - first[0]) * t),
    first[1] + ((second[1] - first[1]) * t),
  ];
}

function projectToLocalMeters(
  coordinate: [number, number],
  origin: { lat: number; lng: number },
  toLatLng: (coordinate: [number, number]) => { lat: number; lng: number },
): { x: number; y: number } {
  const current = toLatLng(coordinate);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(origin.lat * Math.PI / 180);
  return {
    x: (current.lng - origin.lng) * metersPerDegreeLng,
    y: (current.lat - origin.lat) * metersPerDegreeLat,
  };
}

function pointToSegmentDistanceMeters(
  point: [number, number],
  segmentStart: [number, number],
  segmentEnd: [number, number],
  origin: { lat: number; lng: number },
): number {
  const p = projectToLocalMeters(point, origin, toGtfsLatLngCoordinate);
  const a = projectToLocalMeters(segmentStart, origin, toRoutePlannerLatLngCoordinate);
  const b = projectToLocalMeters(segmentEnd, origin, toRoutePlannerLatLngCoordinate);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, (((p.x - a.x) * dx) + ((p.y - a.y) * dy)) / ((dx * dx) + (dy * dy))));
  return Math.hypot(p.x - (a.x + (t * dx)), p.y - (a.y + (t * dy)));
}

function pointToPathDistanceMeters(
  point: [number, number],
  path: readonly [number, number][],
  origin: { lat: number; lng: number },
): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) {
    return distanceMetersBetweenLatLng(toGtfsLatLngCoordinate(point), toRoutePlannerLatLngCoordinate(path[0]!));
  }
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    best = Math.min(best, pointToSegmentDistanceMeters(point, path[index - 1]!, path[index]!, origin));
  }
  return best;
}

function resolveCorridorPathQuality(
  candidate: CorridorPathCandidate,
  targetCoordinates: readonly [number, number][],
): CorridorPathQuality | null {
  if (targetCoordinates.length < 2 || candidate.geometry.length < 2) return null;
  const targetLengthMeters = Math.max(1, pathLengthMeters(targetCoordinates, toRoutePlannerLatLngCoordinate));
  const candidateLengthMeters = Math.max(candidate.lengthMeters, pathLengthMeters(candidate.geometry, toGtfsLatLngCoordinate));
  const origin = toRoutePlannerLatLngCoordinate(targetCoordinates[0]!);
  const maxDistanceMeters = Math.max(
    ...candidate.geometry.map((coordinate) => pointToPathDistanceMeters(coordinate, targetCoordinates, origin)),
  );
  return {
    lengthRatio: candidateLengthMeters / targetLengthMeters,
    maxDistanceMeters,
  };
}

function followsDrawnCorridor(
  candidate: CorridorPathCandidate,
  targetCoordinates: readonly [number, number][],
): boolean {
  const quality = resolveCorridorPathQuality(candidate, targetCoordinates);
  if (!quality) return true;
  const targetLengthMeters = Math.max(1, pathLengthMeters(targetCoordinates, toRoutePlannerLatLngCoordinate));
  const candidateLengthMeters = Math.max(candidate.lengthMeters, pathLengthMeters(candidate.geometry, toGtfsLatLngCoordinate));
  const maxAllowedLengthMeters = Math.max(
    targetLengthMeters * MAX_CORRIDOR_PATH_LENGTH_RATIO,
    targetLengthMeters + MAX_CORRIDOR_PATH_EXTRA_METERS,
  );
  return candidateLengthMeters <= maxAllowedLengthMeters
    && quality.maxDistanceMeters <= MAX_CORRIDOR_PATH_DISTANCE_METERS;
}

function measureShapeOverlapMeters(
  geometry: readonly [number, number][],
  targetCoordinates: readonly [number, number][],
): number {
  if (geometry.length < 2 || targetCoordinates.length < 2) return 0;
  const origin = toRoutePlannerLatLngCoordinate(targetCoordinates[0]!);
  let coveredMeters = 0;

  for (let index = 1; index < geometry.length; index += 1) {
    const previous = geometry[index - 1]!;
    const current = geometry[index]!;
    const legLengthMeters = distanceMetersBetweenLatLng(
      toGtfsLatLngCoordinate(previous),
      toGtfsLatLngCoordinate(current),
    );
    if (legLengthMeters <= 0) continue;
    const sampleCount = Math.max(1, Math.ceil(legLengthMeters / SHAPE_OVERLAP_SAMPLE_METERS));
    const sampleLengthMeters = legLengthMeters / sampleCount;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const midpoint = interpolateGtfsCoordinate(previous, current, (sampleIndex + 0.5) / sampleCount);
      const distanceMeters = pointToPathDistanceMeters(midpoint, targetCoordinates, origin);
      if (distanceMeters <= SHAPE_OVERLAP_MAX_DISTANCE_METERS) {
        coveredMeters += sampleLengthMeters;
      }
    }
  }

  return coveredMeters;
}

function resolvePartialScheduledRuntime(
  scenario: RoutePlanner2Scenario,
  segmentPath: { fromStopId: string; toStopId: string; pathFingerprint: string; coordinates: readonly [number, number][] },
  candidateLengthMeters: number,
  scheduledRuntimeMinutes: number,
): Pick<RoutePlanner2SegmentRuntime, 'runtimeMinutes' | 'confidence' | 'scheduledCoverageRatio' | 'scheduledCoverageDistanceKm' | 'estimatedUncoveredDistanceKm'>
  & { source: Extract<RoutePlanner2RuntimeSource, 'partial-scheduled-proxy'> } | null {
  const targetLengthMeters = Math.max(1, pathLengthMeters(segmentPath.coordinates, toRoutePlannerLatLngCoordinate));
  const scheduledCoverageRatio = Math.min(1, Math.max(0, candidateLengthMeters / targetLengthMeters));
  const uncoveredMeters = Math.max(0, targetLengthMeters - candidateLengthMeters);

  if (
    scheduledCoverageRatio >= PARTIAL_SOURCE_MAX_COVERAGE_RATIO
    || uncoveredMeters < PARTIAL_SOURCE_MIN_UNCOVERED_METERS
  ) {
    return null;
  }

  const automaticEstimate = scenario.runtimeEstimates?.find((estimate) =>
    estimate.fromStopId === segmentPath.fromStopId
    && estimate.toStopId === segmentPath.toStopId
    && estimate.pathFingerprint === segmentPath.pathFingerprint
    && (estimate.source === 'mapbox' || estimate.source === 'fallback')
    && estimate.runtimeMinutes != null
  );
  const automaticRuntimeMinutes = automaticEstimate?.runtimeMinutes ?? null;
  const uncoveredRuntimeMinutes = automaticRuntimeMinutes != null
    ? Math.max(1, Math.round(automaticRuntimeMinutes * (uncoveredMeters / targetLengthMeters)))
    : Math.max(1, Math.ceil((uncoveredMeters / 1000 / FALLBACK_UNCOVERED_SPEED_KMH) * 60));
  const runtimeMinutes = Math.max(1, Math.round(scheduledRuntimeMinutes + uncoveredRuntimeMinutes));

  return {
    runtimeMinutes,
    source: 'partial-scheduled-proxy',
    confidence: 'medium',
    scheduledCoverageRatio: Number(scheduledCoverageRatio.toFixed(2)),
    scheduledCoverageDistanceKm: Number((candidateLengthMeters / 1000).toFixed(2)),
    estimatedUncoveredDistanceKm: Number((uncoveredMeters / 1000).toFixed(2)),
  };
}

function sortRouteNames(routes: readonly string[]): string[] {
  return [...new Set(routes.filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function getScenarioRuntimeRouteSelection(scenario: RoutePlanner2Scenario): RoutePlanner2RuntimeRouteSelection {
  const preferredRoute = getScenarioSourceRoute(scenario);
  if (preferredRoute) return { mode: 'specific', routes: [preferredRoute] };

  const filter = scenario.runtimeRouteFilter;
  if (filter?.mode === 'selected') {
    return { mode: 'specific', routes: sortRouteNames(filter.routeShortNames) };
  }

  return { mode: 'all' };
}

function routeAllowed(route: string, selection: RoutePlanner2RuntimeRouteSelection): boolean {
  return selection.mode === 'all' || selection.routes.includes(route);
}

function findSpeedSegmentForMatchedStops(
  speedIndex: CorridorSpeedIndex,
  fromGtfsStopId: string,
  toGtfsStopId: string,
): CorridorSpeedSegment | null {
  return speedIndex.segments.find((segment) =>
    segment.fromStopId === fromGtfsStopId && segment.toStopId === toGtfsStopId
  ) ?? null;
}

function resolveMatchedRoutes(
  segment: CorridorSpeedSegment,
  stats: CorridorSpeedStats,
): string[] {
  const routes = segment.routes.length > 0
    ? segment.routes
    : stats.routeBreakdown.map((route) => route.route);

  return [...new Set(routes)].filter(Boolean);
}

function combineRouteScopedStats(
  baseStats: CorridorSpeedStats,
  scopedStats: readonly CorridorSpeedStats[],
): CorridorSpeedStats | null {
  if (scopedStats.length === 0) return null;
  if (scopedStats.length === 1) return scopedStats[0]!;

  const scheduledRuntimes = scopedStats
    .map((stats) => stats.scheduledRuntimeMin)
    .filter((value): value is number => value != null);
  const observedRuntimes = scopedStats
    .map((stats) => stats.observedRuntimeMin)
    .filter((value): value is number => value != null);
  const scheduledSpeeds = scopedStats
    .map((stats) => stats.scheduledSpeedKmh)
    .filter((value): value is number => value != null);
  const observedSpeeds = scopedStats
    .map((stats) => stats.observedSpeedKmh)
    .filter((value): value is number => value != null);
  const sampleCount = scopedStats.reduce((sum, stats) => sum + stats.sampleCount, 0);

  return {
    ...baseStats,
    sampleCount,
    lowConfidence: scopedStats.some((stats) => stats.lowConfidence),
    scheduledRuntimeMin: median(scheduledRuntimes),
    observedRuntimeMin: median(observedRuntimes),
    runtimeDeltaMin: null,
    runtimeDeltaPct: null,
    scheduledSpeedKmh: median(scheduledSpeeds),
    observedSpeedKmh: median(observedSpeeds),
    routeBreakdown: scopedStats.flatMap((stats) => stats.routeBreakdown),
  };
}

function addRuntimeDetailFields(
  estimate: RoutePlanner2SegmentRuntime,
  stats: CorridorSpeedStats,
  options: { includeObservedRuntime?: boolean } = {},
): RoutePlanner2SegmentRuntime {
  return {
    ...estimate,
    ...(stats.scheduledRuntimeMin == null ? {} : { scheduledRuntimeMinutes: stats.scheduledRuntimeMin }),
    ...(options.includeObservedRuntime === false || stats.observedRuntimeMin == null ? {} : { observedRuntimeMinutes: stats.observedRuntimeMin }),
  };
}

function getScenarioSourceRoute(scenario: RoutePlanner2Scenario): string | null {
  return scenario.source?.type === 'gtfs' && scenario.source.routeShortName
    ? scenario.source.routeShortName
    : null;
}

function resolveStatsForScenarioRoute(
  matched: { segment: CorridorSpeedSegment; stats: CorridorSpeedStats },
  routeSelection: RoutePlanner2RuntimeRouteSelection,
): { stats: CorridorSpeedStats; matchedRoutes: string[] } | null {
  if (routeSelection.mode === 'all') {
    return {
      stats: matched.stats,
      matchedRoutes: sortRouteNames(resolveMatchedRoutes(matched.segment, matched.stats)),
    };
  }

  const scopedStats: CorridorSpeedStats[] = [];
  const matchedRoutes: string[] = [];

  for (const route of routeSelection.routes) {
    const routeStats = scopeStatsToRoute(matched.stats, route);
    if (routeStats) {
      scopedStats.push(routeStats);
      matchedRoutes.push(route);
      continue;
    }

    if (matched.segment.routes.length === 1 && matched.segment.routes[0] === route) {
      scopedStats.push({
        ...matched.stats,
        routeBreakdown: matched.stats.routeBreakdown.length > 0
          ? matched.stats.routeBreakdown
          : [{
            route,
            sampleCount: matched.stats.sampleCount,
            scheduledRuntimeMin: matched.stats.scheduledRuntimeMin,
            observedRuntimeMin: matched.stats.observedRuntimeMin,
            runtimeDeltaMin: matched.stats.runtimeDeltaMin,
            runtimeDeltaPct: matched.stats.runtimeDeltaPct,
            scheduledSpeedKmh: matched.stats.scheduledSpeedKmh,
            observedSpeedKmh: matched.stats.observedSpeedKmh,
          }],
      });
      matchedRoutes.push(route);
    }
  }

  const stats = combineRouteScopedStats(matched.stats, scopedStats);
  return stats ? { stats, matchedRoutes: sortRouteNames(matchedRoutes) } : null;
}

function buildRuntimeRouteBreakdownFromStats(
  stats: CorridorSpeedStats,
  matchedRoutes: readonly string[],
): RoutePlanner2SegmentRuntimeRouteBreakdown[] {
  const matchedRouteSet = new Set(matchedRoutes);
  const breakdown = stats.routeBreakdown
    .filter((route) => matchedRouteSet.has(route.route) && route.scheduledRuntimeMin != null)
    .map((route) => ({
      routeShortName: route.route,
      scheduledRuntimeMinutes: route.scheduledRuntimeMin!,
    }))
    .sort((a, b) => a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true, sensitivity: 'base' }));
  if (breakdown.length > 0) return breakdown;
  if (matchedRoutes.length === 1 && stats.scheduledRuntimeMin != null) {
    return [{ routeShortName: matchedRoutes[0]!, scheduledRuntimeMinutes: stats.scheduledRuntimeMin }];
  }
  return [];
}

function getRoutesForShapeOverlap(
  segment: CorridorSpeedSegment,
  stats: CorridorSpeedStats,
  selection: RoutePlanner2RuntimeRouteSelection,
): Array<{ route: string; scheduledRuntimeMin: number }> {
  const candidateRoutes = sortRouteNames([
    ...segment.routes,
    ...stats.routeBreakdown.map((route) => route.route),
  ]);

  return candidateRoutes.flatMap((route) => {
    if (!routeAllowed(route, selection)) return [];
    const routeStats = scopeStatsToRoute(stats, route);
    const scheduledRuntimeMin = routeStats?.scheduledRuntimeMin
      ?? (segment.routes.length === 1 && segment.routes[0] === route ? stats.scheduledRuntimeMin : null);
    return scheduledRuntimeMin == null ? [] : [{ route, scheduledRuntimeMin }];
  });
}

function resolveShapeOverlapEvidence(
  scenario: RoutePlanner2Scenario,
  segmentPath: { fromStopId: string; toStopId: string; pathFingerprint: string; coordinates: readonly [number, number][] },
  speedIndex: CorridorSpeedIndex,
  statsBySegmentId: Map<string, CorridorSpeedStats>,
  routeSelection: RoutePlanner2RuntimeRouteSelection,
): {
  runtimeMinutes: number;
  scheduledRuntimeMinutes: number;
  source: Extract<RoutePlanner2RuntimeSource, 'scheduled-proxy' | 'partial-scheduled-proxy'>;
  confidence: RoutePlanner2SegmentConfidence;
  matchedRoutes: string[];
  runtimeRouteBreakdown: RoutePlanner2SegmentRuntimeRouteBreakdown[];
  matchedGtfsPathStopIds: string[];
  matchedSpeedSegmentIds: string[];
  scheduledCoverageRatio?: number;
  scheduledCoverageDistanceKm?: number;
  estimatedUncoveredDistanceKm?: number;
  sampleSize: number;
} | null {
  const targetLengthMeters = Math.max(1, pathLengthMeters(segmentPath.coordinates, toRoutePlannerLatLngCoordinate));
  const candidatesByRoute = new Map<string, ShapeOverlapCandidate>();

  for (const segment of speedIndex.segments) {
    const stats = statsBySegmentId.get(segment.id);
    if (!stats) continue;
    const segmentLengthMeters = Math.max(segment.lengthMeters, pathLengthMeters(segment.geometry, toGtfsLatLngCoordinate));
    if (segmentLengthMeters <= 0) continue;

    const coveredMeters = measureShapeOverlapMeters(segment.geometry, segmentPath.coordinates);
    if (coveredMeters < SHAPE_OVERLAP_MIN_COVERED_METERS) continue;

    const segmentCoverageRatio = Math.min(1, coveredMeters / segmentLengthMeters);
    for (const routeStats of getRoutesForShapeOverlap(segment, stats, routeSelection)) {
      const existing = candidatesByRoute.get(routeStats.route) ?? {
        route: routeStats.route,
        coveredMeters: 0,
        scheduledRuntimeMinutes: 0,
        segmentIds: [],
        stopIds: [],
        sampleSize: 0,
      };
      existing.coveredMeters += coveredMeters;
      existing.scheduledRuntimeMinutes += routeStats.scheduledRuntimeMin * segmentCoverageRatio;
      existing.segmentIds.push(segment.id);
      existing.stopIds.push(segment.fromStopId, segment.toStopId);
      existing.sampleSize += stats.sampleCount;
      candidatesByRoute.set(routeStats.route, existing);
    }
  }

  const bestCandidate = [...candidatesByRoute.values()]
    .map((candidate) => ({
      ...candidate,
      coverageRatio: Math.min(1, candidate.coveredMeters / targetLengthMeters),
    }))
    .filter((candidate) =>
      candidate.coveredMeters >= SHAPE_OVERLAP_MIN_COVERED_METERS
      && candidate.coverageRatio >= SHAPE_OVERLAP_MIN_COVERAGE_RATIO
      && candidate.coveredMeters <= Math.max(targetLengthMeters * 1.2, targetLengthMeters + 400)
    )
    .sort((a, b) =>
      b.coverageRatio - a.coverageRatio
      || a.scheduledRuntimeMinutes - b.scheduledRuntimeMinutes
      || a.route.localeCompare(b.route, undefined, { numeric: true, sensitivity: 'base' })
    )[0];

  if (!bestCandidate || bestCandidate.scheduledRuntimeMinutes <= 0) return null;

  const partialRuntime = resolvePartialScheduledRuntime(
    scenario,
    segmentPath,
    bestCandidate.coveredMeters,
    bestCandidate.scheduledRuntimeMinutes,
  );
  const uniqueStopIds = [...new Set(bestCandidate.stopIds)];
  const uniqueSegmentIds = [...new Set(bestCandidate.segmentIds)];

  return {
    runtimeMinutes: partialRuntime?.runtimeMinutes ?? Math.max(1, Math.round(bestCandidate.scheduledRuntimeMinutes)),
    scheduledRuntimeMinutes: Number(bestCandidate.scheduledRuntimeMinutes.toFixed(1)),
    source: partialRuntime?.source ?? 'scheduled-proxy',
    confidence: partialRuntime?.confidence ?? (bestCandidate.coverageRatio >= 0.75 ? 'high' : 'medium'),
    matchedRoutes: [bestCandidate.route],
    runtimeRouteBreakdown: [{
      routeShortName: bestCandidate.route,
      scheduledRuntimeMinutes: Number(bestCandidate.scheduledRuntimeMinutes.toFixed(1)),
    }],
    matchedGtfsPathStopIds: uniqueStopIds,
    matchedSpeedSegmentIds: uniqueSegmentIds,
    sampleSize: bestCandidate.sampleSize,
    ...partialRuntime,
  };
}

function resolveScheduledRuntimeEvidenceSegment(
  input: Pick<RoutePlanner2RuntimeEvidenceInput, 'scheduledRuntimeMin'>,
): RoutePlanner2ResolvedEvidence | null {
  if (input.scheduledRuntimeMin == null) return null;
  return {
    runtimeMinutes: Math.round(input.scheduledRuntimeMin),
    source: 'scheduled-proxy',
    confidence: 'high',
  };
}

function getRoutesForCorridorPathEdge(
  segment: CorridorSpeedSegment,
  stats: CorridorSpeedStats,
  selection: RoutePlanner2RuntimeRouteSelection,
): CorridorPathEdge[] {
  const candidateRoutes = sortRouteNames([
    ...segment.routes,
    ...stats.routeBreakdown.map((route) => route.route),
  ]);
  const edges: CorridorPathEdge[] = [];

  for (const route of candidateRoutes) {
    if (!routeAllowed(route, selection)) continue;
    const routeStats = scopeStatsToRoute(stats, route);
    const scheduledRuntimeMin = routeStats?.scheduledRuntimeMin
      ?? (segment.routes.length === 1 && segment.routes[0] === route ? stats.scheduledRuntimeMin : null);
    if (scheduledRuntimeMin == null) continue;
    edges.push({
      route,
      fromStopId: segment.fromStopId,
      toStopId: segment.toStopId,
      segmentId: segment.id,
      scheduledRuntimeMin,
    });
  }

  return edges;
}

function findBestCorridorPathForRoute(
  edges: readonly CorridorPathEdge[],
  segmentsById: Map<string, CorridorSpeedSegment>,
  fromStopId: string,
  toStopId: string,
): CorridorPathCandidate | null {
  const adjacency = new Map<string, CorridorPathEdge[]>();
  for (const edge of edges) {
    const existing = adjacency.get(edge.fromStopId) ?? [];
    existing.push(edge);
    adjacency.set(edge.fromStopId, existing);
  }

  const queue: Array<{ stopId: string; runtime: number; segmentIds: string[]; stopIds: string[] }> = [{
    stopId: fromStopId,
    runtime: 0,
    segmentIds: [],
    stopIds: [fromStopId],
  }];
  const bestRuntimeByStop = new Map<string, number>([[fromStopId, 0]]);
  const maxEdgeCount = 80;

  while (queue.length > 0) {
    queue.sort((a, b) => a.runtime - b.runtime || a.stopId.localeCompare(b.stopId));
    const current = queue.shift()!;
    if (current.stopId === toStopId) {
      const route = edges[0]?.route;
      if (!route) return null;
      return {
        route,
        scheduledRuntimeMin: current.runtime,
        segmentIds: current.segmentIds,
        stopIds: current.stopIds,
        geometry: current.segmentIds.flatMap((segmentId, index) => {
          const geometry = segmentsById.get(segmentId)?.geometry ?? [];
          return index === 0 ? geometry : geometry.slice(1);
        }),
        lengthMeters: current.segmentIds.reduce((sum, segmentId) => sum + (segmentsById.get(segmentId)?.lengthMeters ?? 0), 0),
      };
    }
    if (current.segmentIds.length >= maxEdgeCount) continue;

    for (const edge of adjacency.get(current.stopId) ?? []) {
      if (current.stopIds.includes(edge.toStopId)) continue;
      const nextRuntime = current.runtime + edge.scheduledRuntimeMin;
      const bestKnownRuntime = bestRuntimeByStop.get(edge.toStopId);
      if (bestKnownRuntime != null && bestKnownRuntime <= nextRuntime) continue;
      bestRuntimeByStop.set(edge.toStopId, nextRuntime);
      queue.push({
        stopId: edge.toStopId,
        runtime: nextRuntime,
        segmentIds: [...current.segmentIds, edge.segmentId],
        stopIds: [...current.stopIds, edge.toStopId],
      });
    }
  }

  return null;
}

function resolveCorridorPathEvidence(
  speedIndex: CorridorSpeedIndex,
  statsBySegmentId: Map<string, CorridorSpeedStats>,
  fromMatches: readonly RoutePlanner2GtfsStopMatch[],
  toMatches: readonly RoutePlanner2GtfsStopMatch[],
  routeSelection: RoutePlanner2RuntimeRouteSelection,
  targetCoordinates: readonly [number, number][],
): {
  runtimeMinutes: number;
  scheduledRuntimeMinutes: number;
  matchedRoutes: string[];
  runtimeRouteBreakdown: RoutePlanner2SegmentRuntimeRouteBreakdown[];
  matchedGtfsPathStopIds: string[];
  matchedSpeedSegmentIds: string[];
  lengthMeters: number;
  fromMatch: RoutePlanner2GtfsStopMatch;
  toMatch: RoutePlanner2GtfsStopMatch;
  confidence: RoutePlanner2SegmentConfidence;
} | null {
  const edgesByRoute = new Map<string, CorridorPathEdge[]>();
  const segmentsById = new Map(speedIndex.segments.map((segment) => [segment.id, segment]));

  for (const segment of speedIndex.segments) {
    const stats = statsBySegmentId.get(segment.id);
    if (!stats) continue;
    for (const edge of getRoutesForCorridorPathEdge(segment, stats, routeSelection)) {
      const routeEdges = edgesByRoute.get(edge.route) ?? [];
      routeEdges.push(edge);
      edgesByRoute.set(edge.route, routeEdges);
    }
  }

  return resolveCorridorPathEvidenceForCandidateMatches(edgesByRoute, segmentsById, fromMatches, toMatches, targetCoordinates);
}

function matchDistance(match: RoutePlanner2GtfsStopMatch): number {
  if (match.quality === 'exact-code') return 0;
  if (match.quality === 'name') return 10;
  return match.distanceMeters ?? 500;
}

function resolveCorridorPathEvidenceForCandidateMatches(
  edgesByRoute: Map<string, CorridorPathEdge[]>,
  segmentsById: Map<string, CorridorSpeedSegment>,
  fromMatches: readonly RoutePlanner2GtfsStopMatch[],
  toMatches: readonly RoutePlanner2GtfsStopMatch[],
  targetCoordinates: readonly [number, number][],
): {
  runtimeMinutes: number;
  scheduledRuntimeMinutes: number;
  matchedRoutes: string[];
  runtimeRouteBreakdown: RoutePlanner2SegmentRuntimeRouteBreakdown[];
  matchedGtfsPathStopIds: string[];
  matchedSpeedSegmentIds: string[];
  lengthMeters: number;
  fromMatch: RoutePlanner2GtfsStopMatch;
  toMatch: RoutePlanner2GtfsStopMatch;
  confidence: RoutePlanner2SegmentConfidence;
} | null {
  const candidatesByStopPair = new Map<string, {
    fromMatch: RoutePlanner2GtfsStopMatch;
    toMatch: RoutePlanner2GtfsStopMatch;
    candidates: CorridorPathCandidate[];
    matchDistance: number;
  }>();

  for (const fromMatch of fromMatches) {
    for (const toMatch of toMatches) {
      if (fromMatch.gtfsStopId === toMatch.gtfsStopId) continue;
      const pairKey = `${fromMatch.gtfsStopId}->${toMatch.gtfsStopId}`;
      const pairCandidates: CorridorPathCandidate[] = [];

      for (const [route, edges] of [...edgesByRoute.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))) {
        const path = findBestCorridorPathForRoute(edges, segmentsById, fromMatch.gtfsStopId, toMatch.gtfsStopId);
        if (path && followsDrawnCorridor(path, targetCoordinates)) pairCandidates.push({ ...path, route });
      }

      if (pairCandidates.length === 0) continue;
      candidatesByStopPair.set(pairKey, {
        fromMatch,
        toMatch,
        candidates: pairCandidates,
        matchDistance: matchDistance(fromMatch) + matchDistance(toMatch),
      });
    }
  }

  const bestPair = [...candidatesByStopPair.values()].sort((a, b) =>
    a.matchDistance - b.matchDistance
    || (median(a.candidates.map((candidate) => candidate.scheduledRuntimeMin)) ?? 0) - (median(b.candidates.map((candidate) => candidate.scheduledRuntimeMin)) ?? 0)
    || a.fromMatch.gtfsStopId.localeCompare(b.fromMatch.gtfsStopId)
    || a.toMatch.gtfsStopId.localeCompare(b.toMatch.gtfsStopId)
  )[0];

  if (!bestPair) return null;
  const candidates = bestPair.candidates;
  const { fromMatch, toMatch } = bestPair;

  if (candidates.length === 0) return null;
  const scheduledRuntimeMinutes = median(candidates.map((candidate) => candidate.scheduledRuntimeMin));
  if (scheduledRuntimeMinutes == null) return null;
  const representativeCandidate = [...candidates].sort((a, b) =>
    Math.abs(a.scheduledRuntimeMin - scheduledRuntimeMinutes) - Math.abs(b.scheduledRuntimeMin - scheduledRuntimeMinutes)
    || a.scheduledRuntimeMin - b.scheduledRuntimeMin
    || a.route.localeCompare(b.route, undefined, { numeric: true, sensitivity: 'base' })
  )[0]!;
  const matchQuality = resolveWeakerMatchQuality(fromMatch.quality, toMatch.quality);

  return {
    runtimeMinutes: Math.max(1, Math.round(scheduledRuntimeMinutes)),
    scheduledRuntimeMinutes,
    matchedRoutes: sortRouteNames(candidates.map((candidate) => candidate.route)),
    runtimeRouteBreakdown: candidates
      .map((candidate) => ({
        routeShortName: candidate.route,
        scheduledRuntimeMinutes: candidate.scheduledRuntimeMin,
      }))
      .sort((a, b) => a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true, sensitivity: 'base' })),
    matchedGtfsPathStopIds: representativeCandidate.stopIds,
    matchedSpeedSegmentIds: representativeCandidate.segmentIds,
    lengthMeters: representativeCandidate.lengthMeters,
    fromMatch,
    toMatch,
    confidence: matchQuality === 'nearby' ? 'medium' : 'high',
  };
}

export function deriveRoutePlanner2EvidenceRuntimeEstimates(
  scenario: RoutePlanner2Scenario,
  speedIndex: CorridorSpeedIndex,
  dayType: DayType,
  period: TimePeriod,
  options: RoutePlanner2RuntimeEvidenceOptions = {},
): RoutePlanner2SegmentRuntime[] {
  const gtfsStops = options.gtfsStops ?? getAllStopsWithCoords();
  const segmentPaths = buildRoutePlanner2StopSegmentPaths(scenario);
  const stopVisits = buildRoutePlanner2StopVisitSequence(scenario);
  const routePlannerStopsById = new Map(stopVisits.map((stop) => [stop.id, stop]));
  const matchByRoutePlannerStopId = new Map<string, RoutePlanner2GtfsStopMatch | null>();
  const corridorMatchesByRoutePlannerStopId = new Map<string, RoutePlanner2GtfsStopMatch[]>();

  for (const stop of routePlannerStopsById.values()) {
    matchByRoutePlannerStopId.set(stop.id, matchRoutePlanner2StopToGtfsStop(stop, gtfsStops));
    corridorMatchesByRoutePlannerStopId.set(stop.id, matchRoutePlanner2StopToGtfsCorridorStops(stop, gtfsStops));
  }

  const statsBySegmentId = getStatsForPeriod(speedIndex, dayType, period);
  const updatedAt = options.now ?? new Date().toISOString();
  const runtimeBasis = options.runtimeBasis ?? 'best-available';
  const preferredRoute = getScenarioSourceRoute(scenario);
  const routeSelection = getScenarioRuntimeRouteSelection(scenario);
  const estimates: RoutePlanner2SegmentRuntime[] = [];
  const segmentDiagnostics: RoutePlanner2RuntimeEvidenceSegmentDiagnostic[] = [];

  for (const segmentPath of segmentPaths) {
    const fromStop = routePlannerStopsById.get(segmentPath.fromStopId);
    const toStop = routePlannerStopsById.get(segmentPath.toStopId);
    const fromMatch = matchByRoutePlannerStopId.get(segmentPath.fromStopId) ?? null;
    const toMatch = matchByRoutePlannerStopId.get(segmentPath.toStopId) ?? null;
    const fromCorridorMatches = corridorMatchesByRoutePlannerStopId.get(segmentPath.fromStopId) ?? [];
    const toCorridorMatches = corridorMatchesByRoutePlannerStopId.get(segmentPath.toStopId) ?? [];
    const diagnosticBase = {
      segmentId: segmentPath.id,
      fromStopId: segmentPath.fromStopId,
      fromStopName: fromStop?.name,
      toStopId: segmentPath.toStopId,
      toStopName: toStop?.name,
      ...(fromMatch ? { fromGtfsMatch: fromMatch } : {}),
      ...(toMatch ? { toGtfsMatch: toMatch } : {}),
    };
    const addShapeOverlapEstimate = (): boolean => {
      const shapeOverlap = resolveShapeOverlapEvidence(
        scenario,
        segmentPath,
        speedIndex,
        statsBySegmentId,
        routeSelection,
      );
      if (!shapeOverlap) return false;

      estimates.push({
        id: segmentPath.id,
        fromStopId: segmentPath.fromStopId,
        toStopId: segmentPath.toStopId,
        runtimeMinutes: shapeOverlap.runtimeMinutes,
        source: shapeOverlap.source,
        confidence: shapeOverlap.confidence,
        sampleSize: shapeOverlap.sampleSize,
        scheduledRuntimeMinutes: shapeOverlap.scheduledRuntimeMinutes,
        scheduledCoverageRatio: shapeOverlap.scheduledCoverageRatio,
        scheduledCoverageDistanceKm: shapeOverlap.scheduledCoverageDistanceKm,
        estimatedUncoveredDistanceKm: shapeOverlap.estimatedUncoveredDistanceKm,
        matchQuality: 'nearby',
        matchedRoutes: shapeOverlap.matchedRoutes,
        runtimeRouteBreakdown: shapeOverlap.runtimeRouteBreakdown,
        evidenceMethod: 'shape-overlap',
        matchedGtfsPathStopIds: shapeOverlap.matchedGtfsPathStopIds,
        evidenceDayType: dayType,
        evidencePeriod: period,
        pathFingerprint: segmentPath.pathFingerprint,
        updatedAt,
      });

      segmentDiagnostics.push({
        ...diagnosticBase,
        reason: 'matched',
        matchedSpeedSegmentId: shapeOverlap.matchedSpeedSegmentIds.join(' → ') || undefined,
        matchedSegmentRoutes: shapeOverlap.matchedRoutes,
        scheduledRuntimeMin: shapeOverlap.scheduledRuntimeMinutes,
        routeScopedScheduledRuntimeMin: shapeOverlap.scheduledRuntimeMinutes,
        runtimeMinutes: shapeOverlap.runtimeMinutes,
        source: shapeOverlap.source,
        evidenceMethod: 'shape-overlap',
        matchedGtfsPathStopIds: shapeOverlap.matchedGtfsPathStopIds,
      });
      return true;
    };

    if (!fromMatch && fromCorridorMatches.length === 0) {
      if (addShapeOverlapEstimate()) continue;
      segmentDiagnostics.push({ ...diagnosticBase, reason: 'from-stop-unmatched' });
      continue;
    }
    if (!toMatch && toCorridorMatches.length === 0) {
      if (addShapeOverlapEstimate()) continue;
      segmentDiagnostics.push({ ...diagnosticBase, reason: 'to-stop-unmatched' });
      continue;
    }

    let directMiss: RoutePlanner2RuntimeEvidenceSegmentDiagnostic = {
      ...diagnosticBase,
      reason: 'no-speed-segment-for-stop-pair',
    };

    const matchedSegment = fromMatch && toMatch
      ? findSpeedSegmentForMatchedStops(speedIndex, fromMatch.gtfsStopId, toMatch.gtfsStopId)
      : null;

    if (fromMatch && toMatch && matchedSegment) {
      const matchedStats = statsBySegmentId.get(matchedSegment.id);
      if (!matchedStats) {
        directMiss = {
          ...diagnosticBase,
          reason: 'no-stats-for-selected-day-period',
          matchedSpeedSegmentId: matchedSegment.id,
          matchedSegmentRoutes: matchedSegment.routes,
        };
      } else {
        const matched = { segment: matchedSegment, stats: matchedStats };
        const scopedEvidence = resolveStatsForScenarioRoute(matched, routeSelection);
        if (!scopedEvidence) {
          directMiss = {
            ...diagnosticBase,
            reason: 'route-not-found-for-segment',
            matchedSpeedSegmentId: matched.segment.id,
            matchedSegmentRoutes: matched.segment.routes,
            statRoutes: matched.stats.routeBreakdown.map((route) => route.route),
            scheduledRuntimeMin: matched.stats.scheduledRuntimeMin,
          };
        } else {
          const resolved = runtimeBasis === 'scheduled'
            ? resolveScheduledRuntimeEvidenceSegment({
              scheduledRuntimeMin: scopedEvidence.stats.scheduledRuntimeMin,
            })
            : resolveRoutePlanner2RuntimeEvidenceSegment({
              scheduledRuntimeMin: scopedEvidence.stats.scheduledRuntimeMin,
              observedRuntimeMin: scopedEvidence.stats.observedRuntimeMin,
              sampleCount: scopedEvidence.stats.sampleCount,
              lowConfidence: scopedEvidence.stats.lowConfidence,
            });

          if (resolved) {
            const partialRuntime = resolved.source === 'scheduled-proxy'
              ? resolvePartialScheduledRuntime(
                scenario,
                segmentPath,
                Math.max(matched.segment.lengthMeters, pathLengthMeters(matched.segment.geometry, toGtfsLatLngCoordinate)),
                scopedEvidence.stats.scheduledRuntimeMin ?? resolved.runtimeMinutes,
              )
              : null;
            estimates.push(addRuntimeDetailFields({
              id: segmentPath.id,
              fromStopId: segmentPath.fromStopId,
              toStopId: segmentPath.toStopId,
              runtimeMinutes: partialRuntime?.runtimeMinutes ?? resolved.runtimeMinutes,
              source: partialRuntime?.source ?? resolved.source,
              confidence: partialRuntime?.confidence ?? resolved.confidence,
              sampleSize: scopedEvidence.stats.sampleCount,
              matchQuality: resolveWeakerMatchQuality(fromMatch.quality, toMatch.quality),
              matchedFromStopId: fromMatch.gtfsStopId,
              matchedToStopId: toMatch.gtfsStopId,
              matchedRoutes: scopedEvidence.matchedRoutes,
              runtimeRouteBreakdown: buildRuntimeRouteBreakdownFromStats(scopedEvidence.stats, scopedEvidence.matchedRoutes),
              evidenceMethod: 'adjacent-stop-pair',
              matchedGtfsPathStopIds: [fromMatch.gtfsStopId, toMatch.gtfsStopId],
              evidenceDayType: dayType,
              evidencePeriod: period,
              pathFingerprint: segmentPath.pathFingerprint,
              updatedAt,
              ...partialRuntime,
            }, scopedEvidence.stats, { includeObservedRuntime: runtimeBasis !== 'scheduled' }));

            segmentDiagnostics.push({
              ...diagnosticBase,
              reason: 'matched',
              matchedSpeedSegmentId: matched.segment.id,
              matchedSegmentRoutes: matched.segment.routes,
              statRoutes: matched.stats.routeBreakdown.map((route) => route.route),
              scheduledRuntimeMin: matched.stats.scheduledRuntimeMin,
              routeScopedScheduledRuntimeMin: scopedEvidence.stats.scheduledRuntimeMin,
              runtimeMinutes: partialRuntime?.runtimeMinutes ?? resolved.runtimeMinutes,
              source: partialRuntime?.source ?? resolved.source,
              evidenceMethod: 'adjacent-stop-pair',
              matchedGtfsPathStopIds: [fromMatch.gtfsStopId, toMatch.gtfsStopId],
            });
            continue;
          }

          directMiss = {
            ...diagnosticBase,
            reason: 'scheduled-runtime-missing',
            matchedSpeedSegmentId: matched.segment.id,
            matchedSegmentRoutes: matched.segment.routes,
            statRoutes: matched.stats.routeBreakdown.map((route) => route.route),
            scheduledRuntimeMin: matched.stats.scheduledRuntimeMin,
            routeScopedScheduledRuntimeMin: scopedEvidence.stats.scheduledRuntimeMin,
          };
        }
      }
    }

    const corridorPath = resolveCorridorPathEvidence(
      speedIndex,
      statsBySegmentId,
      fromCorridorMatches.length > 0 ? fromCorridorMatches : (fromMatch ? [fromMatch] : []),
      toCorridorMatches.length > 0 ? toCorridorMatches : (toMatch ? [toMatch] : []),
      routeSelection,
      segmentPath.coordinates,
    );
    if (!corridorPath) {
      if (addShapeOverlapEstimate()) continue;
      segmentDiagnostics.push({
        ...directMiss,
        reason: directMiss.reason === 'no-speed-segment-for-stop-pair'
          ? 'no-gtfs-corridor-path'
          : directMiss.reason,
      });
      continue;
    }

    const partialRuntime = resolvePartialScheduledRuntime(
      scenario,
      segmentPath,
      corridorPath.lengthMeters,
      corridorPath.scheduledRuntimeMinutes,
    );

    estimates.push({
      id: segmentPath.id,
      fromStopId: segmentPath.fromStopId,
      toStopId: segmentPath.toStopId,
      runtimeMinutes: partialRuntime?.runtimeMinutes ?? corridorPath.runtimeMinutes,
      source: partialRuntime?.source ?? 'scheduled-proxy',
      confidence: partialRuntime?.confidence ?? corridorPath.confidence,
      scheduledRuntimeMinutes: corridorPath.scheduledRuntimeMinutes,
      ...partialRuntime,
      matchQuality: resolveWeakerMatchQuality(corridorPath.fromMatch.quality, corridorPath.toMatch.quality),
      matchedFromStopId: corridorPath.fromMatch.gtfsStopId,
      matchedToStopId: corridorPath.toMatch.gtfsStopId,
      matchedRoutes: corridorPath.matchedRoutes,
      runtimeRouteBreakdown: corridorPath.runtimeRouteBreakdown,
      evidenceMethod: 'corridor-path',
      matchedGtfsPathStopIds: corridorPath.matchedGtfsPathStopIds,
      evidenceDayType: dayType,
      evidencePeriod: period,
      pathFingerprint: segmentPath.pathFingerprint,
      updatedAt,
    });

    segmentDiagnostics.push({
      ...diagnosticBase,
      reason: 'matched',
      matchedSpeedSegmentId: corridorPath.matchedSpeedSegmentIds.join(' → '),
      matchedSegmentRoutes: corridorPath.matchedRoutes,
      scheduledRuntimeMin: corridorPath.scheduledRuntimeMinutes,
      routeScopedScheduledRuntimeMin: corridorPath.scheduledRuntimeMinutes,
      runtimeMinutes: partialRuntime?.runtimeMinutes ?? corridorPath.runtimeMinutes,
      source: partialRuntime?.source ?? 'scheduled-proxy',
      evidenceMethod: 'corridor-path',
      matchedGtfsPathStopIds: corridorPath.matchedGtfsPathStopIds,
    });
  }

  options.onDiagnostic?.({
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    preferredRoute,
    dayType,
    period,
    runtimeBasis,
    gtfsStopCount: gtfsStops.length,
    speedSegmentCount: speedIndex.segments.length,
    statsForSelectedPeriodCount: statsBySegmentId.size,
    segmentCount: segmentPaths.length,
    estimateCount: estimates.length,
    segments: segmentDiagnostics,
  });

  return estimates;
}
