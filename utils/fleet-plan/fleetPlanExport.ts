import ExcelJS from 'exceljs';
import { FLEET_PLAN_SHEET_CONFIGS } from './fleetPlanConfig';
import { coerceFleetExportValue, isNumericFleetValue } from './fleetPlanModel';
import type { FleetPlanSheet, FleetPlanSheetConfig, FleetPlanWorkbook, FleetPlanSheetKey } from './types';

type FooterCountSet = {
    replacementByYear: number[];
    growthByYear: number[];
    baseByYear: number[];
    totalByYear: number[];
};

const EXPORT_THEME = {
    border: {
        thin: 'FFD7DEE8',
        medium: 'FF94A3B8',
    },
    text: {
        primary: 'FF111827',
        secondary: 'FF374151',
        muted: 'FF64748B',
        inverse: 'FFFFFFFF',
    },
    fill: {
        title: 'FFEAF3FF',
        header: 'FFF1F5F9',
        footerLabel: 'FFF8FAFC',
        footerValue: 'FFFFFFFF',
        blank: 'FFFFFFFF',
        fleetUnit: 'FFE0F2FE',
        retire: 'FFFEE2E2',
        trade: 'FFFFEDD5',
        purchase: 'FFDCFCE7',
        growth: 'FFFEF3C7',
        training: 'FFFEF08A',
        electric: 'FFFFD966',
    },
    tab: {
        'diesel-12m': 'FF2563EB',
        'small-buses': 'FF7C3AED',
        'electric-12m': 'FF059669',
    },
} as const;

const THIN_GRAY: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: EXPORT_THEME.border.thin } };
const MEDIUM_GRAY: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: EXPORT_THEME.border.medium } };
const STATUS_VALIDATION_LIST = '"RETIRE,PURCHASE,GROWTH,TRADED,TRAINING"';
const WORKSHEET_PROTECTION_PASSWORD = 'fleet-plan';

function applyBorder(cell: ExcelJS.Cell, border: Partial<ExcelJS.Border> = THIN_GRAY): void {
    cell.border = { top: border, bottom: border, left: border, right: border };
}

function applyAlignment(cell: ExcelJS.Cell, horizontal: ExcelJS.Alignment['horizontal'] = 'center'): void {
    cell.alignment = { horizontal, vertical: 'middle', wrapText: true, shrinkToFit: horizontal === 'center' };
}

function styleTitle(cell: ExcelJS.Cell): void {
    cell.font = { name: 'Aptos Display', bold: true, size: 18, color: { argb: EXPORT_THEME.text.primary } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.title } };
    applyBorder(cell, MEDIUM_GRAY);
    applyAlignment(cell, 'center');
}

function styleHeader(cell: ExcelJS.Cell): void {
    cell.font = { name: 'Aptos', bold: true, size: 11, color: { argb: EXPORT_THEME.text.secondary } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.header } };
    applyBorder(cell, MEDIUM_GRAY);
    applyAlignment(cell, 'center');
}

function styleFooterLabel(cell: ExcelJS.Cell): void {
    cell.font = { name: 'Aptos', bold: true, size: 11, color: { argb: EXPORT_THEME.text.secondary } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.footerLabel } };
    applyBorder(cell, MEDIUM_GRAY);
    applyAlignment(cell, 'left');
}

function styleFooterValue(cell: ExcelJS.Cell): void {
    cell.font = { name: 'Aptos', bold: true, size: 11, color: { argb: EXPORT_THEME.text.primary } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.footerValue } };
    applyBorder(cell, MEDIUM_GRAY);
    applyAlignment(cell, 'center');
}

function applyStatusValidation(cell: ExcelJS.Cell): void {
    cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [STATUS_VALIDATION_LIST],
        showInputMessage: true,
        promptTitle: 'Fleet plan status',
        prompt: 'Use a standard status when applicable.',
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'Non-standard status',
        error: 'Use RETIRE, PURCHASE, GROWTH, TRADED, or TRAINING unless a custom note is intentional.',
    };
}

