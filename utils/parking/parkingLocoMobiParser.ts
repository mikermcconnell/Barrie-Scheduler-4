import * as XLSX from 'xlsx';
import {
  PARKING_LOCOMOBI_FINANCIAL_BASIS,
  PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION,
  PARKING_LOCOMOBI_VENDOR,
  type ParkingLocoMobiHistoryRow,
  type ParkingLocoMobiParseResult,
  type ParkingLocoMobiPaymentChannel,
  type ParkingLocoMobiQualityFlag,
  type ParkingLocoMobiSourceProfile,
  type ParkingLocoMobiSourceTable,
  type ParkingLocoMobiWorkbookInput,
} from './parkingLocoMobiTypes';

const MAX_HEADER_SCAN_ROWS = 20;

interface LocoMobiColumnMap {
  domain: number;
  meter: number;
  location: number;
  entryTime: number;
  entryDate: number;
  entryClock: number;
  transactionTime: number;
  cardType: number;
  completed: number;
  amount: number;
  status: number;
  sourceEnd: number;
}

interface DetectedTable {
  fileName: string;
  sheetName: string;
  profile: ParkingLocoMobiSourceProfile;
  headerRowIndex: number;
  rows: unknown[][];
  columns: LocoMobiColumnMap;
}

interface ParsedActivityTime {
  date: string;
  month: string;
  minutes: number;
  weekday: number;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function headerIndex(headers: unknown[], name: string): number {
  return headers.findIndex(value => normalizeHeader(value) === name);
}

function sourceProfile(sheetName: string): ParkingLocoMobiSourceProfile {
  const normalized = sheetName.trim().toLowerCase();
  if (normalized === 'all') return 'consolidated_all';
  if (normalized.startsWith('(og)')) return 'original_raw';
  if (normalized === 'revenue details') return 'revenue_details';
  return 'canonical_raw';
}

function detectColumns(headers: unknown[]): LocoMobiColumnMap | null {
  const columns = {
    domain: headerIndex(headers, 'domain'),
    meter: headerIndex(headers, 'meter'),
    location: headerIndex(headers, 'location'),
    entryTime: headerIndex(headers, 'entrytime'),
    entryDate: headerIndex(headers, 'entry'),
    entryClock: headerIndex(headers, 'time'),
    transactionTime: headerIndex(headers, 'transactiontime'),
    cardType: headerIndex(headers, 'cardtype'),
    completed: headerIndex(headers, 'completed'),
    amount: headerIndex(headers, 'amount'),
    status: headerIndex(headers, 'status'),
    sourceEnd: headerIndex(headers, 'xid1'),
  };

  const hasEntry = columns.entryTime >= 0 || (columns.entryDate >= 0 && columns.entryClock >= 0);
  const required = [
    columns.domain,
    columns.meter,
    columns.location,
    columns.transactionTime,
    columns.cardType,
    columns.completed,
    columns.amount,
    columns.status,
  ];
  if (!hasEntry || required.some(index => index < 0)) return null;

  if (columns.sourceEnd < 0) {
    columns.sourceEnd = Math.max(...required, columns.entryTime, columns.entryDate, columns.entryClock);
  }
  return columns;
}

function detectTable(fileName: string, sheetName: string, sheet: XLSX.WorkSheet): DetectedTable | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  });
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); rowIndex += 1) {
    const columns = detectColumns(rows[rowIndex]);
    if (columns) {
      return {
        fileName,
        sheetName,
        profile: sourceProfile(sheetName),
        headerRowIndex: rowIndex,
        rows,
        columns,
      };
    }
  }
  return null;
}

function selectCanonicalTables(tables: DetectedTable[]): DetectedTable[] {
  const selectable = tables.filter(table => !table.sheetName.trim().toLowerCase().includes('edited'));
  const consolidated = selectable.filter(table => table.profile === 'consolidated_all');
  if (consolidated.length > 0) return consolidated;
  const originals = selectable.filter(table => table.profile === 'original_raw');
  if (originals.length > 0) return originals;
  const revenueDetails = selectable.filter(table => table.profile === 'revenue_details');
  if (revenueDetails.length > 0) return revenueDetails;
  return selectable;
}

function exactCellValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function exactSourceRowKey(row: unknown[], sourceEnd: number): string {
  return JSON.stringify(row.slice(0, sourceEnd + 1).map(exactCellValue));
}

function validDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function formatDateParts(year: number, month: number, day: number): string | null {
  if (!validDateParts(year, month, day)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseExcelDate(value: number): { date: string; minutes: number } | null {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) return null;
  const date = formatDateParts(parsed.y, parsed.m, parsed.d);
  if (!date) return null;
  return { date, minutes: parsed.H * 60 + parsed.M };
}

function parseClock(hourText: string, minuteText: string, meridiem = ''): number | null {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const normalizedMeridiem = meridiem.trim().toLowerCase();
  if (normalizedMeridiem) {
    if (hour < 1 || hour > 12) return null;
    if (normalizedMeridiem === 'pm' && hour !== 12) hour += 12;
    if (normalizedMeridiem === 'am' && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

function parseTextDateTime(value: unknown): { date: string; minutes: number } | null {
  const text = normalizeText(value);
  if (!text) return null;
  const yearFirst = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?/i);
  const monthFirst = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?/i);
  const match = yearFirst ?? monthFirst;
  if (!match) return null;
  const [year, month, day] = yearFirst
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : [Number(match[3]), Number(match[1]), Number(match[2])];
  const date = formatDateParts(year, month, day);
  if (!date) return null;
  if (match[4] == null || match[5] == null) return { date, minutes: 0 };
  const minutes = parseClock(match[4], match[5], match[6]);
  return minutes == null ? null : { date, minutes };
}

function parseDateTime(value: unknown): { date: string; minutes: number } | null {
  if (typeof value === 'number' && Number.isFinite(value)) return parseExcelDate(value);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const date = formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    return date ? { date, minutes: value.getHours() * 60 + value.getMinutes() } : null;
  }
  return parseTextDateTime(value);
}

function parseTimeOnly(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fraction = ((value % 1) + 1) % 1;
    return Math.min(1439, Math.round(fraction * 24 * 60));
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getHours() * 60 + value.getMinutes();
  }
  const match = normalizeText(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  return match ? parseClock(match[1], match[2], match[3]) : null;
}

function finishActivityTime(date: string, minutes: number): ParsedActivityTime {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { date, month: date.slice(0, 7), minutes, weekday };
}

function parseActivityTime(row: unknown[], columns: LocoMobiColumnMap): ParsedActivityTime | null {
  const transaction = parseDateTime(row[columns.transactionTime]);
  if (transaction) return finishActivityTime(transaction.date, transaction.minutes);
  if (columns.entryTime >= 0) {
    const combined = parseDateTime(row[columns.entryTime]);
    if (combined) return finishActivityTime(combined.date, combined.minutes);
  }
  if (columns.entryDate >= 0 && columns.entryClock >= 0) {
    const datePart = parseDateTime(row[columns.entryDate]);
    const timePart = parseTimeOnly(row[columns.entryClock]);
    if (datePart && timePart != null) return finishActivityTime(datePart.date, timePart);
  }
  return null;
}

function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? roundMoney(value) : null;
  const text = normalizeText(value);
  if (!text) return null;
  const isParenthesized = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return roundMoney(isParenthesized ? -Math.abs(parsed) : parsed);
}

export function normalizeParkingLocoMobiPaymentChannel(value: unknown): {
  channel: ParkingLocoMobiPaymentChannel;
  label: string;
} {
  const sourceLabel = normalizeText(value);
  const normalized = sourceLabel.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return { channel: 'unknown', label: 'Unknown' };
  if (normalized === 'cash') return { channel: 'cash', label: 'Cash' };
  if (normalized === 'visa') return { channel: 'visa', label: 'Visa' };
  if (normalized === 'mastercard' || normalized === 'mc') return { channel: 'mastercard', label: 'Mastercard' };
  if (normalized === 'interacdebit' || normalized === 'debit') return { channel: 'interac_debit', label: 'Interac debit' };
  if (normalized === 'americanexpress' || normalized === 'amex') return { channel: 'amex', label: 'American Express' };
  if (normalized === 'discover') return { channel: 'discover', label: 'Discover' };
  return { channel: 'other', label: sourceLabel };
}

