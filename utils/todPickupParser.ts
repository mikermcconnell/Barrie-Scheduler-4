import type { TodPickupMonthlyDataset, TodPickupParseResult, TodPickupStop } from './todPickupTypes';

type RawRow = Record<string, string>;

export const MAX_TOD_PICKUP_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOD_PICKUP_ROWS = 25_000;

const STOP_ID_ALIASES = [
  'pickupstopid',
  'stopid',
  'stopcode',
  'locationid',
  'pickuplocationid',
  'originid',
];

const LOCATION_ALIASES = [
  'pickuplocation',
  'pickupstop',
  'pickupstopname',
  'pickupname',
  'origin',
  'originname',
  'from',
  'fromlocation',
  'stop',
  'stopname',
];

const LAT_ALIASES = [
  'pickuplat',
  'pickuplatitude',
  'originlat',
  'originlatitude',
  'fromlat',
  'fromlatitude',
  'lat',
  'latitude',
];

const LON_ALIASES = [
  'pickuplon',
  'pickuplng',
  'pickuplong',
  'pickuplongitude',
  'originlon',
  'originlng',
  'originlong',
  'originlongitude',
  'fromlon',
  'fromlng',
  'fromlong',
  'fromlongitude',
  'lon',
  'lng',
  'long',
  'longitude',
];

const PICKUP_COUNT_ALIASES = [
  'pickups',
  'pickupcount',
  'completedpickups',
  'completedpickupscard',
  'completedrides',
  'completedtrips',
  'count',
  'total',
  'requests',
  'rides',
  'trips',
];

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function coordinateKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function coordinateSlug(lat: number, lon: number): string {
  return coordinateKey(lat, lon)
    .replace(/-/g, 'm')
    .replace(/\./g, 'p')
    .replace(',', '_');
}

function stableId(stopId: string, name: string, lat: number, lon: number): string {
  const normalizedStopId = normalizeHeader(stopId);
  if (normalizedStopId) return `stop-${normalizedStopId.slice(0, 64)}`;

  const coord = coordinateSlug(lat, lon);
  const normalizedName = normalizeHeader(name).slice(0, 48);
  if (normalizedName) return `loc-${normalizedName}-${coord}`;

  return `coord-${coord}`;
}

function coordinateLabel(lat: number, lon: number): string {
  return `Stop at ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function parseCsv(text: string): RawRow[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];
  if (lines.length - 1 > MAX_TOD_PICKUP_ROWS) {
    throw new Error(`TOD pickup CSV is too large. Upload ${MAX_TOD_PICKUP_ROWS.toLocaleString()} rows or fewer.`);
  }

  const parseLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current.trim());
    return values.map(value => value.replace(/^"|"$/g, '').replace(/""/g, '"'));
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const row: RawRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalized = new Map(headers.map(header => [normalizeHeader(header), header]));
  for (const alias of aliases) {
    const match = normalized.get(alias);
    if (match) return match;
  }
  return null;
}

function parseCoordinate(raw: string): number | null {
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}

function parsePickupCount(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw.trim().replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function isValidCoordinate(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return new TextDecoder('utf-8').decode(buffer);
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Could not read TOD pickup CSV file.'));
      reader.readAsText(file);
    });
  }
  throw new Error('Could not read TOD pickup CSV file.');
}

export function isValidTodPickupMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export async function parseTodPickupCsvFile(
  file: File,
  month: string,
  importedBy: string,
): Promise<TodPickupParseResult> {
  if (!isValidTodPickupMonth(month)) {
    throw new Error('Choose a valid data month before importing.');
  }
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new Error('Upload a CSV file for Transit On Demand pickup data.');
  }
  if (file.size > MAX_TOD_PICKUP_FILE_BYTES) {
    throw new Error('TOD pickup CSV is too large. Upload a file smaller than 5 MB.');
  }

  const text = await readFileText(file);
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error('The CSV does not contain any pickup rows.');
  }

  const headers = Object.keys(rows[0] ?? {});
  const stopIdColumn = findColumn(headers, STOP_ID_ALIASES);
  const locationColumn = findColumn(headers, LOCATION_ALIASES);
  const latColumn = findColumn(headers, LAT_ALIASES);
  const lonColumn = findColumn(headers, LON_ALIASES);
  const pickupCountColumn = findColumn(headers, PICKUP_COUNT_ALIASES);
  const missing = [
    latColumn ? null : 'pickup latitude',
    lonColumn ? null : 'pickup longitude',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required TOD pickup columns: ${missing.join(', ')}.`);
  }

  type MutableStop = TodPickupStop & { latSum: number; lonSum: number };
  const stops = new Map<string, MutableStop>();
  let skippedRows = 0;

  for (const row of rows) {
    const rawStopId = stopIdColumn ? normalizeName(row[stopIdColumn] ?? '') : '';
    const rawName = locationColumn ? normalizeName(row[locationColumn] ?? '') : '';
    const lat = parseCoordinate(row[latColumn!] ?? '');
    const lon = parseCoordinate(row[lonColumn!] ?? '');
    const pickups = pickupCountColumn
      ? parsePickupCount(row[pickupCountColumn])
      : 1;

    if (lat == null || lon == null || !isValidCoordinate(lat, lon) || pickups == null) {
      skippedRows++;
      continue;
    }

    const name = rawName || coordinateLabel(lat, lon);
    const key = stableId(rawStopId, rawName, lat, lon);
    const existing = stops.get(key);
    if (existing) {
      existing.pickups += pickups;
      existing.latSum += lat * pickups;
      existing.lonSum += lon * pickups;
    } else {
      stops.set(key, {
        id: key,
        name,
        lat,
        lon,
        pickups,
        latSum: lat * pickups,
        lonSum: lon * pickups,
      });
    }
  }

  const stopRows = Array.from(stops.values())
    .map(({ latSum, lonSum, ...stop }) => ({
      ...stop,
      lat: latSum / stop.pickups,
      lon: lonSum / stop.pickups,
    }))
    .sort((a, b) => {
      const pickupCmp = b.pickups - a.pickups;
      if (pickupCmp !== 0) return pickupCmp;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

  if (stopRows.length === 0) {
    throw new Error('No mappable TOD pickups found. Check the pickup location and coordinate columns.');
  }

  const warnings: string[] = [];
  if (skippedRows > 0) {
    warnings.push(`${skippedRows.toLocaleString()} rows were skipped because pickup coordinates or pickup counts were missing/invalid.`);
  }
  const dataset: TodPickupMonthlyDataset = {
    month,
    importedAt: new Date().toISOString(),
    importedBy,
    sourceFileName: file.name,
    rowCount: rows.length,
    mappableRows: rows.length - skippedRows,
    skippedRows,
    totalPickups: stopRows.reduce((sum, stop) => sum + stop.pickups, 0),
    stops: stopRows,
  };

  return { dataset, warnings };
}
