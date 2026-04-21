import * as XLSX from 'xlsx';
import {
    FLEET_PLAN_REQUIRED_SHEETS,
    FLEET_PLAN_SHEET_CONFIGS,
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

    const missingSheets = FLEET_PLAN_REQUIRED_SHEETS.filter((sheetName) => !workbook.SheetNames.includes(sheetName));
    if (missingSheets.length > 0) {
        throw new Error(`Unsupported fleet plan template. Missing required sheet(s): ${missingSheets.join(', ')}.`);
    }

    const warnings: string[] = [];
    const nowIso = (options.now ?? new Date()).toISOString();
    const parsedSheets = FLEET_PLAN_SHEET_CONFIGS.map((config) => {
        const sheet = workbook.Sheets[config.name];
        if (!sheet) {
            throw new Error(`Unsupported fleet plan template. Missing sheet "${config.name}".`);
        }
        return parseSheet(sheet, config);
    });

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
