import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildParkingLocoMobiHistorySnapshot } from '../utils/parking/parkingLocoMobiAggregation';
import {
  parseParkingLocoMobiWorkbook,
  parseParkingLocoMobiWorkbooks,
} from '../utils/parking/parkingLocoMobiParser';

const COMBINED_HEADERS = [
  'Domain',
  'Meter',
  'Location',
  'Entry Time',
  'Transaction Time',
  'Ticket Barcode Number',
  'Receipt Number',
  'Card Type',
  'Transaction Number',
  'Lpn',
  'Merchant Code',
  'Username',
  'Card',
  'Completed',
  'Amount',
  'Status',
  'Permit Id',
  'End Time',
  'Info',
  'XREF1',
  'XREF2',
  'XID1',
];

const SPLIT_HEADERS = [
  'Domain',
  'Meter',
  'Location',
  'Entry',
  'Time',
  ...COMBINED_HEADERS.slice(4),
];

interface SyntheticRowOptions {
  domain?: string;
  meter?: string;
  location?: string;
  entryTime?: string;
  entryDate?: string | number;
  entryClock?: string | number;
  transactionTime?: string;
  cardType?: string;
  transactionNumber?: string;
  plate?: string;
  amount?: number;
  completed?: string;
  status?: string;
}

function sensitiveValues(options: SyntheticRowOptions = {}): Record<string, unknown> {
  return {
    domain: options.domain ?? 'waterfront',
    meter: options.meter ?? 'M-100',
    location: options.location ?? 'Friendly Harbour Lot',
    entrytime: options.entryTime ?? '2024-03-28 08:00',
    entry: options.entryDate ?? 45379,
    time: options.entryClock ?? 8 / 24,
    transactiontime: options.transactionTime ?? '2024-03-28 10:14',
    ticketbarcodenumber: 'PRIVATE-TICKET-BARCODE',
    receiptnumber: 'PRIVATE-RECEIPT',
    cardtype: options.cardType ?? 'VISA',
    transactionnumber: options.transactionNumber ?? 'PRIVATE-TRANSACTION-A',
    lpn: options.plate ?? 'PRIVATE-PLATE',
    merchantcode: 'PRIVATE-MERCHANT',
    username: 'PRIVATE-USERNAME',
    card: 'PRIVATE-CARD-NUMBER',
    completed: options.completed ?? 'Approved',
    amount: options.amount ?? 10,
    status: options.status ?? 'Paid',
    permitid: 'PRIVATE-PERMIT',
    endtime: 'PRIVATE-END-TIME',
    info: 'PRIVATE-INFO',
    xref1: 'PRIVATE-XREF-1',
    xref2: 'PRIVATE-XREF-2',
    xid1: 'PRIVATE-XID-1',
  };
}

