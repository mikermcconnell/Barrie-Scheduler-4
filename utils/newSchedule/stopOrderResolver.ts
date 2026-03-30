import type {
  DailyStopSegmentRuntimeEntry,
  DailySummary,
  DailyTripStopSegmentRuntimeEntry,
  DayType,
  TripStopSegmentObservation,
} from '../performanceDataTypes';
import { getRouteConfig, isDirectionVariant, parseRouteInfo } from '../config/routeDirectionConfig';
import { normalizeSegmentStopKey } from '../runtimeSegmentMatching';

export type StopOrderDirection = 'North' | 'South' | 'Loop';
export type StopOrderSource = 'observed-midday-pattern' | 'observed-dominant-pattern';
export type StopOrderConfidence = 'high' | 'medium' | 'low';
export type StopOrderDecision = 'accept' | 'review' | 'blocked';

export interface StopOrderPoint {
  stopId: string;
  stopName: string;
  routeStopIndex: number;
  normalizedStopName: string;
}

export interface ResolvedDirectionStopOrder {
  direction: StopOrderDirection;
  source: StopOrderSource;
  confidence: StopOrderConfidence;
  chosenPatternSignature: string;
  stopIds: string[];
  stopNames: string[];
  stopPoints: StopOrderPoint[];
  tripCountUsed: number;
  dayCountUsed: number;
  middayTripCount: number;
  alternatePatternCount: number;
  skippedIndexCount: number;
  anchorMatchCount: number;
  anchorCount: number;
  warnings: string[];
}

export interface StopOrderResolverOptions {
  routeId: string;
  dayType: DayType;
  dateRange?: { start: string; end: string };
  middayWindow?: { start: string; end: string };
  patternAnchorStops?: Partial<Record<StopOrderDirection, string[]>>;
}

export interface StopOrderResolutionResult {
  routeId: string;
  canonicalRouteId: string;
  dayType: DayType;
  decision: StopOrderDecision;
  confidence: StopOrderConfidence;
  resolvedDirections: Partial<Record<StopOrderDirection, ResolvedDirectionStopOrder>>;
  warnings: string[];
  blockers: string[];
}

interface TripCandidate {
  direction: StopOrderDirection;
  tripId: string;
  date: string;
  departureMinutes: number;
  stopPoints: StopOrderPoint[];
  signature: string;
  stopCount: number;
  skippedIndexCount: number;
}

interface PatternAggregate {
  direction: StopOrderDirection;
  signature: string;
  stopPoints: StopOrderPoint[];
  tripIds: Set<string>;
  dates: Set<string>;
  middayTripCount: number;
  skippedIndexScoreTotal: number;
  skippedIndexCount: number;
  score: number;
  anchorMatchCount: number;
  anchorCount: number;
}

type StopNameLookup = Map<string, string>;

const DEFAULT_MIDDAY_WINDOW = { start: '10:00', end: '14:59' } as const;
const MAX_CLEAN_AVERAGE_SKIPPED_INDEX_COUNT = 0.25;

function parseRouteHint(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = parseRouteInfo(trimmed);
  if (direct.direction || direct.isLoop || direct.suffixIsDirection) {
    return direct;
  }

  const tokens = trimmed.match(/\b\d+[A-Z]?\b/g) || [];
  for (const token of tokens) {
    const parsed = parseRouteInfo(token);
    if (parsed.direction || parsed.isLoop || parsed.suffixIsDirection) {
      return parsed;
    }
  }

  return direct;
}

function mapDirection(dir: string, routeId?: string, tripName?: string): StopOrderDirection | null {
  const upper = dir.trim().toUpperCase();
  const parsedTrip = parseRouteHint(tripName);
  const parsedRoute = parseRouteHint(routeId);
  const parsedHint = parsedTrip?.direction ? parsedTrip : parsedRoute;

  if (upper === 'N' || upper === 'NB' || upper === 'NORTH') return 'North';
  if (upper === 'S' || upper === 'SB' || upper === 'SOUTH') return 'South';
  if (upper === 'CW' || upper === 'CCW' || upper === 'LOOP') return 'Loop';
  if (upper === 'A' || upper === 'EA') {
    if (parsedHint?.direction === 'North' || parsedHint?.direction === 'South') return parsedHint.direction;
    if (parsedHint?.suffixIsDirection) return 'North';
  }
  if (upper === 'B' || upper === 'EB') {
    if (parsedHint?.direction === 'North' || parsedHint?.direction === 'South') return parsedHint.direction;
    if (parsedHint?.suffixIsDirection) return 'South';
  }
  if (parsedHint?.direction === 'North' || parsedHint?.direction === 'South') return parsedHint.direction;
  if (parsedHint?.isLoop) return 'Loop';
  return null;
}

