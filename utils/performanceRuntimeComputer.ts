// Performance Runtime Computer — converts stored daily segment data into RuntimeData[]
// Output is identical to parseRuntimeCSV() so the entire downstream pipeline works unchanged.

import type {
  DailySummary,
  DayType,
  DailySegmentRuntimeEntry,
  DailyStopSegmentRuntimeEntry,
  DailyTripStopSegmentRuntimeEntry,
  PerformanceMetadata,
} from './performanceDataTypes';
import { PERFORMANCE_RUNTIME_LOGIC_VERSION } from './performanceDataTypes';
import type {
  RuntimeData,
  SegmentRawData,
  RouteDirection,
  SegmentTimeBucket,
  BucketContribution,
} from '../components/NewSchedule/utils/csvParser';
import { isDirectionVariant, parseRouteInfo } from './config/routeDirectionConfig';
import { normalizeSegmentStopKey } from './runtimeSegmentMatching';

// ─── Percentile (PERCENTILE.INC linear interpolation) ───────────────

function percentileInc(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const n = sorted.length;
  const rank = p * (n - 1);          // 0-based rank
  const lower = Math.floor(rank);
  const frac = rank - lower;

  if (lower + 1 >= n) return sorted[n - 1];
  return sorted[lower] + frac * (sorted[lower + 1] - sorted[lower]);
}

// ─── Direction Mapping ──────────────────────────────────────────────

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

