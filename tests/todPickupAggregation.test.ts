import { describe, expect, it } from 'vitest';
import { aggregateTodPickupStops, getLatestTodPickupMonth } from '../utils/todPickupAggregation';
import type { TodPickupMonthlyDataset, TodPickupSummary } from '../utils/todPickupTypes';

function month(monthId: string, pickups: number): TodPickupMonthlyDataset {
  return {
    month: monthId,
    importedAt: '2026-06-01T00:00:00.000Z',
    importedBy: 'user-1',
    sourceFileName: `${monthId}.csv`,
    rowCount: pickups,
    mappableRows: pickups,
    skippedRows: 0,
    totalPickups: pickups,
    stops: [
      {
        id: 'downtown_44.38900_-79.69000',
        name: 'Downtown',
        lat: 44.389,
        lon: -79.69,
        pickups,
      },
    ],
  };
}

describe('todPickupAggregation', () => {
  it('returns the latest uploaded month', () => {
    const summary: TodPickupSummary = {
      months: [month('2026-04', 2), month('2026-05', 3)],
      metadata: {
        importedAt: '',
        importedBy: '',
        monthCount: 2,
        totalRows: 5,
        totalPickups: 5,
      },
      schemaVersion: 1,
    };

    expect(getLatestTodPickupMonth(summary)).toBe('2026-05');
  });

  it('aggregates selected months by stop id', () => {
    const stops = aggregateTodPickupStops(
      [month('2026-04', 2), month('2026-05', 3)],
      ['2026-04', '2026-05'],
    );

    expect(stops).toEqual([
      expect.objectContaining({
        id: 'downtown_44.38900_-79.69000',
        pickups: 5,
      }),
    ]);
  });
});
