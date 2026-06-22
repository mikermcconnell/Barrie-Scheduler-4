import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  optimizeRoutePlanner2StopsApproximately,
  optimizeRoutePlanner2StopsByRoadTime,
  type RoutePlanner2OptimizationStop,
} from '../utils/route-planner-2/routePlanner2StopOptimization';

function stop(id: string, name: string, lat: number, lng: number): RoutePlanner2OptimizationStop {
  return {
    id,
    name,
    address: `${name} address`,
    lat,
    lng,
    occurrenceCount: 1,
    notes: '',
    sourceRows: [1],
  };
}

function fetcherWithDurations(durations: Record<string, number>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const coordinates = String(input).match(/driving\/([^?]+)/)?.[1] ?? '';
    const [from, to] = coordinates.split(';');
    const duration = durations[`${from}>${to}`] ?? 9999;

    return {
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          duration,
          distance: duration * 10,
          geometry: {
            type: 'LineString',
            coordinates: [
              from!.split(',').map(Number),
              to!.split(',').map(Number),
            ],
          },
        }],
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('routePlanner2StopOptimization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps terminals fixed and finds the lowest road-time order', async () => {
    const start = stop('start', 'Start', 44.1, -79.1);
    const a = stop('a', 'A', 44.2, -79.2);
    const b = stop('b', 'B', 44.3, -79.3);
    const end = stop('end', 'End', 44.4, -79.4);
    const fetchImpl = fetcherWithDurations({
      '-79.1,44.1>-79.2,44.2': 10,
      '-79.1,44.1>-79.3,44.3': 100,
      '-79.2,44.2>-79.3,44.3': 10,
      '-79.3,44.3>-79.2,44.2': 100,
      '-79.2,44.2>-79.4,44.4': 100,
      '-79.3,44.3>-79.4,44.4': 10,
    });

    const result = await optimizeRoutePlanner2StopsByRoadTime(start, [b, a], end, {
      token: 'test-token',
      fetchImpl,
    });

    expect(result.method).toBe('exact-road-time');
    expect(result.orderedStops.map((item) => item.id)).toEqual(['start', 'a', 'b', 'end']);
    expect(result.totalDurationSeconds).toBe(30);
    expect(result.orderedStops[0]?.role).toBe('start-terminal');
    expect(result.orderedStops.at(-1)?.role).toBe('end-terminal');
  });

  it('fails instead of silently using fallback travel time', async () => {
    await expect(optimizeRoutePlanner2StopsByRoadTime(
      stop('start-x', 'Start X', 44.11, -79.11),
      [stop('a-x', 'A X', 44.22, -79.22)],
      stop('end-x', 'End X', 44.44, -79.44),
      { token: null },
    )).rejects.toThrow('Road-time optimization needs Mapbox travel time');
  });

  it('uses zero travel time for co-located geocoded stops instead of failing Mapbox validation', async () => {
    const start = stop('start', 'Start', 44.39, -79.70);
    const firstUnit = stop('first-unit', '1009-49 Coulter ST', 44.400757, -79.706446);
    const secondUnit = stop('second-unit', '1407-49 Coulter St', 44.400757, -79.706446);
    const end = stop('end', 'End', 44.41, -79.69);
    const fetchImpl = fetcherWithDurations({});

    const result = await optimizeRoutePlanner2StopsByRoadTime(start, [firstUnit, secondUnit], end, {
      token: 'test-token',
      fetchImpl,
    });
    const callUrls = vi.mocked(fetchImpl).mock.calls.map((call) => String(call[0]));

    expect(result.method).toBe('exact-road-time');
    expect(result.orderedStops[0]?.id).toBe('start');
    expect(result.orderedStops.at(-1)?.id).toBe('end');
    expect(new Set(result.orderedStops.slice(1, -1).map((item) => item.id))).toEqual(new Set(['first-unit', 'second-unit']));
    expect(result.totalDurationSeconds).toBeLessThan(9999 * 3);
    expect(callUrls.some((url) => url.includes('-79.706446,44.400757;-79.706446,44.400757'))).toBe(false);
  });

  it('uses the configured Mapbox token when no token override is provided', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'env-mapbox-token');
    const fetchImpl = fetcherWithDurations({
      '-79.51,44.51>-79.52,44.52': 10,
      '-79.52,44.52>-79.53,44.53': 10,
      '-79.51,44.51>-79.53,44.53': 20,
      '-79.53,44.53>-79.52,44.52': 10,
      '-79.52,44.52>-79.51,44.51': 10,
      '-79.53,44.53>-79.51,44.51': 20,
    });

    await optimizeRoutePlanner2StopsByRoadTime(
      stop('start-env', 'Start Env', 44.51, -79.51),
      [stop('a-env', 'A Env', 44.52, -79.52)],
      stop('end-env', 'End Env', 44.53, -79.53),
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalled();
    expect(String(vi.mocked(fetchImpl).mock.calls[0]?.[0])).toContain('access_token=env-mapbox-token');
  });

  it('can explicitly use approximate distance ordering when road time is unavailable', () => {
    const result = optimizeRoutePlanner2StopsApproximately(
      stop('start', 'Start', 44.1, -79.1),
      [
        stop('far', 'Far', 44.8, -79.8),
        stop('near', 'Near', 44.2, -79.2),
      ],
      stop('end', 'End', 44.3, -79.3),
    );

    expect(result.method).toBe('approximate-distance');
    expect(result.orderedStops.map((item) => item.id)).toEqual(['start', 'near', 'far', 'end']);
    expect(result.totalDistanceMeters).toBeGreaterThan(0);
  });

  it('uses exact road-time ordering for a 13-stop import with fixed endpoints', async () => {
    const start = stop('start', 'South start', 44.30, -79.69);
    const end = stop('end', 'North end', 44.45, -79.66);
    const intermediateStops = Array.from({ length: 11 }, (_, index) => (
      stop(`stop-${index + 1}`, `Stop ${index + 1}`, 44.31 + index * 0.01, -79.69 + index * 0.002)
    ));
    const idealOrder = ['start', ...intermediateStops.map((item) => item.id), 'end'];
    const stopById = new Map([start, ...intermediateStops, end].map((item) => [item.id, item]));
    const indexById = new Map(idealOrder.map((id, index) => [id, index]));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const coordinates = String(input).match(/driving\/([^?]+)/)?.[1] ?? '';
      const [from, to] = coordinates.split(';');
      const fromStop = [...stopById.values()].find((item) => `${item.lng},${item.lat}` === from);
      const toStop = [...stopById.values()].find((item) => `${item.lng},${item.lat}` === to);
      const fromOrder = indexById.get(fromStop?.id ?? '') ?? 0;
      const toOrder = indexById.get(toStop?.id ?? '') ?? 0;
      const isForwardAdjacent = toOrder === fromOrder + 1;
      const duration = isForwardAdjacent ? 60 : 600 + Math.abs(toOrder - fromOrder) * 60;

      return {
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{
            duration,
            distance: duration * 10,
            geometry: {
              type: 'LineString',
              coordinates: [
                from!.split(',').map(Number),
                to!.split(',').map(Number),
              ],
            },
          }],
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await optimizeRoutePlanner2StopsByRoadTime(start, [...intermediateStops].reverse(), end, {
      token: 'test-token',
      fetchImpl,
    });

    expect(result.method).toBe('exact-road-time');
    expect(result.orderedStops.map((item) => item.id)).toEqual(idealOrder);
  });

  it('warns when an optimized order materially backtracks across the route corridor', async () => {
    const result = await optimizeRoutePlanner2StopsByRoadTime(
      stop('start', 'South start', 44.30, -79.69),
      [
        stop('north-1', 'North 1', 44.45, -79.68),
        stop('south-1', 'South 1', 44.32, -79.67),
        stop('north-2', 'North 2', 44.44, -79.66),
      ],
      stop('end', 'North end', 44.46, -79.65),
      {
        token: 'test-token',
        fetchImpl: fetcherWithDurations({}),
        exactStopLimit: 0,
      },
    );

    expect(result.warnings).toContain('This optimized order appears to backtrack across the route corridor. Review the stop sequence before adding it.');
  });
});
