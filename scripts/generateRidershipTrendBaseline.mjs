import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const SHEET_NAME = 'Ridership Trend';
const FINAL_MONTH = '2026-07';
const EXTRACTED_RANGE = 'A2:T15';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.resolve(scriptDirectory, '../utils/ridership-trends/ridershipTrendBaseline.v1.json');

function parseArguments(argv) {
    const mode = argv.includes('--write') ? 'write' : 'check';
    const sourceIndex = argv.indexOf('--source');
    const outputIndex = argv.indexOf('--output');
    return {
        mode,
        sourcePath: sourceIndex >= 0 ? argv[sourceIndex + 1] : undefined,
        outputPath: outputIndex >= 0 ? argv[outputIndex + 1] : DEFAULT_OUTPUT,
    };
}

function requireWholeYear(value, columnIndex) {
    if (!Number.isInteger(value) || value < 1900 || value > 2200) {
        throw new Error(`Expected a year in row 2, column ${columnIndex + 1}.`);
    }
    return value;
}

function requireMonthName(value, rowIndex) {
    const expected = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ][rowIndex - 2];
    if (value !== expected) throw new Error(`Expected ${expected} in row ${rowIndex + 1}.`);
}

export function extractRidershipTrendBaseline(workbookBuffer, sourceFileName) {
    const workbook = XLSX.read(workbookBuffer, { type: 'buffer', cellFormula: true });
    const sheet = workbook.Sheets[SHEET_NAME];
    if (!sheet) throw new Error(`Workbook is missing the ${SHEET_NAME} sheet.`);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const yearRow = rows[1] ?? [];
    const totalRow = rows[14] ?? [];
    const monthlyTotals = {};

    for (let columnIndex = 1; columnIndex < yearRow.length; columnIndex += 1) {
        if (yearRow[columnIndex] === null) break;
        const year = requireWholeYear(yearRow[columnIndex], columnIndex);
        let derivedAnnualTotal = 0;
        for (let rowIndex = 2; rowIndex <= 13; rowIndex += 1) {
            requireMonthName(rows[rowIndex]?.[0], rowIndex);
            const value = rows[rowIndex]?.[columnIndex];
            const key = `${year}-${String(rowIndex - 1).padStart(2, '0')}`;
            if (value === null) {
                if (key <= FINAL_MONTH) throw new Error(`Missing expected ridership value for ${key}.`);
                continue;
            }
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
                throw new Error(`Invalid ridership value for ${key}.`);
            }
            if (key > FINAL_MONTH) throw new Error(`Unexpected workbook data after ${FINAL_MONTH}.`);
            const roundedValue = Math.round(value);
            monthlyTotals[key] = roundedValue;
            derivedAnnualTotal += roundedValue;
        }

        const workbookTotal = totalRow[columnIndex];
        if (typeof workbookTotal !== 'number' || Math.round(workbookTotal) !== derivedAnnualTotal) {
            throw new Error(`Monthly values do not reconcile to the workbook total for ${year}.`);
        }
    }

    if (Object.keys(monthlyTotals).at(-1) !== FINAL_MONTH) {
        throw new Error(`Expected the baseline to end at ${FINAL_MONTH}.`);
    }

    return {
        schemaVersion: 1,
        metric: 'fixed_route_boardings',
        source: {
            fileName: sourceFileName,
            sheetName: SHEET_NAME,
            sha256: createHash('sha256').update(workbookBuffer).digest('hex'),
            extractedRange: EXTRACTED_RANGE,
            finalMonth: FINAL_MONTH,
        },
        monthlyTotals,
    };
}

export function serializeRidershipTrendBaseline(baseline) {
    return `${JSON.stringify(baseline, null, 2)}\n`;
}

async function main() {
    const { mode, sourcePath, outputPath } = parseArguments(process.argv.slice(2));
    if (!sourcePath) throw new Error('Provide the source workbook with --source <path>.');
    if (!outputPath) throw new Error('--output requires a path.');
    const workbookBuffer = await readFile(sourcePath);
    const baseline = extractRidershipTrendBaseline(workbookBuffer, path.basename(sourcePath));
    const serialized = serializeRidershipTrendBaseline(baseline);

    if (mode === 'write') {
        await writeFile(outputPath, serialized, 'utf8');
        console.log(`Wrote ${outputPath}`);
        return;
    }

    const existing = await readFile(outputPath, 'utf8');
    if (existing !== serialized) {
        throw new Error(`Ridership trend baseline is stale. Run this script with --write.`);
    }
    console.log(`Ridership trend baseline is current: ${outputPath}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
