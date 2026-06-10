import { describe, expect, it, vi } from 'vitest';

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
});