function unlockEditableCell(cell: ExcelJS.Cell): void {
    cell.protection = { locked: false };
}

function setFormulaValue(cell: ExcelJS.Cell, formula: string, result: number): void {
    cell.value = { formula, result };
}

function styleGridCell(cell: ExcelJS.Cell, value: string | number | null, sheetKey: FleetPlanSheetKey): void {
    const normalized = typeof value === 'string' ? value.trim() : value;
    cell.value = value;
    unlockEditableCell(cell);
    applyBorder(cell);
    applyAlignment(cell, typeof value === 'number' ? 'center' : 'center');
    cell.font = { name: 'Aptos', size: 10, color: { argb: EXPORT_THEME.text.primary } };

    if (normalized === null || normalized === '') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.blank } };
        return;
    }

    if (typeof normalized === 'number' || (typeof normalized === 'string' && isNumericFleetValue(normalized))) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.fleetUnit } };
        cell.font = { name: 'Aptos', bold: false, color: { argb: EXPORT_THEME.text.primary } };
        return;
    }

    const upper = String(normalized).toUpperCase();

    if (upper.includes('RETIRE') || upper.includes('ACCIDENT') || upper.includes('GOVDEALS')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.retire } };
        cell.font = { bold: true, color: { argb: 'FF9C0006' } };
        return;
    }

    if (upper.includes('TRADE')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.trade } };
        cell.font = { bold: true, color: { argb: 'FF9A3412' } };
        return;
    }

    if (upper.startsWith('PURCHASE')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.purchase } };
        cell.font = { name: 'Aptos', bold: true, color: { argb: 'FF166534' } };
        return;
    }

    if (upper === 'GROWTH') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.growth } };
        cell.font = { name: 'Aptos', bold: true, color: { argb: 'FF92400E' } };
        return;
    }

    if (upper.includes('TRAINING')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.training } };
        cell.font = { name: 'Aptos', bold: true, color: { argb: 'FF854D0E' } };
        return;
    }

    if (sheetKey === 'electric-12m' && upper === 'E') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.electric } };
        cell.font = { name: 'Aptos', bold: true, color: { argb: EXPORT_THEME.text.primary } };
        applyAlignment(cell, 'right');
        return;
    }

    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_THEME.fill.blank } };
    cell.font = { name: 'Aptos', bold: false, color: { argb: EXPORT_THEME.text.primary } };
}

function styleLegendHeader(cell: ExcelJS.Cell): void {
    cell.value = 'LEGEND';
    cell.font = { name: 'Aptos', bold: true, size: 11, color: { argb: EXPORT_THEME.text.primary } };
    applyAlignment(cell, 'left');
}

function styleLegendText(cell: ExcelJS.Cell, label: string): void {
    cell.value = label;
    cell.font = { name: 'Aptos', bold: false, size: 10, color: { argb: EXPORT_THEME.text.secondary } };
    applyAlignment(cell, 'left');
}

function setSheetColumns(worksheet: ExcelJS.Worksheet, config: FleetPlanSheetConfig): void {
    const widths: Record<string, number> = {
        A: 2.5,
        B: 13,
        C: 18,
        D: 12,
        E: 12,
        F: 12,
        G: 12,
        H: 12,
        I: 14,
        J: 12,
        K: 12,
        L: 12,
        M: 12,
        N: 12,
        O: 12,
        P: 12,
        Q: 12,
        R: 12,
        S: 12,
        T: 10,
        U: 6,
        V: 52,
        W: 52,
    };

    if (config.key === 'diesel-12m') {
        widths.B = 14;
        widths.C = 18;
        widths.D = 10;
        widths.V = 60;
    } else if (config.key === 'small-buses') {
        widths.B = 12;
        widths.C = 10;
        widths.D = 16;
        widths.E = 24;
        widths.I = 18;
        widths.W = 50;
    } else if (config.key === 'electric-12m') {
        widths.B = 14;
        widths.C = 26;
        widths.D = 10;
        widths.E = 11;
    }

    Object.entries(widths).forEach(([column, width]) => {
        worksheet.getColumn(column).width = width;
    });
}