function projectRow(row: unknown[], columns: LocoMobiColumnMap): ParkingLocoMobiHistoryRow | null {
  const domain = normalizeText(row[columns.domain]);
  const meterId = normalizeText(row[columns.meter]);
  const locationLabel = normalizeText(row[columns.location]);
  const activity = parseActivityTime(row, columns);
  const reportedAmount = parseMoney(row[columns.amount]);
  const completed = normalizeText(row[columns.completed]).toLowerCase();
  const status = normalizeText(row[columns.status]).toLowerCase();
  if (!domain || !meterId || !locationLabel || !activity || reportedAmount == null) return null;
  if (completed !== 'approved' || status !== 'paid') return null;

  const payment = normalizeParkingLocoMobiPaymentChannel(row[columns.cardType]);
  const qualityFlags: ParkingLocoMobiQualityFlag[] = [];
  if (reportedAmount === 0) qualityFlags.push('zero_amount');
  if (reportedAmount < 0) qualityFlags.push('negative_amount');
  if (payment.channel === 'unknown') qualityFlags.push('missing_payment_channel');

  return {
    vendor: PARKING_LOCOMOBI_VENDOR,
    financialBasis: PARKING_LOCOMOBI_FINANCIAL_BASIS,
    domain,
    meterId,
    locationLabel,
    activityDate: activity.date,
    activityMonth: activity.month,
    activityMinutes: activity.minutes,
    weekday: activity.weekday,
    isWeekend: activity.weekday === 0 || activity.weekday === 6,
    reportedAmount,
    paymentChannel: payment.channel,
    paymentChannelLabel: payment.label,
    qualityFlags,
  };
}

function isAcceptedSourceRow(row: unknown[], columns: LocoMobiColumnMap): boolean {
  const domain = normalizeText(row[columns.domain]);
  const meterId = normalizeText(row[columns.meter]);
  const locationLabel = normalizeText(row[columns.location]);
  const completed = normalizeText(row[columns.completed]).toLowerCase();
  const status = normalizeText(row[columns.status]).toLowerCase();
  return Boolean(domain && meterId && locationLabel)
    && completed === 'approved'
    && status === 'paid'
    && parseActivityTime(row, columns) != null
    && parseMoney(row[columns.amount]) != null;
}

