import * as XLSX from 'xlsx';
import {
  STREETSRecord,
  STREETS_REQUIRED_COLUMNS,
  ImportPreview,
  ImportProgress,
  parseDayType,
} from './performanceDataTypes';

const COLUMN_MAP: Record<string, keyof STREETSRecord> = {
  VehicleLocationTPKey: 'vehicleLocationTPKey',
  VehicleID: 'vehicleId',
  InBetween: 'inBetween',
  IsTripper: 'isTripper',
  Date: 'date',
  Month: 'month',
  Day: 'day',
  ArrivalTime: 'arrivalTime',
  ObservedArrivalTime: 'observedArrivalTime',
  StopTime: 'stopTime',
  ObservedDepartureTime: 'observedDepartureTime',
  WheelchairUsageCount: 'wheelchairUsageCount',
  DepartureLoad: 'departureLoad',
  Boardings: 'boardings',
  Alightings: 'alightings',
  APCSource: 'apcSource',
  Block: 'block',
  OperatorID: 'operatorId',
  TripName: 'tripName',
  StopName: 'stopName',
  RouteName: 'routeName',
  Branch: 'branch',
  RouteID: 'routeId',
  RouteStopIndex: 'routeStopIndex',
  StopID: 'stopId',
  Direction: 'direction',
  IsDetour: 'isDetour',
  StopLat: 'stopLat',
  StopLon: 'stopLon',
  TimePoint: 'timePoint',
  Distance: 'distance',
  PreviousStopName: 'previousStopName',
  TripID: 'tripId',
  InternalTripID: 'internalTripId',
  TerminalDepartureTime: 'terminalDepartureTime',
};

function toBoolean(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    return lower === 'true' || lower === '1';
  }
  return false;
}

function toNumber(val: unknown, fallback: number = 0): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = Number(val.trim());
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function toStringOrNull(val: unknown): string | null {
  if (val == null || val === '') return null;
  return String(val).trim();
}

function toStringRequired(val: unknown, fallback: string = ''): string {
  if (val == null) return fallback;
  return String(val).trim();
}

export function validateSchema(headers: string[]): {
  valid: boolean;
  missing: string[];
  extra: string[];
} {
  const headerSet = new Set(headers.map(h => h.trim()));
  const requiredSet = new Set<string>(STREETS_REQUIRED_COLUMNS);
  const knownSet = new Set(Object.keys(COLUMN_MAP));

  const missing: string[] = [];
  for (const req of requiredSet) {
    if (!headerSet.has(req)) missing.push(req);
  }

  const extra: string[] = [];
  for (const h of headerSet) {
    if (!knownSet.has(h)) extra.push(h);
  }

  return { valid: missing.length === 0, missing, extra };
}

