import * as XLSX from 'xlsx';
import {
  type ParkingRevenueDataset,
  type ParkingRevenueLocationMapping,
  type ParkingRevenueParseResult,
  type ParkingRevenueRawRow,
  type ParkingRevenueSource,
  type ParkingSettings,
} from './parkingTypes';
import { buildParkingRevenueLocationLookup } from './parkingRevenue';

const MAX_PARKING_REVENUE_FILE_BYTES = 25 * 1024 * 1024;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseMoney(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown): { date: string; month: string; minutes: number; weekday: number; raw: string } | null {
  const raw = normalizeText(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = `${year}-${month}-${day}`;
  const minutes = Number(hour) * 60 + Number(minute);
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  if (!Number.isFinite(minutes) || !Number.isFinite(weekday)) return null;
  return { date, month: `${year}-${month}`, minutes, weekday, raw };
}

export function parseParkingRevenueDurationMinutes(value: unknown): number | null {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  if (/[hm]/.test(text)) {
    const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] ?? 0);
    const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*m/)?.[1] ?? 0);
    const total = Math.round(hours * 60 + minutes);
    return total > 0 ? total : null;
  }
  const decimalHours = Number(text.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(decimalHours) || decimalHours < 0) return null;
  if (decimalHours === 0) return 0;
  return Math.max(1, Math.round(decimalHours * 60));
}

function detectRevenueSource(headers: string[]): ParkingRevenueSource | null {
  if (headers.includes('hotspot') && headers.includes('city')) return 'hotspot';
  if (headers.includes('meter') && headers.includes('tapsign')) return 'qr';
  return null;
}

function findHeaderRow(rows: unknown[][]): { index: number; source: ParkingRevenueSource; headers: unknown[] } | null {
  for (let index = 0; index < rows.length; index += 1) {
    const headers = rows[index].map(normalizeHeader);
    const source = detectRevenueSource(headers);
    if (
      source
      && headers.includes('starttime')
      && headers.includes('plate')
      && headers.includes('amount')
      && headers.includes('tax')
      && headers.includes('total')
      && headers.includes('length')
    ) {
      return { index, source, headers: rows[index] };
    }
  }
  return null;
}

function headerIndex(headers: unknown[], header: string): number {
  return headers.findIndex(value => normalizeHeader(value) === header);
}

interface RevenueColumnIndices {
  sourceId: number;
  sourceLabel: number;
  start: number;
  plate: number;
  amount: number;
  tax: number;
  total: number;
  length: number;
  paymentType: number;
}

function isCurrencyValue(value: unknown): boolean {
  return /\$/.test(normalizeText(value));
}

function resolveRevenueColumnIndices(
  headers: unknown[],
  dataRows: unknown[][],
  source: ParkingRevenueSource,
): { indices: RevenueColumnIndices; correctedShiftedQrColumns: boolean } {
  const indices: RevenueColumnIndices = {
    sourceId: headerIndex(headers, source === 'hotspot' ? 'hotspot' : 'meter'),
    sourceLabel: headerIndex(headers, source === 'hotspot' ? 'city' : 'tapsign'),
    start: headerIndex(headers, 'starttime'),
    plate: headerIndex(headers, 'plate'),
    amount: headerIndex(headers, 'amount'),
    tax: headerIndex(headers, 'tax'),
    total: headerIndex(headers, 'total'),
    length: headerIndex(headers, 'length'),
    paymentType: headerIndex(headers, 'cardtype'),
  };
  if (source !== 'qr' || indices.paymentType < 0) {
    return { indices, correctedShiftedQrColumns: false };
  }

  const hasShiftedQrColumns = dataRows.slice(0, 50).some(row => (
    isCurrencyValue(row[indices.total])
    && isCurrencyValue(row[indices.length])
    && parseParkingRevenueDurationMinutes(row[indices.paymentType]) != null
    && Boolean(normalizeText(row[indices.paymentType + 1]))
  ));
  if (!hasShiftedQrColumns) {
    return { indices, correctedShiftedQrColumns: false };
  }

  return {
    indices: {
      ...indices,
      total: indices.length,
      length: indices.paymentType,
      paymentType: indices.paymentType + 1,
    },
    correctedShiftedQrColumns: true,
  };
}

function locationKeyForRef(source: ParkingRevenueSource, sourceId: string): string {
  return `${source}:${normalizeText(sourceId).toUpperCase()}`;
}

