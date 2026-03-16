// Performance Runtime Computer — converts stored daily segment data into RuntimeData[]
// Output is identical to parseRuntimeCSV() so the entire downstream pipeline works unchanged.

import type {
  DailySummary,
  DayType,
  DailySegmentRuntimeEntry,
  DailyStopSegmentRuntimeEntry,
} from './performanceDataTypes';
import type { RuntimeData, SegmentRawData, RouteDirection } from '../components/NewSchedule/utils/csvParser';
import { isDirectionVariant, parseRouteInfo } from './config/routeDirectionConfig';

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

function mapDirection(dir: string): RouteDirection {
  const upper = dir.toUpperCase();
  if (upper === 'N' || upper === 'NB' || upper === 'NORTH') return 'North';
  if (upper === 'S' || upper === 'SB' || upper === 'SOUTH') return 'South';
  // Loop routes: CW/CCW both map to 'Loop'
  if (upper === 'CW' || upper === 'CCW' || upper === 'LOOP') return 'Loop';
  // Letter-suffix routes (8A/8B)
  if (upper === 'A' || upper === 'EA') return 'A';
  if (upper === 'B' || upper === 'EB') return 'B';
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
  return getCanonicalRouteId(entryNormalized) === getCanonicalRouteId(selectedNormalized);
}

function parseBucketStartMinutes(bucket: string): number {
  const match = bucket.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

// ─── Main: Convert Performance Data → RuntimeData[] ─────────────────

export interface PerformanceRuntimeOptions {
  routeId: string;
  dayType: DayType;
  dateRange?: { start: string; end: string };
}

export function computeRuntimesFromPerformance(
  dailySummaries: DailySummary[],
  options: PerformanceRuntimeOptions
): RuntimeData[] {
  const { routeId, dayType, dateRange } = options;
  const canonicalRouteId = getCanonicalRouteId(routeId);

  // 1. Filter summaries by dayType and optional date range
  const filtered = dailySummaries.filter(d => {
    if (d.dayType !== dayType) return false;
    if (!d.segmentRuntimes && !d.stopSegmentRuntimes) return false;
    if (dateRange) {
      if (d.date < dateRange.start || d.date > dateRange.end) return false;
    }
    return true;
  });

  // 2. Prefer stop-level runtime entries when available because they preserve stop order.
  const stopEntries: DailyStopSegmentRuntimeEntry[] = [];
  const allEntries: DailySegmentRuntimeEntry[] = [];
  for (const day of filtered) {
    for (const entry of day.stopSegmentRuntimes?.entries ?? []) {
      if (routeMatchesSelection(entry.routeId, routeId)) {
        stopEntries.push(entry);
      }
    }

    if (day.segmentRuntimes) {
      for (const entry of day.segmentRuntimes.entries) {
        if (routeMatchesSelection(entry.routeId, routeId)) {
          allEntries.push(entry);
        }
      }
    }
  }

  if (stopEntries.length === 0 && allEntries.length === 0) return [];

  const dirMap = new Map<string, Map<string, {
    segmentName: string;
    fromRouteStopIndex?: number;
    toRouteStopIndex?: number;
    bucketMap: Map<string, number[]>;
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
    for (const entry of stopEntries) {
      const dir = mapDirection(entry.direction);
      const segmentKey = `${entry.fromStopId || entry.fromRouteStopIndex}|${entry.toStopId || entry.toRouteStopIndex}`;
      const segment = ensureSegmentBucket(
        dir,
        segmentKey,
        entry.segmentName,
        entry.fromRouteStopIndex,
        entry.toRouteStopIndex
      );

      for (const obs of entry.observations) {
        if (!segment.bucketMap.has(obs.timeBucket)) segment.bucketMap.set(obs.timeBucket, []);
        segment.bucketMap.get(obs.timeBucket)!.push(obs.runtimeMinutes);
      }
    }
  }

  for (const entry of allEntries) {
    const dir = mapDirection(entry.direction);
    const existingSegment = Array.from(dirMap.get(dir)?.entries() || []).find(([, segment]) => (
      segment.segmentName === entry.segmentName
    ));
    const segment = existingSegment
      ? ensureSegmentBucket(dir, existingSegment[0], entry.segmentName, existingSegment[1].fromRouteStopIndex, existingSegment[1].toRouteStopIndex)
      : ensureSegmentBucket(dir, entry.segmentName, entry.segmentName);

    for (const obs of entry.observations) {
      if (!segment.bucketMap.has(obs.timeBucket)) segment.bucketMap.set(obs.timeBucket, []);
      segment.bucketMap.get(obs.timeBucket)!.push(obs.runtimeMinutes);
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
      const timeBuckets: Record<string, { p50: number; p80: number; n: number }> = {};

      for (const [bucket, values] of segment.bucketMap) {
        allTimeBuckets.add(bucket);
        const sorted = [...values].sort((a, b) => a - b);
        timeBuckets[bucket] = {
          p50: Math.round(percentileInc(sorted, 0.5) * 100) / 100,
          p80: Math.round(percentileInc(sorted, 0.8) * 100) / 100,
          n: sorted.length,
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
  totalObs: number;
  memberRouteIds: string[];
}

export function getAvailableRuntimeRoutes(
  dailySummaries: DailySummary[],
  dayType?: DayType
): AvailableRuntimeRoute[] {
  // Accumulate per route from byRoute (always present) + byTrip (for directions)
  const routeMap = new Map<string, {
    routeName: string;
    directions: Set<string>;
    dates: Set<string>;
    segmentDates: Set<string>;
    totalObs: number;
    memberRouteIds: Set<string>;
  }>();

  for (const day of dailySummaries) {
    if (dayType && day.dayType !== dayType) continue;

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
          totalObs: 0,
          memberRouteIds: new Set([normalizedRouteId]),
        });
      }
    }

    // Collect directions from byTrip when available
    for (const tm of day.byTrip ?? []) {
      const canonicalRouteId = getCanonicalRouteId(tm.routeId);
      const existing = routeMap.get(canonicalRouteId);
      if (existing && tm.direction) {
        existing.directions.add(tm.direction);
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
      totalObs: data.totalObs,
      memberRouteIds,
    });
  }

  return results.sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }));
}
