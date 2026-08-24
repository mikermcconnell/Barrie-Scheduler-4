import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseTodDailyKpiWorkbook } from '../utils/todDailyKpiParser';

function workbookFile(rows: unknown[][], name = 'custom_api3_Licensee KPI.xlsx'): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'custom_api3_Licensee KPI');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes,
  } as File;
}

const header = [
  'Licensee', 'Origin', 'Latitude', 'Longitude', 'Completed Pickups', '', 'Completed Pickups %', '', '',
  'Licensee', 'Destination', 'Latitude', 'Longitude', 'Completed Dropoffs', 'Completed Dropoffs %',
];

describe('todDailyKpiParser', () => {
  it('parses the emailed Top Locations workbook and reconciles completed trips', async () => {
    const file = workbookFile([
      ['Top Locations'],
      [],
      header,
      ['Barrie', 'Stop 777', 44.33967, -79.68031, 13, '', 0.5652, '', '', 'Barrie', 'Stop 777', 44.33967, -79.68031, 19, 0.8261],
      ['', 'Stop 9009', 44.37434, -79.68892, 10, '', 0.4348, '', '', '', 'Stop 9009', 44.37434, -79.68892, 4, 0.1739],
    ]);

    const result = await parseTodDailyKpiWorkbook(file, '2026-08-23', 'user-1');

    expect(result.dataset).toMatchObject({
      date: '2026-08-23',
      sourceFileName: 'custom_api3_Licensee KPI.xlsx',
      totalCompletedTrips: 23,
      totalDropoffs: 23,
    });
    expect(result.dataset.locations).toEqual([
      expect.objectContaining({ id: 'stop-777', pickups: 13, dropoffs: 19 }),
      expect.objectContaining({ id: 'stop-9009', pickups: 10, dropoffs: 4 }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('warns when pickup and drop-off totals do not match', async () => {
    const file = workbookFile([
      header,
      ['Barrie', 'Stop 1', 44.38, -79.69, 5, '', 1, '', '', 'Barrie', 'Stop 1', 44.38, -79.69, 4, 0.8],
    ]);

    const result = await parseTodDailyKpiWorkbook(file, '2026-08-23', 'user-1');

    expect(result.warnings).toContain('Pickup total (5) does not match drop-off total (4).');
  });

  it('rejects a workbook without the expected KPI columns', async () => {
    const file = workbookFile([['Other report'], ['Value'], [1]]);
    await expect(parseTodDailyKpiWorkbook(file, '2026-08-23', 'user-1')).rejects.toThrow(
      'Could not find the Top Locations pickup and drop-off columns',
    );
  });
});