function normalizeRouteId(routeId: string): string {
  return routeId.trim().toUpperCase();
}

function getCanonicalRouteId(routeId: string): string {
  const normalized = normalizeRouteId(routeId);
  if (isDirectionVariant(normalized)) {
    return parseRouteInfo(normalized).baseRoute.toUpperCase();
  }
  return normalized;
}

function routeMatchesSelection(entryRouteId: string, selectedRouteId: string): boolean {
  const entryNormalized = normalizeRouteId(entryRouteId);
  const selectedNormalized = normalizeRouteId(selectedRouteId);
  if (entryNormalized === selectedNormalized) return true;

  const selectedCanonicalRouteId = getCanonicalRouteId(selectedNormalized);
  const selectedIsExplicitDirectionVariant =
    isDirectionVariant(selectedNormalized) && selectedNormalized !== selectedCanonicalRouteId;

  if (selectedIsExplicitDirectionVariant) return false;
  return getCanonicalRouteId(entryNormalized) === selectedCanonicalRouteId;
}

function parseClockMinutes(value: string): number {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function isWithinWindow(value: number, window: { start: string; end: string }): boolean {
  const start = parseClockMinutes(window.start);
  const end = parseClockMinutes(window.end);
  if (!Number.isFinite(value) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  return value >= start && value <= end;
}

function buildStopLookupKey(direction: StopOrderDirection, stopId: string, routeStopIndex: number): string {
  return `${direction}::${stopId.trim()}::${routeStopIndex}`;
}

function buildStopFallbackKey(direction: StopOrderDirection, stopId: string): string {
  return `${direction}::${stopId.trim()}`;
}

function buildStopNameLookup(
  dailySummaries: DailySummary[],
  routeId: string,
  dayType: DayType,
  dateRange?: { start: string; end: string },
): StopNameLookup {
  const lookup: StopNameLookup = new Map();

  const addEntry = (
    direction: StopOrderDirection | null,
    stopId: string,
    routeStopIndex: number,
    stopName: string,
  ) => {
    if (!direction || !stopId.trim() || !stopName.trim()) return;
    lookup.set(buildStopLookupKey(direction, stopId, routeStopIndex), stopName);
    lookup.set(buildStopFallbackKey(direction, stopId), stopName);
  };

  dailySummaries.forEach((day) => {
    if (day.dayType !== dayType) return;
    if (dateRange && (day.date < dateRange.start || day.date > dateRange.end)) return;

    (day.stopSegmentRuntimes?.entries || []).forEach((entry: DailyStopSegmentRuntimeEntry) => {
      if (!routeMatchesSelection(entry.routeId, routeId)) return;
      const direction = mapDirection(entry.direction, entry.routeId);
      addEntry(direction, entry.fromStopId, entry.fromRouteStopIndex, entry.fromStopName);
      addEntry(direction, entry.toStopId, entry.toRouteStopIndex, entry.toStopName);
    });
  });

  return lookup;
}

function resolveStopName(
  lookup: StopNameLookup,
  direction: StopOrderDirection,
  stopId: string,
  routeStopIndex: number,
): string {
  return (
    lookup.get(buildStopLookupKey(direction, stopId, routeStopIndex))
    || lookup.get(buildStopFallbackKey(direction, stopId))
    || stopId
  );
}

function appendStopPoint(points: StopOrderPoint[], point: StopOrderPoint) {
  const existing = points[points.length - 1];
  if (
    existing
    && existing.stopId === point.stopId
    && existing.routeStopIndex === point.routeStopIndex
  ) {
    return;
  }
  points.push(point);
}

function buildTripStopPoints(
  direction: StopOrderDirection,
  trip: DailyTripStopSegmentRuntimeEntry,
  stopNameLookup: StopNameLookup,
): { stopPoints: StopOrderPoint[]; skippedIndexCount: number } | null {
  const sortedSegments = [...trip.segments].sort((a, b) => {
    if (a.fromRouteStopIndex !== b.fromRouteStopIndex) {
      return a.fromRouteStopIndex - b.fromRouteStopIndex;
    }
    return a.toRouteStopIndex - b.toRouteStopIndex;
  });

  if (sortedSegments.length === 0) return null;

  const stopPoints: StopOrderPoint[] = [];
  let skippedIndexCount = 0;
  let previousToIndex: number | null = null;
  let previousToStopId: string | null = null;

  sortedSegments.forEach((segment: TripStopSegmentObservation, index) => {
    if (segment.fromRouteStopIndex < 0 || segment.toRouteStopIndex < 0) {
      return;
    }
    if (segment.toRouteStopIndex <= segment.fromRouteStopIndex) {
      skippedIndexCount += 10;
      return;
    }

    const fromStopName = resolveStopName(
      stopNameLookup,
      direction,
      segment.fromStopId,
      segment.fromRouteStopIndex,
    );
    const toStopName = resolveStopName(
      stopNameLookup,
      direction,
      segment.toStopId,
      segment.toRouteStopIndex,
    );

    if (index === 0) {
      appendStopPoint(stopPoints, {
        stopId: segment.fromStopId,
        stopName: fromStopName,
        routeStopIndex: segment.fromRouteStopIndex,
        normalizedStopName: normalizeSegmentStopKey(fromStopName),
      });
    } else if (
      previousToIndex !== null
      && previousToStopId !== null
      && (
        previousToIndex !== segment.fromRouteStopIndex
        || previousToStopId !== segment.fromStopId
      )
    ) {
      if (segment.fromRouteStopIndex <= previousToIndex) {
        skippedIndexCount += 10;
        return;
      }
      skippedIndexCount += 1;
      appendStopPoint(stopPoints, {
        stopId: segment.fromStopId,
        stopName: fromStopName,
        routeStopIndex: segment.fromRouteStopIndex,
        normalizedStopName: normalizeSegmentStopKey(fromStopName),
      });
    }

    appendStopPoint(stopPoints, {
      stopId: segment.toStopId,
      stopName: toStopName,
      routeStopIndex: segment.toRouteStopIndex,
      normalizedStopName: normalizeSegmentStopKey(toStopName),
    });
    previousToIndex = segment.toRouteStopIndex;
    previousToStopId = segment.toStopId;
  });

  if (stopPoints.length < 2) return null;
  return { stopPoints, skippedIndexCount };
}

function buildPatternSignature(stopPoints: StopOrderPoint[]): string {
  const hasAllStopIds = stopPoints.every(point => point.stopId.trim().length > 0);
  if (hasAllStopIds) {
    return stopPoints.map(point => point.stopId.trim()).join('>');
  }
  return stopPoints.map(point => point.normalizedStopName).join('>');
}

function scorePatternAnchorMatch(stopPoints: StopOrderPoint[], anchors?: string[]): number {
  if (!anchors || anchors.length === 0) return 0;
  const normalizedAnchors = anchors.map(anchor => normalizeSegmentStopKey(anchor)).filter(Boolean);
  if (normalizedAnchors.length === 0) return 0;

  const sequence = stopPoints.map(point => point.normalizedStopName);
  let lastFoundIndex = -1;
  let matches = 0;

  normalizedAnchors.forEach((anchor) => {
    const foundIndex = sequence.findIndex((name, index) => index > lastFoundIndex && name === anchor);
    if (foundIndex >= 0) {
      matches += 1;
      lastFoundIndex = foundIndex;
    }
  });

  return matches;
}

function buildTripCandidate(
  trip: DailyTripStopSegmentRuntimeEntry,
  dayDate: string,
  stopNameLookup: StopNameLookup,
): TripCandidate | null {
  const direction = mapDirection(trip.direction, trip.routeId, trip.tripName);
  if (!direction) return null;

  const pointResult = buildTripStopPoints(direction, trip, stopNameLookup);
  if (!pointResult) return null;

  return {
    direction,
    tripId: trip.tripId,
    date: dayDate,
    departureMinutes: parseClockMinutes(trip.terminalDepartureTime),
    stopPoints: pointResult.stopPoints,
    signature: buildPatternSignature(pointResult.stopPoints),
    stopCount: pointResult.stopPoints.length,
    skippedIndexCount: pointResult.skippedIndexCount,
  };
}

function aggregatePatterns(
  candidates: TripCandidate[],
  middayWindow: { start: string; end: string },
  patternAnchorStops?: Partial<Record<StopOrderDirection, string[]>>,
): Map<StopOrderDirection, PatternAggregate[]> {
  const grouped = new Map<StopOrderDirection, Map<string, PatternAggregate>>();

  candidates.forEach((candidate) => {
    if (!grouped.has(candidate.direction)) {
      grouped.set(candidate.direction, new Map());
    }
    const bySignature = grouped.get(candidate.direction)!;
    const existing = bySignature.get(candidate.signature);
    const middayMatch = isWithinWindow(candidate.departureMinutes, middayWindow);

    if (existing) {
      existing.tripIds.add(candidate.tripId);
      existing.dates.add(candidate.date);
      if (middayMatch) existing.middayTripCount += 1;
      existing.skippedIndexScoreTotal += candidate.skippedIndexCount;
      return;
    }

    const anchorMatchCount = scorePatternAnchorMatch(
      candidate.stopPoints,
      patternAnchorStops?.[candidate.direction],
    );
    bySignature.set(candidate.signature, {
      direction: candidate.direction,
      signature: candidate.signature,
      stopPoints: candidate.stopPoints,
      tripIds: new Set([candidate.tripId]),
      dates: new Set([candidate.date]),
      middayTripCount: middayMatch ? 1 : 0,
      skippedIndexScoreTotal: candidate.skippedIndexCount,
      skippedIndexCount: candidate.skippedIndexCount,
      score: 0,
      anchorMatchCount,
      anchorCount: patternAnchorStops?.[candidate.direction]?.length || 0,
    });
  });

  const results = new Map<StopOrderDirection, PatternAggregate[]>();
  grouped.forEach((patterns, direction) => {
    const aggregates = Array.from(patterns.values()).map((pattern) => {
      const dayCount = pattern.dates.size;
      const stopCount = pattern.stopPoints.length;
      const tripCount = pattern.tripIds.size;
      const averageSkippedIndexCount = tripCount > 0
        ? pattern.skippedIndexScoreTotal / tripCount
        : pattern.skippedIndexScoreTotal;
      const score =
        (pattern.anchorMatchCount * 5000)
        + (stopCount * 1000)
        + (dayCount * 500)
        + (pattern.middayTripCount * 100)
        + (tripCount * 200)
        - (averageSkippedIndexCount * 1500);
      return {
        ...pattern,
        skippedIndexCount: averageSkippedIndexCount,
        score,
      };
    }).sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.stopPoints.length !== b.stopPoints.length) return b.stopPoints.length - a.stopPoints.length;
      if (a.dates.size !== b.dates.size) return b.dates.size - a.dates.size;
      return b.tripIds.size - a.tripIds.size;
    });

    results.set(direction, aggregates);
  });

  return results;
}

