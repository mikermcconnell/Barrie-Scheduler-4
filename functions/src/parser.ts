// Server-side CSV parser for STREETS data
// Mirrors utils/performanceDataParser.ts but operates on raw CSV text (no File API)

import { STREETSRecord, STREETS_REQUIRED_COLUMNS } from './types';

// Column mapping kept for reference — parsing uses direct column name lookup
// const COLUMN_MAP is defined in the client-side parser for Excel support

function toBoolean(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    return lower === 'true' || lower === '1' || lower === 'yes';
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

function validateSchema(headers: string[]): {
  valid: boolean;
  missing: string[];
} {
  const headerSet = new Set(headers.map(h => h.trim()));
  const requiredSet = new Set<string>(STREETS_REQUIRED_COLUMNS);

  const missing: string[] = [];
  for (const req of requiredSet) {
    if (!headerSet.has(req)) missing.push(req);
  }

  return { valid: missing.length === 0, missing };
}

function parseRow(row: Record<string, unknown>): STREETSRecord | null {
  try {
    const date = toStringRequired(row['Date']);
    const day = toStringRequired(row['Day']) || 'WEEKDAY';
    if (!date) return null;

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

export function parseSTREETSCSV(csvText: string): {
  records: STREETSRecord[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const rawRows = parseCSV(csvText);

  if (rawRows.length === 0) {
    return { records: [], warnings: ['CSV contains no data rows'] };
  }

  const headers = Object.keys(rawRows[0]);
  const schema = validateSchema(headers);
  if (!schema.valid) {
    warnings.push(`Missing required columns: ${schema.missing.join(', ')}`);
    return { records: [], warnings };
  }

  const records: STREETSRecord[] = [];
  let skipped = 0;

  for (const rawRow of rawRows) {
    const record = parseRow(rawRow);
    if (record) {
      records.push(record);
    } else {
      skipped++;
    }
  }

  if (skipped > 0) {
    warnings.push(`${skipped} rows skipped due to missing or invalid data`);
  }

  return { records, warnings };
}