export function parseParkingRevenueWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  options: {
    fileName: string;
    importedBy: string;
    settings?: ParkingSettings;
  },
): ParkingRevenueParseResult {
  const workbook = XLSX.read(buffer, { cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The Parking revenue workbook does not contain any sheets.');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  const header = findHeaderRow(rows);
  if (!header) {
    throw new Error('Could not find a Parking revenue header row. Expected HotSpot #/City # or Meter #/Tap Sign with Start Time, Plate, Amount, Tax, Total, and Length.');
  }

  const source = header.source;
  const dataRows = rows.slice(header.index + 1);
  const { indices, correctedShiftedQrColumns } = resolveRevenueColumnIndices(header.headers, dataRows, source);

  const locationLookup = options.settings ? buildParkingRevenueLocationLookup(options.settings) : new Map<string, ParkingRevenueLocationMapping>();
  const parsedRows: ParkingRevenueRawRow[] = [];
  const months = new Set<string>();
  let skippedRows = 0;
  let totalMismatchRows = 0;

  dataRows.forEach((row, rowOffset) => {
    const start = parseDate(row[indices.start]);
    const durationMinutes = parseParkingRevenueDurationMinutes(row[indices.length]);
    const sourceId = normalizeText(row[indices.sourceId]);
    if (!start || durationMinutes == null || !sourceId) {
      skippedRows += 1;
      return;
    }

    const sourceLabel = normalizeText(row[indices.sourceLabel]) || sourceId;
    const location = locationLookup.get(locationKeyForRef(source, sourceId));
    const plate = normalizeText(row[indices.plate]).toUpperCase();
    const amount = parseMoney(row[indices.amount]);
    const tax = parseMoney(row[indices.tax]);
    const total = parseMoney(row[indices.total]);
    if (amount == null || tax == null || total == null) {
      skippedRows += 1;
      return;
    }
    const taxInclusiveAmount = roundMoney(amount + tax);
    if (Math.abs(taxInclusiveAmount - total) > 0.01) totalMismatchRows += 1;
    months.add(start.month);
    parsedRows.push({
      id: `${source}-${start.date}-${rowOffset + 1}-${sourceId}-${plate || 'missing'}`,
      source,
      sourceId,
      sourceLabel,
      physicalLocationId: location?.id || null,
      physicalLocationName: location?.displayName || sourceLabel || sourceId,
      plate,
      hasMissingPlate: !plate,
      startRaw: start.raw,
      startDate: start.date,
      startMonth: start.month,
      startMinutes: start.minutes,
      endMinutes: start.minutes + durationMinutes,
      weekday: start.weekday,
      isWeekend: start.weekday === 0 || start.weekday === 6,
      durationMinutes,
      amount,
      tax,
      taxInclusiveAmount,
      total,
      paymentType: normalizeText(row[indices.paymentType]),
    });
  });

  if (parsedRows.length === 0) {
    throw new Error('The Parking revenue workbook did not contain any importable rows.');
  }
  if (months.size > 1) {
    throw new Error(`Parking revenue imports must contain one month at a time. This file contains ${[...months].sort().join(', ')}.`);
  }

  const dataset: ParkingRevenueDataset = {
    month: [...months][0],
    source,
    importedAt: new Date().toISOString(),
    importedBy: options.importedBy,
    sourceFileName: options.fileName,
    rowCount: parsedRows.length,
    skippedRows,
    totalRevenue: roundMoney(parsedRows.reduce((sum, row) => sum + (row.taxInclusiveAmount || 0), 0)),
    totalTax: roundMoney(parsedRows.reduce((sum, row) => sum + row.tax, 0)),
    totalPaid: roundMoney(parsedRows.reduce((sum, row) => sum + row.total, 0)),
    rows: parsedRows,
  };

  const warnings: string[] = [];
  if (correctedShiftedQrColumns) warnings.push('The QR export used shifted Total, Length, and Card Type columns; their positions were corrected during import.');
  if (skippedRows > 0) warnings.push(`${skippedRows.toLocaleString()} rows were skipped because required revenue fields were missing or invalid.`);
  if (totalMismatchRows > 0) warnings.push(`${totalMismatchRows.toLocaleString()} revenue rows have Amount plus Tax that does not match the source Total.`);
  const missingPlateCount = parsedRows.filter(row => row.hasMissingPlate).length;
  if (missingPlateCount > 0) warnings.push(`${missingPlateCount.toLocaleString()} revenue rows have missing plates.`);
  const zeroAmountCount = parsedRows.filter(row => row.taxInclusiveAmount === 0).length;
  if (zeroAmountCount > 0) warnings.push(`${zeroAmountCount.toLocaleString()} revenue rows have $0 tax-inclusive revenue and are included in activity counts.`);

  return { dataset, warnings };
}

export async function parseParkingRevenueFile(file: File, importedBy: string, settings?: ParkingSettings): Promise<ParkingRevenueParseResult> {
  if (!file.name.match(/\.xlsx?$/i)) {
    throw new Error('Upload a Parking revenue Excel file (.xlsx or .xls).');
  }
  if (file.size > MAX_PARKING_REVENUE_FILE_BYTES) {
    throw new Error('Parking revenue files must be 25 MB or smaller. Split larger exports by month and source.');
  }
  const buffer = await file.arrayBuffer();
  return parseParkingRevenueWorkbook(buffer, { fileName: file.name, importedBy, settings });
}
