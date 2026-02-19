/**
 * OD Matrix Parser
 *
 * Parses Excel cross-tab OD matrices into structured data.
 * Expected format: row 0 = destination station headers, column 0 = origin station names.
 * Each cell[r][c] = number of journeys from origin r to destination c.
 */

import * as XLSX from 'xlsx';
import type { ODStation, ODPairRecord, ODMatrixParseResult } from './odMatrixTypes';

function emptyResult(warning: string): ODMatrixParseResult {
    return { stations: [], pairs: [], totalJourneys: 0, stationCount: 0, topPairs: [], warnings: [warning] };
}

const SKIP_LABELS = new Set([
    'grand total',
    '(blank)',
    'row labels',
    'column labels',
    'total',
    '',
]);

const ORIGIN_HEADER_HINTS = new Set([
    'row labels',
    'origin',
    'origins',
    'from',
    'origin station',
    'origin stations',
]);

function shouldSkip(name: string | null | undefined): boolean {
    if (name == null) return true;
    const normalized = String(name).trim().toLowerCase();
    return SKIP_LABELS.has(normalized);
}

function cleanStationName(raw: string | null | undefined): string {
    if (raw == null) return '';
    return String(raw).trim();
}

function parseJourneyValue(cellValue: string | number | null): number {
    if (typeof cellValue === 'number') {
        return Number.isFinite(cellValue) ? cellValue : 0;
    }

    if (typeof cellValue === 'string') {
        const cleaned = cellValue.trim().replace(/,/g, '');
        if (!cleaned) return 0;
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
}

function detectHeaderRowIndex(rows: (string | number | null)[][]): number {
    const maxScan = Math.min(25, rows.length);
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let r = 0; r < maxScan; r++) {
        const row = rows[r] || [];
        if (row.length < 2) continue;

        let destinationLabelCount = 0;
        let numericCount = 0;

        for (let c = 1; c < row.length; c++) {
            const cell = row[c];
            if (cell == null) continue;

            if (typeof cell === 'number') {
                numericCount++;
                continue;
            }

            const name = cleanStationName(cell);
            if (!shouldSkip(name)) destinationLabelCount++;
        }

        if (destinationLabelCount < 2) continue;

        const firstCell = cleanStationName(row[0] as string).toLowerCase();
        const firstCellLooksHeader = shouldSkip(firstCell) || ORIGIN_HEADER_HINTS.has(firstCell);
        const score = (destinationLabelCount * 3) + (firstCellLooksHeader ? 2 : 0) - (numericCount * 2);

        if (score > bestScore) {
            bestScore = score;
            bestIndex = r;
        }
    }

    return bestIndex;
}

/**
 * Parse an OD matrix from an Excel ArrayBuffer.
 * Assumes the first sheet contains the cross-tab matrix.
 */
export function parseODMatrixFromExcel(buffer: ArrayBuffer): ODMatrixParseResult {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        return emptyResult('No sheets found in workbook');
    }

    const sheet = workbook.Sheets[sheetName];
    const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: true,
    });

    if (rows.length < 2) {
        return emptyResult('Sheet has fewer than 2 rows');
    }

    const warnings: string[] = [];

    const headerRowIndex = detectHeaderRowIndex(rows);
    const headerRow = rows[headerRowIndex] || [];
    const destNames: string[] = [];
    const destColIndices: number[] = [];

    for (let c = 1; c < headerRow.length; c++) {
        const name = cleanStationName(headerRow[c] as string);
        if (shouldSkip(name)) continue;
        destNames.push(name);
        destColIndices.push(c);
    }

    // Build origin names and journey matrix
    const originNames: string[] = [];
    const originRowIndices: number[] = [];

    for (let r = headerRowIndex + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length === 0) continue;
        const name = cleanStationName(row[0] as string);
        if (shouldSkip(name)) continue;
        originNames.push(name);
        originRowIndices.push(r);
    }

    // Collect all unique station names
    const allStationNames = new Set<string>([...originNames, ...destNames]);

    // Build pairs (sparse — non-zero only)
    const pairs: ODPairRecord[] = [];
    let totalJourneys = 0;

    // Track per-station totals
    const originTotals = new Map<string, number>();
    const destTotals = new Map<string, number>();

    for (let oi = 0; oi < originNames.length; oi++) {
        const originName = originNames[oi];
        const row = rows[originRowIndices[oi]];

        for (let di = 0; di < destNames.length; di++) {
            const destName = destNames[di];
            const colIdx = destColIndices[di];
            const cellValue = row?.[colIdx] ?? null;
            const journeys = parseJourneyValue(cellValue);

            if (journeys > 0) {
                pairs.push({ origin: originName, destination: destName, journeys });
                totalJourneys += journeys;
                originTotals.set(originName, (originTotals.get(originName) || 0) + journeys);
                destTotals.set(destName, (destTotals.get(destName) || 0) + journeys);
            }
        }
    }

    // Build station objects
    const stations: ODStation[] = Array.from(allStationNames).map(name => {
        const totalOrigin = originTotals.get(name) || 0;
        const totalDestination = destTotals.get(name) || 0;
        return { name, totalOrigin, totalDestination, totalVolume: totalOrigin + totalDestination };
    });

    // Sort stations by total volume descending
    stations.sort((a, b) => b.totalVolume - a.totalVolume);

    // Top 100 pairs by journeys
    const topPairs = [...pairs]
        .sort((a, b) => b.journeys - a.journeys)
        .slice(0, 100);

    if (stations.length === 0) {
        warnings.push('No valid stations found in matrix');
    }
    if (destNames.length === 0) {
        warnings.push('No destination columns found in matrix');
    }
    if (originNames.length === 0) {
        warnings.push('No origin rows found in matrix');
    }
    if (stations.length > 0 && totalJourneys === 0) {
        warnings.push('No non-zero journey values found in matrix');
    }

    return {
        stations,
        pairs,
        totalJourneys,
        stationCount: stations.length,
        topPairs,
        warnings,
    };
}
