import * as XLSX from 'xlsx';
import {
    FLEET_PLAN_REQUIRED_SHEETS,
    FLEET_PLAN_SHEET_CONFIGS,
    FLEET_PLAN_SHEET_CONFIG_BY_KEY,
    FLEET_PLAN_SUPPORTED_HEADERS,
    FLEET_PLAN_TEMPLATE_VERSION,
} from './fleetPlanConfig';
import { createFleetPlanRowId, fleetRowHasContent, normalizeFleetPlanCellValue } from './fleetPlanModel';
import type { FleetPlanParseResult, FleetPlanRow, FleetPlanSheet, FleetPlanSheetConfig, FleetPlanSheetKey, FleetPlanWorkbook } from './types';

function readCell(sheet: XLSX.WorkSheet, row: number, column: string): unknown {
    const address = `${column}${row}`;
    return sheet[address]?.v;
}

function findFooterStartRow(sheet: XLSX.WorkSheet, config: FleetPlanSheetConfig): number {
    const range = XLSX.utils.decode_range(sheet['!ref'] || `${config.baseColumns[0]?.exportColumn ?? 'A'}1:A1`);

    const matchers: Record<FleetPlanSheetKey, (row: number) => boolean> = {
        'diesel-12m': (row) => {
            const label = normalizeFleetPlanCellValue(readCell(sheet, row, 'B'));
            return ['Replacement', 'Base', 'Growth', 'Total Fleet'].includes(label);
        },
        'small-buses': (row) => normalizeFleetPlanCellValue(readCell(sheet, row, 'B')) === 'Total Cutaways',
        'electric-12m': (row) => normalizeFleetPlanCellValue(readCell(sheet, row, 'D')) === 'Total',
    };

    for (let row = config.dataStartRow; row <= range.e.r + 1; row += 1) {
        if (matchers[config.key](row)) return row;
    }

    return range.e.r + 2;
}

function validateSheetHeader(sheet: XLSX.WorkSheet, config: FleetPlanSheetConfig): void {
    const expectedHeaders = FLEET_PLAN_SUPPORTED_HEADERS[config.key];
    const actualHeaders = config.baseColumns.map((column) => normalizeFleetPlanCellValue(readCell(sheet, config.headerRow, column.exportColumn)));

    if (expectedHeaders.length !== actualHeaders.length) {
        throw new Error(`Unsupported ${config.name} template: expected ${expectedHeaders.length} base columns but found ${actualHeaders.length}.`);
    }

    config.baseColumns.forEach((column, index) => {
        const actualHeader = actualHeaders[index];
        const expectedHeader = expectedHeaders[index];
        if (column.headerRequired === false) {
            if (actualHeader !== '' && actualHeader !== expectedHeader) {
                throw new Error(`Unsupported ${config.name} template: expected optional header "${expectedHeader}" in ${column.exportColumn}${config.headerRow} but found "${actualHeader}".`);
            }
            return;
        }
        if (actualHeader !== expectedHeader) {
            throw new Error(`Unsupported ${config.name} template: expected header "${expectedHeader}" but found "${actualHeader || 'blank'}".`);
        }
    });

    config.timelineColumns.forEach((column) => {
        const actualHeader = normalizeFleetPlanCellValue(readCell(sheet, config.headerRow, column.exportColumn));
        if (actualHeader !== column.label) {
            throw new Error(`Unsupported ${config.name} template: expected timeline header "${column.label}" in ${column.exportColumn}${config.headerRow} but found "${actualHeader || 'blank'}".`);
        }
    });
}

function parseRow(sheet: XLSX.WorkSheet, rowNumber: number, config: FleetPlanSheetConfig): FleetPlanRow {
    const timeline = Object.fromEntries(config.timelineColumns.map((column) => [
        column.key,
        normalizeFleetPlanCellValue(readCell(sheet, rowNumber, column.exportColumn)),
    ]));

    return {
        id: createFleetPlanRowId(),
        unitNumber: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'B')),
        busSize: config.key === 'small-buses' ? normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'C')) : '',
        makeModel: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, config.key === 'small-buses' ? 'D' : 'C')),
        year: config.key === 'small-buses' ? '' : normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'D')),
        comment: config.key === 'small-buses' ? normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'E')) : '',
        electricFlag: config.key === 'electric-12m' ? normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'E')) : '',
        onOrder: config.key === 'small-buses' ? normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'I')) : '',
        timeline,
    };
}

