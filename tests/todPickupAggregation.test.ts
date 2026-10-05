import { describe, expect, it } from 'vitest';
import {
  aggregateTodDailyLocations,
  getTodActivityValue,
  mergeTodIntoStopActivity,
} from '../utils/todPickupAggregation';
import type { TodDailyKpiDataset } from '../utils/todPickupTypes';
import type { StopMetrics } from '../utils/performanceDataTypes';

function stop(overrides: Partial<StopMetrics> = {}): StopMetrics {
  return {
    stopName: 'Stop 777', stopId: '777', lat: 44.38, lon: -79.69, isTimepoint: true,
    otp: { total: 1, onTime: 1, early: 0, late: 0, onTimePercent: 100, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 },
    boardings: 20, alightings: 10, avgLoad: 0, routeCount: 1, routes: ['10'],
    ...overrides,
  };
}

function report(
  date: string,
  locations: TodDailyKpiDataset['locations'],
): TodDailyKpiDataset {
  return {
    date,
    importedAt: `${date}T12:00:00.000Z`,
    importedBy: 'auto-ingest',
    sourceFileName: `${date}.xlsx`,
    rowCount: locations.length * 2,
    totalCompletedTrips: locations.reduce((sum, location) => sum + location.pickups, 0),
    totalDropoffs: locations.reduce((sum, location) => sum + location.dropoffs, 0),
    locations,
  };
}

describe('TOD daily activity aggregation', () => {
  it('aggregates only reports included by the Ridership period', () => {
    const locations = aggregateTodDailyLocations([
      report('2026-08-22', [
        { id: 'stop-777', name: 'Stop 777', lat: 44.38, lon: -79.69, pickups: 4, dropoffs: 6 },
      ]),
      report('2026-08-23', [
        { id: 'stop-777', name: 'Stop 777', lat: 44.39, lon: -79.68, pickups: 13, dropoffs: 19 },
        { id: 'stop-9009', name: 'Stop 9009', lat: 44.4, lon: -79.67, pickups: 10, dropoffs: 15 },
      ]),
    ], ['2026-08-23']);

    expect(locations).toEqual([
      expect.objectContaining({ id: 'stop-777', pickups: 13, dropoffs: 19, lat: 44.39, lon: -79.68 }),
      expect.objectContaining({ id: 'stop-9009', pickups: 10, dropoffs: 15 }),
    ]);
  });

  it('sums both metrics and weights coordinates across selected reports', () => {
    const locations = aggregateTodDailyLocations([
      report('2026-08-22', [
        { id: 'stop-777', name: 'Stop 777', lat: 44, lon: -79, pickups: 2, dropoffs: 2 },
      ]),
      report('2026-08-23', [
        { id: 'stop-777', name: 'Stop 777', lat: 46, lon: -81, pickups: 6, dropoffs: 6 },
      ]),
    ], ['2026-08-22', '2026-08-23']);

    expect(locations).toEqual([
      expect.objectContaining({
        id: 'stop-777',
        pickups: 8,
        dropoffs: 8,
        lat: 45.5,
        lon: -80.5,
      }),
    ]);
    expect(getTodActivityValue(locations[0], 'pickups')).toBe(8);
    expect(getTodActivityValue(locations[0], 'dropoffs')).toBe(8);
    expect(getTodActivityValue(locations[0], 'activity')).toBe(16);
  });

  it('adds TOD pickups and drop-offs to matching fixed-route stops and retains unmatched locations', () => {
    const merged = mergeTodIntoStopActivity([stop()], [
      { id: 'stop-777', name: 'Stop 777', lat: 44.39, lon: -79.68, pickups: 3, dropoffs: 4 },
      { id: 'custom-zone', name: 'Hospital Zone', lat: 44.4, lon: -79.67, pickups: 5, dropoffs: 6 },
    ]);

    expect(merged[0]).toEqual(expect.objectContaining({
      stopId: '777',
      boardings: 23,
      alightings: 14,
      fixedRouteBoardings: 20,
      fixedRouteAlightings: 10,
      todPickups: 3,
      todDropoffs: 4,
      activitySource: 'combined',
    }));
    expect(merged[1]).toEqual(expect.objectContaining({
      stopId: 'tod:custom-zone',
      stopName: 'Hospital Zone',
      boardings: 5,
      alightings: 6,
      routeCount: 0,
      routes: [],
      activitySource: 'transit-on-demand',
    }));
  });
});
