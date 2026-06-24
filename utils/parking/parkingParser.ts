import * as XLSX from 'xlsx';
import {
  DEFAULT_PARKING_SETTINGS,
  type ParkingMonthlyDataset,
  type ParkingParseResult,
  type ParkingRawRow,
  type ParkingSettings,
  type ParkingUnmappedCodeFamily,
} from './parkingTypes';
import { buildParkingMonthAnalysis, mergeParkingSettings } from './parkingAggregation';
import {
  getParkingAllKnownCodesForMapping,
  getParkingCodeFamilyKey,
  normalizeParkingCode,
} from './parkingCodeRules';

const REQUIRED_HEADERS = [
  'licenceplate',
  'starttime',
  'spotidtaptoken',
  'length',
  'tapsignsspot',
  'discountcode',
  'discountamount',
];

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export { getParkingCodeFamilyKey, normalizeParkingCode } from './parkingCodeRules';

function parseMoney(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseParkingDurationMinutes(value: unknown): number | null {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] ?? 0);
  const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*m/)?.[1] ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : null;
}

function parseHotspotDate(value: unknown): { date: string; month: string; minutes: number; weekday: number; raw: string } | null {
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

function findHeaderRow(rows: unknown[][]): number {
  return rows.findIndex(row => {
    const normalized = row.map(normalizeHeader);
    return REQUIRED_HEADERS.every(header => normalized.includes(header));
  });
}

function headerIndex(headers: unknown[], header: string): number {
  return headers.findIndex(value => normalizeHeader(value) === header);
}

function buildMappingLookup(settings: ParkingSettings): Map<string, string> {
  const map = new Map<string, string>();
  for (const mapping of settings.codeFamilies) {
    const familyKey = getParkingCodeFamilyKey(mapping.familyKey);
    if (familyKey && mapping.department.trim()) {
      map.set(familyKey, mapping.department.trim());
    }
    for (const code of getParkingAllKnownCodesForMapping(mapping)) {
      const exact = normalizeParkingCode(code);
      if (exact && mapping.department.trim()) {
        map.set(exact, mapping.department.trim());
        if (!familyKey) map.set(getParkingCodeFamilyKey(exact), mapping.department.trim());
      }
    }
  }
  return map;
}

function buildLocationLookup(settings: ParkingSettings): Map<string, string> {
  return new Map(settings.spotLocations.map(location => [normalizeText(location.spotId), normalizeText(location.locationName)]));
}

function sortUnmapped(values: Map<string, ParkingUnmappedCodeFamily>): ParkingUnmappedCodeFamily[] {
  return [...values.values()].sort((a, b) => a.familyKey.localeCompare(b.familyKey));
}

export function parseParkingWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  options: {
    fileName: string;
    importedBy: string;
    settings?: ParkingSettings;
  },
): ParkingParseResult {
  const settings = mergeParkingSettings(DEFAULT_PARKING_SETTINGS, options.settings || DEFAULT_PARKING_SETTINGS);
  const workbook = XLSX.read(buffer, { cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The HotSpot workbook does not contain any sheets.');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error('Could not find the HotSpot header row. Expected Licence Plate, Start Time, Spot Id/Tap Token, Length, Discount Code, and Discount Amount.');
  }

  const headers = rows[headerRowIndex];
  const indices = {
    plate: headerIndex(headers, 'licenceplate'),
    start: headerIndex(headers, 'starttime'),
    spot: headerIndex(headers, 'spotidtaptoken'),
    length: headerIndex(headers, 'length'),
    tapType: headerIndex(headers, 'tapsignsspot'),
    code: headerIndex(headers, 'discountcode'),
    description: headerIndex(headers, 'description'),
    amount: headerIndex(headers, 'discountamount'),
  };

  const mappingLookup = buildMappingLookup(settings);
  const locationLookup = buildLocationLookup(settings);
  const parsedRows: ParkingRawRow[] = [];
  const months = new Set<string>();
  const unmapped = new Map<string, ParkingUnmappedCodeFamily>();
  let skippedRows = 0;

  rows.slice(headerRowIndex + 1).forEach((row, rowOffset) => {
    const start = parseHotspotDate(row[indices.start]);
    const durationMinutes = parseParkingDurationMinutes(row[indices.length]);
    const discountCode = normalizeParkingCode(row[indices.code]);
    if (!start || !durationMinutes || !discountCode) {
      skippedRows += 1;
      return;
    }

    const plate = normalizeText(row[indices.plate]).toUpperCase();
    const spotId = normalizeText(row[indices.spot]);
    const codeFamilyKey = getParkingCodeFamilyKey(discountCode);
    const department = mappingLookup.get(discountCode) || mappingLookup.get(codeFamilyKey) || '';
    const description = normalizeText(indices.description >= 0 ? row[indices.description] : '');

    if (!department) {
      const existing = unmapped.get(codeFamilyKey) ?? {
        familyKey: codeFamilyKey,
        codes: [],
        descriptions: [],
        rowCount: 0,
      };
      if (!existing.codes.includes(discountCode)) existing.codes.push(discountCode);
      if (description && !existing.descriptions.includes(description)) existing.descriptions.push(description);
      existing.rowCount += 1;
      unmapped.set(codeFamilyKey, existing);
    }

    months.add(start.month);
    parsedRows.push({
      id: `${start.date}-${rowOffset + 1}-${discountCode}-${plate || 'missing'}`,
      plate,
      hasMissingPlate: !plate,
      startRaw: start.raw,
      startDate: start.date,
      startMonth: start.month,
      startMinutes: start.minutes,
      endMinutes: start.minutes + durationMinutes,
      weekday: start.weekday,
      isWeekend: start.weekday === 0 || start.weekday === 6,
      spotId,
      locationName: locationLookup.get(spotId) || spotId,
      durationMinutes,
      tapType: normalizeText(row[indices.tapType]),
      discountCode,
      codeFamilyKey,
      department,
      description,
      discountAmount: parseMoney(row[indices.amount]),
    });
  });

  if (parsedRows.length === 0) {
    throw new Error('The HotSpot workbook did not contain any importable usage rows.');
  }
  if (months.size > 1) {
    throw new Error(`Parking imports must contain one month at a time. This file contains ${[...months].sort().join(', ')}.`);
  }

  const month = [...months][0];
  const analysis = buildParkingMonthAnalysis(parsedRows, settings.flagRules);
  const dataset: ParkingMonthlyDataset = {
    month,
    importedAt: new Date().toISOString(),
    importedBy: options.importedBy,
    sourceFileName: options.fileName,
    rowCount: parsedRows.length,
    skippedRows,
    totalValue: parsedRows.reduce((sum, row) => sum + row.discountAmount, 0),
    rows: parsedRows,
    departmentSummaries: analysis.departmentSummaries,
    platePatterns: analysis.platePatterns,
  };

  const warnings: string[] = [];
  if (skippedRows > 0) warnings.push(`${skippedRows.toLocaleString()} rows were skipped because required HotSpot fields were missing or invalid.`);
  const missingPlateCount = parsedRows.filter(row => row.hasMissingPlate).length;
  if (missingPlateCount > 0) warnings.push(`${missingPlateCount.toLocaleString()} rows have missing licence plates and were flagged for review.`);

  return {
    dataset: { ...dataset, departmentSummaries: dataset.departmentSummaries.map(summary => ({ ...summary, month })) },
    warnings,
    unmappedCodeFamilies: sortUnmapped(unmapped),
  };
}

export async function parseParkingFile(file: File, importedBy: string, settings?: ParkingSettings): Promise<ParkingParseResult> {
  if (!file.name.match(/\.xlsx?$/i)) {
    throw new Error('Upload a HotSpot Excel file (.xlsx or .xls).');
  }
  const buffer = await file.arrayBuffer();
  return parseParkingWorkbook(buffer, { fileName: file.name, importedBy, settings });
}