function parseSheet(sheet: XLSX.WorkSheet, config: FleetPlanSheetConfig): FleetPlanSheet {
    validateSheetHeader(sheet, config);

    const footerStartRow = findFooterStartRow(sheet, config);
    const rows: FleetPlanRow[] = [];

    for (let rowNumber = config.dataStartRow; rowNumber < footerStartRow; rowNumber += 1) {
        const row = parseRow(sheet, rowNumber, config);

        if (!fleetRowHasContent(row)) continue;
        rows.push(row);
    }

    return {
        key: config.key,
        name: config.name,
        title: config.title,
        rows,
    };
}

const COMBINED_SHEET_NAME = 'Fleet Plan';
const COMBINED_HEADER_ROW = 3;
const COMBINED_DATA_START_ROW = 4;
const COMBINED_BUS_TYPE_LABELS: Record<string, FleetPlanSheetKey> = {
    '12m diesel': 'diesel-12m',
    'diesel 12m': 'diesel-12m',
    '12m buses': 'diesel-12m',
    '8m & 6m': 'small-buses',
    '8m and 6m': 'small-buses',
    'small buses': 'small-buses',
    '12m electric': 'electric-12m',
    'electric 12m': 'electric-12m',
    '12m electric buses': 'electric-12m',
};

function normalizeCombinedHeader(value: unknown): string {
    return normalizeFleetPlanCellValue(value).toLowerCase().replace(/\s+/g, ' ');
}

function resolveCombinedSheetKey(value: unknown): FleetPlanSheetKey | null {
    return COMBINED_BUS_TYPE_LABELS[normalizeCombinedHeader(value)] ?? null;
}

function validateCombinedSheetHeader(sheet: XLSX.WorkSheet): void {
    const expectedHeaders = ['Bus Type', 'Unit Number', 'Size', 'Make/Model', 'Year', 'Comment', 'Electric', 'On Order'];

    expectedHeaders.forEach((expectedHeader, index) => {
        const actualHeader = normalizeFleetPlanCellValue(readCell(sheet, COMBINED_HEADER_ROW, XLSX.utils.encode_col(index)));
        if (actualHeader !== expectedHeader) {
            throw new Error(`Unsupported combined Fleet Plan export: expected header "${expectedHeader}" but found "${actualHeader || 'blank'}".`);
        }
    });

    const yearHeaders = FLEET_PLAN_SHEET_CONFIGS
        .flatMap((config) => config.timelineColumns)
        .map((column) => column.label)
        .filter((year, index, years) => years.indexOf(year) === index)
        .sort((left, right) => Number(left) - Number(right));

    yearHeaders.forEach((year, index) => {
        const actualHeader = normalizeFleetPlanCellValue(readCell(sheet, COMBINED_HEADER_ROW, XLSX.utils.encode_col(expectedHeaders.length + index)));
        if (actualHeader !== year) {
            throw new Error(`Unsupported combined Fleet Plan export: expected timeline header "${year}" but found "${actualHeader || 'blank'}".`);
        }
    });
}

function parseCombinedRow(sheet: XLSX.WorkSheet, rowNumber: number, sheetKey: FleetPlanSheetKey): FleetPlanRow {
    const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
    const timeline = Object.fromEntries(config.timelineColumns.map((column) => {
        const yearIndex = COMBINED_BASE_COLUMN_COUNT + COMBINED_EXPORT_YEARS.indexOf(column.key);
        const columnLetter = XLSX.utils.encode_col(yearIndex);
        return [column.key, normalizeFleetPlanCellValue(readCell(sheet, rowNumber, columnLetter))];
    }));

    return {
        id: createFleetPlanRowId(),
        unitNumber: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'B')),
        busSize: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'C')),
        makeModel: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'D')),
        year: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'E')),
        comment: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'F')),
        electricFlag: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'G')),
        onOrder: normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'H')),
        timeline,
    };
}

