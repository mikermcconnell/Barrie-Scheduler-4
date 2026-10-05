import type {
  SpecializedTransitActivityBucket,
  SpecializedTransitLocationV1,
  SpecializedTransitParsedCommonLocations,
  SpecializedTransitSourceFile,
} from './types';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 1000;
const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

export interface ExtractedPdf {
  lines: string[];
  pageCount: number;
  sha256: string;
}

export interface ParsedMonthlySpecializedReport {
  reportMonth: string;
  reportedTrips: number;
  priorYearPercent: number | null;
}

function assertPdfFile(file: File): void {
  if (file.size <= 0 || file.size > MAX_PDF_BYTES) throw new Error('Each PDF must be between 1 byte and 10 MB.');
  if (file.type && file.type !== 'application/pdf') throw new Error('Only PDF files are accepted.');
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function extractPdf(file: File, onProgress?: (page: number, total: number) => void): Promise<ExtractedPdf> {
  assertPdfFile(file);
  const bytes = await file.arrayBuffer();
  const header = new TextDecoder('ascii').decode(bytes.slice(0, 5));
  if (header !== '%PDF-') throw new Error('The selected file does not have a valid PDF signature.');
  const sha256 = bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  if (document.numPages < 1 || document.numPages > MAX_PDF_PAGES) throw new Error('The PDF page count is outside the supported range.');

  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim() || !('transform' in item)) continue;
      const x = Number(item.transform[4]);
      const y = Number(item.transform[5]);
      let row = rows.find(candidate => Math.abs(candidate.y - y) <= 2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, text: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      const line = row.items.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    }
    onProgress?.(pageNumber, document.numPages);
    if (pageNumber % 10 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const pageCount = document.numPages;
  await document.destroy();
  return { lines, pageCount, sha256 };
}

function parseReportMonth(lines: string[]): string {
  for (const line of lines.slice(0, 80)) {
    const match = line.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
    if (match) return `${match[2]}-${MONTHS[match[1].toLowerCase()]}`;
  }
  throw new Error('Could not determine the report month.');
}

export function parseMonthlySpecializedLines(lines: string[]): ParsedMonthlySpecializedReport {
  const joined = lines.join('\n');
  if (!/Specialized(?:\s+Transit)?\s+Ridership/i.test(joined) || !/\bMonth\s+20\d{2}\s+Trips\s+Ridership\b/i.test(joined.replace(/\s+/g, ' '))) {
    throw new Error('This is not a supported Monthly Ridership Report.');
  }
  const reportMonth = parseReportMonth(lines);
  const monthName = Object.entries(MONTHS).find(([, value]) => value === reportMonth.slice(5))?.[0];
  if (!monthName) throw new Error('The report month is invalid.');
  const tablePattern = new RegExp(`\\b${monthName}\\b\\s+([\\d,]+)\\s+(\\d{1,3})%`, 'i');
  const match = joined.replace(/\s+/g, ' ').match(tablePattern);
  if (!match) throw new Error('Could not read the Specialized Ridership total.');
  const reportedTrips = Number(match[1].replace(/,/g, ''));
  const priorYearPercent = Number(match[2]);
  if (!Number.isInteger(reportedTrips) || reportedTrips < 0 || priorYearPercent < 0 || priorYearPercent > 999) {
    throw new Error('The Specialized Ridership values are invalid.');
  }
  return { reportMonth, reportedTrips, priorYearPercent };
}

export function normalizeSpecializedLocationName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.)])/g, '$1')
    .trim();
}

function normalizedLocationKey(value: string): string {
  return normalizeSpecializedLocationName(value).toLocaleLowerCase('en-CA').replace(/[^a-z0-9]+/g, ' ').trim();
}

function stableLocationId(key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `st-${(hash >>> 0).toString(36)}`;
}

function isNamedLocation(value: string): boolean {
  return normalizedLocationKey(value) !== 'n a';
}