function getLastDataColumn(config: FleetPlanSheetConfig): string {
    return config.timelineColumns[config.timelineColumns.length - 1]?.exportColumn
        ?? config.baseColumns[config.baseColumns.length - 1]?.exportColumn
        ?? 'B';
}

function getLastPrintableColumn(config: FleetPlanSheetConfig): string {
    return config.legendColumn ?? getLastDataColumn(config);
}

function getTimelineRange(column: string, config: FleetPlanSheetConfig, lastDataRow: number): string {
    const safeLastDataRow = Math.max(lastDataRow, config.dataStartRow);
    return `${column}${config.dataStartRow}:${column}${safeLastDataRow}`;
}

async function applyWorksheetBestPractices(
    worksheet: ExcelJS.Worksheet,
    config: FleetPlanSheetConfig,
    lastDataRow: number,
    lastUsedRow: number,
): Promise<void> {
    const firstDataColumn = config.baseColumns[0]?.exportColumn ?? 'B';
    const lastDataColumn = getLastDataColumn(config);
    const lastPrintableColumn = getLastPrintableColumn(config);
    const filterLastRow = Math.max(lastDataRow, config.headerRow);

    worksheet.properties.defaultRowHeight = 18;
    worksheet.properties.showGridLines = false;
    worksheet.properties.tabColor = { argb: EXPORT_THEME.tab[config.key] };
    worksheet.autoFilter = {
        from: `${firstDataColumn}${config.headerRow}`,
        to: `${lastDataColumn}${filterLastRow}`,
    };
    worksheet.pageSetup = {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
        horizontalCentered: true,
        showGridLines: false,
        printArea: `A1:${lastPrintableColumn}${Math.max(lastUsedRow, config.headerRow)}`,
        printTitlesRow: `1:${config.headerRow}`,
        margins: {
            left: 0.25,
            right: 0.25,
            top: 0.5,
            bottom: 0.5,
            header: 0.2,
            footer: 0.2,
        },
    };
    worksheet.headerFooter = {
        oddHeader: `&L&B${config.title}&R&D`,
        oddFooter: '&LGenerated by Transit Scheduler&RPage &P of &N',
    };
    worksheet.views = [{
        state: 'frozen',
        xSplit: 0,
        ySplit: config.headerRow,
        topLeftCell: `${firstDataColumn}${config.dataStartRow}`,
        zoomScale: config.zoomScale ?? 90,
        showGridLines: false,
    }];
    await worksheet.protect(WORKSHEET_PROTECTION_PASSWORD, {
        selectLockedCells: true,
        selectUnlockedCells: true,
        formatCells: false,
        formatColumns: false,
        formatRows: false,
        insertRows: true,
        deleteRows: true,
        sort: true,
        autoFilter: true,
    });
}

function buildFooterCounts(sheet: FleetPlanSheet, config: FleetPlanSheetConfig): FooterCountSet {
    const replacementByYear = config.timelineColumns.map(() => 0);
    const growthByYear = config.timelineColumns.map(() => 0);
    const baseByYear = config.timelineColumns.map(() => 0);

    sheet.rows.forEach((row) => {
        config.timelineColumns.forEach((column, index) => {
            const value = (row.timeline[column.key] || '').trim();
            if (!value) return;

            const upper = value.toUpperCase();
            if (upper.startsWith('PURCHASE')) {
                replacementByYear[index] += 1;
                return;
            }
            if (upper === 'GROWTH') {
                growthByYear[index] += 1;
                return;
            }

            if (config.key === 'electric-12m') {
                if (/-E$/i.test(value)) baseByYear[index] += 1;
                return;
            }

            if (isNumericFleetValue(value)) {
                baseByYear[index] += 1;
            }
        });
    });

    const totalByYear = baseByYear.map((count, index) => count + growthByYear[index]);
    return { replacementByYear, growthByYear, baseByYear, totalByYear };
}

