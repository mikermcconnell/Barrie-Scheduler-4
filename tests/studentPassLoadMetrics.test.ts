import { describe, expect, it } from 'vitest';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';
import {
  buildStudentPassRouteLoadLookup,
  getStudentPassRouteLoadMetric,
  isStudentPassLoadMetricSmallSample,
} from '../utils/transit-app/studentPassLoadMetrics';

const performanceData: PerformanceDataSummary = {
  dailySummaries: [
    {
      date: '2026-03-02',
      dayType: 'weekday',
      byRoute: [
        { routeId: '7A', avgLoad: 20 },
        { routeId: '8A', avgLoad: 17 },
      ],
      byRouteHour: [
        { routeId: '7A', hour: 15, avgLoad: 12, boardings: 0 },
      ],
    },
    {
      date: '2026-03-03',
      dayType: 'weekday',
      byRoute: [
        { routeId: '7A', avgLoad: 22 },
        { routeId: '8A', avgLoad: 19 },
      ],
      byRouteHour: [
        { routeId: '7A', hour: 15, avgLoad: 14, boardings: 0 },
      ],
    },
    {
      date: '2026-03-04',
      dayType: 'weekday',
      byRoute: [
        { routeId: '7A', avgLoad: 24 },
      ],
      byRouteHour: [
        { routeId: '7A', hour: 15, avgLoad: 16, boardings: 0 },
      ],
    },
    {
      date: '2026-03-07',
      dayType: 'saturday',
      byRoute: [
        { routeId: '7A', avgLoad: 30 },
      ],
      byRouteHour: [
        { routeId: '7A', hour: 15, avgLoad: 28, boardings: 0 },
      ],
    },
  ] as PerformanceDataSummary['dailySummaries'],
  metadata: {
    importedAt: '2026-03-06T00:00:00.000Z',
    importedBy: 'test-user',
    dateRange: { start: '2026-03-02', end: '2026-03-07' },
    dayCount: 4,
    totalRecords: 0,
  },
  schemaVersion: 5,
};

describe('studentPassLoadMetrics', () => {
  it('prefers route-hour averages for the matching service day type', () => {
    const lookup = buildStudentPassRouteLoadLookup(performanceData, '2026-03-03');
    const metric = getStudentPassRouteLoadMetric(lookup, '7A', 15 * 60 + 30);

    expect(metric).toMatchObject({
      routeId: '7A',
      observationDays: 3,
      source: 'route-hour',
    });
    expect(metric?.avgLoad).toBeCloseTo(14, 5);
    expect(isStudentPassLoadMetricSmallSample(metric)).toBe(true);
  });

  it('falls back to route-level averages when hour-specific data is unavailable', () => {
    const lookup = buildStudentPassRouteLoadLookup(performanceData, '2026-03-03');
    const metric = getStudentPassRouteLoadMetric(lookup, '8A', 9 * 60);

    expect(metric).toMatchObject({
      routeId: '8A',
      observationDays: 2,
      source: 'route',
    });
    expect(metric?.avgLoad).toBeCloseTo(18, 5);
  });

  it('uses the selected service date day type when building the lookup', () => {
    const lookup = buildStudentPassRouteLoadLookup(performanceData, '2026-03-07');
    const metric = getStudentPassRouteLoadMetric(lookup, '7A', 15 * 60 + 10);

    expect(lookup?.dayType).toBe('saturday');
    expect(metric).toMatchObject({
      routeId: '7A',
      observationDays: 1,
      source: 'route-hour',
    });
    expect(metric?.avgLoad).toBeCloseTo(28, 5);
  });
});