function resolveConfidence(
  winner: PatternAggregate,
  runnerUp?: PatternAggregate,
): StopOrderConfidence {
  const stopCount = winner.stopPoints.length;
  const dayCount = winner.dates.size;
  const tripCount = winner.tripIds.size;
  const hasStrongCoverage = stopCount >= 4 && (dayCount >= 2 || tripCount >= 5);
  const hasMiddayEvidence = winner.middayTripCount > 0;
  const isClean = winner.skippedIndexCount <= MAX_CLEAN_AVERAGE_SKIPPED_INDEX_COUNT;
  const hasStrongLead = !runnerUp || (winner.score - runnerUp.score) >= 500;
  const anchorsSatisfied = winner.anchorCount === 0 || winner.anchorMatchCount === winner.anchorCount;

  if (hasStrongCoverage && hasMiddayEvidence && isClean && hasStrongLead && anchorsSatisfied) return 'high';
  if (stopCount >= 3 && tripCount >= 1 && isClean) return 'medium';
  return 'low';
}

function summarizeConfidence(
  resolvedDirections: Partial<Record<StopOrderDirection, ResolvedDirectionStopOrder>>,
): StopOrderConfidence {
  const results = Object.values(resolvedDirections).filter(Boolean) as ResolvedDirectionStopOrder[];
  if (results.length === 0) return 'low';
  if (results.some(result => result.confidence === 'low')) return 'low';
  if (results.some(result => result.confidence === 'medium')) return 'medium';
  return 'high';
}