function writeCommonHeader(worksheet: ExcelJS.Worksheet, config: FleetPlanSheetConfig, totals: FooterCountSet): void {
    if (config.bandLabels) {
        config.bandLabels.forEach((band) => {
            const cell = worksheet.getCell(band.cell);
            cell.value = band.value;
            cell.font = {
                bold: band.bold ?? true,
                size: 11,
                color: { argb: band.fontColor ?? 'FF111827' },
            };
            if (band.fill) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: band.fill } };
            }
            applyAlignment(cell, 'center');
        });
    }

    worksheet.mergeCells(config.titleMerge);
    styleTitle(worksheet.getCell(config.titleMerge.split(':')[0]!));
    worksheet.getCell(config.titleMerge.split(':')[0]!).value = config.title;

    if (config.key === 'small-buses') {
        worksheet.mergeCells('B3:E3');
    } else if (config.key === 'electric-12m') {
        worksheet.mergeCells('B3:D3');
    }

    const totalLabelCell = worksheet.getCell('B3');
    totalLabelCell.value = 'TOTAL FLEET';
    styleFooterLabel(totalLabelCell);

    config.baseColumns.forEach((column) => {
        const cell = worksheet.getCell(`${column.exportColumn}${config.headerRow}`);
        cell.value = column.label;
        styleHeader(cell);
    });
    config.timelineColumns.forEach((column, index) => {
        const headerCell = worksheet.getCell(`${column.exportColumn}${config.headerRow}`);
        headerCell.value = column.label;
        styleHeader(headerCell);

        const totalCell = worksheet.getCell(`${column.exportColumn}3`);
        totalCell.value = totals.totalByYear[index];
        styleFooterValue(totalCell);
    });

    if (config.key === 'small-buses') {
        worksheet.getCell('I3').value = 'On Order';
        styleFooterValue(worksheet.getCell('I3'));
    }
}

function writeHeaderTotalFormulas(
    worksheet: ExcelJS.Worksheet,
    config: FleetPlanSheetConfig,
    totals: FooterCountSet,
    lastDataRow: number,
): void {
    config.timelineColumns.forEach((column, index) => {
        const range = getTimelineRange(column.exportColumn, config, lastDataRow);
        const totalCell = worksheet.getCell(`${column.exportColumn}3`);
        if (config.key === 'electric-12m') {
            setFormulaValue(totalCell, `COUNTIF(${range},"*-E")`, totals.totalByYear[index] ?? 0);
        } else {
            setFormulaValue(totalCell, `COUNT(${range})+COUNTIF(${range},"GROWTH")`, totals.totalByYear[index] ?? 0);
        }
        styleFooterValue(totalCell);
    });
}

function writeSheetRows(worksheet: ExcelJS.Worksheet, sheet: FleetPlanSheet, config: FleetPlanSheetConfig): number {
    let rowNumber = config.dataStartRow;

    sheet.rows.forEach((row) => {
        config.baseColumns.forEach((column) => {
            const cell = worksheet.getCell(`${column.exportColumn}${rowNumber}`);
            const rawValue = column.key === 'unitNumber'
                ? row.unitNumber
                : column.key === 'busSize'
                    ? row.busSize || ''
                    : column.key === 'makeModel'
                        ? row.makeModel
                        : column.key === 'year'
                            ? row.year
                            : column.key === 'comment'
                                ? row.comment || ''
                                : column.key === 'onOrder'
                                    ? row.onOrder || ''
                                    : row.electricFlag || '';
            styleGridCell(cell, coerceFleetExportValue(rawValue), config.key);
            if (column.key === 'comment') applyAlignment(cell, 'left');
            if (column.key === 'makeModel') applyAlignment(cell, 'left');
            if (column.key === 'onOrder') applyAlignment(cell, 'left');
        });

        config.timelineColumns.forEach((column) => {
            const cell = worksheet.getCell(`${column.exportColumn}${rowNumber}`);
            styleGridCell(cell, coerceFleetExportValue(row.timeline[column.key] || ''), config.key);
            applyStatusValidation(cell);
        });

        rowNumber += 1;
    });

    return rowNumber - 1;
}

