import {
  getStatsForPeriod,
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
  matchRoutePlanner2StopToGtfsStop,
  type RoutePlanner2GtfsStopMatch,
  type RoutePlanner2StopMatchQuality,
} from './routePlanner2StopMatching';
import type {
  RoutePlanner2RuntimeSource,
  RoutePlanner2Scenario,
  RoutePlanner2SegmentConfidence,
  RoutePlanner2SegmentRuntime,
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
}

type RoutePlanner2ResolvedEvidence = {
  runtimeMinutes: number;
  source: Extract<RoutePlanner2RuntimeSource, 'observed-proxy' | 'observed-scheduled-blend' | 'scheduled-proxy'>;
  confidence: RoutePlanner2SegmentConfidence;
};

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

function findStatsForMatchedStops(
  speedIndex: CorridorSpeedIndex,
  statsBySegmentId: ReadonlyMap<string, CorridorSpeedStats>,
  fromGtfsStopId: string,
  toGtfsStopId: string,
): { segment: CorridorSpeedSegment; stats: CorridorSpeedStats } | null {
  for (const segment of speedIndex.segments) {
    if (segment.fromStopId !== fromGtfsStopId || segment.toStopId !== toGtfsStopId) continue;
    const stats = statsBySegmentId.get(segment.id);
    if (stats) return { segment, stats };
  }

  return null;
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

function addRuntimeDetailFields(
  estimate: RoutePlanner2SegmentRuntime,
  stats: CorridorSpeedStats,
): RoutePlanner2SegmentRuntime {
  return {
    ...estimate,
    ...(stats.scheduledRuntimeMin == null ? {} : { scheduledRuntimeMinutes: stats.scheduledRuntimeMin }),
    ...(stats.observedRuntimeMin == null ? {} : { observedRuntimeMinutes: stats.observedRuntimeMin }),
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

  for (const stop of routePlannerStopsById.values()) {
    matchByRoutePlannerStopId.set(stop.id, matchRoutePlanner2StopToGtfsStop(stop, gtfsStops));
  }

  const statsBySegmentId = getStatsForPeriod(speedIndex, dayType, period);
  const updatedAt = options.now ?? new Date().toISOString();
  const estimates: RoutePlanner2SegmentRuntime[] = [];

  for (const segmentPath of segmentPaths) {
    const fromMatch = matchByRoutePlannerStopId.get(segmentPath.fromStopId) ?? null;
    const toMatch = matchByRoutePlannerStopId.get(segmentPath.toStopId) ?? null;
    if (!fromMatch || !toMatch) continue;

    const matched = findStatsForMatchedStops(
      speedIndex,
      statsBySegmentId,
      fromMatch.gtfsStopId,
      toMatch.gtfsStopId,
    );
    if (!matched) continue;

    const resolved = resolveRoutePlanner2RuntimeEvidenceSegment({
      scheduledRuntimeMin: matched.stats.scheduledRuntimeMin,
      observedRuntimeMin: matched.stats.observedRuntimeMin,
      sampleCount: matched.stats.sampleCount,
      lowConfidence: matched.stats.lowConfidence,
    });
    if (!resolved) continue;

    estimates.push(addRuntimeDetailFields({
      id: segmentPath.id,
      fromStopId: segmentPath.fromStopId,
      toStopId: segmentPath.toStopId,
      runtimeMinutes: resolved.runtimeMinutes,
      source: resolved.source,
      confidence: resolved.confidence,
      sampleSize: matched.stats.sampleCount,
      matchQuality: resolveWeakerMatchQuality(fromMatch.quality, toMatch.quality),
      matchedFromStopId: fromMatch.gtfsStopId,
      matchedToStopId: toMatch.gtfsStopId,
      matchedRoutes: resolveMatchedRoutes(matched.segment, matched.stats),
      pathFingerprint: segmentPath.pathFingerprint,
      updatedAt,
    }, matched.stats));
  }

  return estimates;
}
