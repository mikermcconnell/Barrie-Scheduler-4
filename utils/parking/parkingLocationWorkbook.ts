import * as XLSX from 'xlsx';
import type {
  ParkingRevenueLocationMapping,
  ParkingRevenueSource,
} from './parkingTypes';
export { mergeParkingRevenueLocationMappings } from './parkingLocationMappings';

export interface ParkingLocationWorkbookImportResult {
  mappings: ParkingRevenueLocationMapping[];
  rowCount: number;
  skippedRows: number;
  warnings: string[];
}

interface HeaderMap {
  hotspotId: number;
  latitude: number;
  longitude: number;
  commonName: number;
  parkingName: number;
  address: number;
  spaces: number;
}

interface ImportedLocationRow {
  sourceId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  capacitySpaces: number | null;
}

const LOCATION_ID_SOURCES: ParkingRevenueSource[] = ['hotspot', 'qr'];

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text.toLowerCase() === '<null>' ? '' : text;
}

function normalizeId(value: unknown): string {
  return normalizeText(value).replace(/\.0$/, '').toUpperCase();
}

function parseNumber(value: unknown): number | null {
  const text = normalizeText(value).replace(/[^0-9.-]/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex(header => aliases.includes(header));
}

function readHeaderMap(row: unknown[]): HeaderMap | null {
  const headers = row.map(normalizeHeader);
  const hotspotId = findHeaderIndex(headers, ['hotspotid', 'hotspot', 'hotspotnumber']);
  const latitude = findHeaderIndex(headers, ['latitude', 'lat']);
  const longitude = findHeaderIndex(headers, ['longitude', 'lng', 'lon']);
  if (hotspotId < 0 || latitude < 0 || longitude < 0) return null;

  return {
    hotspotId,
    latitude,
    longitude,
    commonName: findHeaderIndex(headers, ['commonname', 'cartoname']),
    parkingName: findHeaderIndex(headers, ['parkingname', 'name']),
    address: findHeaderIndex(headers, ['lotaddressparkinglocation', 'address', 'location']),
    spaces: findHeaderIndex(headers, ['numberofspaces', 'numspaces', 'spaces']),
  };
}

function findHeaderRow(rows: unknown[][]): { index: number; headers: HeaderMap } | null {
  for (let index = 0; index < rows.length; index += 1) {
    const headers = readHeaderMap(rows[index]);
    if (headers) return { index, headers };
  }
  return null;
}

function getCell(row: unknown[], index: number): unknown {
  return index >= 0 ? row[index] : '';
}

function isValidCoordinate(latitude: number | null, longitude: number | null): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function makeMappingId(sourceId: string): string {
  return `hotspot-${sourceId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/g, '');
}

function weightedAverage(rows: ImportedLocationRow[], coordinate: 'latitude' | 'longitude'): number {
  const totalWeight = rows.reduce((sum, row) => sum + (row.capacitySpaces && row.capacitySpaces > 0 ? row.capacitySpaces : 1), 0);
  return rows.reduce((sum, row) => sum + row[coordinate] * (row.capacitySpaces && row.capacitySpaces > 0 ? row.capacitySpaces : 1), 0) / totalWeight;
}

function bestDisplayName(rows: ImportedLocationRow[], sourceId: string): string {
  const sortedRows = [...rows].sort((a, b) => (b.capacitySpaces || 0) - (a.capacitySpaces || 0));
  return sortedRows.find(row => row.displayName)?.displayName || `Parking location ${sourceId}`;
}

function buildMappings(rows: ImportedLocationRow[]): ParkingRevenueLocationMapping[] {
  const groups = new Map<string, ImportedLocationRow[]>();
  for (const row of rows) {
    groups.set(row.sourceId, [...(groups.get(row.sourceId) || []), row]);
  }

  return [...groups.entries()].map(([sourceId, group]) => {
    const displayName = bestDisplayName(group, sourceId);
    const capacityValues = group
      .map(row => row.capacitySpaces)
      .filter((value): value is number => typeof value === 'number' && value >= 0);
    return {
      id: makeMappingId(sourceId),
      displayName,
      latitude: Number(weightedAverage(group, 'latitude').toFixed(6)),
      longitude: Number(weightedAverage(group, 'longitude').toFixed(6)),
      capacitySpaces: capacityValues.length > 0 ? capacityValues.reduce((sum, value) => sum + value, 0) : null,
      sourceRefs: LOCATION_ID_SOURCES.map(source => ({
        source,
        sourceId,
        label: displayName,
      })),
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function parseParkingLocationWorkbook(
  buffer: ArrayBuffer | Uint8Array,
): ParkingLocationWorkbookImportResult {
  const workbook = XLSX.read(buffer, { cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The parking location workbook does not contain any sheets.');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  const header = findHeaderRow(rows);
  if (!header) {
    throw new Error('Could not find parking location columns. Expected Hot Spot ID, Latitude, and Longitude.');
  }

  const importedRows: ImportedLocationRow[] = [];
  let skippedRows = 0;

  for (const row of rows.slice(header.index + 1)) {
    const sourceId = normalizeId(getCell(row, header.headers.hotspotId));
    const latitude = parseNumber(getCell(row, header.headers.latitude));
    const longitude = parseNumber(getCell(row, header.headers.longitude));
    if (!sourceId || !isValidCoordinate(latitude, longitude) || typeof latitude !== 'number' || typeof longitude !== 'number') {
      skippedRows += 1;
      continue;
    }

    const commonName = normalizeText(getCell(row, header.headers.commonName));
    const parkingName = normalizeText(getCell(row, header.headers.parkingName));
    const address = normalizeText(getCell(row, header.headers.address));
    importedRows.push({
      sourceId,
      displayName: commonName || parkingName || address || `Parking location ${sourceId}`,
      latitude,
      longitude,
      capacitySpaces: parseNumber(getCell(row, header.headers.spaces)),
    });
  }

  if (importedRows.length === 0) {
    throw new Error('The parking location workbook did not contain any importable rows with Hot Spot ID, Latitude, and Longitude.');
  }

  const mappings = buildMappings(importedRows);
  const warnings = skippedRows > 0
    ? [`${skippedRows.toLocaleString()} rows were skipped because they were missing Hot Spot ID or valid coordinates.`]
    : [];

  return {
    mappings,
    rowCount: importedRows.length,
    skippedRows,
    warnings,
  };
}

export async function parseParkingLocationWorkbookFile(file: File): Promise<ParkingLocationWorkbookImportResult> {
  if (!file.name.match(/\.xlsx?$/i)) {
    throw new Error('Upload a parking location Excel file (.xlsx or .xls).');
  }
  const buffer = await file.arrayBuffer();
  return parseParkingLocationWorkbook(buffer);
}