export function parseCommonLocationLines(lines: string[]): SpecializedTransitParsedCommonLocations {
  if (!lines.some(line => /Ridership By Common Location/i.test(line))) {
    throw new Error('This is not a supported Ridership By Common Location report.');
  }
  const records: Array<{ date: string; hour: number; clientId: string; bookingId: string; pickup: string; dropoff: string }> = [];
  let pickup = '';
  let dropoff = '';
  const seenBookings = new Map<string, string>();

  for (const line of lines) {
    const heading = line.match(/^Pickup in\s*:\s*(.*?)\s+And Dropoff in\s*:\s*(.*?)\s*$/i);
    if (heading) {
      pickup = normalizeSpecializedLocationName(heading[1]);
      dropoff = normalizeSpecializedLocationName(heading[2]);
      continue;
    }
    const row = line.match(/^(20\d{2}-\d{2}-\d{2})\s+(\d{2}):(\d{2})\s+(\d{1,8})\s+(\d{9,12})\b/);
    if (!row || !pickup || !dropoff) continue;
    const signature = `${row[1]}|${row[2]}:${row[3]}|${row[4]}|${pickup}|${dropoff}`;
    const existing = seenBookings.get(row[5]);
    if (existing && existing !== signature) throw new Error('A BookingId appears with conflicting trip details.');
    if (existing) continue;
    seenBookings.set(row[5], signature);
    records.push({ date: row[1], hour: Number(row[2]), clientId: row[4], bookingId: row[5], pickup, dropoff });
  }
  if (records.length === 0) throw new Error('No common-location booking rows were found.');
  const dates = [...new Set(records.map(record => record.date))].sort();
  const reportMonth = dates[0].slice(0, 7);
  if (dates.some(date => date.slice(0, 7) !== reportMonth)) throw new Error('The common-location report contains more than one service month.');
  const grandTotalMatch = lines.join(' ').match(/Grand Totals\s*:\s*([\d,]+)/i);
  if (grandTotalMatch && Number(grandTotalMatch[1].replace(/,/g, '')) !== records.length) {
    throw new Error('The parsed booking count does not match the report Grand Total.');
  }

  const dailyTotals: Record<string, number> = {};
  const hourlyTotals: Record<string, number> = {};
  const clientTotals = new Map<string, number>();
  const locations: Record<string, SpecializedTransitLocationV1> = {};
  const bucketMap = new Map<string, SpecializedTransitActivityBucket>();
  const addLocation = (name: string, date: string, hour: number, field: 'pickups' | 'dropoffs') => {
    if (!isNamedLocation(name)) return;
    const key = normalizedLocationKey(name);
    const id = stableLocationId(key);
    const existingLocation = locations[id];
    if (existingLocation && existingLocation.normalizedName !== key) throw new Error('A common-location identifier collision was detected.');
    locations[id] ??= {
      id,
      displayName: name,
      normalizedName: key,
      aliases: [name],
      latitude: null,
      longitude: null,
      status: 'unmapped',
      coordinateSource: null,
      relevance: null,
    };
    if (!locations[id].aliases.includes(name)) locations[id].aliases.push(name);
    const bucketKey = `${date}|${hour}|${id}`;
    const bucket = bucketMap.get(bucketKey) ?? { date, hour, locationId: id, pickups: 0, dropoffs: 0 };
    bucket[field] += 1;
    bucketMap.set(bucketKey, bucket);
  };

  for (const record of records) {
    dailyTotals[record.date] = (dailyTotals[record.date] ?? 0) + 1;
    hourlyTotals[String(record.hour)] = (hourlyTotals[String(record.hour)] ?? 0) + 1;
    clientTotals.set(record.clientId, (clientTotals.get(record.clientId) ?? 0) + 1);
    addLocation(record.pickup, record.date, record.hour, 'pickups');
    addLocation(record.dropoff, record.date, record.hour, 'dropoffs');
  }
  const perClient = [...clientTotals.values()].sort((a, b) => a - b);
  const middle = Math.floor(perClient.length / 2);
  const median = perClient.length % 2 === 0 ? (perClient[middle - 1] + perClient[middle]) / 2 : perClient[middle];
  const thresholds = [2, 4, 8, 20].map(minimumBookings => {
    const qualifying = perClient.filter(value => value >= minimumBookings);
    const bookingCount = qualifying.reduce((sum, value) => sum + value, 0);
    return {
      minimumBookings,
      clientCount: qualifying.length,
      bookingCount,
      bookingShare: bookingCount / records.length,
    };
  });
  return {
    reportMonth,
    serviceDateRange: { start: dates[0], end: dates[dates.length - 1] },
    commonLocationBookings: records.length,
    dailyTotals,
    hourlyTotals,
    activityBuckets: [...bucketMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour || a.locationId.localeCompare(b.locationId)),
    locations,
    recurringDemand: {
      distinctClientIds: clientTotals.size,
      medianBookingsPerClient: median,
      thresholds,
    },
  };
}

export function sourceFileFromExtract(extracted: ExtractedPdf): SpecializedTransitSourceFile {
  return { sha256: extracted.sha256, pageCount: extracted.pageCount };
}