function resolveDecision(
  routeId: string,
  resolvedDirections: Partial<Record<StopOrderDirection, ResolvedDirectionStopOrder>>,
): { decision: StopOrderDecision; warnings: string[]; blockers: string[] } {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const config = getRouteConfig(routeId);
  const expectedDirections: StopOrderDirection[] = config?.segments.length === 2
    ? ['North', 'South']
    : ['Loop'];

  expectedDirections.forEach((direction) => {
    if (!resolvedDirections[direction]) {
      const message = `Missing resolved stop order for ${direction}.`;
      warnings.push(message);
      blockers.push(message);
    }
  });

  Object.values(resolvedDirections).forEach((directionResult) => {
    if (!directionResult) return;
    warnings.push(...directionResult.warnings);

    if (directionResult.confidence === 'medium') {
      warnings.push(`${directionResult.direction} stop order is usable, but should be smoke-tested before Step 2 wiring.`);
    } else if (directionResult.confidence === 'low') {
      warnings.push(`${directionResult.direction} stop order confidence is too weak for automatic Step 2 use.`);
    }
  });

  if (blockers.length > 0) {
    return { decision: 'blocked', warnings, blockers };
  }

  if (warnings.length > 0) {
    return { decision: 'review', warnings, blockers };
  }

  return { decision: 'accept', warnings, blockers };
}

