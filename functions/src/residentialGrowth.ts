import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { randomUUID } from 'crypto';

export type ResidentialGrowthLayer = 'issued' | 'occupied';

export interface ResidentialGrowthGeocode {
  lat: number;
  lon: number;
  displayName: string;
  source: 'mapbox';
  confidence: 'high' | 'medium' | 'low';
}

export interface ResidentialGrowthRecord {
  id: string;
  layer: ResidentialGrowthLayer;
  fileNumber: string;
  address: string;
  date: string;
  units: number;
  category: string;
  subtype?: string;
  workProposed?: string;
  description?: string;
  status?: string;
  geocode?: ResidentialGrowthGeocode | null;
  warnings: string[];
}

export interface ResidentialGrowthMonthlyDataset {
  schemaVersion: 1;
  period: string;
  issued: ResidentialGrowthRecord[];
  occupied: ResidentialGrowthRecord[];
  metadata: {
    importedAt: string;
    importedBy: string;
    issuedFileName?: string;
    occupiedFileName?: string;
    issuedImportedAt?: string;
    occupiedImportedAt?: string;
  };
}

interface PendingReportState {
  period: string;
  issuedRawStoragePath?: string;
  occupiedRawStoragePath?: string;
  issuedFileName?: string;
  occupiedFileName?: string;
  updatedAt?: admin.firestore.FieldValue;
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/_x000D_/g, ' ').replace(/\s+/g, ' ').trim();
}

function excelDateToIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = cellToString(value);
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString().slice(0, 10);
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = cellToString(value).replace(/[$,]/g, '');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeAddress(value: string): string {
  return value.replace(/,\s*BARRIE,\s*ON\s*$/i, ', Barrie, ON').replace(/\s+/g, ' ').trim();
}