const COMBINED_BASE_COLUMN_COUNT = 8;
const COMBINED_EXPORT_YEARS = FLEET_PLAN_SHEET_CONFIGS
    .flatMap((config) => config.timelineColumns.map((column) => column.key))
    .filter((year, index, years) => years.indexOf(year) === index)
    .sort((left, right) => Number(left) - Number(right));

function combinedRowHasAnyContent(sheet: XLSX.WorkSheet, rowNumber: number): boolean {
    const lastColumnIndex = COMBINED_BASE_COLUMN_COUNT + COMBINED_EXPORT_YEARS.length - 1;
    for (let columnIndex = 0; columnIndex <= lastColumnIndex; columnIndex += 1) {
        if (normalizeFleetPlanCellValue(readCell(sheet, rowNumber, XLSX.utils.encode_col(columnIndex)))) {
            return true;
        }
    }
    return false;
}

function parseCombinedFleetPlanSheet(sheet: XLSX.WorkSheet): { sheets: FleetPlanSheet[]; warnings: string[] } {
    validateCombinedSheetHeader(sheet);
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const rowsBySheet = new Map<FleetPlanSheetKey, FleetPlanRow[]>(
        FLEET_PLAN_SHEET_CONFIGS.map((config): [FleetPlanSheetKey, FleetPlanRow[]] => [config.key, []]),
    );
    const warnings: string[] = [];

    for (let rowNumber = COMBINED_DATA_START_ROW; rowNumber <= range.e.r + 1; rowNumber += 1) {
        const busTypeValue = normalizeFleetPlanCellValue(readCell(sheet, rowNumber, 'A'));
        const sheetKey = resolveCombinedSheetKey(busTypeValue);
        if (!sheetKey) {
            if (combinedRowHasAnyContent(sheet, rowNumber)) {
                warnings.push(`Skipped row ${rowNumber} because Bus Type "${busTypeValue || 'blank'}" is not recognized.`);
            }
            continue;
        }

        const row = parseCombinedRow(sheet, rowNumber, sheetKey);
        if (!fleetRowHasContent(row)) continue;
        rowsBySheet.get(sheetKey)?.push(row);
    }

    return {
        sheets: FLEET_PLAN_SHEET_CONFIGS.map((config) => ({
            key: config.key,
            name: config.name,
            title: config.title,
            rows: rowsBySheet.get(config.key) ?? [],
        })),
        warnings,
    };
}

export function parseFleetPlanWorkbook(
    buffer: ArrayBuffer,
    options: {
        fileName: string;
        userId: string;
        now?: Date;
    },
): FleetPlanParseResult {
    const workbook = XLSX.read(buffer, {
        type: 'array',
        cellFormula: true,
        cellStyles: false,
    });

    const warnings: string[] = [];
    const nowIso = (options.now ?? new Date()).toISOString();
    const combinedSheet = workbook.Sheets[COMBINED_SHEET_NAME];
    const parsedSheets = combinedSheet
        ? (() => {
            const combinedResult = parseCombinedFleetPlanSheet(combinedSheet);
            warnings.push(...combinedResult.warnings);
            return combinedResult.sheets;
        })()
        : (() => {
            const missingSheets = FLEET_PLAN_REQUIRED_SHEETS.filter((sheetName) => !workbook.SheetNames.includes(sheetName));
            if (missingSheets.length > 0) {
                throw new Error(`Unsupported fleet plan template. Missing required sheet(s): ${missingSheets.join(', ')}.`);
            }

            return FLEET_PLAN_SHEET_CONFIGS.map((config) => {
                const sheet = workbook.Sheets[config.name];
                if (!sheet) {
                    throw new Error(`Unsupported fleet plan template. Missing sheet "${config.name}".`);
                }
                return parseSheet(sheet, config);
            });
        })();

    const parsedWorkbook: FleetPlanWorkbook = {
        schemaVersion: 1,
        metadata: {
            templateVersion: FLEET_PLAN_TEMPLATE_VERSION,
            sourceFileName: options.fileName,
            importedAt: nowIso,
            importedBy: options.userId,
            updatedAt: nowIso,
            updatedBy: options.userId,
        },
        sheets: parsedSheets,
    };

    if (parsedWorkbook.sheets.every((sheet) => sheet.rows.length === 0)) {
        warnings.push('Imported workbook did not contain any editable fleet rows.');
    }

    return { workbook: parsedWorkbook, warnings };
}