function writeLegends(worksheet: ExcelJS.Worksheet, config: FleetPlanSheetConfig): void {
    if (!config.legendColumn || !config.legendItems || config.legendItems.length === 0) return;
    const headerCell = worksheet.getCell(`${config.legendColumn}5`);
    styleLegendHeader(headerCell);

    config.legendItems.forEach((item, index) => {
        styleLegendText(worksheet.getCell(`${config.legendColumn}${index + 6}`), item);
    });
}

function writeDieselFooter(
    worksheet: ExcelJS.Worksheet,
    startRow: number,
    totals: FooterCountSet,
    config: FleetPlanSheetConfig,
    lastDataRow: number,
): number {
    const replacementRow = startRow + config.footerSpacerRows;
    const baseRow = replacementRow + 1;
    const growthRow = baseRow + 1;
    const totalRow = growthRow + 1;

    worksheet.getCell(`B${replacementRow}`).value = 'Replacement';
    worksheet.getCell(`B${baseRow}`).value = 'Base';
    worksheet.getCell(`B${growthRow}`).value = 'Growth';
    worksheet.getCell(`B${totalRow}`).value = 'Total Fleet';

    [replacementRow, baseRow, growthRow, totalRow].forEach((rowNumber) => {
        styleFooterLabel(worksheet.getCell(`B${rowNumber}`));
    });

    setFormulaValue(worksheet.getCell(`D${replacementRow}`), `SUM(E${replacementRow}:${getLastDataColumn(config)}${replacementRow})`, totals.replacementByYear.reduce((sum, value) => sum + value, 0));
    setFormulaValue(worksheet.getCell(`D${baseRow}`), `SUM(E${baseRow}:${getLastDataColumn(config)}${baseRow})`, totals.baseByYear.reduce((sum, value) => sum + value, 0));
    setFormulaValue(worksheet.getCell(`D${growthRow}`), `SUM(E${growthRow}:${getLastDataColumn(config)}${growthRow})`, totals.growthByYear.reduce((sum, value) => sum + value, 0));
    setFormulaValue(worksheet.getCell(`D${totalRow}`), `SUM(E${totalRow}:${getLastDataColumn(config)}${totalRow})`, totals.totalByYear.reduce((sum, value) => sum + value, 0));
    [replacementRow, baseRow, growthRow, totalRow].forEach((rowNumber) => {
        styleFooterValue(worksheet.getCell(`D${rowNumber}`));
    });

    config.timelineColumns.forEach((column, index) => {
        const range = getTimelineRange(column.exportColumn, config, lastDataRow);
        const replacementCell = worksheet.getCell(`${column.exportColumn}${replacementRow}`);
        const baseCell = worksheet.getCell(`${column.exportColumn}${baseRow}`);
        const growthCell = worksheet.getCell(`${column.exportColumn}${growthRow}`);
        const totalCell = worksheet.getCell(`${column.exportColumn}${totalRow}`);

        setFormulaValue(replacementCell, `COUNTIF(${range},"PURCHASE*")`, totals.replacementByYear[index] ?? 0);
        setFormulaValue(baseCell, `COUNT(${range})`, totals.baseByYear[index] ?? 0);
        setFormulaValue(growthCell, `COUNTIF(${range},"GROWTH")`, totals.growthByYear[index] ?? 0);
        setFormulaValue(totalCell, `${column.exportColumn}${baseRow}+${column.exportColumn}${growthRow}`, totals.totalByYear[index] ?? 0);

        [replacementCell, baseCell, growthCell, totalCell].forEach(styleFooterValue);
    });

    return totalRow;
}

