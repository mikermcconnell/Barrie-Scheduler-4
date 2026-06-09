import { describe, expect, it } from 'vitest';
import { MAX_TOD_PICKUP_FILE_BYTES, MAX_TOD_PICKUP_ROWS, parseTodPickupCsvFile } from '../utils/todPickupParser';

function csvFile(text: string, name = 'tod-pickups.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

describe('todPickupParser', () => {
  it('aggregates pickup rows by pickup location and coordinates for the selected month', async () => {
    const file = csvFile([
      'Customer Name,Pickup Location,Pickup Latitude,Pickup Longitude,Booking ID',
      'Private Person,Downtown Terminal,44.389,-79.690,abc-1',
      'Another Person,Downtown Terminal,44.389,-79.690,abc-2',
      'Third Person,Park Place,44.338,-79.681,abc-3',
    ].join('\n'));

    const result = await parseTodPickupCsvFile(file, '2026-05', 'user-1');

    expect(result.dataset.month).toBe('2026-05');
    expect(result.dataset.rowCount).toBe(3);
    expect(result.dataset.totalPickups).toBe(3);
    expect(result.dataset.stops).toHaveLength(2);
    expect(result.dataset.stops[0]).toMatchObject({
      name: 'Downtown Terminal',
      pickups: 2,
      lat: 44.389,
      lon: -79.69,
    });
    expect(JSON.stringify(result.dataset)).not.toContain('Private Person');
    expect(JSON.stringify(result.dataset)).not.toContain('abc-1');
  });

  it('accepts common origin latitude and longitude aliases', async () => {
    const file = csvFile([
      'Origin,Origin Lat,Origin Lng',
      'Georgian Mall,44.413,-79.708',
    ].join('\n'));

    const result = await parseTodPickupCsvFile(file, '2026-05', 'user-1');

    expect(result.dataset.stops).toEqual([
      expect.objectContaining({
        name: 'Georgian Mall',
        pickups: 1,
      }),
    ]);
  });

  it('imports coordinate-only top pickup location totals', async () => {
    const file = csvFile([
      'latitude,longitude,Completed Pickups_Card',
      '44.33967301,-79.68031601,1070',
      '44.374343,-79.68892,485',
    ].join('\n'), 'Top Pickup Locations.csv');

    const result = await parseTodPickupCsvFile(file, '2026-05', 'user-1');

    expect(result.dataset.rowCount).toBe(2);
    expect(result.dataset.mappableRows).toBe(2);
    expect(result.dataset.totalPickups).toBe(1555);
    expect(result.dataset.stops[0]).toMatchObject({
      name: 'Stop at 44.33967, -79.68032',
      lat: 44.33967301,
      lon: -79.68031601,
      pickups: 1070,
    });
    expect(result.warnings).not.toContain('No pickup location/name column was found, so map labels use pickup coordinates.');
  });

  it('does not use address columns as saved stop labels', async () => {
    const file = csvFile([
      'Pickup Address,Pickup Latitude,Pickup Longitude,Pickups',
      '123 Private Street,44.389,-79.690,4',
    ].join('\n'));

    const result = await parseTodPickupCsvFile(file, '2026-05', 'user-1');

    expect(result.dataset.stops).toEqual([
      expect.objectContaining({
        name: 'Stop at 44.38900, -79.69000',
        pickups: 4,
      }),
    ]);
    expect(JSON.stringify(result.dataset)).not.toContain('123 Private Street');
  });

  it('keeps same-name stops separate when coordinates differ', async () => {
    const file = csvFile([
      'Pickup Location,Pickup Latitude,Pickup Longitude,Pickups',
      'Main Stop,44.389,-79.690,2',
      'Main Stop,44.400,-79.700,3',
    ].join('\n'));

    const result = await parseTodPickupCsvFile(file, '2026-05', 'user-1');

    expect(result.dataset.stops).toHaveLength(2);
    expect(result.dataset.totalPickups).toBe(5);
  });

  it('uses stop id to aggregate the same stop across small coordinate differences', async () => {
    const file = csvFile([
      'Stop ID,Pickup Location,Pickup Latitude,Pickup Longitude,Pickups',
      'stop-123,Main Stop,44.38900,-79.69000,2',
      'stop-123,Main Stop,44.38904,-79.69004,3',
    ].join('\n'));

    const result = await parseTodPickupCsvFile(file, '2026-05', 'user-1');

    expect(result.dataset.stops).toHaveLength(1);
    expect(result.dataset.stops[0]).toMatchObject({
      name: 'Main Stop',
      pickups: 5,
    });
    expect(result.dataset.stops[0].lat).toBeCloseTo(44.389024);
    expect(result.dataset.stops[0].lon).toBeCloseTo(-79.690024);
  });

  it('rejects oversized CSV files before reading them', async () => {
    const file = {
      name: 'tod-pickups.csv',
      size: MAX_TOD_PICKUP_FILE_BYTES + 1,
      text: async () => 'Pickup Latitude,Pickup Longitude\n44.389,-79.690',
    } as File;

    await expect(parseTodPickupCsvFile(file, '2026-05', 'user-1')).rejects.toThrow(
      'TOD pickup CSV is too large. Upload a file smaller than 5 MB.',
    );
  });

  it('rejects CSVs above the row limit', async () => {
    const rows = Array.from({ length: MAX_TOD_PICKUP_ROWS + 1 }, () => '44.389,-79.690').join('\n');
    const file = csvFile(`Pickup Latitude,Pickup Longitude\n${rows}`);

    await expect(parseTodPickupCsvFile(file, '2026-05', 'user-1')).rejects.toThrow(
      `TOD pickup CSV is too large. Upload ${MAX_TOD_PICKUP_ROWS.toLocaleString()} rows or fewer.`,
    );
  });

  it('reports missing required columns clearly', async () => {
    const file = csvFile([
      'Pickup Location,Some Other Column',
      'Downtown,123',
    ].join('\n'));

    await expect(parseTodPickupCsvFile(file, '2026-05', 'user-1')).rejects.toThrow(
      'Missing required TOD pickup columns: pickup latitude, pickup longitude.',
    );
  });

  it('requires the user-selected month', async () => {
    const file = csvFile([
      'Pickup Location,Pickup Latitude,Pickup Longitude',
      'Downtown,44.389,-79.690',
    ].join('\n'));

    await expect(parseTodPickupCsvFile(file, '', 'user-1')).rejects.toThrow(
      'Choose a valid data month before importing.',
    );
  });
});
