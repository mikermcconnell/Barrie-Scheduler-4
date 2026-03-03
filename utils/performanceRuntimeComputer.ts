// Performance Runtime Computer — converts stored daily segment data into RuntimeData[]
// Output is identical to parseRuntimeCSV() so the entire downstream pipeline works unchanged.

import type { DailySummary, DayType, DailySegmentRuntimeEntry } from './performanceDataTypes';
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
    if (!d.segmentRuntimes) return false;
    if (dateRange) {
      if (d.date < dateRange.start || d.date > dateRange.end) return false;
    }
    return true;
  });

  // 2. Collect all segment entries matching routeId
  const allEntries: DailySegmentRuntimeEntry[] = [];
  for (const day of filtered) {
    for (const entry of day.segmentRuntimes!.entries) {
      if (routeMatchesSelection(entry.routeId, routeId)) {
        allEntries.push(entry);
      }
    }
  }

  if (allEntries.length === 0) return [];

  // 3. Group by direction → segmentName → timeBucket → observations
  // Structure: Map<direction, Map<segmentName, Map<timeBucket, number[]>>>
  const dirMap = new Map<string, Map<string, Map<string, number[]>>>();

  for (const entry of allEntries) {
    const dir = mapDirection(entry.direction);
    if (!dirMap.has(dir)) dirMap.set(dir, new Map());
    const segMap = dirMap.get(dir)!;

    if (!segMap.has(entry.segmentName)) segMap.set(entry.segmentName, new Map());
    const bucketMap = segMap.get(entry.segmentName)!;

    for (const obs of entry.observations) {
      if (!bucketMap.has(obs.timeBucket)) bucketMap.set(obs.timeBucket, []);
      bucketMap.get(obs.timeBucket)!.push(obs.runtimeMinutes);
    }
  }

  // 4. Compute p50/p80 per direction → return RuntimeData[]
  const results: RuntimeData[] = [];

  for (const [direction, segMap] of dirMap) {
    const allTimeBuckets = new Set<string>();
    const segments: SegmentRawData[] = [];

    for (const [segmentName, bucketMap] of segMap) {
      const timeBuckets: Record<string, { p50: number; p80: number; n: number }> = {};

      for (const [bucket, values] of bucketMap) {
        allTimeBuckets.add(bucket);
        const sorted = [...values].sort((a, b) => a - b);
        timeBuckets[bucket] = {
          p50: Math.round(percentileInc(sorted, 0.5) * 100) / 100,
          p80: Math.round(percentileInc(sorted, 0.8) * 100) / 100,
          n: sorted.length,
        };
      }

      segments.push({ segmentName, timeBuckets });
    }

    const sortedBuckets = Array.from(allTimeBuckets).sort();

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

    // Collect directions from byTrip (always present)
    for (const tm of day.byTrip) {
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