function writeSmallBusFooter(
    worksheet: ExcelJS.Worksheet,
    nextRow: number,
    totals: FooterCountSet,
    config: FleetPlanSheetConfig,
    lastDataRow: number,
): number {
    worksheet.getCell(`B${nextRow}`).value = 'Total Cutaways';
    styleFooterLabel(worksheet.getCell(`B${nextRow}`));
    config.timelineColumns.forEach((column, index) => {
        const cell = worksheet.getCell(`${column.exportColumn}${nextRow}`);
        setFormulaValue(cell, `COUNT(${getTimelineRange(column.exportColumn, config, lastDataRow)})`, totals.baseByYear[index] ?? 0);
        styleFooterValue(cell);
    });

    return nextRow;
}

function writeElectricFooter(
    worksheet: ExcelJS.Worksheet,
    startRow: number,
    totals: FooterCountSet,
    config: FleetPlanSheetConfig,
    lastDataRow: number,
): number {
    const footerRow = startRow + config.footerSpacerRows;
    worksheet.getCell(`D${footerRow}`).value = 'Total';
    styleFooterLabel(worksheet.getCell(`D${footerRow}`));

    config.timelineColumns.forEach((column, index) => {
        const cell = worksheet.getCell(`${column.exportColumn}${footerRow}`);
        setFormulaValue(cell, `COUNTIF(${getTimelineRange(column.exportColumn, config, lastDataRow)},"*-E")`, totals.baseByYear[index] ?? 0);
        styleFooterValue(cell);
    });

    return footerRow;
}

function finalizeSheetLayout(worksheet: ExcelJS.Worksheet, config: FleetPlanSheetConfig): void {
    setSheetColumns(worksheet, config);

    Object.entries(config.rowBandHeights || {}).forEach(([row, height]) => {
        worksheet.getRow(Number(row)).height = height;
    });
}

async function renderSheet(worksheet: ExcelJS.Worksheet, sheet: FleetPlanSheet, config: FleetPlanSheetConfig): Promise<void> {
    const totals = buildFooterCounts(sheet, config);
    finalizeSheetLayout(worksheet, config);
    writeCommonHeader(worksheet, config, totals);
    const lastDataRow = writeSheetRows(worksheet, sheet, config);
    const nextRow = lastDataRow + 1;
    let lastUsedRow = nextRow;
    writeHeaderTotalFormulas(worksheet, config, totals, lastDataRow);

    if (config.footerType === 'diesel-12m') {
        lastUsedRow = writeDieselFooter(worksheet, nextRow, totals, config, lastDataRow);
    } else if (config.footerType === 'small-buses') {
        lastUsedRow = writeSmallBusFooter(worksheet, nextRow, totals, config, lastDataRow);
    } else {
        lastUsedRow = writeElectricFooter(worksheet, nextRow, totals, config, lastDataRow);
    }

    writeLegends(worksheet, config);
    await applyWorksheetBestPractices(worksheet, config, lastDataRow, lastUsedRow);
}

function downloadBuffer(buffer: ArrayBuffer, fileName: string): void {
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

export async function buildFleetPlanWorkbookBuffer(data: FleetPlanWorkbook): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Barrie Transit Scheduler';
    workbook.lastModifiedBy = 'Barrie Transit Scheduler';
    workbook.subject = 'Fleet planning workbook';
    workbook.title = data.metadata.sourceFileName || 'Fleet Plan';
    workbook.company = 'Barrie Transit';
    workbook.keywords = 'fleet, transit, planning';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;

    for (const config of FLEET_PLAN_SHEET_CONFIGS) {
        const worksheet = workbook.addWorksheet(config.name);
        const sheet = data.sheets.find((entry) => entry.key === config.key);
        if (!sheet) continue;
        await renderSheet(worksheet, sheet, config);
    }

    return workbook.xlsx.writeBuffer();
}

export async function exportFleetPlanWorkbook(data: FleetPlanWorkbook, fileName?: string): Promise<void> {
    const buffer = await buildFleetPlanWorkbookBuffer(data);
    const baseName = fileName?.trim() || `Fleet_Plan_${new Date().toISOString().slice(0, 10)}.xlsx`;
    downloadBuffer(buffer, baseName.endsWith('.xlsx') ? baseName : `${baseName}.xlsx`);
}
