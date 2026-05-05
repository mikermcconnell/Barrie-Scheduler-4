import { describe, expect, it } from 'vitest';
import {
  buildRoutePlanner2GtfsImportPatterns,
  createRoutePlanner2ScenarioFromGtfsPattern,
  simplifyRoutePlanner2GtfsShapePoints,
    type RoutePlanner2GtfsImportFeed,
} from '../utils/route-planner-2/routePlanner2GtfsImport';
import { deriveRoutePlanner2Feasibility } from '../utils/route-planner-2/routePlanner2Feasibility';

const feed: RoutePlanner2GtfsImportFeed = {
  routes: [{ route_id: '8A', route_short_name: '8A', route_long_name: 'RVH/Yonge', route_type: 3, route_color: '00AEEF' }],
  stops: [
    { stop_id: 's1', stop_code: '1001', stop_name: 'Terminal A', stop_lat: 44.37, stop_lon: -79.70 },
    { stop_id: 's2', stop_code: '1002', stop_name: 'Main Street', stop_lat: 44.38, stop_lon: -79.69 },
    { stop_id: 's3', stop_code: '1003', stop_name: 'Terminal B', stop_lat: 44.39, stop_lon: -79.68 },
  ],
  trips: [
    { route_id: '8A', service_id: 'weekday', trip_id: 't1', trip_headsign: 'To Terminal B', direction_id: 0, shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 't2', trip_headsign: 'To Terminal B', direction_id: 0, shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 'partial-1', trip_headsign: 'To Terminal B', direction_id: 0, shape_id: 'shape-8a-partial' },
  ],
  stopTimes: [
    { trip_id: 't1', arrival_time: '06:00:00', departure_time: '06:00:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't1', arrival_time: '06:05:00', departure_time: '06:05:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't1', arrival_time: '06:12:00', departure_time: '06:12:00', stop_id: 's3', stop_sequence: 3 },
    { trip_id: 't2', arrival_time: '06:30:00', departure_time: '06:30:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't2', arrival_time: '06:35:00', departure_time: '06:35:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't2', arrival_time: '06:42:00', departure_time: '06:42:00', stop_id: 's3', stop_sequence: 3 },
    { trip_id: 'partial-1', arrival_time: '07:00:00', departure_time: '07:00:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 'partial-1', arrival_time: '07:05:00', departure_time: '07:05:00', stop_id: 's2', stop_sequence: 2 },
  ],
  calendar: [{ service_id: 'weekday', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0, start_date: '20260101', end_date: '20261231' }],
  calendarDates: [] as unknown[],
  shapes: [
    { shape_id: 'shape-8a-a', shape_pt_lat: 44.37, shape_pt_lon: -79.70, shape_pt_sequence: 1 },
    { shape_id: 'shape-8a-a', shape_pt_lat: 44.375, shape_pt_lon: -79.695, shape_pt_sequence: 2 },
    { shape_id: 'shape-8a-a', shape_pt_lat: 44.38, shape_pt_lon: -79.69, shape_pt_sequence: 3 },
    { shape_id: 'shape-8a-a', shape_pt_lat: 44.39, shape_pt_lon: -79.68, shape_pt_sequence: 4 },
    { shape_id: 'shape-8a-partial', shape_pt_lat: 44.37, shape_pt_lon: -79.70, shape_pt_sequence: 1 },
    { shape_id: 'shape-8a-partial', shape_pt_lat: 44.38, shape_pt_lon: -79.69, shape_pt_sequence: 2 },
  ],
};

describe('routePlanner2GtfsImport', () => {
  it('groups trips into selectable GTFS import patterns', () => {
    const patterns = buildRoutePlanner2GtfsImportPatterns(feed);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      routeId: '8A',
      routeShortName: '8A',
      serviceId: 'weekday',
      directionId: 0,
      shapeId: 'shape-8a-a',
      tripCount: 2,
      stopCount: 3,
    });
  });

  it('filters out partial GTFS patterns for the same route, service, and direction', () => {
    const patterns = buildRoutePlanner2GtfsImportPatterns(feed);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.stopCount).toBe(3);
    expect(patterns[0]?.shapeId).toBe('shape-8a-a');
  });

  it('creates an editable Route Planner 2 scenario from a GTFS pattern', () => {
    const pattern = buildRoutePlanner2GtfsImportPatterns(feed)[0]!;
    const scenario = createRoutePlanner2ScenarioFromGtfsPattern(pattern, { id: 'scenario-imported', now: '2026-05-01T12:00:00.000Z' });
    expect(scenario.name).toBe('Route 8A - To Terminal B');
    expect(scenario.source?.type).toBe('gtfs');
    expect(scenario.stops.map(stop => stop.name)).toEqual(['Terminal A', 'Main Street', 'Terminal B']);
    expect(scenario.stops[0]?.role).toBe('start-terminal');
    expect(scenario.stops[2]?.role).toBe('end-terminal');
    expect(scenario.stops.every(stop => stop.source === 'barrie-stop')).toBe(true);
    expect(scenario.alignment.length).toBeGreaterThan(0);
    expect(scenario.runtimeEstimates?.map((estimate) => estimate.runtimeMinutes)).toEqual([5, 7]);
    expect(scenario.runtimeEstimates?.every((estimate) => estimate.source === 'scheduled-proxy' && estimate.confidence === 'high')).toBe(true);
    expect(scenario.runtimeEstimates?.every((estimate) => estimate.matchedRoutes?.includes('8A'))).toBe(true);
    expect(deriveRoutePlanner2Feasibility(scenario).confidence).toBe('high');
  });

  it('simplifies dense shape points while preserving endpoints', () => {
    const dense = Array.from({ length: 80 }, (_, index) => ({ lat: 44 + index * 0.001, lng: -79 - index * 0.001, sequence: index + 1 }));
    const simplified = simplifyRoutePlanner2GtfsShapePoints(dense, 20);
    expect(simplified.length).toBeLessThanOrEqual(20);
    expect(simplified[0]).toEqual(dense[0]);
    expect(simplified[simplified.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it('loads GTFS patterns through the proxy client', async () => {
    const { loadRoutePlanner2GtfsImportPatterns } = await import('../utils/route-planner-2/routePlanner2GtfsClient');
    const calls: string[] = [];
    const patterns = await loadRoutePlanner2GtfsImportPatterns({
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => feed } as Response;
      }) as typeof fetch,
    });
    expect(calls[0]).toContain('/api/gtfs?includeShapes=true');
    expect(patterns).toHaveLength(1);
  });
});
