import * as XLSX from 'xlsx';
import {
  PARKING_REVENUE_SCHEMA_VERSION,
  type ParkingRevenueAnalytics,
  type ParkingRevenueDataset,
  type ParkingRevenueFilters,
  type ParkingRevenueLocationMapping,
  type ParkingRevenueLocationRef,
  type ParkingRevenueLocationSummary,
  type ParkingRevenueParseResult,
  type ParkingRevenueRawRow,
  type ParkingRevenueSource,
  type ParkingRevenueSummary,
  type ParkingRevenueTrendPoint,
  type ParkingSettings,
} from './parkingTypes';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseMoney(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
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
    if (source && headers.includes('starttime') && headers.includes('plate') && headers.includes('amount') && headers.includes('length')) {
      return { index, source, headers: rows[index] };
    }
  }
  return null;
}

function headerIndex(headers: unknown[], header: string): number {
  return headers.findIndex(value => normalizeHeader(value) === header);
}

function locationKeyForRef(source: ParkingRevenueSource, sourceId: string): string {
  return `${source}:${normalizeText(sourceId).toUpperCase()}`;
}

export function buildParkingRevenueLocationLookup(settings: ParkingSettings): Map<string, ParkingRevenueLocationMapping> {
  const lookup = new Map<string, ParkingRevenueLocationMapping>();
  for (const location of settings.revenueLocations || []) {
    for (const ref of location.sourceRefs || []) {
      const key = locationKeyForRef(ref.source, ref.sourceId);
      if (key) lookup.set(key, location);
    }
  }
  return lookup;
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
    throw new Error('Could not find a Parking revenue header row. Expected HotSpot #/City # or Meter #/Tap Sign with Start Time, Plate, Amount, Total, and Length.');
  }

  const source = header.source;
  const indices = {
    sourceId: headerIndex(header.headers, source === 'hotspot' ? 'hotspot' : 'meter'),
    sourceLabel: headerIndex(header.headers, source === 'hotspot' ? 'city' : 'tapsign'),
    start: headerIndex(header.headers, 'starttime'),
    plate: headerIndex(header.headers, 'plate'),
    amount: headerIndex(header.headers, 'amount'),
    tax: headerIndex(header.headers, 'tax'),
    total: headerIndex(header.headers, 'total'),
    length: headerIndex(header.headers, 'length'),
    paymentType: headerIndex(header.headers, 'cardtype'),
  };

  const locationLookup = options.settings ? buildParkingRevenueLocationLookup(options.settings) : new Map<string, ParkingRevenueLocationMapping>();
  const parsedRows: ParkingRevenueRawRow[] = [];
  const months = new Set<string>();
  let skippedRows = 0;

  rows.slice(header.index + 1).forEach((row, rowOffset) => {
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
    totalRevenue: roundMoney(parsedRows.reduce((sum, row) => sum + row.amount, 0)),
    totalTax: roundMoney(parsedRows.reduce((sum, row) => sum + row.tax, 0)),
    totalPaid: roundMoney(parsedRows.reduce((sum, row) => sum + row.total, 0)),
    rows: parsedRows,
  };

  const warnings: string[] = [];
  if (skippedRows > 0) warnings.push(`${skippedRows.toLocaleString()} rows were skipped because required revenue fields were missing or invalid.`);
  const missingPlateCount = parsedRows.filter(row => row.hasMissingPlate).length;
  if (missingPlateCount > 0) warnings.push(`${missingPlateCount.toLocaleString()} revenue rows have missing plates.`);
  const zeroAmountCount = parsedRows.filter(row => row.amount === 0).length;
  if (zeroAmountCount > 0) warnings.push(`${zeroAmountCount.toLocaleString()} revenue rows have $0 Amount and are included in activity counts.`);

  return { dataset, warnings };
}

export async function parseParkingRevenueFile(file: File, importedBy: string, settings?: ParkingSettings): Promise<ParkingRevenueParseResult> {
  if (!file.name.match(/\.xlsx?$/i)) {
    throw new Error('Upload a Parking revenue Excel file (.xlsx or .xls).');
  }
  const buffer = await file.arrayBuffer();
  return parseParkingRevenueWorkbook(buffer, { fileName: file.name, importedBy, settings });
}