function makeId(layer: ResidentialGrowthLayer, fileNumber: string, address: string, index: number): string {
  const base = `${layer}-${fileNumber || address || index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || `${layer}-${index}`;
}

function sheetRows(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false });
}

function extractPeriod(records: ResidentialGrowthRecord[]): string | undefined {
  return records.find((record) => /^\d{4}-\d{2}-\d{2}$/.test(record.date))?.date.slice(0, 7);
}

export function parseIssuanceListingBuffer(buffer: Buffer): { records: ResidentialGrowthRecord[]; period?: string; warnings: string[] } {
  const rows = sheetRows(buffer);
  const records: ResidentialGrowthRecord[] = [];
  let current: ResidentialGrowthRecord | null = null;

  rows.forEach((row, rowIndex) => {
    const first = cellToString(row[0]);
    if (/^PMT\d{2}-\d+/i.test(first)) {
      if (current) records.push(current);
      const units = Math.max(0, Math.round(parseNumber(row[10]) ?? 0));
      current = {
        id: makeId('issued', first, '', rowIndex),
        layer: 'issued',
        fileNumber: first,
        address: '',
        date: excelDateToIso(row[7]),
        units,
        category: cellToString(row[8]) || 'Unknown',
        workProposed: cellToString(row[9]) || undefined,
        description: undefined,
        warnings: units <= 0 ? ['No residential unit count in issuance listing.'] : [],
      };
      return;
    }
    if (!current) return;
    const label = cellToString(row[1]);
    if (label === 'Location:') {
      current.address = normalizeAddress(cellToString(row[5]));
      current.id = makeId('issued', current.fileNumber, current.address, rowIndex);
    } else if (label === 'Project Description:') {
      current.description = cellToString(row[5]) || undefined;
    }
  });
  if (current) records.push(current);

  const residential = records.filter((record) => {
    const haystack = `${record.category} ${record.workProposed ?? ''} ${record.description ?? ''}`.toLowerCase();
    return record.units > 0 && /(residential|dwelling|suite|duplex|triplex|rowhouse)/.test(haystack);
  });
  residential.forEach((record) => {
    if (!record.address) record.warnings.push('Missing address.');
    if (!record.date) record.warnings.push('Missing issue date.');
  });
  return { records: residential, period: extractPeriod(residential), warnings: residential.length ? [] : ['No residential issued records with units greater than zero were found.'] };
}

export function parseOccupancyCertificateBuffer(buffer: Buffer): { records: ResidentialGrowthRecord[]; period?: string; warnings: string[] } {
  const rows = sheetRows(buffer);
  const headerRowIndex = rows.findIndex((row) => cellToString(row[0]) === 'File Number' && cellToString(row[1]) === 'Location');
  if (headerRowIndex < 0) return { records: [], warnings: ['Certificate of Occupancy header row was not found.'] };
  const headers = rows[headerRowIndex].map(cellToString);
  const indexOf = (header: string) => headers.indexOf(header);
  const records: ResidentialGrowthRecord[] = [];

  rows.slice(headerRowIndex + 1).forEach((row, offset) => {
    const fileNumber = cellToString(row[indexOf('File Number')]);
    const address = normalizeAddress(cellToString(row[indexOf('Location')]));
    if (!fileNumber && !address) return;
    const projectType = cellToString(row[indexOf('Type of Project')]);
    const status = cellToString(row[indexOf('Status')]);
    if (projectType.toLowerCase() !== 'residential' || status.toLowerCase() !== 'passed') return;
    const record: ResidentialGrowthRecord = {
      id: makeId('occupied', fileNumber, address, offset),
      layer: 'occupied',
      fileNumber,
      address,
      date: excelDateToIso(row[indexOf('Date Inspection')]),
      units: 1,
      category: projectType,
      subtype: cellToString(row[indexOf('Residential Subtype')]) || undefined,
      workProposed: cellToString(row[indexOf('Primary Application Purpose')]) || undefined,
      status,
      warnings: [],
    };
    if (!address) record.warnings.push('Missing address.');
    if (!record.date) record.warnings.push('Missing inspection date.');
    records.push(record);
  });

  return { records, period: extractPeriod(records), warnings: records.length ? [] : ['No passed residential occupancy rows were found.'] };
}

function summarize(records: ResidentialGrowthRecord[]): { records: number; units: number; geocoded: number } {
  return {
    records: records.length,
    units: records.reduce((sum, record) => sum + record.units, 0),
    geocoded: records.filter((record) => !!record.geocode).length,
  };
}

function geocodeKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function geocodeAddress(address: string, mapboxToken: string): Promise<ResidentialGrowthGeocode | null> {
  if (!address) return null;
  const query = encodeURIComponent(/barrie/i.test(address) ? address : `${address}, Barrie, Ontario, Canada`);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${mapboxToken}&country=ca&limit=1&bbox=-79.85,44.25,-79.55,44.50`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json() as { features?: Array<{ center?: [number, number]; place_name?: string; relevance?: number }> };
  const feature = data.features?.[0];
  if (!feature?.center) return null;
  const relevance = feature.relevance ?? 0;
  return {
    lon: feature.center[0],
    lat: feature.center[1],
    displayName: feature.place_name || address,
    source: 'mapbox',
    confidence: relevance >= 0.9 ? 'high' : relevance >= 0.75 ? 'medium' : 'low',
  };
}

async function geocodeRecords(records: ResidentialGrowthRecord[], mapboxToken: string): Promise<ResidentialGrowthRecord[]> {
  const cache = new Map<string, ResidentialGrowthGeocode | null>();
  for (const address of Array.from(new Set(records.map((record) => record.address).filter(Boolean)))) {
    cache.set(geocodeKey(address), await geocodeAddress(address, mapboxToken));
  }
  return records.map((record) => {
    const geocode = cache.get(geocodeKey(record.address)) ?? null;
    return {
      ...record,
      geocode,
      warnings: geocode ? record.warnings : Array.from(new Set([...record.warnings, 'Address could not be geocoded.'])),
    };
  });
}

function buildStaticMapUrl(records: ResidentialGrowthRecord[], color: string, mapboxToken: string): string | null {
  const points = records.filter((record) => record.geocode).slice(0, 80);
  if (points.length === 0) return null;
  const features = points.map((record) => ({
    type: 'Feature',
    properties: { 'marker-color': color.replace('#', ''), 'marker-size': record.units > 10 ? 'large' : 'medium' },
    geometry: { type: 'Point', coordinates: [record.geocode!.lon, record.geocode!.lat] },
  }));
  const overlay = encodeURIComponent(JSON.stringify({ type: 'FeatureCollection', features }));
  return `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/geojson(${overlay})/auto/1200x800@2x?padding=70&access_token=${mapboxToken}`;
}

