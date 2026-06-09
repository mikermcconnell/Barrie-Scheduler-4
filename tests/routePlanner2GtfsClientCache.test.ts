import { describe, expect, it, vi } from 'vitest';

import { loadRoutePlanner2GtfsImportPatterns } from '../utils/route-planner-2/routePlanner2GtfsClient';
import { ROUTE_PLANNER_2_GTFS_CACHE_MAX_AGE_MS } from '../utils/route-planner-2/routePlanner2GtfsCache';
import type { RoutePlanner2GtfsImportFeed } from '../utils/route-planner-2/routePlanner2GtfsImport';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function buildFeed(): RoutePlanner2GtfsImportFeed {
  const trips = Array.from({ length: 6 }, (_, index) => ({
    route_id: 'route-1',
    service_id: 'weekday',
    trip_id: `trip-${index + 1}`,
    trip_headsign: 'To Terminal',
    direction_id: 0,
    shape_id: 'shape-1',
  }));

  const stopTimes = trips.flatMap((trip, index) => {
    const departureHour = 6 + index;
    return [
      {
        trip_id: trip.trip_id,
        arrival_time: `${String(departureHour).padStart(2, '0')}:00:00`,
        departure_time: `${String(departureHour).padStart(2, '0')}:00:00`,
        stop_id: 'stop-1',
        stop_sequence: 1,
      },
      {
        trip_id: trip.trip_id,
        arrival_time: `${String(departureHour).padStart(2, '0')}:15:00`,
        departure_time: `${String(departureHour).padStart(2, '0')}:15:00`,
        stop_id: 'stop-2',
        stop_sequence: 2,
      },
    ];
  });

  return {
    routes: [{ route_id: 'route-1', route_short_name: '1', route_long_name: 'Route 1', route_color: '0EA5E9' }],
    stops: [
      { stop_id: 'stop-1', stop_code: '1001', stop_name: 'Terminal A', stop_lat: 44.38, stop_lon: -79.69 },
      { stop_id: 'stop-2', stop_code: '1002', stop_name: 'Terminal B', stop_lat: 44.39, stop_lon: -79.68 },
    ],
    trips,
    stopTimes,
    calendar: [{ service_id: 'weekday', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, start_date: '20260101', end_date: '20261231' }],
    shapes: [
      { shape_id: 'shape-1', shape_pt_lat: 44.38, shape_pt_lon: -79.69, shape_pt_sequence: 1 },
      { shape_id: 'shape-1', shape_pt_lat: 44.39, shape_pt_lon: -79.68, shape_pt_sequence: 2 },
    ],
  };
}

function mockGtfsFetch(feed = buildFeed()) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => feed,
  })) as unknown as typeof fetch;
}

describe('loadRoutePlanner2GtfsImportPatterns cache', () => {
  it('uses cached parsed GTFS route patterns until refresh or expiry', async () => {
    const storage = new MemoryStorage();
    const fetchImpl = mockGtfsFetch();

    const first = await loadRoutePlanner2GtfsImportPatterns({ fetchImpl, cacheStorage: storage, now: 1_000 });
    const second = await loadRoutePlanner2GtfsImportPatterns({ fetchImpl, cacheStorage: storage, now: 2_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);

    await loadRoutePlanner2GtfsImportPatterns({ fetchImpl, cacheStorage: storage, forceRefresh: true, now: 3_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await loadRoutePlanner2GtfsImportPatterns({
      fetchImpl,
      cacheStorage: storage,
      now: 3_000 + ROUTE_PLANNER_2_GTFS_CACHE_MAX_AGE_MS + 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
