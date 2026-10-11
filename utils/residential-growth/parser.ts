import * as XLSX from 'xlsx';
import type { ResidentialGrowthLayer, ResidentialGrowthParseResult, ResidentialGrowthRecord } from './types';

function cellToString(value: unknown): string {
    if (value == null) return '';
    return String(value).replace(/_x000D_/g, ' ').replace(/\s+/g, ' ').trim();
}

function excelDateToIso(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number') {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) {
            const month = String(parsed.m).padStart(2, '0');
            const day = String(parsed.d).padStart(2, '0');
            return `${parsed.y}-${month}-${day}`;
        }
    }
    const raw = cellToString(value);
    if (!raw) return '';
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    return raw;
}

function parseNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = cellToString(value).replace(/[$,]/g, '');
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseUnits(value: unknown, fallback: number): number {
    const parsed = parseNumber(value);
    if (parsed == null) return fallback;
    return Math.max(0, Math.round(parsed));
}

function normalizeAddress(value: string): string {
    return value.replace(/,\s*BARRIE,\s*ON\s*$/i, ', Barrie, ON').replace(/\s+/g, ' ').trim();
}

function makeId(layer: ResidentialGrowthLayer, fileNumber: string, address: string, index: number): string {
    const base = `${layer}-${fileNumber || address || index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return base || `${layer}-${index}`;
}

function extractPeriodFromDates(records: ResidentialGrowthRecord[]): string | undefined {
    const first = records.find((record) => /^\d{4}-\d{2}-\d{2}$/.test(record.date));
    return first?.date.slice(0, 7);
}

function decodeQuotedPrintableUtf8(value: string): string {
    const unfolded = value.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let index = 0; index < unfolded.length; index += 1) {
        const hex = unfolded.slice(index + 1, index + 3);
        if (unfolded[index] === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
            bytes.push(Number.parseInt(hex, 16));
            index += 2;
        } else {
            bytes.push(unfolded.charCodeAt(index) & 0xff);
        }
    }
    return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
}

function htmlCellToString(value: string): string {
    return value
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replace(/\s+/g, ' ')
        .trim();
}

function htmlCellToValue(value: string): string | number {
    const text = htmlCellToString(value);
    if (/xls-date-/i.test(value) && /^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text;
}

function htmlReportRows(buffer: ArrayBuffer): unknown[][] | null {
    const bytes = new Uint8Array(buffer);
    const ascii = new TextDecoder('latin1').decode(bytes);
    if (!/(?:<html\b|MIME-Version:)/i.test(ascii)) return null;

    const text = /Content-Transfer-Encoding:\s*quoted-printable/i.test(ascii)
        ? decodeQuotedPrintableUtf8(ascii)
        : new TextDecoder('utf-8').decode(bytes);
    const headerMatch = /File\s+Number/i.exec(text);
    if (!headerMatch) return null;

    const beforeHeader = text.slice(0, headerMatch.index);
    const tableStarts = Array.from(beforeHeader.matchAll(/<table\b/gi));
    const tableStart = tableStarts.at(-1)?.index;
    const tableEndMatch = /<\/table>/i.exec(text.slice(headerMatch.index));
    if (tableStart == null || !tableEndMatch) return null;

    const tableEnd = headerMatch.index + tableEndMatch.index + tableEndMatch[0].length;
    const table = text.slice(tableStart, tableEnd);
    return Array.from(table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi), (rowMatch) =>
        Array.from(
            rowMatch[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>)/gi),
            (cellMatch) => htmlCellToValue(cellMatch[1]),
        ),
    ).filter((row) => row.length > 0);
}

function sheetRows(buffer: ArrayBuffer): unknown[][] {
    const reportRows = htmlReportRows(buffer);
    if (reportRows) return reportRows;
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false });
}

export function parseIssuanceListing(buffer: ArrayBuffer): ResidentialGrowthParseResult {
    const rows = sheetRows(buffer);
    const records: ResidentialGrowthRecord[] = [];
    const warnings: string[] = [];
    let current: ResidentialGrowthRecord | null = null;

    rows.forEach((row, rowIndex) => {
        const first = cellToString(row[0]);
        if (/^PMT\d{2}-\d+/i.test(first)) {
            if (current) records.push(current);
            const units = parseUnits(row[10], 0);
            current = {
                id: makeId('issued', first, '', rowIndex),
                layer: 'issued',
                fileNumber: first,
                address: '',
                date: excelDateToIso(row[7]),
                units,
                category: cellToString(row[8]) || 'Unknown',
                workProposed: cellToString(row[9]) || undefined,
                floorAreaSqft: parseNumber(row[14]),
                estimatedValue: parseNumber(row[15]),
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

    const residentialRecords = records.filter((record) => {
        const haystack = `${record.category} ${record.workProposed ?? ''} ${record.description ?? ''}`.toLowerCase();
        return record.units > 0 && (haystack.includes('residential') || haystack.includes('dwelling') || haystack.includes('suite') || haystack.includes('duplex') || haystack.includes('triplex') || haystack.includes('rowhouse'));
    });

    residentialRecords.forEach((record) => {
        if (!record.address) record.warnings.push('Missing address.');
        if (!record.date) record.warnings.push('Missing issue date.');
    });

    if (records.length === 0) warnings.push('No permit records found.');
    if (residentialRecords.length === 0) warnings.push('No residential issued records with units greater than zero were found.');

    return { records: residentialRecords, period: extractPeriodFromDates(residentialRecords), warnings };
}

function findHeaderRow(rows: unknown[][]): number {
    return rows.findIndex((row) => cellToString(row[0]) === 'File Number' && cellToString(row[1]) === 'Location');
}

export function parseOccupancyCertificate(buffer: ArrayBuffer): ResidentialGrowthParseResult {
    const rows = sheetRows(buffer);
    const warnings: string[] = [];
    const headerRowIndex = findHeaderRow(rows);
    if (headerRowIndex < 0) {
        return { records: [], warnings: ['Certificate of Occupancy header row was not found.'] };
    }

    const headers = rows[headerRowIndex].map(cellToString);
    const indexOf = (name: string) => headers.indexOf(name);
    const records: ResidentialGrowthRecord[] = [];

    rows.slice(headerRowIndex + 1).forEach((row, offset) => {
        const fileNumber = cellToString(row[indexOf('File Number')]);
        const address = normalizeAddress(cellToString(row[indexOf('Location')]));
        if (!fileNumber && !address) return;
        const projectType = cellToString(row[indexOf('Type of Project')]);
        const status = cellToString(row[indexOf('Status')]);
        if (projectType.toLowerCase() !== 'residential' || status.toLowerCase() !== 'passed') return;

        const subtype = cellToString(row[indexOf('Residential Subtype')]);
        const purpose = cellToString(row[indexOf('Primary Application Purpose')]);
        const date = excelDateToIso(row[indexOf('Date Inspection')]);
        const record: ResidentialGrowthRecord = {
            id: makeId('occupied', fileNumber, address, offset),
            layer: 'occupied',
            fileNumber,
            address,
            date,
            units: 1,
            category: projectType,
            subtype: subtype || undefined,
            workProposed: purpose || undefined,
            status,
            warnings: [],
        };
        if (!address) record.warnings.push('Missing address.');
        if (!date) record.warnings.push('Missing inspection date.');
        records.push(record);
    });

    if (records.length === 0) warnings.push('No passed residential occupancy rows were found.');
    return { records, period: extractPeriodFromDates(records), warnings };
}

export function summarizeResidentialGrowth(issued: ResidentialGrowthRecord[], occupied: ResidentialGrowthRecord[]) {
    const reviewCount = [...issued, ...occupied].filter((record) => record.warnings.length > 0 || !record.geocode).length;
    return {
        issuedRecords: issued.length,
        issuedUnits: issued.reduce((sum, record) => sum + record.units, 0),
        occupiedRecords: occupied.length,
        occupiedUnits: occupied.reduce((sum, record) => sum + record.units, 0),
        issuedGeocoded: issued.filter((record) => !!record.geocode).length,
        occupiedGeocoded: occupied.filter((record) => !!record.geocode).length,
        reviewCount,
    };
}
