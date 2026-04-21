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

const THIN_GRAY: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFC7D3' } };
const MEDIUM_GRAY: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF7A8797' } };

function applyBorder(cell: ExcelJS.Cell, border: Partial<ExcelJS.Border> = THIN_GRAY): void {
    cell.border = { top: border, bottom: border, left: border, right: border };
}

function applyAlignment(cell: ExcelJS.Cell, horizontal: ExcelJS.Alignment['horizontal'] = 'center'): void {
    cell.alignment = { horizontal, vertical: 'middle', wrapText: true };
}

function styleTitle(cell: ExcelJS.Cell): void {
    cell.font = { bold: true, size: 18, color: { argb: 'FF1F2937' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5F0FA' } };
    applyBorder(cell, MEDIUM_GRAY);
    applyAlignment(cell, 'center');
}

function styleHeader(cell: ExcelJS.Cell): void {
    cell.font = { bold: true, size: 11, color: { argb: 'FF374151' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    applyBorder(cell, MEDIUM_GRAY);
    applyAlignment(cell, 'center');
}

function styleFooterLabel(cell: ExcelJS.Cell): void {
    cell.font = { bold: true, size: 11, color: { argb: 'FF374151' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    applyBorder(cell, MEDIUM_GRAY);
    applyAlignment(cell, 'left');
}

function styleFooterValue(cell: ExcelJS.Cell): void {
    cell.font = { bold: true, size: 11, color: { argb: 'FF111827' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
    applyBorder(cell, MEDIUM_GRAY);
    applyAlignment(cell, 'center');
}

function styleGridCell(cell: ExcelJS.Cell, value: string | number | null, sheetKey: FleetPlanSheetKey): void {
    const normalized = typeof value === 'string' ? value.trim() : value;
    cell.value = value;
    applyBorder(cell);
    applyAlignment(cell, typeof value === 'number' ? 'center' : 'center');

    if (normalized === null || normalized === '') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        return;
    }

    if (typeof normalized === 'number' || (typeof normalized === 'string' && isNumericFleetValue(normalized))) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDAEEF3' } };
        cell.font = { bold: false, color: { argb: 'FF111827' } };
        return;
    }

    const upper = String(normalized).toUpperCase();

    if (upper.includes('RETIRE') || upper.includes('ACCIDENT') || upper.includes('GOVDEALS')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        cell.font = { bold: true, color: { argb: 'FF9C0006' } };
        return;
    }

    if (upper.includes('TRADE')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
        cell.font = { bold: true, color: { argb: 'FF9A3412' } };
        return;
    }

    if (upper.startsWith('PURCHASE')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sheetKey === 'small-buses' ? 'FF66FF66' : 'FF99FF33' } };
        cell.font = { bold: true, color: { argb: 'FF14532D' } };
        return;
    }

    if (upper === 'GROWTH') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7CEB99' } };
        cell.font = { bold: true, color: { argb: 'FF14532D' } };
        return;
    }

    if (upper.includes('TRAINING')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        cell.font = { bold: true, color: { argb: 'FF854D0E' } };
        return;
    }

    if (sheetKey === 'electric-12m' && upper === 'E') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        applyAlignment(cell, 'right');
        return;
    }

    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    cell.font = { bold: false, color: { argb: 'FF111827' } };
}

function styleLegendHeader(cell: ExcelJS.Cell): void {
    cell.value = 'LEGEND';
    cell.font = { bold: true, size: 11, color: { argb: 'FF111827' } };
    applyAlignment(cell, 'left');
}

function styleLegendText(cell: ExcelJS.Cell, label: string): void {
    cell.value = label;
    cell.font = { bold: false, size: 10, color: { argb: 'FF374151' } };
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

function writeDieselFooter(worksheet: ExcelJS.Worksheet, startRow: number, totals: FooterCountSet, config: FleetPlanSheetConfig): void {
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

    worksheet.getCell(`D${replacementRow}`).value = totals.replacementByYear.reduce((sum, value) => sum + value, 0);
    worksheet.getCell(`D${baseRow}`).value = totals.baseByYear[0] ?? 0;
    worksheet.getCell(`D${growthRow}`).value = totals.growthByYear[0] ?? 0;
    worksheet.getCell(`D${totalRow}`).value = totals.totalByYear[0] ?? 0;
    [replacementRow, baseRow, growthRow, totalRow].forEach((rowNumber) => {
        styleFooterValue(worksheet.getCell(`D${rowNumber}`));
    });

    config.timelineColumns.forEach((column, index) => {
        const replacementCell = worksheet.getCell(`${column.exportColumn}${replacementRow}`);
        const baseCell = worksheet.getCell(`${column.exportColumn}${baseRow}`);
        const growthCell = worksheet.getCell(`${column.exportColumn}${growthRow}`);
        const totalCell = worksheet.getCell(`${column.exportColumn}${totalRow}`);

        replacementCell.value = totals.replacementByYear[index];
        baseCell.value = totals.baseByYear[index];
        growthCell.value = totals.growthByYear[index];
        totalCell.value = totals.totalByYear[index];

        [replacementCell, baseCell, growthCell, totalCell].forEach(styleFooterValue);
    });
}

function writeSmallBusFooter(worksheet: ExcelJS.Worksheet, nextRow: number, totals: FooterCountSet, config: FleetPlanSheetConfig): void {
    worksheet.getCell(`B${nextRow}`).value = 'Total Cutaways';
    styleFooterLabel(worksheet.getCell(`B${nextRow}`));
    config.timelineColumns.forEach((column, index) => {
        const cell = worksheet.getCell(`${column.exportColumn}${nextRow}`);
        cell.value = totals.baseByYear[index];
        styleFooterValue(cell);
    });
}

function writeElectricFooter(worksheet: ExcelJS.Worksheet, startRow: number, totals: FooterCountSet, config: FleetPlanSheetConfig): void {
    const footerRow = startRow + config.footerSpacerRows;
    worksheet.getCell(`D${footerRow}`).value = 'Total';
    styleFooterLabel(worksheet.getCell(`D${footerRow}`));

    config.timelineColumns.forEach((column, index) => {
        const cell = worksheet.getCell(`${column.exportColumn}${footerRow}`);
        cell.value = totals.baseByYear[index];
        styleFooterValue(cell);
    });
}

function finalizeSheetLayout(worksheet: ExcelJS.Worksheet, config: FleetPlanSheetConfig): void {
    setSheetColumns(worksheet, config);

    if (config.freezeCell) {
        worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: Number(config.freezeCell.replace(/\D/g, '')) - 1, zoomScale: config.zoomScale }];
    } else if (config.zoomScale) {
        worksheet.views = [{ zoomScale: config.zoomScale }];
    }

    Object.entries(config.rowBandHeights || {}).forEach(([row, height]) => {
        worksheet.getRow(Number(row)).height = height;
    });
}

function renderSheet(worksheet: ExcelJS.Worksheet, sheet: FleetPlanSheet, config: FleetPlanSheetConfig): void {
    const totals = buildFooterCounts(sheet, config);
    finalizeSheetLayout(worksheet, config);
    writeCommonHeader(worksheet, config, totals);
    const lastDataRow = writeSheetRows(worksheet, sheet, config);
    const nextRow = lastDataRow + 1;

    if (config.footerType === 'diesel-12m') {
        writeDieselFooter(worksheet, nextRow, totals, config);
    } else if (config.footerType === 'small-buses') {
        writeSmallBusFooter(worksheet, nextRow, totals, config);
    } else {
        writeElectricFooter(worksheet, nextRow, totals, config);
    }

    writeLegends(worksheet, config);
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
    workbook.created = new Date();
    workbook.modified = new Date();

    FLEET_PLAN_SHEET_CONFIGS.forEach((config) => {
        const worksheet = workbook.addWorksheet(config.name);
        const sheet = data.sheets.find((entry) => entry.key === config.key);
        if (!sheet) return;
        renderSheet(worksheet, sheet, config);
    });

    return workbook.xlsx.writeBuffer();
}

export async function exportFleetPlanWorkbook(data: FleetPlanWorkbook, fileName?: string): Promise<void> {
    const buffer = await buildFleetPlanWorkbookBuffer(data);
    const baseName = fileName?.trim() || `Fleet_Plan_${new Date().toISOString().slice(0, 10)}.xlsx`;
    downloadBuffer(buffer, baseName.endsWith('.xlsx') ? baseName : `${baseName}.xlsx`);
}