async function fetchPngDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const arrayBuffer = await response.arrayBuffer();
  return `data:image/png;base64,${Buffer.from(arrayBuffer).toString('base64')}`;
}

export async function buildResidentialGrowthPdf(dataset: ResidentialGrowthMonthlyDataset, mapboxToken: string): Promise<Buffer> {
  const issuedSummary = summarize(dataset.issued);
  const occupiedSummary = summarize(dataset.occupied);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(`Residential Growth — ${dataset.period}`, 12, 15);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Issued: ${issuedSummary.units} units / ${issuedSummary.records} records · Occupied: ${occupiedSummary.units} units / ${occupiedSummary.records} records`, 12, 23);

  const issuedMap = await fetchPngDataUrl(buildStaticMapUrl(dataset.issued, '#2563eb', mapboxToken));
  const occupiedMap = await fetchPngDataUrl(buildStaticMapUrl(dataset.occupied, '#16a34a', mapboxToken));
  if (issuedMap) doc.addImage(issuedMap, 'PNG', 12, 32, 122, 82);
  if (occupiedMap) doc.addImage(occupiedMap, 'PNG', 145, 32, 122, 82);
  doc.setFont('helvetica', 'bold');
  doc.text('Issued / planned', 12, 122);
  doc.text('Occupied / completed', 145, 122);

  doc.addPage('letter', 'landscape');
  doc.setFontSize(16);
  doc.text('Largest issued records', 12, 15);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  [...dataset.issued].sort((a, b) => b.units - a.units).slice(0, 18).forEach((record, index) => {
    const y = 25 + index * 7;
    doc.text(`${index + 1}. ${record.address} — ${record.units} unit${record.units === 1 ? '' : 's'} — ${record.workProposed || record.category}`, 12, y, { maxWidth: 240 });
  });

  const output = doc.output('arraybuffer');
  return Buffer.from(output);
}

export async function saveResidentialGrowthDataset(params: {
  db: admin.firestore.Firestore;
  bucket: admin.storage.Storage['bucket'] extends (...args: never[]) => infer R ? R : never;
  teamId: string;
  period: string;
  issued: ResidentialGrowthRecord[];
  occupied: ResidentialGrowthRecord[];
  issuedFileName?: string;
  occupiedFileName?: string;
  pdfBuffer: Buffer;
}): Promise<{ importId: string; storagePath: string; pdfStoragePath: string; signedPdfUrl: string }> {
  const importId = `${params.period}-${Date.now()}`;
  const storagePath = `teams/${params.teamId}/residentialGrowth/${importId}.json`;
  const pdfStoragePath = `teams/${params.teamId}/residentialGrowth/${importId}.pdf`;
  const dataset: ResidentialGrowthMonthlyDataset = {
    schemaVersion: 1,
    period: params.period,
    issued: params.issued,
    occupied: params.occupied,
    metadata: {
      importedAt: new Date().toISOString(),
      importedBy: 'auto-ingest',
      issuedFileName: params.issuedFileName,
      occupiedFileName: params.occupiedFileName,
      issuedImportedAt: new Date().toISOString(),
      occupiedImportedAt: new Date().toISOString(),
    },
  };
  const issuedSummary = summarize(params.issued);
  const occupiedSummary = summarize(params.occupied);
  const reviewCount = [...params.issued, ...params.occupied].filter((record) => record.warnings.length > 0 || !record.geocode).length;

  await params.bucket.file(storagePath).save(JSON.stringify(dataset), { contentType: 'application/json' });
  const pdfDownloadToken = randomUUID();
  await params.bucket.file(pdfStoragePath).save(params.pdfBuffer, {
    contentType: 'application/pdf',
    metadata: {
      firebaseStorageDownloadTokens: pdfDownloadToken,
    },
  });
  const firebasePdfUrl = `https://firebasestorage.googleapis.com/v0/b/${params.bucket.name}/o/${encodeURIComponent(pdfStoragePath)}?alt=media&token=${pdfDownloadToken}`;

  let signedPdfUrl = firebasePdfUrl;
  try {
    [signedPdfUrl] = await params.bucket.file(pdfStoragePath).getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  } catch (error) {
    console.warn('Residential Growth PDF was saved with a Firebase download token, but a signed PDF URL could not be created:', error);
  }

  const importsCollection = params.db.collection(`teams/${params.teamId}/residentialGrowth/default/imports`);
  const activeImports = await importsCollection.where('isActive', '==', true).get();
  const batch = params.db.batch();
  activeImports.docs.forEach((docSnap) => batch.update(docSnap.ref, { isActive: false }));
  batch.set(importsCollection.doc(importId), {
    id: importId,
    period: params.period,
    importedAt: new Date().toISOString(),
    importedBy: 'auto-ingest',
    issuedFileName: params.issuedFileName || null,
    occupiedFileName: params.occupiedFileName || null,
    issuedCount: issuedSummary.records,
    issuedUnits: issuedSummary.units,
    occupiedCount: occupiedSummary.records,
    occupiedUnits: occupiedSummary.units,
    storagePath,
    pdfStoragePath,
    isActive: true,
  });
  batch.set(params.db.doc(`teams/${params.teamId}/residentialGrowth/default`), {
    activeImportId: importId,
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
    importedBy: 'auto-ingest',
    period: params.period,
    storagePath,
    pdfStoragePath,
    issuedFileName: params.issuedFileName || null,
    occupiedFileName: params.occupiedFileName || null,
    issuedRecords: issuedSummary.records,
    issuedUnits: issuedSummary.units,
    issuedGeocoded: issuedSummary.geocoded,
    occupiedRecords: occupiedSummary.records,
    occupiedUnits: occupiedSummary.units,
    occupiedGeocoded: occupiedSummary.geocoded,
    reviewCount,
  });
  await batch.commit();

  return { importId, storagePath, pdfStoragePath, signedPdfUrl };
}

