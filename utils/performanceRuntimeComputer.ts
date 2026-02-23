// Performance Runtime Computer — converts stored daily segment data into RuntimeData[]
// Output is identical to parseRuntimeCSV() so the entire downstream pipeline works unchanged.

import type { DailySummary, DayType, DailySegmentRuntimeEntry } from './performanceDataTypes';
import type { RuntimeData, SegmentRawData, RouteDirection } from '../components/NewSchedule/utils/csvParser';

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
      if (entry.routeId === routeId) {
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
      const timeBuckets: Record<string, { p50: number; p80: number }> = {};

      for (const [bucket, values] of bucketMap) {
        allTimeBuckets.add(bucket);
        const sorted = [...values].sort((a, b) => a - b);
        timeBuckets[bucket] = {
          p50: Math.round(percentileInc(sorted, 0.5) * 100) / 100,
          p80: Math.round(percentileInc(sorted, 0.8) * 100) / 100,
        };
      }

      segments.push({ segmentName, timeBuckets });
    }

    const sortedBuckets = Array.from(allTimeBuckets).sort();

    results.push({
      segments,
      allTimeBuckets: sortedBuckets,
      detectedRouteNumber: routeId,
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
  totalObs: number;
}

export function getAvailableRuntimeRoutes(
  dailySummaries: DailySummary[],
  dayType?: DayType
): AvailableRuntimeRoute[] {
  // Accumulate per route: routeName, directions set, day dates set, obs count
  const routeMap = new Map<string, {
    routeName: string;
    directions: Set<string>;
    dates: Set<string>;
    totalObs: number;
  }>();

  for (const day of dailySummaries) {
    if (dayType && day.dayType !== dayType) continue;
    if (!day.segmentRuntimes) continue;

    for (const entry of day.segmentRuntimes.entries) {
      const existing = routeMap.get(entry.routeId);
      if (existing) {
        existing.directions.add(entry.direction);
        existing.dates.add(day.date);
        existing.totalObs += entry.observations.length;
      } else {
        // Look up routeName from the day's byRoute
        const routeMetric = day.byRoute.find(r => r.routeId === entry.routeId);
        routeMap.set(entry.routeId, {
          routeName: routeMetric?.routeName || entry.routeId,
          directions: new Set([entry.direction]),
          dates: new Set([day.date]),
          totalObs: entry.observations.length,
        });
      }
    }
  }

  const results: AvailableRuntimeRoute[] = [];
  for (const [routeId, data] of routeMap) {
    results.push({
      routeId,
      routeName: data.routeName,
      directions: Array.from(data.directions).sort(),
      dayCount: data.dates.size,
      totalObs: data.totalObs,
    });
  }

  return results.sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }));
}
