import { FLEET_PLAN_SHEET_CONFIG_BY_KEY } from './fleetPlanConfig';
import type { FleetPlanRow, FleetPlanSheet, FleetPlanSheetKey, FleetPlanSummary, FleetPlanWorkbook } from './types';

function randomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `fleet-row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createFleetPlanRowId(): string {
    return randomId();
}

export function createEmptyFleetPlanRow(sheetKey: FleetPlanSheetKey): FleetPlanRow {
    const config = FLEET_PLAN_SHEET_CONFIG_BY_KEY[sheetKey];
    const timeline = Object.fromEntries(config.timelineColumns.map((column) => [column.key, '']));

    return {
        id: createFleetPlanRowId(),
        unitNumber: '',
        busSize: '',
        makeModel: '',
        year: '',
        comment: '',
        electricFlag: sheetKey === 'electric-12m' ? 'E' : '',
        timeline,
    };
}

export function summarizeFleetPlan(workbook: FleetPlanWorkbook): FleetPlanSummary {
    return {
        sheetCount: workbook.sheets.length,
        totalRows: workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    };
}

export function cloneFleetPlanWorkbook(workbook: FleetPlanWorkbook): FleetPlanWorkbook {
    return {
        schemaVersion: workbook.schemaVersion,
        metadata: { ...workbook.metadata },
        sheets: workbook.sheets.map((sheet) => ({
            ...sheet,
            rows: sheet.rows.map((row) => ({
                ...row,
                timeline: { ...row.timeline },
            })),
        })),
    };
}

export function replaceFleetPlanSheet(
    workbook: FleetPlanWorkbook,
    nextSheet: FleetPlanSheet,
): FleetPlanWorkbook {
    return {
        ...workbook,
        sheets: workbook.sheets.map((sheet) => (sheet.key === nextSheet.key ? nextSheet : sheet)),
    };
}

export function normalizeFleetPlanCellValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

export function isNumericFleetValue(value: string): boolean {
    return /^\d+$/.test(value.trim());
}

export function coerceFleetExportValue(value: string): string | number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return isNumericFleetValue(trimmed) ? Number(trimmed) : trimmed;
}

export function fleetRowHasContent(row: FleetPlanRow): boolean {
    return Boolean(
        row.unitNumber.trim()
        || row.busSize?.trim()
        || row.makeModel.trim()
        || row.year.trim()
        || row.comment?.trim()
        || row.electricFlag?.trim()
        || Object.values(row.timeline).some((value) => value.trim()),
    );
}