function buildRevenueMetadata(datasets: ParkingRevenueDataset[], importedBy: string): ParkingRevenueSummary['metadata'] {
  return {
    importedAt: new Date().toISOString(),
    importedBy,
    datasetCount: datasets.length,
    monthCount: new Set(datasets.map(dataset => dataset.month)).size,
    totalRows: datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0),
    totalRevenue: roundMoney(datasets.reduce((sum, dataset) => sum + dataset.totalRevenue, 0)),
  };
}

export function buildParkingRevenueSummary(
  datasets: ParkingRevenueDataset[],
  importedBy: string,
  storagePath?: string,
): ParkingRevenueSummary {
  const sortedDatasets = [...datasets].sort((a, b) => a.month.localeCompare(b.month) || a.source.localeCompare(b.source));
  return {
    schemaVersion: PARKING_REVENUE_SCHEMA_VERSION,
    datasets: sortedDatasets,
    metadata: {
      ...buildRevenueMetadata(sortedDatasets, importedBy),
      ...(storagePath ? { storagePath } : {}),
    },
  };
}

export function buildParkingRevenueReplacementSummary(
  existingSummary: ParkingRevenueSummary | null,
  datasets: ParkingRevenueDataset[],
  importedBy: string,
  storagePath: string,
): ParkingRevenueSummary {
  if (datasets.length === 0) throw new Error('Select at least one Parking revenue file to save.');
  const replacementKeys = new Set<string>();
  for (const dataset of datasets) {
    const key = `${dataset.month}|${dataset.source}`;
    if (replacementKeys.has(key)) {
      throw new Error('Parking revenue batch imports must contain different source/month combinations.');
    }
    replacementKeys.add(key);
  }
  const keptDatasets = (existingSummary?.datasets || []).filter(dataset => !replacementKeys.has(`${dataset.month}|${dataset.source}`));
  return buildParkingRevenueSummary([...keptDatasets, ...datasets], importedBy, storagePath);
}

function sourceLabel(source: ParkingRevenueSource): string {
  return source === 'hotspot' ? 'HotSpot app' : 'QR code';
}

function groupKeyForRow(row: ParkingRevenueRawRow, locationLookup?: Map<string, ParkingRevenueLocationMapping>): string {
  const currentMappedLocation = locationLookup?.get(locationKeyForRef(row.source, row.sourceId));
  return currentMappedLocation?.id || row.physicalLocationId || `${row.source}:${row.sourceId}`;
}

function groupNameForRow(row: ParkingRevenueRawRow): string {
  return row.physicalLocationName || row.sourceLabel || row.sourceId;
}

function rowMatchesFilters(row: ParkingRevenueRawRow, filters: ParkingRevenueFilters): boolean {
  if (filters.months && filters.months.length > 0 && !filters.months.includes(row.startMonth)) return false;
  if (filters.source && filters.source !== 'all' && row.source !== filters.source) return false;
  if (filters.dayType === 'weekday' && row.isWeekend) return false;
  if (filters.dayType === 'weekend' && !row.isWeekend) return false;
  if (filters.dayType === 'saturday' && row.weekday !== 6) return false;
  if (filters.dayType === 'sunday' && row.weekday !== 0) return false;
  if (typeof filters.hourStart === 'number' && Math.floor(row.startMinutes / 60) < filters.hourStart) return false;
  if (typeof filters.hourEnd === 'number' && Math.floor(row.startMinutes / 60) > filters.hourEnd) return false;
  return true;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function peakEntry<T extends string | number>(values: Iterable<T>): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
}