export function parseParkingLocoMobiWorkbooks(inputs: ParkingLocoMobiWorkbookInput[]): ParkingLocoMobiParseResult {
  if (inputs.length === 0) throw new Error('Select at least one LocoMobi workbook.');

  const selectedTables: DetectedTable[] = [];
  const ignoredSheets: ParkingLocoMobiParseResult['ignoredSheets'] = [];
  for (const input of inputs) {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(input.buffer, { type: 'array', cellDates: false, raw: true });
    } catch {
      throw new Error(`Could not read LocoMobi workbook ${input.fileName}. Confirm it is a valid Excel workbook.`);
    }
    const detected = workbook.SheetNames
      .map(sheetName => detectTable(input.fileName, sheetName, workbook.Sheets[sheetName]))
      .filter((table): table is DetectedTable => table != null);
    const selected = selectCanonicalTables(detected);
    if (selected.length === 0) {
      throw new Error(`Could not find a canonical LocoMobi payment table in ${input.fileName}.`);
    }
    const selectedNames = new Set(selected.map(table => table.sheetName));
    selectedTables.push(...selected);
    for (const sheetName of workbook.SheetNames) {
      if (!selectedNames.has(sheetName)) {
        const wasDetected = detected.some(table => table.sheetName === sheetName);
        ignoredSheets.push({
          fileName: input.fileName,
          sheetName,
          reason: wasDetected
            ? 'Alternate or report-oriented table was excluded in favour of the canonical source table.'
            : 'Sheet does not contain a canonical LocoMobi payment table.',
        });
      }
    }
  }

  const sourceTables: ParkingLocoMobiSourceTable[] = selectedTables.map(table => ({
    fileName: table.fileName,
    sheetName: table.sheetName,
    profile: table.profile,
    headerRowNumber: table.headerRowIndex + 1,
    sourceColumnCount: table.columns.sourceEnd + 1,
    sourceRowCount: 0,
    acceptedRowCount: 0,
    duplicateRowCount: 0,
    skippedRowCount: 0,
  }));
  const seenSourceRows = new Set<string>();
  const rows: ParkingLocoMobiHistoryRow[] = [];

  selectedTables.forEach((table, tableIndex) => {
    const metadata = sourceTables[tableIndex];
    for (const sourceRow of table.rows.slice(table.headerRowIndex + 1)) {
      metadata.sourceRowCount += 1;
      if (!isAcceptedSourceRow(sourceRow, table.columns)) {
        metadata.skippedRowCount += 1;
        continue;
      }
      const exactKey = exactSourceRowKey(sourceRow, table.columns.sourceEnd);
      if (seenSourceRows.has(exactKey)) {
        metadata.duplicateRowCount += 1;
        continue;
      }
      seenSourceRows.add(exactKey);
      const projected = projectRow(sourceRow, table.columns);
      if (!projected) {
        throw new Error('A validated LocoMobi source row could not be privacy-projected.');
      }
      metadata.acceptedRowCount += 1;
      rows.push(projected);
    }
  });

  if (rows.length === 0) throw new Error('The selected LocoMobi workbooks did not contain any accepted paid activity rows.');
  rows.sort((left, right) => (
    left.activityDate.localeCompare(right.activityDate)
    || left.activityMinutes - right.activityMinutes
    || left.meterId.localeCompare(right.meterId)
  ));

  const observedDates = new Set(rows.map(row => row.activityDate));
  const observedMonths = [...new Set(rows.map(row => row.activityMonth))].sort();
  const observedYears = [...new Set(observedMonths.map(month => Number(month.slice(0, 4))))].sort((a, b) => a - b);
  const duplicateRowCount = sourceTables.reduce((sum, table) => sum + table.duplicateRowCount, 0);
  const skippedRowCount = sourceTables.reduce((sum, table) => sum + table.skippedRowCount, 0);
  const zeroAmountRowCount = rows.filter(row => row.qualityFlags.includes('zero_amount')).length;
  const negativeAmountRowCount = rows.filter(row => row.qualityFlags.includes('negative_amount')).length;
  const missingPaymentChannelRowCount = rows.filter(row => row.qualityFlags.includes('missing_payment_channel')).length;
  const warnings: string[] = [];
  if (duplicateRowCount > 0) warnings.push(`${duplicateRowCount.toLocaleString()} exact duplicate source rows were removed before privacy projection.`);
  if (skippedRowCount > 0) warnings.push(`${skippedRowCount.toLocaleString()} report or invalid rows were excluded from accepted payment activity.`);
  if (zeroAmountRowCount > 0) warnings.push(`${zeroAmountRowCount.toLocaleString()} zero-dollar payments were retained and quality-flagged.`);
  if (missingPaymentChannelRowCount > 0) warnings.push(`${missingPaymentChannelRowCount.toLocaleString()} payments have no recognized payment channel.`);

  return {
    schemaVersion: PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION,
    vendor: PARKING_LOCOMOBI_VENDOR,
    financialBasis: PARKING_LOCOMOBI_FINANCIAL_BASIS,
    rows,
    sourceTables,
    ignoredSheets,
    coverage: {
      observedStartDate: rows[0].activityDate,
      observedEndDate: rows[rows.length - 1].activityDate,
      observedMonths,
      observedYears,
      activeDateCount: observedDates.size,
    },
    reconciliation: {
      sourceRowCount: sourceTables.reduce((sum, table) => sum + table.sourceRowCount, 0),
      acceptedRowCount: rows.length,
      duplicateRowCount,
      skippedRowCount,
      zeroAmountRowCount,
      negativeAmountRowCount,
      missingPaymentChannelRowCount,
      uniqueMeterCount: new Set(rows.map(row => row.meterId)).size,
      uniqueMeterLocationCount: new Set(rows.map(row => `${row.meterId}\u0000${row.locationLabel}`)).size,
      totalReportedAmount: roundMoney(rows.reduce((sum, row) => sum + row.reportedAmount, 0)),
    },
    warnings,
  };
}

export function parseParkingLocoMobiWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  options: { fileName: string },
): ParkingLocoMobiParseResult {
  return parseParkingLocoMobiWorkbooks([{ buffer, fileName: options.fileName }]);
}
