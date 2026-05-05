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
  runtimeBasis?: 'best-available' | 'scheduled';
  onDiagnostic?: (diagnostic: RoutePlanner2RuntimeEvidenceDiagnostic) => void;
}

export type RoutePlanner2RuntimeEvidenceMissReason =
  | 'matched'
  | 'from-stop-unmatched'
  | 'to-stop-unmatched'
  | 'no-speed-segment-for-stop-pair'
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
  preferredRoute: string | null,
): { stats: CorridorSpeedStats; matchedRoutes: string[] } | null {
  if (!preferredRoute) {
    return {
      stats: matched.stats,
      matchedRoutes: resolveMatchedRoutes(matched.segment, matched.stats),
    };
  }

  const routeStats = scopeStatsToRoute(matched.stats, preferredRoute);
  if (routeStats) {
    return {
      stats: routeStats,
      matchedRoutes: [preferredRoute],
    };
  }

  if (matched.segment.routes.length === 1 && matched.segment.routes[0] === preferredRoute) {
    return {
      stats: matched.stats,
      matchedRoutes: [preferredRoute],
    };
  }

  return null;
}

function resolveScheduledRuntimeEvidenceSegment(
  input: Pick<RoutePlanner2RuntimeEvidenceInput, 'scheduledRuntimeMin'>,
): RoutePlanner2ResolvedEvidence | null {
  if (input.scheduledRuntimeMin == null) return null;
  return {
    runtimeMinutes: Math.round(input.scheduledRuntimeMin),
    source: 'scheduled-proxy',
    confidence: 'medium',
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
  const runtimeBasis = options.runtimeBasis ?? 'best-available';
  const preferredRoute = getScenarioSourceRoute(scenario);
  const estimates: RoutePlanner2SegmentRuntime[] = [];
  const segmentDiagnostics: RoutePlanner2RuntimeEvidenceSegmentDiagnostic[] = [];

  for (const segmentPath of segmentPaths) {
    const fromStop = routePlannerStopsById.get(segmentPath.fromStopId);
    const toStop = routePlannerStopsById.get(segmentPath.toStopId);
    const fromMatch = matchByRoutePlannerStopId.get(segmentPath.fromStopId) ?? null;
    const toMatch = matchByRoutePlannerStopId.get(segmentPath.toStopId) ?? null;
    const diagnosticBase = {
      segmentId: segmentPath.id,
      fromStopId: segmentPath.fromStopId,
      fromStopName: fromStop?.name,
      toStopId: segmentPath.toStopId,
      toStopName: toStop?.name,
      ...(fromMatch ? { fromGtfsMatch: fromMatch } : {}),
      ...(toMatch ? { toGtfsMatch: toMatch } : {}),
    };

    if (!fromMatch) {
      segmentDiagnostics.push({ ...diagnosticBase, reason: 'from-stop-unmatched' });
      continue;
    }
    if (!toMatch) {
      segmentDiagnostics.push({ ...diagnosticBase, reason: 'to-stop-unmatched' });
      continue;
    }

    const matchedSegment = findSpeedSegmentForMatchedStops(speedIndex, fromMatch.gtfsStopId, toMatch.gtfsStopId);
    if (!matchedSegment) {
      segmentDiagnostics.push({ ...diagnosticBase, reason: 'no-speed-segment-for-stop-pair' });
      continue;
    }

    const matchedStats = statsBySegmentId.get(matchedSegment.id);
    if (!matchedStats) {
      segmentDiagnostics.push({
        ...diagnosticBase,
        reason: 'no-stats-for-selected-day-period',
        matchedSpeedSegmentId: matchedSegment.id,
        matchedSegmentRoutes: matchedSegment.routes,
      });
      continue;
    }

    const matched = { segment: matchedSegment, stats: matchedStats };
    const scopedEvidence = resolveStatsForScenarioRoute(matched, preferredRoute);
    if (!scopedEvidence) {
      segmentDiagnostics.push({
        ...diagnosticBase,
        reason: 'route-not-found-for-segment',
        matchedSpeedSegmentId: matched.segment.id,
        matchedSegmentRoutes: matched.segment.routes,
        statRoutes: matched.stats.routeBreakdown.map((route) => route.route),
        scheduledRuntimeMin: matched.stats.scheduledRuntimeMin,
      });
      continue;
    }

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
    if (!resolved) {
      segmentDiagnostics.push({
        ...diagnosticBase,
        reason: 'scheduled-runtime-missing',
        matchedSpeedSegmentId: matched.segment.id,
        matchedSegmentRoutes: matched.segment.routes,
        statRoutes: matched.stats.routeBreakdown.map((route) => route.route),
        scheduledRuntimeMin: matched.stats.scheduledRuntimeMin,
        routeScopedScheduledRuntimeMin: scopedEvidence.stats.scheduledRuntimeMin,
      });
      continue;
    }

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
      matchedRoutes: scopedEvidence.matchedRoutes,
      evidenceDayType: dayType,
      evidencePeriod: period,
      pathFingerprint: segmentPath.pathFingerprint,
      updatedAt,
    }, scopedEvidence.stats, { includeObservedRuntime: runtimeBasis !== 'scheduled' }));

    segmentDiagnostics.push({
      ...diagnosticBase,
      reason: 'matched',
      matchedSpeedSegmentId: matched.segment.id,
      matchedSegmentRoutes: matched.segment.routes,
      statRoutes: matched.stats.routeBreakdown.map((route) => route.route),
      scheduledRuntimeMin: matched.stats.scheduledRuntimeMin,
      routeScopedScheduledRuntimeMin: scopedEvidence.stats.scheduledRuntimeMin,
      runtimeMinutes: resolved.runtimeMinutes,
      source: resolved.source,
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