export function resolveStopOrderFromPerformance(
  dailySummaries: DailySummary[],
  options: StopOrderResolverOptions,
): StopOrderResolutionResult {
  const {
    routeId,
    dayType,
    dateRange,
    middayWindow = DEFAULT_MIDDAY_WINDOW,
    patternAnchorStops,
  } = options;

  const normalizedRouteId = normalizeRouteId(routeId);
  const canonicalRouteId = getCanonicalRouteId(normalizedRouteId);
  const stopNameLookup = buildStopNameLookup(dailySummaries, normalizedRouteId, dayType, dateRange);

  const candidates: TripCandidate[] = [];
  dailySummaries.forEach((day) => {
    if (day.dayType !== dayType) return;
    if (dateRange && (day.date < dateRange.start || day.date > dateRange.end)) return;

    (day.tripStopSegmentRuntimes?.entries || []).forEach((trip) => {
      if (!routeMatchesSelection(trip.routeId, normalizedRouteId)) return;
      const candidate = buildTripCandidate(trip, day.date, stopNameLookup);
      if (!candidate) return;
      candidates.push(candidate);
    });
  });

  const aggregatesByDirection = aggregatePatterns(candidates, middayWindow, patternAnchorStops);
  const resolvedDirections: Partial<Record<StopOrderDirection, ResolvedDirectionStopOrder>> = {};

  aggregatesByDirection.forEach((patterns, direction) => {
    const winner = patterns[0];
    if (!winner) return;
    const runnerUp = patterns[1];
    const confidence = resolveConfidence(winner, runnerUp);
    const warnings: string[] = [];

    if (winner.skippedIndexCount > MAX_CLEAN_AVERAGE_SKIPPED_INDEX_COUNT) {
      warnings.push(`${direction} pattern still contains skipped stop indexes and may include partial-trip drift.`);
    }
    if (winner.anchorCount > 0 && winner.anchorMatchCount < winner.anchorCount) {
      warnings.push(`${direction} pattern did not match all expected anchor stops.`);
    }
    if (runnerUp && (winner.score - runnerUp.score) < 500) {
      warnings.push(`${direction} has competing stop patterns with similar scores.`);
    }

    resolvedDirections[direction] = {
      direction,
      source: winner.middayTripCount > 0 ? 'observed-midday-pattern' : 'observed-dominant-pattern',
      confidence,
      chosenPatternSignature: winner.signature,
      stopIds: winner.stopPoints.map(point => point.stopId),
      stopNames: winner.stopPoints.map(point => point.stopName),
      stopPoints: winner.stopPoints,
      tripCountUsed: winner.tripIds.size,
      dayCountUsed: winner.dates.size,
      middayTripCount: winner.middayTripCount,
      alternatePatternCount: Math.max(0, patterns.length - 1),
      skippedIndexCount: winner.skippedIndexCount,
      anchorMatchCount: winner.anchorMatchCount,
      anchorCount: winner.anchorCount,
      warnings,
    };
  });

  const decisionResult = resolveDecision(normalizedRouteId, resolvedDirections);

  return {
    routeId: normalizedRouteId,
    canonicalRouteId,
    dayType,
    decision: decisionResult.decision,
    confidence: summarizeConfidence(resolvedDirections),
    resolvedDirections,
    warnings: decisionResult.warnings,
    blockers: decisionResult.blockers,
  };
}

export const resolveDynamicStopOrder = resolveStopOrderFromPerformance;
