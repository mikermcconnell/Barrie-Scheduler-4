import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createParkingRawObservationsWorkbook,
  exportParkingRawObservationsExcel,
  exportParkingRawObservationsPdf,
} from '../utils/parking/parkingExport';
import type { ParkingRawRow } from '../utils/parking/parkingTypes';

const pdfMocks = vi.hoisted(() => ({
  setFontSize: vi.fn(),
  text: vi.fn(),
  save: vi.fn(),
  autoTable: vi.fn(),
}));

vi.mock('xlsx', async importOriginal => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, writeFile: vi.fn() };
});

vi.mock('jspdf', () => ({
  jsPDF: class JsPdfMock {
    setFontSize = pdfMocks.setFontSize;
    text = pdfMocks.text;
    save = pdfMocks.save;
  },
}));

vi.mock('jspdf-autotable', () => ({ default: pdfMocks.autoTable }));

const rawRow = (overrides: Partial<ParkingRawRow> = {}): ParkingRawRow => ({
  id: 'row-1',
  plate: 'ABC123',
  hasMissingPlate: false,
  startRaw: '2026-01-02 09:00',
  startDate: '2026-01-02',
  startMonth: '2026-01',
  startMinutes: 540,
  endMinutes: 600,
  weekday: 5,
  isWeekend: false,
  spotId: '100',
  locationName: 'City Hall Lot',
  durationMinutes: 60,
  tapType: 'Spot',
  discountCode: 'TA2026',
  codeFamilyKey: 'TA',
  department: 'Transit Administration',
  description: 'Shared parking',
  discountAmount: 10.25,
  ...overrides,
});

afterEach(() => vi.clearAllMocks());

describe('parking raw-observation exports', () => {
  it('creates a workbook with report context and complete raw observation columns', () => {
    const workbook = createParkingRawObservationsWorkbook(
      [rawRow(), rawRow({ id: 'row-2', plate: '', department: '', discountAmount: 4.75 })],
      { title: 'January observations', subtitle: 'All departments', fileName: 'january.xlsx' },
    );

    expect(workbook.SheetNames).toEqual(['Report Summary', 'Raw Observations']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['Report Summary'])).toEqual([{
      Report: 'January observations',
      Context: 'All departments',
      Uses: 2,
      'Total Value': 15,
    }]);
    expect(XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Raw Observations'])).toEqual([
      expect.objectContaining({
        Month: '2026-01',
        Date: '2026-01-02',
        'Licence Plate': 'ABC123',
        Location: 'City Hall Lot',
        'Discount Code': 'TA2026',
        Department: 'Transit Administration',
        'Discount Amount': 10.25,
      }),
      expect.objectContaining({
        'Licence Plate': '(missing)',
        Department: 'Unmapped',
        'Discount Amount': 4.75,
      }),
    ]);
  });

  it('writes Excel with a sanitized filename and the requested extension', () => {
    exportParkingRawObservationsExcel([rawRow()], {
      title: 'Observations',
      subtitle: 'January',
      fileName: 'Parking: January / Transit?.pdf',
    });

    expect(XLSX.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ SheetNames: ['Report Summary', 'Raw Observations'] }),
      'Parking-January-Transit.xlsx',
    );
  });

  it('exports a landscape PDF table with raw columns, totals, and a safe filename', async () => {
    await exportParkingRawObservationsPdf([rawRow()], {
      title: 'Transit annual observations',
      subtitle: '2026 · Transit',
      fileName: 'Transit <2026>.xlsx',
    });

    expect(pdfMocks.text).toHaveBeenCalledWith('Transit annual observations', 36, 34);
    expect(pdfMocks.text).toHaveBeenCalledWith('2026 · Transit', 36, 50);
    expect(pdfMocks.text).toHaveBeenCalledWith('1 use · $10.25 total value', 36, 64);
    expect(pdfMocks.autoTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      head: [[
        'Month', 'Date', 'Licence plate', 'Start time', 'Spot ID', 'Location', 'Length',
        'Tap Signs/Spot', 'Discount code', 'Department', 'Description', 'Discount amount',
      ]],
      body: [[
        '2026-01', '2026-01-02', 'ABC123', '2026-01-02 09:00', '100', 'City Hall Lot',
        '1h 0m', 'Spot', 'TA2026', 'Transit Administration', 'Shared parking', '$10.25',
      ]],
    }));
    expect(pdfMocks.save).toHaveBeenCalledWith('Transit-2026.pdf');
  });
});