export function decodeExcelRequestBody(reqBody: unknown): { buffer: Buffer; fileName?: string } {
  if (Buffer.isBuffer(reqBody)) return { buffer: reqBody };
  const body = typeof reqBody === 'string' ? JSON.parse(reqBody) as { fileBase64?: string; contentBytes?: string; fileName?: string } : reqBody as { fileBase64?: string; contentBytes?: string; fileName?: string };
  const base64 = body?.fileBase64 || body?.contentBytes;
  if (!base64) throw new Error('JSON body must include fileBase64 or contentBytes.');
  return { buffer: Buffer.from(base64, 'base64'), fileName: body.fileName };
}

export async function processResidentialGrowthIfComplete(params: {
  db: admin.firestore.Firestore;
  bucket: admin.storage.Storage['bucket'] extends (...args: never[]) => infer R ? R : never;
  teamId: string;
  period: string;
  pending: PendingReportState;
  mapboxToken: string;
}): Promise<{ completed: false } | { completed: true; importId: string; storagePath: string; pdfStoragePath: string; signedPdfUrl: string; issuedCount: number; occupiedCount: number }> {
  if (!params.pending.issuedRawStoragePath || !params.pending.occupiedRawStoragePath) return { completed: false };
  const [issuedBuffer] = await params.bucket.file(params.pending.issuedRawStoragePath).download();
  const [occupiedBuffer] = await params.bucket.file(params.pending.occupiedRawStoragePath).download();
  const issuedParse = parseIssuanceListingBuffer(issuedBuffer);
  const occupiedParse = parseOccupancyCertificateBuffer(occupiedBuffer);
  const issued = await geocodeRecords(issuedParse.records, params.mapboxToken);
  const occupied = await geocodeRecords(occupiedParse.records, params.mapboxToken);
  const dataset: ResidentialGrowthMonthlyDataset = {
    schemaVersion: 1,
    period: params.period,
    issued,
    occupied,
    metadata: {
      importedAt: new Date().toISOString(),
      importedBy: 'auto-ingest',
      issuedFileName: params.pending.issuedFileName,
      occupiedFileName: params.pending.occupiedFileName,
    },
  };
  const pdfBuffer = await buildResidentialGrowthPdf(dataset, params.mapboxToken);
  const saved = await saveResidentialGrowthDataset({
    db: params.db,
    bucket: params.bucket,
    teamId: params.teamId,
    period: params.period,
    issued,
    occupied,
    issuedFileName: params.pending.issuedFileName,
    occupiedFileName: params.pending.occupiedFileName,
    pdfBuffer,
  });
  return { completed: true, ...saved, issuedCount: issued.length, occupiedCount: occupied.length };
}
