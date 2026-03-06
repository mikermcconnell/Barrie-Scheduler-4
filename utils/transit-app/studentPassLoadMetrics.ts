import type {
  DayType,
  PerformanceDataSummary,
} from '../performanceDataTypes';
import { deriveDayTypeFromDate } from '../performanceDataTypes';

export const SMALL_SAMPLE_DAYS_THRESHOLD = 10;

export interface StudentPassRouteLoadMetric {
  routeId: string;
  avgLoad: number;
  observationDays: number;
  source: 'route-hour' | 'route';
  hour?: number;
}

export interface StudentPassRouteLoadLookup {
  dayType: DayType;
  byRouteHour: Map<string, StudentPassRouteLoadMetric>;
  byRoute: Map<string, StudentPassRouteLoadMetric>;
}

type LoadAccumulator = {
  routeId: string;
  totalLoad: number;
  observationDays: number;
  hour?: number;
};

function normalizeRouteId(routeId: string): string {
  return routeId.trim().replace(/^rt\s+/i, '').toUpperCase();
}

function buildRouteHourKey(routeId: string, hour: number): string {
  return `${normalizeRouteId(routeId)}|${hour}`;
}

function finalizeAccumulator(
  accumulator: LoadAccumulator,
  source: StudentPassRouteLoadMetric['source']
): StudentPassRouteLoadMetric {
  return {
    routeId: accumulator.routeId,
    avgLoad: accumulator.observationDays > 0
      ? accumulator.totalLoad / accumulator.observationDays
      : 0,
    observationDays: accumulator.observationDays,
    source,
    hour: accumulator.hour,
  };
}

export function buildStudentPassRouteLoadLookup(
  performanceData: PerformanceDataSummary | null | undefined,
  serviceDate: string
): StudentPassRouteLoadLookup | null {
  if (!performanceData?.dailySummaries?.length) return null;

  const dayType = deriveDayTypeFromDate(serviceDate);
  const relevantDays = performanceData.dailySummaries.filter((day) => day.dayType === dayType);
  if (!relevantDays.length) return null;

  const routeHourAccumulators = new Map<string, LoadAccumulator>();
  const routeAccumulators = new Map<string, LoadAccumulator>();

  for (const day of relevantDays) {
    for (const routeHour of day.byRouteHour ?? []) {
      const normalizedRouteId = normalizeRouteId(routeHour.routeId);
      const key = buildRouteHourKey(normalizedRouteId, routeHour.hour);
      const existing = routeHourAccumulators.get(key);
      if (existing) {
        existing.totalLoad += routeHour.avgLoad;
        existing.observationDays += 1;
      } else {
        routeHourAccumulators.set(key, {
          routeId: normalizedRouteId,
          totalLoad: routeHour.avgLoad,
          observationDays: 1,
          hour: routeHour.hour,
        });
      }
    }

    for (const route of day.byRoute) {
      const normalizedRouteId = normalizeRouteId(route.routeId);
      const existing = routeAccumulators.get(normalizedRouteId);
      if (existing) {
        existing.totalLoad += route.avgLoad;
        existing.observationDays += 1;
      } else {
        routeAccumulators.set(normalizedRouteId, {
          routeId: normalizedRouteId,
          totalLoad: route.avgLoad,
          observationDays: 1,
        });
      }
    }
  }

  return {
    dayType,
    byRouteHour: new Map(
      Array.from(routeHourAccumulators.entries()).map(([key, accumulator]) => [
        key,
        finalizeAccumulator(accumulator, 'route-hour'),
      ])
    ),
    byRoute: new Map(
      Array.from(routeAccumulators.entries()).map(([key, accumulator]) => [
        key,
        finalizeAccumulator(accumulator, 'route'),
      ])
    ),
  };
}

export function getStudentPassRouteLoadMetric(
  lookup: StudentPassRouteLoadLookup | null | undefined,
  routeId: string,
  departureMinutes?: number
): StudentPassRouteLoadMetric | null {
  if (!lookup) return null;

  const normalizedRouteId = normalizeRouteId(routeId);
  if (departureMinutes != null) {
    const departureHour = Math.floor(departureMinutes / 60) % 24;
    const byHour = lookup.byRouteHour.get(buildRouteHourKey(normalizedRouteId, departureHour));
    if (byHour) return byHour;
  }

  return lookup.byRoute.get(normalizedRouteId) ?? null;
}

export function isStudentPassLoadMetricSmallSample(
  metric: StudentPassRouteLoadMetric | null | undefined
): boolean {
  return !!metric && metric.observationDays > 0 && metric.observationDays < SMALL_SAMPLE_DAYS_THRESHOLD;
}