function mapDirection(dir: string, routeId?: string, tripName?: string): RouteDirection {
  const upper = dir.trim().toUpperCase();
  const parsedTrip = parseRouteHint(tripName);
  const parsedRoute = parseRouteHint(routeId);
  const parsedHint = parsedTrip?.direction ? parsedTrip : parsedRoute;

  if (upper === 'N' || upper === 'NB' || upper === 'NORTH') return 'North';
  if (upper === 'S' || upper === 'SB' || upper === 'SOUTH') return 'South';
  // Loop routes: CW/CCW both map to 'Loop'
  if (upper === 'CW' || upper === 'CCW' || upper === 'LOOP') return 'Loop';
  // Letter-suffix routes (8A/8B)
  if (upper === 'A' || upper === 'EA') {
    if (parsedHint?.direction) return parsedHint.direction;
    if (parsedHint?.suffixIsDirection) return 'North';
    return 'A';
  }
  if (upper === 'B' || upper === 'EB') {
    if (parsedHint?.direction) return parsedHint.direction;
    if (parsedHint?.suffixIsDirection) return 'South';
    return 'B';
  }
  if (parsedHint?.direction) return parsedHint.direction;
  if (parsedHint?.isLoop) return 'Loop';
  return 'North'; // fallback
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

function parseBucketStartMinutes(bucket: string): number {
  const match = bucket.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseClockMinutes(value: string): number {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function getHalfHourBucketRange(value: string): { start: number; end: number } {
  const start = parseClockMinutes(value);
  if (!Number.isFinite(start)) {
    return {
      start: Number.POSITIVE_INFINITY,
      end: Number.POSITIVE_INFINITY,
    };
  }
  return {
    start,
    end: start + 29,
  };
}

function toHalfHourBucket(value: string): string {
  const totalMinutes = parseClockMinutes(value);
  if (!Number.isFinite(totalMinutes)) return value;
  const bucketMinutes = Math.floor(totalMinutes / 30) * 30;
  const hours = Math.floor(bucketMinutes / 60);
  const minutes = bucketMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getStopSegmentKey(fromRouteStopIndex: number, toRouteStopIndex: number): string {
  return `${fromRouteStopIndex}|${toRouteStopIndex}`;
}

function getSegmentIdentityKey(params: {
  fromStopId?: string;
  toStopId?: string;
  fromRouteStopIndex: number;
  toRouteStopIndex: number;
  preferStopIds?: boolean;
}): string {
  const { fromStopId, toStopId, fromRouteStopIndex, toRouteStopIndex, preferStopIds = false } = params;
  if (preferStopIds && fromStopId && toStopId) {
    return `${fromStopId}|${toStopId}`;
  }
  return getStopSegmentKey(fromRouteStopIndex, toRouteStopIndex);
}

interface CanonicalSegmentDefinition {
  segmentKey: string;
  segmentName: string;
  fromRouteStopIndex: number;
  toRouteStopIndex: number;
}

interface AggregatedSegmentBucket {
  segmentName: string;
  fromRouteStopIndex?: number;
  toRouteStopIndex?: number;
  bucketMap: Map<string, { values: number[]; dates: Set<string>; dayTotals: Map<string, number> }>;
}

interface PreferredTripPattern {
  segmentKeys: string[];
  segmentCount: number;
  anchorScore?: number;
}

type StopNameLookupByDirection = Map<RouteDirection, Map<string, string>>;

type PerformanceBucketMode = 'cycleStart' | 'tripStart';

interface CycleBucketCandidate {
  bucket: string;
  totalRuntime: number;
  details: Array<{ segment: CanonicalSegmentDefinition; runtimeMinutes: number }>;
}

function resolveCanonicalStopToStopName(
  direction: RouteDirection,
  fromRouteStopIndex: number,
  toRouteStopIndex: number,
  canonicalDirectionStops?: Partial<Record<RouteDirection, string[]>>
): string | undefined {
  const stops = canonicalDirectionStops?.[direction];
  if (!stops || stops.length === 0) return undefined;

  const fromStopName = stops[fromRouteStopIndex - 1];
  const toStopName = stops[toRouteStopIndex - 1];
  if (!fromStopName || !toStopName) return undefined;
  return `${fromStopName} to ${toStopName}`;
}

function buildCanonicalSegmentsFromStops(
  direction: RouteDirection,
  canonicalStops: string[] | undefined,
): Map<string, CanonicalSegmentDefinition> {
  const definitions = new Map<string, CanonicalSegmentDefinition>();
  if (!canonicalStops || canonicalStops.length < 2) return definitions;

  for (let index = 0; index < canonicalStops.length - 1; index += 1) {
    const fromRouteStopIndex = index + 1;
    const toRouteStopIndex = index + 2;
    const segmentKey = getStopSegmentKey(fromRouteStopIndex, toRouteStopIndex);
    definitions.set(segmentKey, {
      segmentKey,
      segmentName: resolveCanonicalStopToStopName(
        direction,
        fromRouteStopIndex,
        toRouteStopIndex,
        { [direction]: canonicalStops }
      ) || `${canonicalStops[index]} to ${canonicalStops[index + 1]}`,
      fromRouteStopIndex,
      toRouteStopIndex,
    });
  }

  return definitions;
}

function stopNamesLikelyMatch(observedStopName: string, canonicalStopName: string): boolean {
  const observedKey = normalizeSegmentStopKey(observedStopName);
  const canonicalKey = normalizeSegmentStopKey(canonicalStopName);
  if (!observedKey || !canonicalKey) return false;
  return observedKey === canonicalKey
    || observedKey.includes(canonicalKey)
    || canonicalKey.includes(observedKey);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentileInc(sorted, 0.5);
}

function buildObservedPathBucketObservations(
  entries: DailyStopSegmentRuntimeEntry[],
): Array<{ timeBucket: string; runtimeMinutes: number }> {
  if (entries.length === 0) return [];

  const segmentOptions = entries.map((entry) => (
    Array.from(new Set(
      entry.observations.map(observation => observation.timeBucket)
    ))
      .sort((a, b) => parseClockMinutes(a) - parseClockMinutes(b))
      .map((bucket) => {
        const values = entry.observations
          .filter(observation => observation.timeBucket === bucket)
          .map(observation => observation.runtimeMinutes);

        return {
          bucket,
          bucketRange: getHalfHourBucketRange(bucket),
          runtimeMinutes: Math.round(median(values) * 100) / 100,
        };
      })
  ));

  const firstSegmentOptions = segmentOptions[0];
  if (!firstSegmentOptions || firstSegmentOptions.length === 0) return [];

  const candidates = firstSegmentOptions.map((startOption) => {
    let totalRuntime = startOption.runtimeMinutes;

    for (let index = 1; index < segmentOptions.length; index += 1) {
      const option = segmentOptions[index].find((candidate) => (
        candidate.bucketRange.end >= (startOption.bucketRange.start + totalRuntime - 5)
      ));
      if (!option) return null;
      totalRuntime += option.runtimeMinutes;
    }

    return {
      timeBucket: startOption.bucket,
      runtimeMinutes: Math.round(totalRuntime * 100) / 100,
    };
  }).filter((value): value is { timeBucket: string; runtimeMinutes: number } => value !== null);

  const merged = new Map<string, number[]>();
  candidates.forEach((candidate) => {
    if (!merged.has(candidate.timeBucket)) merged.set(candidate.timeBucket, []);
    merged.get(candidate.timeBucket)!.push(candidate.runtimeMinutes);
  });

  return Array.from(merged.entries())
    .sort((a, b) => parseClockMinutes(a[0]) - parseClockMinutes(b[0]))
    .map(([timeBucket, runtimes]) => ({
      timeBucket,
      runtimeMinutes: Math.round(median(runtimes) * 100) / 100,
    }));
}

function canonicalizeStopEntriesForDirection(
  entries: DailyStopSegmentRuntimeEntry[],
  canonicalStops: string[] | undefined,
): DailyStopSegmentRuntimeEntry[] {
  if (!canonicalStops || canonicalStops.length < 2 || entries.length === 0) return entries;

  const buildSyntheticEntriesFromPaths = (
    paths: Array<{
      fromCanonicalIndex: number;
      toCanonicalIndex: number;
      entries: DailyStopSegmentRuntimeEntry[];
    }>
  ): DailyStopSegmentRuntimeEntry[] => {
    const syntheticEntries: DailyStopSegmentRuntimeEntry[] = [];

    for (const path of paths) {
      if (path.entries.length === 0) continue;

      const observations = buildObservedPathBucketObservations(path.entries);
      if (observations.length === 0) continue;

      const firstEntry = path.entries[0];
      const lastEntry = path.entries[path.entries.length - 1];
      syntheticEntries.push({
        routeId: firstEntry.routeId,
        direction: firstEntry.direction,
        fromStopId: firstEntry.fromStopId,
        toStopId: lastEntry.toStopId,
        fromStopName: canonicalStops[path.fromCanonicalIndex],
        toStopName: canonicalStops[path.toCanonicalIndex],
        fromRouteStopIndex: path.fromCanonicalIndex + 1,
        toRouteStopIndex: path.toCanonicalIndex + 1,
        segmentName: `${canonicalStops[path.fromCanonicalIndex]} to ${canonicalStops[path.toCanonicalIndex]}`,
        observations,
      });
    }

    return syntheticEntries;
  };

  const buildSyntheticEntriesFromAnchors = (): DailyStopSegmentRuntimeEntry[] => {
  const fineStops = new Map<number, string>();
  for (const entry of entries) {
    fineStops.set(entry.fromRouteStopIndex, entry.fromStopName);
    fineStops.set(entry.toRouteStopIndex, entry.toStopName);
  }

  const orderedFineStops = Array.from(fineStops.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([routeStopIndex, stopName]) => ({ routeStopIndex, stopName }));

  const anchors: Array<{ canonicalIndex: number; routeStopIndex: number }> = [];
  let previousMatchedIndex = Number.NEGATIVE_INFINITY;

  canonicalStops.forEach((canonicalStopName, canonicalIndex) => {
    const matchedStop = orderedFineStops.find(stop => (
      stop.routeStopIndex > previousMatchedIndex
      && stopNamesLikelyMatch(stop.stopName, canonicalStopName)
    ));
    if (!matchedStop) return;
    anchors.push({
      canonicalIndex,
      routeStopIndex: matchedStop.routeStopIndex,
    });
    previousMatchedIndex = matchedStop.routeStopIndex;
  });

  if (anchors.length < 2) return entries;

  const entryByKey = new Map<string, DailyStopSegmentRuntimeEntry>();
  entries.forEach((entry) => {
    entryByKey.set(getStopSegmentKey(entry.fromRouteStopIndex, entry.toRouteStopIndex), entry);
  });

    const paths: Array<{
      fromCanonicalIndex: number;
      toCanonicalIndex: number;
      entries: DailyStopSegmentRuntimeEntry[];
    }> = [];

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const startAnchor = anchors[index];
    const endAnchor = anchors[index + 1];
    if (endAnchor.routeStopIndex <= startAnchor.routeStopIndex) continue;

    const constituentEntries: DailyStopSegmentRuntimeEntry[] = [];
    let isContiguous = true;
    for (let fineIndex = startAnchor.routeStopIndex; fineIndex < endAnchor.routeStopIndex; fineIndex += 1) {
      const segmentEntry = entryByKey.get(getStopSegmentKey(fineIndex, fineIndex + 1));
      if (!segmentEntry) {
        isContiguous = false;
        break;
      }
      constituentEntries.push(segmentEntry);
    }

    if (!isContiguous || constituentEntries.length === 0) continue;
      paths.push({
        fromCanonicalIndex: startAnchor.canonicalIndex,
        toCanonicalIndex: endAnchor.canonicalIndex,
        entries: constituentEntries,
      });
    }

    return buildSyntheticEntriesFromPaths(paths);
  };

  const buildSyntheticEntriesFromStopGraph = (): DailyStopSegmentRuntimeEntry[] => {
    const outgoing = new Map<string, DailyStopSegmentRuntimeEntry[]>();
    const observedLabels = new Map<string, Set<string>>();

    const registerStopLabel = (key: string, label: string) => {
      if (!observedLabels.has(key)) observedLabels.set(key, new Set<string>());
      observedLabels.get(key)!.add(label);
    };

    entries.forEach((entry) => {
      const fromKey = normalizeSegmentStopKey(entry.fromStopName);
      const toKey = normalizeSegmentStopKey(entry.toStopName);
      if (!fromKey || !toKey) return;

      if (!outgoing.has(fromKey)) outgoing.set(fromKey, []);
      outgoing.get(fromKey)!.push(entry);

      registerStopLabel(fromKey, entry.fromStopName);
      registerStopLabel(toKey, entry.toStopName);
    });

    outgoing.forEach((list) => {
      list.sort((a, b) => {
        const fromDiff = a.fromRouteStopIndex - b.fromRouteStopIndex;
        if (fromDiff !== 0) return fromDiff;
        const toDiff = a.toRouteStopIndex - b.toRouteStopIndex;
        if (toDiff !== 0) return toDiff;
        return a.segmentName.localeCompare(b.segmentName);
      });
    });

    const resolveObservedStopKey = (canonicalStopName: string): string | undefined => {
      const canonicalKey = normalizeSegmentStopKey(canonicalStopName);
      if (!canonicalKey) return undefined;
      if (observedLabels.has(canonicalKey)) return canonicalKey;

      for (const [observedKey, labels] of observedLabels) {
        if ([...labels].some(label => stopNamesLikelyMatch(label, canonicalStopName))) {
          return observedKey;
        }
      }

      return undefined;
    };

    const findPath = (
      startStopName: string,
      endStopName: string,
    ): DailyStopSegmentRuntimeEntry[] | null => {
      const startKey = resolveObservedStopKey(startStopName);
      const endKey = resolveObservedStopKey(endStopName);
      if (!startKey || !endKey) return null;
      if (startKey === endKey) return [];

      const queue: string[] = [startKey];
      const visited = new Set<string>([startKey]);
      const previous = new Map<string, { priorKey: string; entry: DailyStopSegmentRuntimeEntry }>();

      while (queue.length > 0) {
        const currentKey = queue.shift()!;
        if (currentKey === endKey) break;

        const options = outgoing.get(currentKey) || [];
        for (const option of options) {
          const nextKey = normalizeSegmentStopKey(option.toStopName);
          if (!nextKey || visited.has(nextKey)) continue;
          visited.add(nextKey);
          previous.set(nextKey, { priorKey: currentKey, entry: option });
          queue.push(nextKey);
        }
      }

      if (!visited.has(endKey)) return null;

      const path: DailyStopSegmentRuntimeEntry[] = [];
      let cursor = endKey;
      while (cursor !== startKey) {
        const step = previous.get(cursor);
        if (!step) return null;
        path.unshift(step.entry);
        cursor = step.priorKey;
      }

      return path;
    };

    const paths: Array<{
      fromCanonicalIndex: number;
      toCanonicalIndex: number;
      entries: DailyStopSegmentRuntimeEntry[];
    }> = [];

    for (let index = 0; index < canonicalStops.length - 1; index += 1) {
      const constituentEntries = findPath(canonicalStops[index], canonicalStops[index + 1]);
      if (!constituentEntries || constituentEntries.length === 0) continue;
      paths.push({
        fromCanonicalIndex: index,
        toCanonicalIndex: index + 1,
        entries: constituentEntries,
      });
    }

    return buildSyntheticEntriesFromPaths(paths);
  };

  const anchorSyntheticEntries = buildSyntheticEntriesFromAnchors();
  if (anchorSyntheticEntries.length >= canonicalStops.length - 1) {
    return anchorSyntheticEntries;
  }

  const graphSyntheticEntries = buildSyntheticEntriesFromStopGraph();
  if (graphSyntheticEntries.length > anchorSyntheticEntries.length) {
    return graphSyntheticEntries;
  }

  return anchorSyntheticEntries.length > 0 ? anchorSyntheticEntries : entries;
}

function canonicalizeStopEntriesByDay(
  stopEntriesByDay: Map<string, Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>>,
  canonicalDirectionStops?: Partial<Record<RouteDirection, string[]>>,
): Map<string, Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>> {
  if (!canonicalDirectionStops) return stopEntriesByDay;

  const result = new Map<string, Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>>();
  for (const [dayDate, directionMap] of stopEntriesByDay) {
    const canonicalizedDirections = new Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>();
    for (const [direction, entries] of directionMap) {
      canonicalizedDirections.set(
        direction,
        canonicalizeStopEntriesForDirection(entries, canonicalDirectionStops[direction]),
      );
    }
    result.set(dayDate, canonicalizedDirections);
  }
  return result;
}

function serializeTripPatternSegments(
  trip: DailyTripStopSegmentRuntimeEntry,
  preferStopIds: boolean = false
): string[] {
  return trip.segments.map((leg) => getSegmentIdentityKey({
    fromStopId: leg.fromStopId,
    toStopId: leg.toStopId,
    fromRouteStopIndex: leg.fromRouteStopIndex,
    toRouteStopIndex: leg.toRouteStopIndex,
    preferStopIds,
  }));
}

function buildStopNameLookupByDirection(
  stopEntriesByDay: Map<string, Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>>
): StopNameLookupByDirection {
  const lookup = new Map<RouteDirection, Map<string, string>>();

  for (const directionMap of stopEntriesByDay.values()) {
    for (const [direction, entries] of directionMap) {
      const directionLookup = lookup.get(direction) || new Map<string, string>();
      entries.forEach((entry) => {
        if (entry.fromStopId && entry.fromStopName && !directionLookup.has(entry.fromStopId)) {
          directionLookup.set(entry.fromStopId, entry.fromStopName);
        }
        if (entry.toStopId && entry.toStopName && !directionLookup.has(entry.toStopId)) {
          directionLookup.set(entry.toStopId, entry.toStopName);
        }
      });
      lookup.set(direction, directionLookup);
    }
  }

  return lookup;
}

function scorePatternAnchorMatch(
  trip: DailyTripStopSegmentRuntimeEntry,
  direction: RouteDirection,
  stopNameLookup: StopNameLookupByDirection,
  patternAnchorStops?: Partial<Record<RouteDirection, string[]>>
): number {
  const anchors = patternAnchorStops?.[direction];
  if (!anchors || anchors.length < 2 || trip.segments.length === 0) return 0;

  const directionLookup = stopNameLookup.get(direction);
  const firstSegment = trip.segments[0];
  const lastSegment = trip.segments[trip.segments.length - 1];
  const startName = directionLookup?.get(firstSegment.fromStopId);
  const endName = directionLookup?.get(lastSegment.toStopId);

  let score = 0;
  if (normalizeSegmentStopKey(startName || '') === normalizeSegmentStopKey(anchors[0] || '')) {
    score += 1;
  }
  if (normalizeSegmentStopKey(endName || '') === normalizeSegmentStopKey(anchors[anchors.length - 1] || '')) {
    score += 1;
  }

  return score;
}

function buildPreferredTripPatterns(
  tripEntriesByDay: Map<string, Map<RouteDirection, DailyTripStopSegmentRuntimeEntry[]>>,
  stopNameLookup: StopNameLookupByDirection,
  patternAnchorStops?: Partial<Record<RouteDirection, string[]>>,
  preferStopIds: boolean = false
): Map<RouteDirection, PreferredTripPattern> {
  const patternStats = new Map<RouteDirection, Map<string, {
    segmentKeys: string[];
    count: number;
    anchorScore: number;
  }>>();

  for (const directionMap of tripEntriesByDay.values()) {
    for (const [direction, trips] of directionMap) {
      const directionPatterns = patternStats.get(direction) || new Map<string, {
        segmentKeys: string[];
        count: number;
        anchorScore: number;
      }>();
      trips.forEach((trip) => {
        const segmentKeys = serializeTripPatternSegments(trip, preferStopIds);
        if (segmentKeys.length === 0) return;
        const patternKey = segmentKeys.join('>');
        const anchorScore = scorePatternAnchorMatch(trip, direction, stopNameLookup, patternAnchorStops);
        const existing = directionPatterns.get(patternKey);
        if (existing) {
          existing.count += 1;
          existing.anchorScore = Math.max(existing.anchorScore, anchorScore);
        } else {
          directionPatterns.set(patternKey, {
            segmentKeys,
            count: 1,
            anchorScore,
          });
        }
      });
      patternStats.set(direction, directionPatterns);
    }
  }

  const preferred = new Map<RouteDirection, PreferredTripPattern>();
  for (const [direction, patterns] of patternStats) {
    const chosen = Array.from(patterns.values()).sort((a, b) => {
      if (a.anchorScore !== b.anchorScore) return b.anchorScore - a.anchorScore;
      if (a.segmentKeys.length !== b.segmentKeys.length) return b.segmentKeys.length - a.segmentKeys.length;
      if (a.count !== b.count) return b.count - a.count;
      return a.segmentKeys.join('>').localeCompare(b.segmentKeys.join('>'));
    })[0];

    if (chosen) {
      preferred.set(direction, {
        segmentKeys: chosen.segmentKeys,
        segmentCount: chosen.segmentKeys.length,
        anchorScore: chosen.anchorScore,
      });
    }
  }

  return preferred;
}

function tripMatchesPreferredPattern(
  trip: DailyTripStopSegmentRuntimeEntry,
  preferredPattern?: PreferredTripPattern,
  preferStopIds: boolean = false
): boolean {
  if (!preferredPattern || preferredPattern.segmentCount === 0) return true;
  const tripPattern = serializeTripPatternSegments(trip, preferStopIds);
  if (tripPattern.length !== preferredPattern.segmentCount) return false;
  return tripPattern.every((segmentKey, index) => segmentKey === preferredPattern.segmentKeys[index]);
}

function buildRuntimeDataFromDirectionBuckets(
  dirMap: Map<string, Map<string, AggregatedSegmentBucket>>,
  canonicalRouteId: string,
  troubleshootingStatusByDirection?: Map<string, 'anchored' | 'fallback'>,
): RuntimeData[] {
  const results: RuntimeData[] = [];

  for (const [direction, segMap] of dirMap) {
    const allTimeBuckets = new Set<string>();
    const segments: SegmentRawData[] = [];

    const orderedSegments = Array.from(segMap.values()).sort((a, b) => {
      const aFrom = Number.isFinite(a.fromRouteStopIndex) ? a.fromRouteStopIndex! : Number.POSITIVE_INFINITY;
      const bFrom = Number.isFinite(b.fromRouteStopIndex) ? b.fromRouteStopIndex! : Number.POSITIVE_INFINITY;
      if (aFrom !== bFrom) return aFrom - bFrom;

      const aTo = Number.isFinite(a.toRouteStopIndex) ? a.toRouteStopIndex! : Number.POSITIVE_INFINITY;
      const bTo = Number.isFinite(b.toRouteStopIndex) ? b.toRouteStopIndex! : Number.POSITIVE_INFINITY;
      if (aTo !== bTo) return aTo - bTo;

      return 0;
    });

    for (const segment of orderedSegments) {
      const timeBuckets: Record<string, SegmentTimeBucket> = {};

      for (const [bucket, bucketData] of segment.bucketMap) {
        allTimeBuckets.add(bucket);
        const sorted = [...bucketData.values].sort((a, b) => a - b);
        const contributions: BucketContribution[] = Array.from(bucketData.dayTotals.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, runtime]) => ({ date, runtime }));
        timeBuckets[bucket] = {
          p50: Math.round(percentileInc(sorted, 0.5) * 100) / 100,
          p80: Math.round(percentileInc(sorted, 0.8) * 100) / 100,
          n: bucketData.dates.size || sorted.length,
          contributions,
        };
      }

      segments.push({
        segmentName: segment.segmentName,
        timeBuckets,
        fromRouteStopIndex: segment.fromRouteStopIndex,
        toRouteStopIndex: segment.toRouteStopIndex,
      });
    }

    const sortedBuckets = Array.from(allTimeBuckets).sort((a, b) => {
      const aMinutes = parseBucketStartMinutes(a);
      const bMinutes = parseBucketStartMinutes(b);
      if (aMinutes !== bMinutes) return aMinutes - bMinutes;
      return a.localeCompare(b);
    });

    results.push({
      segments,
      allTimeBuckets: sortedBuckets,
      detectedRouteNumber: canonicalRouteId,
      detectedDirection: direction as RouteDirection,
      sampleCountMode: 'days',
      troubleshootingPatternStatus: troubleshootingStatusByDirection?.get(direction) ?? 'anchored',
    });
  }

  return results;
}

function buildTripBucketedRuntimesFromTrips(
  filtered: DailySummary[],
  selectedRouteId: string,
  canonicalRouteId: string,
  bucketMode: PerformanceBucketMode,
  canonicalDirectionStops?: Partial<Record<RouteDirection, string[]>>,
  patternAnchorStops?: Partial<Record<RouteDirection, string[]>>,
  fullPatternOnly: boolean = false,
): RuntimeData[] | null {
  const canonicalSegmentsByDirection = new Map<RouteDirection, Map<string, CanonicalSegmentDefinition>>();
  const preferStopIdsForPatterns = !canonicalDirectionStops;
  let stopEntriesByDay = new Map<string, Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>>();
  const tripEntriesByDay = new Map<string, Map<RouteDirection, DailyTripStopSegmentRuntimeEntry[]>>();

  if (canonicalDirectionStops) {
    (Object.entries(canonicalDirectionStops) as Array<[RouteDirection, string[] | undefined]>)
      .forEach(([direction, stops]) => {
        const definitions = buildCanonicalSegmentsFromStops(direction, stops);
        if (definitions.size > 0) {
          canonicalSegmentsByDirection.set(direction, definitions);
        }
      });
  }

  for (const day of filtered) {
    const dayStops = stopEntriesByDay.get(day.date) || new Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>();
    for (const entry of day.stopSegmentRuntimes?.entries ?? []) {
      if (!routeMatchesSelection(entry.routeId, selectedRouteId)) continue;
      const direction = mapDirection(entry.direction, entry.routeId);
      const directionStops = dayStops.get(direction) || [];
      directionStops.push(entry);
      dayStops.set(direction, directionStops);

    }

    const dayTrips = tripEntriesByDay.get(day.date) || new Map<RouteDirection, DailyTripStopSegmentRuntimeEntry[]>();
    for (const entry of day.tripStopSegmentRuntimes?.entries ?? []) {
      if (!routeMatchesSelection(entry.routeId, selectedRouteId)) continue;
      const direction = mapDirection(entry.direction, entry.routeId, entry.tripName);
      const list = dayTrips.get(direction) || [];
      list.push(entry);
      dayTrips.set(direction, list);

      if (!canonicalDirectionStops) {
        const directionSegments = canonicalSegmentsByDirection.get(direction) || new Map<string, CanonicalSegmentDefinition>();
        for (const leg of entry.segments) {
          const segmentKey = getSegmentIdentityKey({
            fromStopId: leg.fromStopId,
            toStopId: leg.toStopId,
            fromRouteStopIndex: leg.fromRouteStopIndex,
            toRouteStopIndex: leg.toRouteStopIndex,
            preferStopIds: preferStopIdsForPatterns,
          });
          if (!directionSegments.has(segmentKey)) {
            directionSegments.set(segmentKey, {
              segmentKey,
              segmentName: resolveCanonicalStopToStopName(
                direction,
                leg.fromRouteStopIndex,
                leg.toRouteStopIndex,
                canonicalDirectionStops,
              ) || `${leg.fromStopId || leg.fromRouteStopIndex} to ${leg.toStopId || leg.toRouteStopIndex}`,
              fromRouteStopIndex: leg.fromRouteStopIndex,
              toRouteStopIndex: leg.toRouteStopIndex,
            });
          }
        }
        canonicalSegmentsByDirection.set(direction, directionSegments);
      }
    }
    if (dayTrips.size > 0) tripEntriesByDay.set(day.date, dayTrips);
    if (dayStops.size > 0) stopEntriesByDay.set(day.date, dayStops);
  }

  const rawStopNameLookup = buildStopNameLookupByDirection(stopEntriesByDay);
  stopEntriesByDay = canonicalizeStopEntriesByDay(stopEntriesByDay, canonicalDirectionStops);
  const preferredPatternsByDirection = fullPatternOnly
    ? buildPreferredTripPatterns(tripEntriesByDay, rawStopNameLookup, patternAnchorStops, preferStopIdsForPatterns)
    : new Map<RouteDirection, PreferredTripPattern>();
  const troubleshootingStatusByDirection = new Map<string, 'anchored' | 'fallback'>();
  if (fullPatternOnly) {
    const allDirections = new Set<RouteDirection>([
      ...canonicalSegmentsByDirection.keys(),
      ...preferredPatternsByDirection.keys(),
    ]);
    allDirections.forEach((direction) => {
      const anchors = patternAnchorStops?.[direction];
      const preferredPattern = preferredPatternsByDirection.get(direction);
      const anchored = !anchors || anchors.length < 2 || (preferredPattern?.anchorScore ?? 0) >= 2;
      troubleshootingStatusByDirection.set(direction, anchored ? 'anchored' : 'fallback');
    });
  }

  for (const [, directionMap] of stopEntriesByDay) {
    for (const [direction, entries] of directionMap) {
      const directionSegments = canonicalSegmentsByDirection.get(direction) || new Map<string, CanonicalSegmentDefinition>();
      for (const entry of entries) {
        if (fullPatternOnly) {
          const preferredPattern = preferredPatternsByDirection.get(direction);
          const entrySegmentKey = getSegmentIdentityKey({
            fromStopId: entry.fromStopId,
            toStopId: entry.toStopId,
            fromRouteStopIndex: entry.fromRouteStopIndex,
            toRouteStopIndex: entry.toRouteStopIndex,
            preferStopIds: preferStopIdsForPatterns,
          });
          if (preferredPattern && !preferredPattern.segmentKeys.includes(entrySegmentKey)) {
            continue;
          }
        }
        const segmentKey = getSegmentIdentityKey({
          fromStopId: entry.fromStopId,
          toStopId: entry.toStopId,
          fromRouteStopIndex: entry.fromRouteStopIndex,
          toRouteStopIndex: entry.toRouteStopIndex,
          preferStopIds: preferStopIdsForPatterns,
        });
        if (canonicalDirectionStops) {
          if (!directionSegments.has(segmentKey)) {
            continue;
          }
        } else {
          const canonicalSegmentName = resolveCanonicalStopToStopName(
            direction,
            entry.fromRouteStopIndex,
            entry.toRouteStopIndex,
            canonicalDirectionStops,
          ) || entry.segmentName;
          directionSegments.set(segmentKey, {
            segmentKey,
            segmentName: canonicalSegmentName,
            fromRouteStopIndex: entry.fromRouteStopIndex,
            toRouteStopIndex: entry.toRouteStopIndex,
          });
        }
      }
      if (directionSegments.size > 0) {
        canonicalSegmentsByDirection.set(direction, directionSegments);
      }
    }
  }

  if (canonicalSegmentsByDirection.size === 0) return null;

  const hasTripEntries = tripEntriesByDay.size > 0;
  const dirMap = new Map<string, Map<string, AggregatedSegmentBucket>>();

  const ensureBucket = (
    direction: RouteDirection,
    segment: CanonicalSegmentDefinition,
  ) => {
    if (!dirMap.has(direction)) dirMap.set(direction, new Map());
    const segMap = dirMap.get(direction)!;
    if (!segMap.has(segment.segmentKey)) {
      segMap.set(segment.segmentKey, {
        segmentName: segment.segmentName,
        fromRouteStopIndex: segment.fromRouteStopIndex,
        toRouteStopIndex: segment.toRouteStopIndex,
        bucketMap: new Map(),
      });
    }
    return segMap.get(segment.segmentKey)!;
  };

  const addCandidateToCycleBucket = (
    direction: RouteDirection,
    candidate: CycleBucketCandidate,
    cycleBucket: string,
    dayDate: string,
  ) => {
    candidate.details.forEach(({ segment, runtimeMinutes }) => {
      const target = ensureBucket(direction, segment);
      if (!target.bucketMap.has(cycleBucket)) {
        target.bucketMap.set(cycleBucket, { values: [], dates: new Set(), dayTotals: new Map() });
      }
      const bucket = target.bucketMap.get(cycleBucket)!;
      bucket.values.push(runtimeMinutes);
      bucket.dates.add(dayDate);
      bucket.dayTotals.set(dayDate, (bucket.dayTotals.get(dayDate) || 0) + runtimeMinutes);
    });
  };

  const buildPerTripSegments = (
    trip: DailyTripStopSegmentRuntimeEntry,
    direction: RouteDirection,
  ): Array<{ segment: CanonicalSegmentDefinition; runtimeMinutes: number }> => {
    const definitions = canonicalSegmentsByDirection.get(direction);
    if (!definitions || definitions.size === 0) return [];

    return trip.segments.map((leg) => {
      const segment = definitions.get(getSegmentIdentityKey({
        fromStopId: leg.fromStopId,
        toStopId: leg.toStopId,
        fromRouteStopIndex: leg.fromRouteStopIndex,
        toRouteStopIndex: leg.toRouteStopIndex,
        preferStopIds: preferStopIdsForPatterns,
      }));
      if (!segment) return null;
      return {
        segment,
        runtimeMinutes: Math.round(leg.runtimeMinutes * 100) / 100,
      };
    }).filter((value): value is { segment: CanonicalSegmentDefinition; runtimeMinutes: number } => value !== null);
  };

  const buildTripCandidates = (
    trips: DailyTripStopSegmentRuntimeEntry[],
    direction: RouteDirection,
  ): CycleBucketCandidate[] => (
    trips
    .filter((trip) => tripMatchesPreferredPattern(trip, preferredPatternsByDirection.get(direction), preferStopIdsForPatterns))
    .map((trip) => {
      const details = buildPerTripSegments(trip, direction);
      const definitions = canonicalSegmentsByDirection.get(direction);
      if (
        fullPatternOnly
        && canonicalDirectionStops
        && definitions
        && details.length !== definitions.size
      ) {
        return null;
      }
      if (details.length === 0) return null;
      return {
        bucket: toHalfHourBucket(trip.terminalDepartureTime),
        totalRuntime: details.reduce((sum, detail) => sum + detail.runtimeMinutes, 0),
        details,
      };
    }).filter((value): value is CycleBucketCandidate => value !== null)
  );

  const buildStopBucketCandidates = (
    entries: DailyStopSegmentRuntimeEntry[],
    direction: RouteDirection,
  ): CycleBucketCandidate[] => {
    const definitions = canonicalSegmentsByDirection.get(direction);
    if (!definitions || definitions.size === 0 || entries.length === 0) return [];

    const orderedSegments = Array.from(definitions.values()).sort((a, b) => {
      if (a.fromRouteStopIndex !== b.fromRouteStopIndex) {
        return a.fromRouteStopIndex - b.fromRouteStopIndex;
      }
      return a.toRouteStopIndex - b.toRouteStopIndex;
    });

    const entriesBySegment = new Map<string, DailyStopSegmentRuntimeEntry>();
    entries.forEach((entry) => {
      entriesBySegment.set(getSegmentIdentityKey({
        fromStopId: entry.fromStopId,
        toStopId: entry.toStopId,
        fromRouteStopIndex: entry.fromRouteStopIndex,
        toRouteStopIndex: entry.toRouteStopIndex,
        preferStopIds: preferStopIdsForPatterns,
      }), entry);
    });

    const segmentOptions = orderedSegments.map((segment) => {
      const entry = entriesBySegment.get(segment.segmentKey);
      if (!entry) return null;

      const buckets = Array.from(new Set(
        entry.observations.map(observation => observation.timeBucket)
      )).sort((a, b) => parseClockMinutes(a) - parseClockMinutes(b)).map((bucket) => {
        const values = entry.observations
          .filter(observation => observation.timeBucket === bucket)
          .map(observation => observation.runtimeMinutes);

        return {
          bucket,
          bucketRange: getHalfHourBucketRange(bucket),
          runtimeMinutes: Math.round(median(values) * 100) / 100,
        };
      });

      return {
        segment,
        buckets,
      };
    });

    if (segmentOptions.some(option => option === null)) return [];

    const resolvedSegmentOptions = segmentOptions.filter((
      option,
    ): option is {
      segment: CanonicalSegmentDefinition;
      buckets: Array<{ bucket: string; bucketRange: { start: number; end: number }; runtimeMinutes: number }>;
    } => option !== null);

    const firstSegmentOptions = resolvedSegmentOptions[0];
    if (!firstSegmentOptions || firstSegmentOptions.buckets.length === 0) return [];

    return firstSegmentOptions.buckets.map((startOption) => {
      const details: Array<{ segment: CanonicalSegmentDefinition; runtimeMinutes: number }> = [];
      let totalRuntime = 0;

      for (let index = 0; index < resolvedSegmentOptions.length; index += 1) {
        const currentSegment = resolvedSegmentOptions[index];
        const option = index === 0
          ? startOption
          : currentSegment.buckets.find((candidate) => (
            candidate.bucketRange.end >= (startOption.bucketRange.start + totalRuntime - 5)
          ));

        if (!option) return null;

        details.push({
          segment: currentSegment.segment,
          runtimeMinutes: option.runtimeMinutes,
        });
        totalRuntime += option.runtimeMinutes;
      }

      return {
        bucket: startOption.bucket,
        totalRuntime,
        details,
      };
    }).filter((value): value is CycleBucketCandidate => value !== null);
  };

  const allDays = new Set<string>([
    ...stopEntriesByDay.keys(),
    ...tripEntriesByDay.keys(),
  ]);

  for (const dayDate of allDays) {
    const dayTrips = tripEntriesByDay.get(dayDate) || new Map<RouteDirection, DailyTripStopSegmentRuntimeEntry[]>();
    const dayStops = stopEntriesByDay.get(dayDate) || new Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>();
    const bidirectional = canonicalSegmentsByDirection.has('North') && canonicalSegmentsByDirection.has('South');
    const northTrips = [...(dayTrips.get('North') || [])]
      .sort((a, b) => parseClockMinutes(a.terminalDepartureTime) - parseClockMinutes(b.terminalDepartureTime));
    const southTrips = [...(dayTrips.get('South') || [])]
      .sort((a, b) => parseClockMinutes(a.terminalDepartureTime) - parseClockMinutes(b.terminalDepartureTime));

    if (bucketMode === 'cycleStart' && bidirectional) {
      const northCandidates = northTrips.length > 0
        ? buildTripCandidates(northTrips, 'North')
        : buildStopBucketCandidates(dayStops.get('North') || [], 'North');
      const southCandidates = southTrips.length > 0
        ? buildTripCandidates(southTrips, 'South')
        : buildStopBucketCandidates(dayStops.get('South') || [], 'South');

      if (northCandidates.length > 0 && southCandidates.length > 0) {
        const southUsed = new Set<number>();

        northCandidates.forEach((northCandidate) => {
          const northBucketRange = getHalfHourBucketRange(northCandidate.bucket);
          const earliestExpectedSouthDeparture = northBucketRange.start + northCandidate.totalRuntime - 5;

          let chosenSouthIndex = -1;
          for (let index = 0; index < southCandidates.length; index += 1) {
            if (southUsed.has(index)) continue;
            const candidateRange = getHalfHourBucketRange(southCandidates[index].bucket);
            if (candidateRange.end >= earliestExpectedSouthDeparture) {
              chosenSouthIndex = index;
              break;
            }
          }

          if (chosenSouthIndex < 0) return;

          southUsed.add(chosenSouthIndex);
          addCandidateToCycleBucket('North', northCandidate, northCandidate.bucket, dayDate);
          addCandidateToCycleBucket('South', southCandidates[chosenSouthIndex], northCandidate.bucket, dayDate);
        });

        continue;
      }
    }

    const directions = new Set<RouteDirection>([
      ...dayTrips.keys(),
      ...dayStops.keys(),
    ]);

    directions.forEach((direction) => {
      const trips = (dayTrips.get(direction) || []).filter((trip) => (
        tripMatchesPreferredPattern(trip, preferredPatternsByDirection.get(direction), preferStopIdsForPatterns)
      ));
      if (trips.length > 0 && hasTripEntries) {
        trips.forEach((trip) => {
          const details = buildPerTripSegments(trip, direction);
          const definitions = canonicalSegmentsByDirection.get(direction);
          if (
            fullPatternOnly
            && canonicalDirectionStops
            && definitions
            && details.length !== definitions.size
          ) {
            return;
          }
          if (details.length === 0) return;
          const bucket = toHalfHourBucket(trip.terminalDepartureTime);
          details.forEach(({ segment, runtimeMinutes }) => {
            const target = ensureBucket(direction, segment);
            if (!target.bucketMap.has(bucket)) {
              target.bucketMap.set(bucket, { values: [], dates: new Set(), dayTotals: new Map() });
            }
            const bucketData = target.bucketMap.get(bucket)!;
            bucketData.values.push(runtimeMinutes);
            bucketData.dates.add(dayDate);
            bucketData.dayTotals.set(dayDate, (bucketData.dayTotals.get(dayDate) || 0) + runtimeMinutes);
          });
        });
        return;
      }

      const stopLevelEntries = dayStops.get(direction) || [];
      stopLevelEntries.forEach((entry) => {
        const segment = canonicalSegmentsByDirection.get(direction)?.get(getSegmentIdentityKey({
          fromStopId: entry.fromStopId,
          toStopId: entry.toStopId,
          fromRouteStopIndex: entry.fromRouteStopIndex,
          toRouteStopIndex: entry.toRouteStopIndex,
          preferStopIds: preferStopIdsForPatterns,
        }));
        if (!segment) return;

        for (const obs of entry.observations) {
          const target = ensureBucket(direction, segment);
          if (!target.bucketMap.has(obs.timeBucket)) {
            target.bucketMap.set(obs.timeBucket, { values: [], dates: new Set(), dayTotals: new Map() });
          }
          const bucketData = target.bucketMap.get(obs.timeBucket)!;
          bucketData.values.push(obs.runtimeMinutes);
          bucketData.dates.add(dayDate);
          bucketData.dayTotals.set(dayDate, (bucketData.dayTotals.get(dayDate) || 0) + obs.runtimeMinutes);
        }
      });
    });
  }

  if (dirMap.size === 0) return null;
  return buildRuntimeDataFromDirectionBuckets(
    dirMap,
    canonicalRouteId,
    fullPatternOnly ? troubleshootingStatusByDirection : undefined
  );
}

// ─── Main: Convert Performance Data → RuntimeData[] ─────────────────

export interface PerformanceRuntimeOptions {
  routeId: string;
  dayType: DayType;
  dateRange?: { start: string; end: string };
  bucketMode?: PerformanceBucketMode;
  canonicalDirectionStops?: Partial<Record<RouteDirection, string[]>>;
  patternAnchorStops?: Partial<Record<RouteDirection, string[]>>;
  fullPatternOnly?: boolean;
}

export interface PerformanceRuntimeDiagnostics {
  selectedRouteId: string;
  canonicalRouteId: string;
  filteredDayCount: number;
  matchedRouteDayCount: number;
  coarseEntryCount: number;
  stopEntryCount: number;
  tripEntryCount: number;
  matchedRouteIds: string[];
  directions: string[];
  importedAt?: string;
  runtimeLogicVersion?: number;
  isCurrentRuntimeLogic: boolean;
  usesLegacyRuntimeLogic: boolean;
}

export function inspectPerformanceRuntimeAvailability(
  dailySummaries: DailySummary[],
  options: Pick<PerformanceRuntimeOptions, 'routeId' | 'dayType' | 'dateRange'> & {
    metadata?: Pick<PerformanceMetadata, 'importedAt' | 'runtimeLogicVersion'>;
  }
): PerformanceRuntimeDiagnostics {
  const { routeId, dayType, dateRange, metadata } = options;
  const canonicalRouteId = getCanonicalRouteId(routeId);
  const filtered = dailySummaries.filter(d => {
    if (d.dayType !== dayType) return false;
    if (dateRange) {
      if (d.date < dateRange.start || d.date > dateRange.end) return false;
    }
    return true;
  });

  const matchedDays = new Set<string>();
  const matchedRouteIds = new Set<string>();
  const directions = new Set<string>();
  let coarseEntryCount = 0;
  let stopEntryCount = 0;
  let tripEntryCount = 0;

  for (const day of filtered) {
    let dayMatched = false;

    for (const entry of day.segmentRuntimes?.entries ?? []) {
      if (!routeMatchesSelection(entry.routeId, routeId)) continue;
      coarseEntryCount += 1;
      matchedRouteIds.add(normalizeRouteId(entry.routeId));
      directions.add(mapDirection(entry.direction, entry.routeId));
      dayMatched = true;
    }

    for (const entry of day.stopSegmentRuntimes?.entries ?? []) {
      if (!routeMatchesSelection(entry.routeId, routeId)) continue;
      stopEntryCount += 1;
      matchedRouteIds.add(normalizeRouteId(entry.routeId));
      directions.add(mapDirection(entry.direction, entry.routeId));
      dayMatched = true;
    }

    for (const entry of day.tripStopSegmentRuntimes?.entries ?? []) {
      if (!routeMatchesSelection(entry.routeId, routeId)) continue;
      tripEntryCount += 1;
      matchedRouteIds.add(normalizeRouteId(entry.routeId));
      directions.add(mapDirection(entry.direction, entry.routeId, entry.tripName));
      dayMatched = true;
    }

    if (dayMatched) matchedDays.add(day.date);
  }

  return {
    selectedRouteId: normalizeRouteId(routeId),
    canonicalRouteId,
    filteredDayCount: filtered.length,
    matchedRouteDayCount: matchedDays.size,
    coarseEntryCount,
    stopEntryCount,
    tripEntryCount,
    matchedRouteIds: Array.from(matchedRouteIds).sort(),
    directions: Array.from(directions).sort(),
    importedAt: metadata?.importedAt,
    runtimeLogicVersion: metadata?.runtimeLogicVersion,
    isCurrentRuntimeLogic: (metadata?.runtimeLogicVersion ?? 0) >= PERFORMANCE_RUNTIME_LOGIC_VERSION,
    usesLegacyRuntimeLogic: (metadata?.runtimeLogicVersion ?? 0) < PERFORMANCE_RUNTIME_LOGIC_VERSION,
  };
}

export function computeRuntimesFromPerformance(
  dailySummaries: DailySummary[],
  options: PerformanceRuntimeOptions
): RuntimeData[] {
  const {
    routeId,
    dayType,
    dateRange,
    bucketMode = 'cycleStart',
    canonicalDirectionStops,
    patternAnchorStops,
    fullPatternOnly = false,
  } = options;
  const canonicalRouteId = getCanonicalRouteId(routeId);

  // 1. Filter summaries by dayType and optional date range
  const filtered = dailySummaries.filter(d => {
    if (d.dayType !== dayType) return false;
    if (!d.segmentRuntimes && !d.stopSegmentRuntimes && !d.tripStopSegmentRuntimes) return false;
    if (dateRange) {
      if (d.date < dateRange.start || d.date > dateRange.end) return false;
    }
    return true;
  });

  const tripBucketedResults = buildTripBucketedRuntimesFromTrips(
    filtered,
    routeId,
    canonicalRouteId,
    bucketMode,
    canonicalDirectionStops,
    patternAnchorStops,
    fullPatternOnly,
  );
  if (tripBucketedResults && tripBucketedResults.length > 0) {
    return tripBucketedResults;
  }

  const strictCanonicalPlanning = !!canonicalDirectionStops && fullPatternOnly;
  const adjacentCanonicalSegmentsByDirection = strictCanonicalPlanning
    ? (() => {
        const definitionsByDirection = new Map<RouteDirection, Map<string, CanonicalSegmentDefinition>>();
        (Object.entries(canonicalDirectionStops) as Array<[RouteDirection, string[] | undefined]>)
          .forEach(([direction, stops]) => {
            const definitions = buildCanonicalSegmentsFromStops(direction, stops);
            if (definitions.size > 0) {
              definitionsByDirection.set(direction, definitions);
            }
          });
        return definitionsByDirection;
      })()
    : null;

  // 2. Prefer stop-to-stop runtime entries so Step 2 coverage and schedule generation
  // use the same segment model as the canonical stop chain. Timepoint segments only
  // remain as a fallback when stop-level data is absent.
  const stopEntries: Array<{ dayDate: string; entry: DailyStopSegmentRuntimeEntry }> = [];
  const allEntries: Array<{ dayDate: string; entry: DailySegmentRuntimeEntry }> = [];
  for (const day of filtered) {
    for (const entry of day.stopSegmentRuntimes?.entries ?? []) {
      if (routeMatchesSelection(entry.routeId, routeId)) {
        stopEntries.push({ dayDate: day.date, entry });
      }
    }

    if (day.segmentRuntimes) {
      for (const entry of day.segmentRuntimes.entries) {
        if (routeMatchesSelection(entry.routeId, routeId)) {
          allEntries.push({ dayDate: day.date, entry });
        }
      }
    }
  }

  if (stopEntries.length > 0 && canonicalDirectionStops) {
    const stopEntriesByDay = new Map<string, Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>>();
    for (const { dayDate, entry } of stopEntries) {
      const direction = mapDirection(entry.direction, entry.routeId);
      const dayMap = stopEntriesByDay.get(dayDate) || new Map<RouteDirection, DailyStopSegmentRuntimeEntry[]>();
      const directionEntries = dayMap.get(direction) || [];
      directionEntries.push(entry);
      dayMap.set(direction, directionEntries);
      stopEntriesByDay.set(dayDate, dayMap);
    }

    const canonicalizedByDay = canonicalizeStopEntriesByDay(stopEntriesByDay, canonicalDirectionStops);
    stopEntries.length = 0;
    for (const [dayDate, directionMap] of canonicalizedByDay) {
      for (const entries of directionMap.values()) {
        entries.forEach((entry) => {
          stopEntries.push({ dayDate, entry });
        });
      }
    }
  }

  if (stopEntries.length === 0 && allEntries.length === 0) return [];

  const dirMap = new Map<string, Map<string, {
    segmentName: string;
    fromRouteStopIndex?: number;
    toRouteStopIndex?: number;
    bucketMap: Map<string, { values: number[]; dates: Set<string>; dayTotals: Map<string, number> }>;
  }>>();

  const ensureSegmentBucket = (
    direction: string,
    segmentKey: string,
    segmentName: string,
    fromRouteStopIndex?: number,
    toRouteStopIndex?: number
  ) => {
    if (!dirMap.has(direction)) dirMap.set(direction, new Map());
    const segMap = dirMap.get(direction)!;
    if (!segMap.has(segmentKey)) {
      segMap.set(segmentKey, {
        segmentName,
        fromRouteStopIndex,
        toRouteStopIndex,
        bucketMap: new Map(),
      });
    }
    return segMap.get(segmentKey)!;
  };

  if (stopEntries.length > 0) {
    for (const { dayDate, entry } of stopEntries) {
      const dir = mapDirection(entry.direction, entry.routeId);
      const canonicalSegment = adjacentCanonicalSegmentsByDirection?.get(dir)?.get(
        getStopSegmentKey(entry.fromRouteStopIndex, entry.toRouteStopIndex)
      );
      if (strictCanonicalPlanning && !canonicalSegment) {
        continue;
      }
      const segmentKey = canonicalSegment
        ? canonicalSegment.segmentKey
        : `${entry.fromStopId || entry.fromRouteStopIndex}|${entry.toStopId || entry.toRouteStopIndex}`;
      const segmentName = canonicalSegment?.segmentName || resolveCanonicalStopToStopName(
        dir,
        entry.fromRouteStopIndex,
        entry.toRouteStopIndex,
        canonicalDirectionStops,
      ) || entry.segmentName;
      const segment = ensureSegmentBucket(
        dir,
        segmentKey,
        segmentName,
        canonicalSegment?.fromRouteStopIndex ?? entry.fromRouteStopIndex,
        canonicalSegment?.toRouteStopIndex ?? entry.toRouteStopIndex
      );

      for (const obs of entry.observations) {
        if (!segment.bucketMap.has(obs.timeBucket)) {
          segment.bucketMap.set(obs.timeBucket, { values: [], dates: new Set(), dayTotals: new Map() });
        }
        const bucket = segment.bucketMap.get(obs.timeBucket)!;
        bucket.values.push(obs.runtimeMinutes);
        bucket.dates.add(dayDate);
        bucket.dayTotals.set(dayDate, (bucket.dayTotals.get(dayDate) || 0) + obs.runtimeMinutes);
      }
    }
  }

  if (strictCanonicalPlanning && stopEntries.length === 0) {
    return [];
  }

  if (stopEntries.length === 0 && allEntries.length > 0) {
    for (const { dayDate, entry } of allEntries) {
      const dir = mapDirection(entry.direction, entry.routeId);
      const existingSegment = Array.from(dirMap.get(dir)?.entries() || []).find(([, segment]) => (
        segment.segmentName === entry.segmentName
      ));
      const segment = existingSegment
        ? ensureSegmentBucket(dir, existingSegment[0], entry.segmentName, existingSegment[1].fromRouteStopIndex, existingSegment[1].toRouteStopIndex)
        : ensureSegmentBucket(dir, entry.segmentName, entry.segmentName);

      for (const obs of entry.observations) {
        if (!segment.bucketMap.has(obs.timeBucket)) {
          segment.bucketMap.set(obs.timeBucket, { values: [], dates: new Set(), dayTotals: new Map() });
        }
        const bucket = segment.bucketMap.get(obs.timeBucket)!;
        bucket.values.push(obs.runtimeMinutes);
        bucket.dates.add(dayDate);
        bucket.dayTotals.set(dayDate, (bucket.dayTotals.get(dayDate) || 0) + obs.runtimeMinutes);
      }
    }
  }

  // 4. Compute p50/p80 per direction → return RuntimeData[]
  const results: RuntimeData[] = [];

  for (const [direction, segMap] of dirMap) {
    const allTimeBuckets = new Set<string>();
    const segments: SegmentRawData[] = [];

    const orderedSegments = Array.from(segMap.values()).sort((a, b) => {
      const aFrom = Number.isFinite(a.fromRouteStopIndex) ? a.fromRouteStopIndex! : Number.POSITIVE_INFINITY;
      const bFrom = Number.isFinite(b.fromRouteStopIndex) ? b.fromRouteStopIndex! : Number.POSITIVE_INFINITY;
      if (aFrom !== bFrom) return aFrom - bFrom;

      const aTo = Number.isFinite(a.toRouteStopIndex) ? a.toRouteStopIndex! : Number.POSITIVE_INFINITY;
      const bTo = Number.isFinite(b.toRouteStopIndex) ? b.toRouteStopIndex! : Number.POSITIVE_INFINITY;
      if (aTo !== bTo) return aTo - bTo;

      return 0;
    });

    for (const segment of orderedSegments) {
      const timeBuckets: Record<string, SegmentTimeBucket> = {};

      for (const [bucket, bucketData] of segment.bucketMap) {
        allTimeBuckets.add(bucket);
        const sorted = [...bucketData.values].sort((a, b) => a - b);
        const contributions: BucketContribution[] = Array.from(bucketData.dayTotals.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, runtime]) => ({ date, runtime }));
        timeBuckets[bucket] = {
          p50: Math.round(percentileInc(sorted, 0.5) * 100) / 100,
          p80: Math.round(percentileInc(sorted, 0.8) * 100) / 100,
          n: bucketData.dates.size || sorted.length,
          contributions,
        };
      }

      segments.push({
        segmentName: segment.segmentName,
        timeBuckets,
        fromRouteStopIndex: segment.fromRouteStopIndex,
        toRouteStopIndex: segment.toRouteStopIndex,
      });
    }

    const sortedBuckets = Array.from(allTimeBuckets).sort((a, b) => {
      const aMinutes = parseBucketStartMinutes(a);
      const bMinutes = parseBucketStartMinutes(b);
      if (aMinutes !== bMinutes) return aMinutes - bMinutes;
      return a.localeCompare(b);
    });

    results.push({
      segments,
      allTimeBuckets: sortedBuckets,
      detectedRouteNumber: canonicalRouteId,
      detectedDirection: direction as RouteDirection,
      sampleCountMode: 'days',
    });
  }

  return results;
}