function rowFor(headers: string[], options: SyntheticRowOptions = {}): unknown[] {
  const values = sensitiveValues(options);
  return headers.map(header => values[header.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? '');
}

function workbookBuffer(sheets: Array<{ name: string; rows: unknown[][] }>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function syntheticArchive() {
  const allHeaders = [...SPLIT_HEADERS, '', 'Card Type', '(All)'];
  const first = rowFor(allHeaders, {
    entryDate: 45379,
    entryClock: 8 / 24,
    transactionTime: '2024-03-28 10:14',
  });
  const exactDuplicateWithDifferentPivot = [...first];
  exactDuplicateWithDifferentPivot[allHeaders.length - 1] = 'changed report value';
  const sameSafeProjectionDifferentSourceRow = rowFor(allHeaders, {
    entryDate: 45379,
    entryClock: 8 / 24,
    transactionTime: '2024-03-28 10:14',
    transactionNumber: 'PRIVATE-TRANSACTION-B',
    plate: 'PRIVATE-PLATE-B',
  });
  const reportRow: unknown[] = allHeaders.map(() => '');
  reportRow[allHeaders.indexOf('Amount')] = 999_999;

  const workbook2024 = workbookBuffer([
    {
      name: 'JAN1-MAR31',
      rows: [COMBINED_HEADERS, rowFor(COMBINED_HEADERS, { amount: 888_888 })],
    },
    {
      name: 'All',
      rows: [allHeaders, first, exactDuplicateWithDifferentPivot, sameSafeProjectionDifferentSourceRow, reportRow],
    },
  ]);
  const workbook2025 = workbookBuffer([
    {
      name: '(OG)Jan_1_2025-Oct_31_2025',
      rows: [COMBINED_HEADERS, rowFor(COMBINED_HEADERS, {
        domain: 'downtown',
        meter: 'M-200',
        location: 'Market Lot',
        entryTime: '2025-01-03 09:00',
        transactionTime: 'unavailable',
        cardType: 'Cash',
        transactionNumber: 'PRIVATE-TRANSACTION-C',
        amount: 0,
      })],
    },
    {
      name: '(EDITED)Jan_1_2025-Oct_31_2025',
      rows: [COMBINED_HEADERS, rowFor(COMBINED_HEADERS, { amount: 777_777 })],
    },
  ]);
  const workbookNovember = workbookBuffer([{
    name: 'Revenue Details',
    rows: [COMBINED_HEADERS, rowFor(COMBINED_HEADERS, {
      domain: 'marina',
      meter: 'M-300',
      location: 'Marina Lot',
      entryTime: '2025-11-11 06:00',
      transactionTime: '2025-11-11 10:56',
      cardType: 'MC',
      transactionNumber: 'PRIVATE-TRANSACTION-D',
      amount: 5,
    })],
  }]);
  return { workbook2024, workbook2025, workbookNovember };
}

describe('LocoMobi Parking history parser', () => {
  it('selects canonical source tables, strips reports, and deduplicates before privacy projection', () => {
    const archive = syntheticArchive();
    const result = parseParkingLocoMobiWorkbooks([
      { buffer: archive.workbook2024, fileName: 'WORLDSTREAM_2024.xlsx' },
      { buffer: archive.workbook2025, fileName: 'WORLDSTREAM_2025.xlsx' },
      { buffer: archive.workbookNovember, fileName: 'WORLDSTREAM_NOV_2025.xls' },
    ]);

    expect(result.sourceTables.map(table => [table.sheetName, table.profile])).toEqual([
      ['All', 'consolidated_all'],
      ['(OG)Jan_1_2025-Oct_31_2025', 'original_raw'],
      ['Revenue Details', 'revenue_details'],
    ]);
    expect(result.ignoredSheets.map(sheet => sheet.sheetName)).toEqual([
      'JAN1-MAR31',
      '(EDITED)Jan_1_2025-Oct_31_2025',
    ]);
    expect(result.reconciliation).toMatchObject({
      sourceRowCount: 6,
      acceptedRowCount: 4,
      duplicateRowCount: 1,
      skippedRowCount: 1,
      zeroAmountRowCount: 1,
      uniqueMeterCount: 3,
      uniqueMeterLocationCount: 3,
      totalReportedAmount: 25,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('PRIVATE-TICKET-BARCODE');
    expect(serialized).not.toContain('PRIVATE-RECEIPT');
    expect(serialized).not.toContain('PRIVATE-TRANSACTION');
    expect(serialized).not.toContain('PRIVATE-PLATE');
    expect(serialized).not.toContain('PRIVATE-USERNAME');
    expect(serialized).not.toContain('PRIVATE-CARD-NUMBER');
    expect(serialized).not.toContain('PRIVATE-PERMIT');
    expect(Object.keys(result.rows[0])).not.toContain('id');
  });

  it('uses Transaction Time first and Entry Time only as a fallback', () => {
    const archive = syntheticArchive();
    const result = parseParkingLocoMobiWorkbooks([
      { buffer: archive.workbook2024, fileName: 'WORLDSTREAM_2024.xlsx' },
      { buffer: archive.workbook2025, fileName: 'WORLDSTREAM_2025.xlsx' },
      { buffer: archive.workbookNovember, fileName: 'WORLDSTREAM_NOV_2025.xls' },
    ]);

    const march = result.rows.find(row => row.meterId === 'M-100');
    const january = result.rows.find(row => row.meterId === 'M-200');
    const november = result.rows.find(row => row.meterId === 'M-300');
    expect(march).toMatchObject({ activityDate: '2024-03-28', activityMinutes: 10 * 60 + 14 });
    expect(january).toMatchObject({ activityDate: '2025-01-03', activityMinutes: 9 * 60 });
    expect(november).toMatchObject({ activityDate: '2025-11-11', activityMinutes: 10 * 60 + 56 });
  });

  it('reads OOXML bytes even when the supplied filename ends in .xls', () => {
    const { workbookNovember } = syntheticArchive();
    const result = parseParkingLocoMobiWorkbook(workbookNovember, { fileName: 'november.xls' });

    expect(result.reconciliation).toMatchObject({ acceptedRowCount: 1, totalReportedAmount: 5 });
    expect(result.rows[0]).toMatchObject({ vendor: 'locomobi', paymentChannel: 'mastercard' });
  });

  it('rejects workbooks that do not contain a canonical payment table', () => {
    const buffer = workbookBuffer([{ name: 'Pivot', rows: [['Card Type', 'Total'], ['Visa', 100]] }]);
    expect(() => parseParkingLocoMobiWorkbook(buffer, { fileName: 'report.xlsx' }))
      .toThrow(/canonical LocoMobi payment table/i);
  });
});

describe('LocoMobi Parking strategy aggregates', () => {
  it('builds aggregate-only monthly, location, time, payment, and domain views', () => {
    const archive = syntheticArchive();
    const parsed = parseParkingLocoMobiWorkbooks([
      { buffer: archive.workbook2024, fileName: 'WORLDSTREAM_2024.xlsx' },
      { buffer: archive.workbook2025, fileName: 'WORLDSTREAM_2025.xlsx' },
      { buffer: archive.workbookNovember, fileName: 'WORLDSTREAM_NOV_2025.xls' },
    ]);
    const snapshot = buildParkingLocoMobiHistorySnapshot(parsed);

    expect(snapshot).not.toHaveProperty('rows');
    expect(snapshot.financialBasis).toBe('source_reported_amount');
    expect(snapshot.monthly).toEqual([
      expect.objectContaining({ month: '2024-03', rowCount: 2, totalReportedAmount: 20 }),
      expect.objectContaining({ month: '2025-01', rowCount: 1, totalReportedAmount: 0, zeroAmountRowCount: 1 }),
      expect.objectContaining({ month: '2025-11', rowCount: 1, totalReportedAmount: 5 }),
    ]);
    expect(snapshot.locations).toHaveLength(3);
    expect(snapshot.hourly).toHaveLength(24);
    expect(snapshot.hourly[10]).toMatchObject({ rowCount: 3, totalReportedAmount: 25 });
    expect(snapshot.weekdays).toHaveLength(7);
    expect(snapshot.paymentChannels).toEqual([
      expect.objectContaining({ paymentChannel: 'visa', rowCount: 2 }),
      expect.objectContaining({ paymentChannel: 'cash', rowCount: 1 }),
      expect.objectContaining({ paymentChannel: 'mastercard', rowCount: 1 }),
    ]);
    expect(snapshot.domains.map(domain => domain.domain)).toEqual(['waterfront', 'marina', 'downtown']);
  });
});

const localArchiveDirectory = 'D:\\LocoMobi Data- Mike Bot Mach2';
const localArchiveFiles = [
  'Locomobi Payment Data_WORLDSTREAM_JAN_1_to_DEC_31_2024.xlsx',
  'Locomobi Payment Data_WORLDSTREAM_JAN_1_to_OCT_31_2025.xlsx',
  'Locomobi Payment Data_WORLDSTREAM_NOV_1_to_NOV_11_2025.xls',
];
const localArchiveAvailable = localArchiveFiles.every(fileName => existsSync(join(localArchiveDirectory, fileName)));

describe.skipIf(!localArchiveAvailable)('local read-only LocoMobi archive reconciliation', () => {
  it('matches the audited source totals without exposing identifying fields', () => {
    const result = parseParkingLocoMobiWorkbooks(localArchiveFiles.map(fileName => ({
      fileName,
      buffer: readFileSync(join(localArchiveDirectory, fileName)),
    })));

    expect(result.reconciliation).toMatchObject({
      sourceRowCount: 44_268,
      acceptedRowCount: 44_236,
      duplicateRowCount: 28,
      skippedRowCount: 4,
      zeroAmountRowCount: 2_193,
      uniqueMeterLocationCount: 18,
      totalReportedAmount: 592_495.02,
    });
    expect(result.coverage).toMatchObject({
      observedStartDate: '2024-03-28',
      observedEndDate: '2025-11-11',
      observedYears: [2024, 2025],
    });
    expect(result.sourceTables.map(table => table.sheetName)).toEqual([
      'All',
      '(OG)Jan_1_2025-Oct_31_2025',
      'Revenue Details',
    ]);
  }, 30_000);
});