export function parseRow(
  row: Record<string, unknown>,
  rowIndex: number
): STREETSRecord | null {
  try {
    const date = toStringRequired(row['Date']);
    const day = toStringRequired(row['Day']);
    if (!date || !day) return null;

    return {
      vehicleLocationTPKey: toNumber(row['VehicleLocationTPKey']),
      vehicleId: toStringRequired(row['VehicleID']),
      inBetween: toBoolean(row['InBetween']),
      isTripper: toBoolean(row['IsTripper']),
      date,
      month: toStringRequired(row['Month']),
      day,
      arrivalTime: toStringRequired(row['ArrivalTime']),
      observedArrivalTime: toStringOrNull(row['ObservedArrivalTime']),
      stopTime: toStringRequired(row['StopTime']),
      observedDepartureTime: toStringOrNull(row['ObservedDepartureTime']),
      wheelchairUsageCount: toNumber(row['WheelchairUsageCount']),
      departureLoad: toNumber(row['DepartureLoad']),
      boardings: toNumber(row['Boardings']),
      alightings: toNumber(row['Alightings']),
      apcSource: toNumber(row['APCSource']),
      block: toStringRequired(row['Block']),
      operatorId: toStringRequired(row['OperatorID']),
      tripName: toStringRequired(row['TripName']),
      stopName: toStringRequired(row['StopName']),
      routeName: toStringRequired(row['RouteName']),
      branch: toStringRequired(row['Branch']),
      routeId: toStringRequired(row['RouteID']),
      routeStopIndex: toNumber(row['RouteStopIndex']),
      stopId: toStringRequired(row['StopID']),
      direction: toStringRequired(row['Direction']),
      isDetour: toBoolean(row['IsDetour']),
      stopLat: toNumber(row['StopLat']),
      stopLon: toNumber(row['StopLon']),
      timePoint: toBoolean(row['TimePoint']),
      distance: toNumber(row['Distance']),
      previousStopName: toStringOrNull(row['PreviousStopName']),
      tripId: toStringRequired(row['TripID']),
      internalTripId: toNumber(row['InternalTripID']),
      terminalDepartureTime: toStringRequired(row['TerminalDepartureTime']),
    };
  } catch {
    return null;
  }
}

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let c = 0; c < lines[i].length; c++) {
      const ch = lines[i][c];
      if (ch === '"') {
        if (inQuotes && lines[i][c + 1] === '"') {
          current += '"';
          c++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current);

    const row: Record<string, unknown> = {};
    for (let h = 0; h < headers.length; h++) {
      row[headers[h]] = values[h] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

export function generatePreview(
  records: STREETSRecord[],
  fileName: string,
  fileSize: number
): ImportPreview {
  const warnings: string[] = [];

  if (records.length === 0) {
    return {
      fileName,
      fileSize,
      rowCount: 0,
      dateRange: { start: '', end: '' },
      dayTypes: [],
      routeIds: [],
      sampleRows: [],
      warnings: ['No valid records found'],
    };
  }

  const dates = records.map(r => r.date).filter(Boolean).sort();
  const start = dates[0] ?? '';
  const end = dates[dates.length - 1] ?? '';

  const dayTypeSet = new Set(records.map(r => parseDayType(r.day)));
  const routeIdSet = new Set(records.map(r => r.routeId));

  const missingAVL = records.filter(r => r.observedArrivalTime == null).length;
  if (missingAVL > 0) {
    const pct = ((missingAVL / records.length) * 100).toFixed(1);
    warnings.push(`${missingAVL} records (${pct}%) missing AVL arrival data`);
  }

  const inBetween = records.filter(r => r.inBetween).length;
  if (inBetween > 0) {
    warnings.push(`${inBetween} in-between records will be filtered during analysis`);
  }

  const detours = records.filter(r => r.isDetour).length;
  if (detours > 0) {
    warnings.push(`${detours} detour records detected`);
  }

  const sampleRows = records.slice(0, 5);

  return {
    fileName,
    fileSize,
    rowCount: records.length,
    dateRange: { start, end },
    dayTypes: [...dayTypeSet].sort(),
    routeIds: [...routeIdSet].sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    }),
    sampleRows,
    warnings,
  };
}

export async function parseSTREETSFile(
  file: File,
  onProgress?: (p: ImportProgress) => void
): Promise<{ records: STREETSRecord[]; warnings: string[] }> {
  const warnings: string[] = [];
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const isCSV = ext === 'csv';

  onProgress?.({ phase: 'Reading file', current: 0, total: 1 });

  const buffer = await file.arrayBuffer();
  let rawRows: Record<string, unknown>[];

  if (isCSV) {
    const text = new TextDecoder('utf-8').decode(buffer);
    rawRows = parseCSV(text);
  } else {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { records: [], warnings: ['No sheets found in workbook'] };
    }
    const sheet = workbook.Sheets[sheetName];
    rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
    });
  }

  if (rawRows.length === 0) {
    return { records: [], warnings: ['File contains no data rows'] };
  }

  const headers = Object.keys(rawRows[0]);
  const schema = validateSchema(headers);
  if (!schema.valid) {
    warnings.push(`Missing required columns: ${schema.missing.join(', ')}`);
    return { records: [], warnings };
  }
  if (schema.extra.length > 0) {
    warnings.push(`Unexpected columns ignored: ${schema.extra.join(', ')}`);
  }

  onProgress?.({ phase: 'Parsing records', current: 0, total: rawRows.length });

  const records: STREETSRecord[] = [];
  let skipped = 0;
  const progressInterval = Math.max(1, Math.floor(rawRows.length / 100));

  for (let i = 0; i < rawRows.length; i++) {
    const record = parseRow(rawRows[i], i + 2);
    if (record) {
      records.push(record);
    } else {
      skipped++;
    }

    if (onProgress && i % progressInterval === 0) {
      onProgress({ phase: 'Parsing records', current: i + 1, total: rawRows.length });
    }
  }

  onProgress?.({ phase: 'Complete', current: rawRows.length, total: rawRows.length });

  if (skipped > 0) {
    warnings.push(`${skipped} rows skipped due to missing or invalid data`);
  }

  return { records, warnings };
}