// ─── Route Discovery Helper ─────────────────────────────────────────

export interface AvailableRuntimeRoute {
  routeId: string;
  routeName: string;
  directions: string[];
  dayCount: number;
  /** Days that have segment runtime data (usable for schedule generation) */
  segmentDayCount: number;
  /** Days that have stop-level or trip-stop runtime data (required for canonical stop-to-stop schedule building) */
  stopLevelDayCount: number;
  totalObs: number;
  memberRouteIds: string[];
}

export function getAvailableRuntimeRoutes(
  dailySummaries: DailySummary[],
  dayType?: DayType,
  dateRange?: { start: string; end: string }
): AvailableRuntimeRoute[] {
  // Accumulate per route from byRoute (always present) + byTrip (for directions)
  const routeMap = new Map<string, {
    routeName: string;
    directions: Set<string>;
    dates: Set<string>;
    segmentDates: Set<string>;
    stopLevelDates: Set<string>;
    totalObs: number;
    memberRouteIds: Set<string>;
  }>();

  for (const day of dailySummaries) {
    if (dayType && day.dayType !== dayType) continue;
    if (dateRange) {
      if (day.date < dateRange.start || day.date > dateRange.end) continue;
    }

    // Build route info from byRoute (always present on every DailySummary)
    for (const rm of day.byRoute) {
      const canonicalRouteId = getCanonicalRouteId(rm.routeId);
      const normalizedRouteId = normalizeRouteId(rm.routeId);
      const existing = routeMap.get(canonicalRouteId);
      if (existing) {
        existing.dates.add(day.date);
        existing.memberRouteIds.add(normalizedRouteId);
        if (!existing.routeName && rm.routeName) existing.routeName = rm.routeName;
      } else {
        routeMap.set(canonicalRouteId, {
          routeName: rm.routeName || rm.routeId,
          directions: new Set<string>(),
          dates: new Set([day.date]),
          segmentDates: new Set<string>(),
          stopLevelDates: new Set<string>(),
          totalObs: 0,
          memberRouteIds: new Set([normalizedRouteId]),
        });
      }
    }

    // Collect directions from byTrip when available
    for (const tm of day.byTrip ?? []) {
      const canonicalRouteId = getCanonicalRouteId(tm.routeId);
      const existing = routeMap.get(canonicalRouteId);
      if (existing) {
        existing.directions.add(mapDirection(tm.direction, tm.routeId, tm.tripName));
      }
    }

    // Overlay segment runtime observations (may be absent on older imports)
    if (day.segmentRuntimes) {
      for (const entry of day.segmentRuntimes.entries) {
        const canonicalRouteId = getCanonicalRouteId(entry.routeId);
        const existing = routeMap.get(canonicalRouteId);
        if (existing) {
          existing.segmentDates.add(day.date);
          existing.totalObs += entry.observations.length;
          existing.directions.add(entry.direction);
          existing.memberRouteIds.add(normalizeRouteId(entry.routeId));
        }
      }
    }

    for (const entry of day.stopSegmentRuntimes?.entries ?? []) {
      const canonicalRouteId = getCanonicalRouteId(entry.routeId);
      const existing = routeMap.get(canonicalRouteId);
      if (existing) {
        existing.stopLevelDates.add(day.date);
        existing.directions.add(entry.direction);
        existing.memberRouteIds.add(normalizeRouteId(entry.routeId));
      }
    }

    for (const entry of day.tripStopSegmentRuntimes?.entries ?? []) {
      const canonicalRouteId = getCanonicalRouteId(entry.routeId);
      const existing = routeMap.get(canonicalRouteId);
      if (existing) {
        existing.stopLevelDates.add(day.date);
        existing.directions.add(mapDirection(entry.direction, entry.routeId, entry.tripName));
        existing.memberRouteIds.add(normalizeRouteId(entry.routeId));
      }
    }
  }

  const results: AvailableRuntimeRoute[] = [];
  for (const [routeId, data] of routeMap) {
    const memberRouteIds = Array.from(data.memberRouteIds).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    results.push({
      routeId,
      routeName: data.routeName || memberRouteIds.join(' / '),
      directions: Array.from(data.directions).sort(),
      dayCount: data.dates.size,
      segmentDayCount: data.segmentDates.size,
      stopLevelDayCount: data.stopLevelDates.size,
      totalObs: data.totalObs,
      memberRouteIds,
    });
  }

  return results.sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }));
}
