import * as XLSX from 'xlsx';
import type { TodDailyKpiDataset, TodDailyKpiLocation, TodDailyKpiParseResult } from './todPickupTypes';

export const MAX_TOD_DAILY_KPI_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOD_DAILY_KPI_ROWS = 1_000;

type SheetRow = Array<string | number | null>;

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseCount(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function parseCoordinate(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidCoordinate(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);
}

function locationId(name: string, lat: number, lon: number): string {
  const stopMatch = name.match(/(?:stop\s+)(\d+)/i);
  if (stopMatch) return `stop-${stopMatch[1]}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `loc-${slug || 'unnamed'}-${lat.toFixed(5)}-${lon.toFixed(5)}`;
}

function validServiceDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function findHeaderRow(rows: SheetRow[]): number {
  return rows.findIndex(row => {
    const headers = row.map(normalizeHeader);
    return headers.includes('origin')
      && headers.includes('completedpickups')
      && headers.includes('destination')
      && headers.includes('completeddropoffs');
  });
}

function columnIndex(row: SheetRow, header: string): number {
  return row.map(normalizeHeader).indexOf(header);
}

export async function parseTodDailyKpiWorkbook(
  file: File,
  serviceDate: string,
  importedBy: string,
): Promise<TodDailyKpiParseResult> {
  return parseTodDailyKpiWorkbookBytes(
    new Uint8Array(await file.arrayBuffer()),
    file.name,
    serviceDate,
    importedBy,
  );
}

export function parseTodDailyKpiWorkbookBytes(
  bytes: ArrayBuffer | Uint8Array,
  fileName: string,
  serviceDate: string,
  importedBy: string,
): TodDailyKpiParseResult {
  if (!validServiceDate(serviceDate)) {
    throw new Error('Choose a valid service date before importing.');
  }
  if (!/\.xlsx?$/i.test(fileName)) {
    throw new Error('Upload the Transit On Demand KPI Excel workbook (.xlsx).');
  }
  if (bytes.byteLength > MAX_TOD_DAILY_KPI_FILE_BYTES) {
    throw new Error('TOD KPI workbook is too large. Upload a file smaller than 5 MB.');
  }

  const workbook = XLSX.read(bytes, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) throw new Error('The TOD KPI workbook does not contain a worksheet.');

  const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  if (rows.length > MAX_TOD_DAILY_KPI_ROWS) {
    throw new Error(`TOD KPI workbook is too large. Upload ${MAX_TOD_DAILY_KPI_ROWS.toLocaleString()} rows or fewer.`);
  }

  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error('Could not find the Top Locations pickup and drop-off columns in this workbook.');
  }
  const headers = rows[headerRowIndex];
  const originIndex = columnIndex(headers, 'origin');
  const pickupLatIndex = columnIndex(headers, 'latitude');
  const pickupLonIndex = columnIndex(headers, 'longitude');
  const pickupsIndex = columnIndex(headers, 'completedpickups');
  const destinationIndex = columnIndex(headers, 'destination');
  const dropoffsIndex = columnIndex(headers, 'completeddropoffs');
  const destinationLatIndex = headers.map(normalizeHeader).findIndex((value, index) => value === 'latitude' && index > destinationIndex);
  const destinationLonIndex = headers.map(normalizeHeader).findIndex((value, index) => value === 'longitude' && index > destinationIndex);

  if ([originIndex, pickupLatIndex, pickupLonIndex, pickupsIndex, destinationIndex, destinationLatIndex, destinationLonIndex, dropoffsIndex].some(index => index < 0)) {
    throw new Error('The TOD KPI workbook is missing one or more required location, coordinate, pickup, or drop-off columns.');
  }

  const locations = new Map<string, TodDailyKpiLocation>();
  let invalidRows = 0;
  let sourceRows = 0;
  const addActivity = (nameValue: unknown, latValue: unknown, lonValue: unknown, countValue: unknown, kind: 'pickup' | 'dropoff') => {
    const name = normalizeName(nameValue);
    const lat = parseCoordinate(latValue);
    const lon = parseCoordinate(lonValue);
    const count = parseCount(countValue);
    if (!name && count === 0) return;
    sourceRows++;
    if (!name || lat == null || lon == null || count == null || !isValidCoordinate(lat, lon)) {
      invalidRows++;
      return;
    }
    const id = locationId(name, lat, lon);
    const current = locations.get(id) ?? { id, name, lat, lon, pickups: 0, dropoffs: 0 };
    if (kind === 'pickup') current.pickups += count;
    else current.dropoffs += count;
    locations.set(id, current);
  };

  for (const row of rows.slice(headerRowIndex + 1)) {
    addActivity(row[originIndex], row[pickupLatIndex], row[pickupLonIndex], row[pickupsIndex], 'pickup');
    addActivity(row[destinationIndex], row[destinationLatIndex], row[destinationLonIndex], row[dropoffsIndex], 'dropoff');
  }

  const locationRows = [...locations.values()]
    .filter(location => location.pickups > 0 || location.dropoffs > 0)
    .sort((a, b) => (b.pickups + b.dropoffs) - (a.pickups + a.dropoffs) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const totalCompletedTrips = locationRows.reduce((sum, location) => sum + location.pickups, 0);
  const totalDropoffs = locationRows.reduce((sum, location) => sum + location.dropoffs, 0);
  if (locationRows.length === 0 || totalCompletedTrips === 0) {
    throw new Error('The TOD KPI workbook does not contain any completed pickups.');
  }

  const warnings: string[] = [];
  if (invalidRows > 0) warnings.push(`${invalidRows.toLocaleString()} location rows were skipped because required values were invalid.`);
  if (totalCompletedTrips !== totalDropoffs) {
    warnings.push(`Pickup total (${totalCompletedTrips.toLocaleString()}) does not match drop-off total (${totalDropoffs.toLocaleString()}).`);
  }

  const dataset: TodDailyKpiDataset = {
    date: serviceDate,
    importedAt: new Date().toISOString(),
    importedBy,
    sourceFileName: fileName,
    rowCount: sourceRows,
    totalCompletedTrips,
    totalDropoffs,
    locations: locationRows,
  };
  return { dataset, warnings };
}