function buildLocationSummaries(rows: ParkingRevenueRawRow[], settings: ParkingSettings): ParkingRevenueLocationSummary[] {
  const locationById = new Map((settings.revenueLocations || []).map(location => [location.id, location]));
  const locationLookup = buildParkingRevenueLocationLookup(settings);
  const groups = new Map<string, ParkingRevenueRawRow[]>();
  for (const row of rows) {
    const key = groupKeyForRow(row, locationLookup);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const first = group[0];
    const mappedLocation = locationById.get(key) || (first.physicalLocationId ? locationById.get(first.physicalLocationId) : undefined);
    const sourceIds = new Map<string, ParkingRevenueLocationRef>();
    for (const row of group) {
      sourceIds.set(locationKeyForRef(row.source, row.sourceId), { source: row.source, sourceId: row.sourceId, label: row.sourceLabel });
    }
    const durations = group.map(row => row.durationMinutes).filter(value => value > 0);
    return {
      key,
      displayName: mappedLocation?.displayName || groupNameForRow(first),
      sourceIds: mappedLocation?.sourceRefs?.length ? mappedLocation.sourceRefs : [...sourceIds.values()],
      latitude: mappedLocation?.latitude ?? null,
      longitude: mappedLocation?.longitude ?? null,
      isMapped: Boolean(mappedLocation && typeof mappedLocation.latitude === 'number' && typeof mappedLocation.longitude === 'number'),
      rowCount: group.length,
      totalRevenue: roundMoney(group.reduce((sum, row) => sum + row.amount, 0)),
      totalPaid: roundMoney(group.reduce((sum, row) => sum + row.total, 0)),
      averageStayMinutes: average(durations),
      uniquePlateCount: new Set(group.map(row => row.plate).filter(Boolean)).size,
      hotspotRevenue: roundMoney(group.filter(row => row.source === 'hotspot').reduce((sum, row) => sum + row.amount, 0)),
      qrRevenue: roundMoney(group.filter(row => row.source === 'qr').reduce((sum, row) => sum + row.amount, 0)),
      peakHour: peakEntry(group.map(row => Math.floor(row.startMinutes / 60))),
      peakDay: peakEntry(group.map(row => row.startDate)) || '',
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue || b.rowCount - a.rowCount || a.displayName.localeCompare(b.displayName));
}

function buildTrend(rows: ParkingRevenueRawRow[], keyForRow: (row: ParkingRevenueRawRow) => string, labelForKey = (key: string) => key): ParkingRevenueTrendPoint[] {
  const groups = new Map<string, ParkingRevenueRawRow[]>();
  for (const row of rows) {
    const key = keyForRow(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: labelForKey(key),
    rowCount: group.length,
    totalRevenue: roundMoney(group.reduce((sum, row) => sum + row.amount, 0)),
    averageStayMinutes: average(group.map(row => row.durationMinutes).filter(value => value > 0)),
  })).sort((a, b) => a.key.localeCompare(b.key));
}

export function buildParkingRevenueAnalytics(
  summary: ParkingRevenueSummary | null | undefined,
  settings: ParkingSettings,
  filters: ParkingRevenueFilters = {},
): ParkingRevenueAnalytics {
  const rows = (summary?.datasets || [])
    .flatMap(dataset => dataset.rows)
    .filter(row => rowMatchesFilters(row, filters));
  const locationSummaries = buildLocationSummaries(rows, settings);
  const durations = rows.map(row => row.durationMinutes).filter(value => value > 0);
  return {
    rows,
    locationSummaries,
    mappedLocationSummaries: locationSummaries.filter(location => location.isMapped),
    unmappedLocationSummaries: locationSummaries.filter(location => !location.isMapped),
    totalRevenue: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)),
    totalPaid: roundMoney(rows.reduce((sum, row) => sum + row.total, 0)),
    rowCount: rows.length,
    averageStayMinutes: average(durations),
    uniquePlateCount: new Set(rows.map(row => row.plate).filter(Boolean)).size,
    peakHour: peakEntry(rows.map(row => Math.floor(row.startMinutes / 60))),
    peakDay: peakEntry(rows.map(row => row.startDate)) || '',
    revenueByDay: buildTrend(rows, row => row.startDate),
    revenueByHour: buildTrend(rows, row => String(Math.floor(row.startMinutes / 60)).padStart(2, '0'), key => `${key}:00`),
    revenueByMonth: buildTrend(rows, row => row.startMonth),
  };
}

export function getParkingRevenueAvailableMonths(summary: ParkingRevenueSummary | null | undefined): string[] {
  return [...new Set((summary?.datasets || []).map(dataset => dataset.month))].sort();
}

export function getParkingRevenueSourceLabel(source: ParkingRevenueSource): string {
  return sourceLabel(source);
}
