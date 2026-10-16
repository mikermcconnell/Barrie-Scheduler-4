import * as XLSX from 'xlsx';
import { parseMonth } from './months';
import type { ImportResult, Note, RouteMonth, SystemMonth, Targets } from './types';
import {
  type Column,
  NOTES_SHEET,
  normalizeHeader,
  ROUTE_COLUMNS,
  ROUTES_SHEET,
  SYSTEM_COLUMNS,
  SYSTEM_SHEET,
  TARGET_DEFS,
  TARGETS_SHEET,
} from './workbookSchema';

type Cell = string | number | boolean | Date | null;
type Rows = Cell[][];

/** Parses `1,234`, `$6.85`, `84.3%`. Returns undefined for text that is not a number. */
export function parseNumber(value: Cell): { value: number | null; percentSign: boolean } | undefined {
  if (value == null || value === '') return { value: null, percentSign: false };
  if (typeof value === 'number') return Number.isFinite(value) ? { value, percentSign: false } : undefined;
  if (typeof value === 'boolean' || value instanceof Date) return undefined;
  const text = value.trim();
  if (text === '' || text === '-' || /^n\/?a$/i.test(text)) return { value: null, percentSign: false };
  const percentSign = text.endsWith('%');
  const cleaned = text.replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(cleaned)) return undefined;
  return { value: Number(cleaned), percentSign };
}

/** Percent cells may hold 0.843 (Excel percent format) or 84.3; both become 84.3. */
export function toPercent(parsed: { value: number | null; percentSign: boolean }): number | null {
  if (parsed.value == null) return null;
  if (!parsed.percentSign && Math.abs(parsed.value) <= 1.5) return Math.round(parsed.value * 100000) / 1000;
  return parsed.value;
}

function findSheet(workbook: XLSX.WorkBook, name: string): XLSX.WorkSheet | undefined {
  const wanted = normalizeHeader(name);
  const match = workbook.SheetNames.find((sheet) => normalizeHeader(sheet) === wanted);
  return match ? workbook.Sheets[match] : undefined;
}

function sheetRows(sheet: XLSX.WorkSheet): Rows {
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
}

function isBlankRow(row: Cell[]) {
  return row.every((cell) => cell == null || String(cell).trim() === '');
}

/** Finds the header row (within the first 15 rows) and maps each known column to its index. */
function locateColumns<K extends string>(rows: Rows, columns: Column<K>[]) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const headers = rows[r].map(normalizeHeader);
    const indexes = new Map<K, number>();
    for (const column of columns) {
      const i = headers.findIndex((h) => column.aliases.includes(h));
      if (i >= 0) indexes.set(column.key, i);
    }
    if (columns.filter((c) => c.required).every((c) => indexes.has(c.key))) {
      return { headerRow: r, indexes };
    }
  }
  return null;
}

function readTable<K extends string>(
  rows: Rows,
  columns: Column<K>[],
  sheetName: string,
  errors: string[],
  warnings: string[],
): Record<K, unknown>[] | null {
  const located = locateColumns(rows, columns);
  if (!located) {
    const required = columns.filter((c) => c.required).map((c) => `"${c.header}"`).join(', ');
    errors.push(`Sheet "${sheetName}" needs a header row with ${required}.`);
    return null;
  }
  const missing = columns.filter((c) => !located.indexes.has(c.key)).map((c) => c.header);
  if (missing.length) warnings.push(`Sheet "${sheetName}" has no ${missing.join(', ')} column; those measures will show as no data.`);

  const out: Record<K, unknown>[] = [];
  for (let r = located.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlankRow(row)) continue;
    const excelRow = r + 1;
    const record = {} as Record<K, unknown>;
    let skip = false;
    for (const column of columns) {
      const index = located.indexes.get(column.key);
      const cell = index == null ? null : (row[index] ?? null);
      if (column.kind === 'month') {
        const month = parseMonth(cell);
        if (!month) {
          // Totals rows below the data are common; skip those without a warning.
          if (!/^(grand\s*)?totals?\b/i.test(String(cell ?? '').trim())) warnings.push(`Sheet "${sheetName}" row ${excelRow}: "${cell ?? ''}" is not a month; row skipped.`);
          skip = true;
          break;
        }
        record[column.key] = month;
      } else if (column.kind === 'text') {
        const text = cell == null ? '' : String(cell).trim();
        if (column.required && !text) {
          warnings.push(`Sheet "${sheetName}" row ${excelRow}: ${column.header} is blank; row skipped.`);
          skip = true;
          break;
        }
        record[column.key] = text;
      } else {
        const parsed = parseNumber(cell);
        if (!parsed) {
          warnings.push(`Sheet "${sheetName}" row ${excelRow}: ${column.header} "${cell}" is not a number; treated as blank.`);
          record[column.key] = null;
        } else {
          record[column.key] = column.kind === 'percent' ? toPercent(parsed) : parsed.value;
        }
      }
    }
    if (!skip) out.push(record);
  }
  return out;
}

