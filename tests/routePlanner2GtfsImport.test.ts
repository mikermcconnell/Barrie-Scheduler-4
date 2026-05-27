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
    { route_id: '8A', service_id: 'weekday', trip_id: 't1', trip_headsign: 'To Terminal B', direction_id: 0, block_id: 'block-1', shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 't2', trip_headsign: 'To Terminal B', direction_id: 0, block_id: 'block-2', shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 't3', trip_headsign: 'To Terminal B', direction_id: 0, block_id: 'block-3', shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 't4', trip_headsign: 'To Terminal B', direction_id: 0, block_id: 'block-1', shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 't5', trip_headsign: 'To Terminal B', direction_id: 0, block_id: 'block-2', shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 't6', trip_headsign: 'To Terminal B', direction_id: 0, block_id: 'block-3', shape_id: 'shape-8a-a' },
    { route_id: '8A', service_id: 'weekday', trip_id: 'partial-1', trip_headsign: 'To Terminal B', direction_id: 0, shape_id: 'shape-8a-partial' },
  ],
  stopTimes: [
    { trip_id: 't1', arrival_time: '06:00:00', departure_time: '06:00:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't1', arrival_time: '06:05:00', departure_time: '06:05:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't1', arrival_time: '06:12:00', departure_time: '06:12:00', stop_id: 's3', stop_sequence: 3 },
    { trip_id: 't2', arrival_time: '06:30:00', departure_time: '06:30:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't2', arrival_time: '06:35:00', departure_time: '06:35:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't2', arrival_time: '06:42:00', departure_time: '06:42:00', stop_id: 's3', stop_sequence: 3 },
    { trip_id: 't3', arrival_time: '07:00:00', departure_time: '07:00:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't3', arrival_time: '07:06:00', departure_time: '07:06:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't3', arrival_time: '07:15:00', departure_time: '07:15:00', stop_id: 's3', stop_sequence: 3 },
    { trip_id: 't4', arrival_time: '07:30:00', departure_time: '07:30:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't4', arrival_time: '07:36:00', departure_time: '07:36:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't4', arrival_time: '07:45:00', departure_time: '07:45:00', stop_id: 's3', stop_sequence: 3 },
    { trip_id: 't5', arrival_time: '10:00:00', departure_time: '10:00:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't5', arrival_time: '10:10:00', departure_time: '10:10:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't5', arrival_time: '10:22:00', departure_time: '10:22:00', stop_id: 's3', stop_sequence: 3 },
    { trip_id: 't6', arrival_time: '10:30:00', departure_time: '10:30:00', stop_id: 's1', stop_sequence: 1 },
    { trip_id: 't6', arrival_time: '10:40:00', departure_time: '10:40:00', stop_id: 's2', stop_sequence: 2 },
    { trip_id: 't6', arrival_time: '10:52:00', departure_time: '10:52:00', stop_id: 's3', stop_sequence: 3 },
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
      routeColor: '000000',
      serviceId: 'weekday',
      directionId: 0,
      shapeId: 'shape-8a-a',
      tripCount: 6,
      stopCount: 3,
      firstDepartureMinutes: 360,
      lastDepartureMinutes: 630,
      medianHeadwayMinutes: 30,
      blockCount: 3,
    });
  });

  it('filters out partial GTFS patterns for the same route, service, and direction', () => {
    const patterns = buildRoutePlanner2GtfsImportPatterns(feed);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.stopCount).toBe(3);
    expect(patterns[0]?.shapeId).toBe('shape-8a-a');
  });

  it('hides GTFS patterns with five trips or fewer', () => {
    const lowTripFeed: RoutePlanner2GtfsImportFeed = {
      ...feed,
      trips: feed.trips.filter((trip) => ['t1', 't2', 't3', 't4', 't5'].includes(trip.trip_id)),
      stopTimes: feed.stopTimes.filter((stopTime) => ['t1', 't2', 't3', 't4', 't5'].includes(stopTime.trip_id)),
    };

    expect(buildRoutePlanner2GtfsImportPatterns(lowTripFeed)).toHaveLength(0);
  });

  it('creates an editable Route Planner 2 scenario from a GTFS pattern', () => {
    const pattern = buildRoutePlanner2GtfsImportPatterns(feed)[0]!;
    const scenario = createRoutePlanner2ScenarioFromGtfsPattern(pattern, { id: 'scenario-imported', now: '2026-05-01T12:00:00.000Z' });
    expect(scenario.name).toBe('Route 8A - To Terminal B');
    expect(scenario.source?.type).toBe('gtfs');
    expect(scenario.source).toMatchObject({ type: 'gtfs', routeColor: '#000000' });
    expect(scenario.stops.map(stop => stop.name)).toEqual(['Terminal A', 'Main Street', 'Terminal B']);
    expect(scenario.stops[0]?.role).toBe('start-terminal');
    expect(scenario.stops[2]?.role).toBe('end-terminal');
    expect(scenario.stops.every(stop => stop.source === 'barrie-stop')).toBe(true);
    expect(scenario.alignment.length).toBeGreaterThan(0);
    expect(scenario.runtimeEstimates?.filter((estimate) => estimate.evidencePeriod === 'full-day').map((estimate) => estimate.runtimeMinutes)).toEqual([6, 9]);
    expect(scenario.runtimeEstimates?.filter((estimate) => estimate.evidencePeriod === 'am-peak').map((estimate) => estimate.runtimeMinutes)).toEqual([6, 9]);
    expect(scenario.runtimeEstimates?.filter((estimate) => estimate.evidencePeriod === 'midday').map((estimate) => estimate.runtimeMinutes)).toEqual([10, 12]);
    expect(scenario.runtimeEstimates?.every((estimate) => estimate.source === 'scheduled-proxy' && estimate.confidence === 'high')).toBe(true);
    expect(scenario.runtimeEstimates?.every((estimate) => estimate.matchedRoutes?.includes('8A'))).toBe(true);
    expect(scenario.runtimeSourceMode).toBe('gtfs');
    expect(scenario.service).toMatchObject({
      firstTripTime: '06:00',
      lastTripTime: '10:30',
      frequencyMinutes: 30,
      targetBuses: 3,
      startTerminalLayoverMinutes: 0,
      endTerminalLayoverMinutes: 0,
      dayType: 'weekday',
      planningPeriod: 'all-day',
    });
    const feasibility = deriveRoutePlanner2Feasibility(scenario);
    expect(feasibility.segmentRuntimeMinutes).toBe(15);
    expect(feasibility.busesRequired).toBe(3);
    expect(feasibility.cycleTimeMinutes).toBe(90);
    expect(feasibility.segmentSummaries.map((segment) => segment.source)).toEqual(['scheduled-proxy', 'scheduled-proxy']);
    expect(feasibility.confidence).toBe('high');

    const middayFeasibility = deriveRoutePlanner2Feasibility({
      ...scenario,
      service: { ...scenario.service, planningPeriod: 'midday' },
    });
    expect(middayFeasibility.segmentRuntimeMinutes).toBe(22);
    expect(middayFeasibility.segmentSummaries.every((segment) => segment.evidencePeriod === 'midday')).toBe(true);
  });

  it('adds Barrie merged A/B route-family metadata to GTFS import patterns and scenarios', () => {
    const familyFeed: RoutePlanner2GtfsImportFeed = {
      ...feed,
      routes: [
        { route_id: '2A', route_short_name: '2A', route_long_name: 'Route 2 North', route_type: 3 },
        { route_id: '2B', route_short_name: '2B', route_long_name: 'Route 2 South', route_type: 3 },
      ],
      trips: feed.trips
        .filter((trip) => trip.trip_id !== 'partial-1')
        .flatMap((trip) => [
          { ...trip, route_id: '2A', trip_id: `${trip.trip_id}-2a`, trip_headsign: 'To Downtown', direction_id: 0, shape_id: 'shape-2a' },
          { ...trip, route_id: '2B', trip_id: `${trip.trip_id}-2b`, trip_headsign: 'To Park Place', direction_id: 1, shape_id: 'shape-2b' },
        ]),
      stopTimes: feed.stopTimes
        .filter((stopTime) => stopTime.trip_id !== 'partial-1')
        .flatMap((stopTime) => [
          { ...stopTime, trip_id: `${stopTime.trip_id}-2a` },
          { ...stopTime, trip_id: `${stopTime.trip_id}-2b` },
        ]),
      shapes: [
        { shape_id: 'shape-2a', shape_pt_lat: 44.37, shape_pt_lon: -79.70, shape_pt_sequence: 1 },
        { shape_id: 'shape-2a', shape_pt_lat: 44.39, shape_pt_lon: -79.68, shape_pt_sequence: 2 },
        { shape_id: 'shape-2b', shape_pt_lat: 44.39, shape_pt_lon: -79.68, shape_pt_sequence: 1 },
        { shape_id: 'shape-2b', shape_pt_lat: 44.37, shape_pt_lon: -79.70, shape_pt_sequence: 2 },
      ],
    };

    const patterns = buildRoutePlanner2GtfsImportPatterns(familyFeed);
    expect(patterns.map((pattern) => pattern.routeShortName)).toEqual(['2A', '2B']);
    expect(patterns.map((pattern) => pattern.routeFamily)).toEqual([
      {
        key: 'barrie-merged-2',
        name: 'Route 2',
        shortName: '2',
        memberShortName: '2A',
        directionRole: 'out',
        directionLabel: 'Out',
      },
      {
        key: 'barrie-merged-2',
        name: 'Route 2',
        shortName: '2',
        memberShortName: '2B',
        directionRole: 'back',
        directionLabel: 'Back',
      },
    ]);

    const scenario = createRoutePlanner2ScenarioFromGtfsPattern(patterns[0]!, { id: 'scenario-route-2a', now: '2026-05-01T12:00:00.000Z' });
    expect(scenario.name).toBe('Route 2 Out - To Downtown');
    expect(scenario.routeFamily).toMatchObject({
      key: 'barrie-merged-2',
      name: 'Route 2',
      memberShortName: '2A',
      directionRole: 'out',
      directionLabel: 'Out',
    });
    expect(scenario.source).toMatchObject({ type: 'gtfs', routeShortName: '2A' });
    expect(scenario.runtimeEstimates?.every((estimate) => estimate.matchedRoutes?.includes('2A'))).toBe(true);
  });

  it('does not family-group Barrie route variants that are not merged routes', () => {
    const pattern = buildRoutePlanner2GtfsImportPatterns(feed)[0]!;
    expect(pattern.routeShortName).toBe('8A');
    expect(pattern.routeFamily).toBeUndefined();
  });

  it('keeps adjacent same-minute GTFS stop times as scheduled evidence with a one-minute minimum', () => {
    const sameMinuteFeed: RoutePlanner2GtfsImportFeed = {
      ...feed,
      stopTimes: [
        { trip_id: 't1', arrival_time: '06:00:00', departure_time: '06:00:00', stop_id: 's1', stop_sequence: 1 },
        { trip_id: 't1', arrival_time: '06:00:00', departure_time: '06:00:00', stop_id: 's2', stop_sequence: 2 },
        { trip_id: 't1', arrival_time: '06:05:00', departure_time: '06:05:00', stop_id: 's3', stop_sequence: 3 },
        { trip_id: 't2', arrival_time: '06:30:00', departure_time: '06:30:00', stop_id: 's1', stop_sequence: 1 },
        { trip_id: 't2', arrival_time: '06:30:00', departure_time: '06:30:00', stop_id: 's2', stop_sequence: 2 },
        { trip_id: 't2', arrival_time: '06:35:00', departure_time: '06:35:00', stop_id: 's3', stop_sequence: 3 },
        { trip_id: 't3', arrival_time: '07:00:00', departure_time: '07:00:00', stop_id: 's1', stop_sequence: 1 },
        { trip_id: 't3', arrival_time: '07:00:00', departure_time: '07:00:00', stop_id: 's2', stop_sequence: 2 },
        { trip_id: 't3', arrival_time: '07:05:00', departure_time: '07:05:00', stop_id: 's3', stop_sequence: 3 },
        { trip_id: 't4', arrival_time: '07:30:00', departure_time: '07:30:00', stop_id: 's1', stop_sequence: 1 },
        { trip_id: 't4', arrival_time: '07:30:00', departure_time: '07:30:00', stop_id: 's2', stop_sequence: 2 },
        { trip_id: 't4', arrival_time: '07:35:00', departure_time: '07:35:00', stop_id: 's3', stop_sequence: 3 },
        { trip_id: 't5', arrival_time: '08:00:00', departure_time: '08:00:00', stop_id: 's1', stop_sequence: 1 },
        { trip_id: 't5', arrival_time: '08:00:00', departure_time: '08:00:00', stop_id: 's2', stop_sequence: 2 },
        { trip_id: 't5', arrival_time: '08:05:00', departure_time: '08:05:00', stop_id: 's3', stop_sequence: 3 },
        { trip_id: 't6', arrival_time: '08:30:00', departure_time: '08:30:00', stop_id: 's1', stop_sequence: 1 },
        { trip_id: 't6', arrival_time: '08:30:00', departure_time: '08:30:00', stop_id: 's2', stop_sequence: 2 },
        { trip_id: 't6', arrival_time: '08:35:00', departure_time: '08:35:00', stop_id: 's3', stop_sequence: 3 },
        { trip_id: 'partial-1', arrival_time: '07:00:00', departure_time: '07:00:00', stop_id: 's1', stop_sequence: 1 },
        { trip_id: 'partial-1', arrival_time: '07:05:00', departure_time: '07:05:00', stop_id: 's2', stop_sequence: 2 },
      ],
    };

    const pattern = buildRoutePlanner2GtfsImportPatterns(sameMinuteFeed)[0]!;
    const scenario = createRoutePlanner2ScenarioFromGtfsPattern(pattern, { id: 'scenario-imported', now: '2026-05-01T12:00:00.000Z' });

    expect(scenario.runtimeEstimates?.filter((estimate) => estimate.evidencePeriod === 'full-day')).toHaveLength(2);
    expect(scenario.runtimeEstimates?.filter((estimate) => estimate.evidencePeriod === 'full-day').map((estimate) => estimate.runtimeMinutes)).toEqual([1, 5]);
    expect(scenario.runtimeEstimates?.every((estimate) => estimate.source === 'scheduled-proxy')).toBe(true);
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
