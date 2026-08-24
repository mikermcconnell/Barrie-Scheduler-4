import { describe, expect, it } from 'vitest';
import {
  aggregateTodDailyLocations,
  getTodActivityValue,
} from '../utils/todPickupAggregation';
import type { TodDailyKpiDataset } from '../utils/todPickupTypes';

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
  });
});