function readTargets(rows: Rows, warnings: string[]): Targets {
  const targets: Targets = {};
  rows.forEach((row, r) => {
    const label = normalizeHeader(row[0]);
    if (!label || label === 'measure' || label === 'metric') return;
    const def = TARGET_DEFS.find((d) => d.aliases.includes(label));
    if (!def) {
      warnings.push(`Sheet "${TARGETS_SHEET}" row ${r + 1}: "${row[0]}" is not a known measure; ignored.`);
      return;
    }
    const parsed = parseNumber(row[1] ?? null);
    if (!parsed || parsed.value == null) return;
    targets[def.key] = def.percent ? (toPercent(parsed) ?? undefined) : parsed.value;
  });
  return targets;
}

function readNotes(rows: Rows): Note[] {
  const notes: Note[] = [];
  const header = rows[0]?.map(normalizeHeader) ?? [];
  const hasHeader = header.includes('title');
  const col = (name: string, fallback: number) => (hasHeader ? header.indexOf(name) : fallback);
  const [mi, ti, di] = [col('month', 0), col('title', 1), col('detail', 2)];
  for (const row of rows.slice(hasHeader ? 1 : 0)) {
    const title = ti >= 0 ? String(row[ti] ?? '').trim() : '';
    if (!title) continue;
    notes.push({
      month: mi >= 0 ? parseMonth(row[mi]) : null,
      title,
      detail: di >= 0 ? String(row[di] ?? '').trim() : '',
    });
  }
  return notes;
}

function dedupeByKey<T>(items: T[], key: (item: T) => string, label: (k: string) => string, warnings: string[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (map.has(k)) warnings.push(`${label(k)} appears more than once; the last row was used.`);
    map.set(k, item);
  }
  return [...map.values()];
}

export function parseWorkbook(workbook: XLSX.WorkBook, sourceFile: string, isSample = false): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // A CSV or one-sheet workbook is treated as the System Monthly sheet.
  const systemSheet = findSheet(workbook, SYSTEM_SHEET)
    ?? (workbook.SheetNames.length === 1 ? workbook.Sheets[workbook.SheetNames[0]] : undefined);
  if (!systemSheet) {
    errors.push(`No "${SYSTEM_SHEET}" sheet found. Download the template to see the expected layout.`);
    return { data: null, errors, warnings };
  }

  const systemRows = readTable(sheetRows(systemSheet), SYSTEM_COLUMNS, SYSTEM_SHEET, errors, warnings) as SystemMonth[] | null;
  if (!systemRows) return { data: null, errors, warnings };
  if (systemRows.length === 0) {
    errors.push(`Sheet "${SYSTEM_SHEET}" has no monthly rows.`);
    return { data: null, errors, warnings };
  }
  const system = dedupeByKey(systemRows, (r) => r.month, (k) => `Month ${k} in "${SYSTEM_SHEET}"`, warnings)
    .sort((a, b) => a.month.localeCompare(b.month));

  const routeSheet = findSheet(workbook, ROUTES_SHEET);
  let routes: RouteMonth[] = [];
  if (routeSheet) {
    const routeErrors: string[] = [];
    const parsed = readTable(sheetRows(routeSheet), ROUTE_COLUMNS, ROUTES_SHEET, routeErrors, warnings) as RouteMonth[] | null;
    // A broken Routes sheet should not block the system report.
    warnings.push(...routeErrors.map((e) => `${e} Route table left empty.`));
    routes = dedupeByKey(parsed ?? [], (r) => `${r.month}|${r.route}`, (k) => `Route ${k.split('|')[1]} for ${k.split('|')[0]}`, warnings);
  }

  const targetSheet = findSheet(workbook, TARGETS_SHEET);
  const targets = targetSheet ? readTargets(sheetRows(targetSheet), warnings) : {};
  if (!targetSheet) warnings.push(`No "${TARGETS_SHEET}" sheet; measures will show without targets.`);

  const notesSheet = findSheet(workbook, NOTES_SHEET);
  const notes = notesSheet ? readNotes(sheetRows(notesSheet)) : [];

  return {
    data: { system, routes, targets, notes, sourceFile, importedAt: new Date().toISOString(), isSample },
    errors,
    warnings,
  };
}

export async function importFile(file: File): Promise<ImportResult> {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    return parseWorkbook(workbook, file.name);
  } catch {
    return { data: null, errors: [`"${file.name}" could not be read as an Excel or CSV file.`], warnings: [] };
  }
}
