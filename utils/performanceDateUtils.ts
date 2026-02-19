const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === (month - 1) && d.getUTCDate() === day;
}

function buildIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const wholeDays = Math.floor(serial);
  if (wholeDays <= 0 || wholeDays > 200000) return null;
  const utc = new Date(EXCEL_EPOCH_UTC_MS + (wholeDays * MS_PER_DAY));
  return buildIsoDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

function localDateToIso(date: Date): string {
  return buildIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function normalizeToISODate(input: unknown): string | null {
  if (input == null) return null;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : localDateToIso(input);
  }

  if (typeof input === 'number') {
    return excelSerialToIso(input);
  }

  const raw = String(input).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const fromSerial = excelSerialToIso(Number(raw));
    if (fromSerial) return fromSerial;
  }

  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return isValidDateParts(year, month, day) ? buildIsoDate(year, month, day) : null;
  }

  match = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return isValidDateParts(year, month, day) ? buildIsoDate(year, month, day) : null;
  }

  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const month = Number(match[1]);
    const day = Number(match[2]);
    return isValidDateParts(year, month, day) ? buildIsoDate(year, month, day) : null;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return localDateToIso(parsed);
  }

  return null;
}

export function toDateSortKey(dateStr: string): number {
  const iso = normalizeToISODate(dateStr);
  if (iso) return Date.parse(`${iso}T00:00:00Z`);
  const parsed = Date.parse(dateStr);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

export function compareDateStrings(a: string, b: string): number {
  const aKey = toDateSortKey(a);
  const bKey = toDateSortKey(b);
  const aValid = Number.isFinite(aKey);
  const bValid = Number.isFinite(bKey);

  if (aValid && bValid) return aKey - bKey;
  if (aValid) return -1;
  if (bValid) return 1;
  return a.localeCompare(b);
}

export function shortDateLabel(dateStr: string): string {
  const iso = normalizeToISODate(dateStr);
  return iso ? iso.slice(5) : dateStr;
}
