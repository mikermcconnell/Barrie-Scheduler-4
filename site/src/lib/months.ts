import type { MonthKey } from './types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function toMonthKey(year: number, month: number): MonthKey {
  return `${year}-${pad(month)}`;
}

export function splitMonth(key: MonthKey): { year: number; month: number } {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m };
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const { year, month } = splitMonth(key);
  const index = year * 12 + (month - 1) + delta;
  return toMonthKey(Math.floor(index / 12), (index % 12) + 1);
}

export function formatMonth(key: MonthKey): string {
  const { year, month } = splitMonth(key);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function shortMonth(key: MonthKey): string {
  return MONTH_NAMES[splitMonth(key).month - 1].slice(0, 3);
}

/** `Sep 2025` */
export function shortMonthYear(key: MonthKey): string {
  return `${shortMonth(key)} ${splitMonth(key).year}`;
}

function valid(year: number, month: number): MonthKey | null {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (year < 1990 || year > 2100 || month < 1 || month > 12) return null;
  return toMonthKey(year, month);
}

/** Excel serial date (1900 date system) to a month, ignoring time of day. */
function fromExcelSerial(serial: number): MonthKey | null {
  if (serial < 1 || serial > 80000) return null;
  // Excel day 25569 is 1970-01-01; treat the serial as a UTC calendar day.
  const date = new Date(Math.round((Math.floor(serial) - 25569) * 86400000));
  return valid(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/**
 * Reads the month from a workbook cell. Accepts Excel dates, `2026-09`,
 * `2026-09-01`, `2026/09`, `Sep 2026`, `September 2026`, `Sep-26` and `9/1/2026`.
 */
export function parseMonth(value: unknown): MonthKey | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : valid(value.getFullYear(), value.getMonth() + 1);
  }
  if (typeof value === 'number') return fromExcelSerial(value);

  const text = String(value).trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) return valid(Number(m[1]), Number(m[2]));

  m = text.match(/^([A-Za-z]{3,9})\.?[\s,-]+(\d{2}|\d{4})$/);
  if (m) {
    const index = MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(m![1].toLowerCase().slice(0, 3)));
    if (index < 0) return null;
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return valid(year, index + 1);
  }

  m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    // Month first unless the first number can only be a day.
    const a = Number(m[1]);
    const b = Number(m[2]);
    return valid(Number(m[3]), a > 12 ? b : a);
  }

  if (/^\d+(\.\d+)?$/.test(text)) return fromExcelSerial(Number(text));
  return null;
}
