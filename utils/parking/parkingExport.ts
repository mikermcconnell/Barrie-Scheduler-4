import * as XLSX from 'xlsx';
import type { ParkingRawRow, ParkingSummary } from './parkingTypes';

export interface ParkingRawObservationExportOptions {
  title: string;
  subtitle?: string;
  fileName: string;
}

function money(value: number | null | undefined): number | string {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : '';
}

function percent(value: number | null | undefined): number | string {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : '';
}

function minutesToDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function minutesToTime(minutes: number): string {
  const safe = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function rawObservationExportRows(rows: ParkingRawRow[]) {
  return rows.map(row => ({
    Month: row.startMonth,
    Date: row.startDate,
    'Licence Plate': row.plate || '(missing)',
    'Start Time': row.startRaw,
    'Start HH:MM': minutesToTime(row.startMinutes),
    'End HH:MM': minutesToTime(row.endMinutes),
    Duration: minutesToDuration(row.durationMinutes),
    'Spot ID': row.spotId,
    Location: row.locationName,
    'Tap Signs/Spot': row.tapType,
    'Discount Code': row.discountCode,
    'Code Family': row.codeFamilyKey,
    Department: row.department || 'Unmapped',
    Description: row.description,
    'Discount Amount': money(row.discountAmount),
  }));
}

function safeParkingExportFileName(value: string | undefined, extension: 'xlsx' | 'pdf'): string {
  const withoutExtension = (value || 'parking-raw-observations')
    .trim()
    .replace(/\.(xlsx|pdf)$/i, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 120);
  return `${withoutExtension || 'parking-raw-observations'}.${extension}`;
}

export function createParkingRawObservationsWorkbook(
  rows: ParkingRawRow[],
  options: ParkingRawObservationExportOptions,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const totalValue = rows.reduce((sum, row) => sum + row.discountAmount, 0);
  const summaryRows = [{
    Report: options.title,
    Context: options.subtitle || '',
    Uses: rows.length,
    'Total Value': money(totalValue),
  }];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Report Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawObservationExportRows(rows)), 'Raw Observations');
  return workbook;
}

export function exportParkingRawObservationsExcel(
  rows: ParkingRawRow[],
  options: ParkingRawObservationExportOptions,
): void {
  XLSX.writeFile(
    createParkingRawObservationsWorkbook(rows, options),
    safeParkingExportFileName(options.fileName, 'xlsx'),
  );
}

export async function exportParkingRawObservationsPdf(
  rows: ParkingRawRow[],
  options: ParkingRawObservationExportOptions,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const totalValue = rows.reduce((sum, row) => sum + row.discountAmount, 0);

  doc.setFontSize(16);
  doc.text(options.title, 36, 34);
  doc.setFontSize(9);
  if (options.subtitle) doc.text(options.subtitle, 36, 50);
  doc.text(`${rows.length.toLocaleString()} ${rows.length === 1 ? 'use' : 'uses'} · $${totalValue.toFixed(2)} total value`, 36, options.subtitle ? 64 : 50);

  autoTable(doc, {
    startY: options.subtitle ? 76 : 62,
    head: [[
      'Month', 'Date', 'Licence plate', 'Start time', 'Spot ID', 'Location', 'Length',
      'Tap Signs/Spot', 'Discount code', 'Department', 'Description', 'Discount amount',
    ]],
    body: rows.map(row => [
      row.startMonth,
      row.startDate,
      row.plate || '(missing)',
      row.startRaw || minutesToTime(row.startMinutes),
      row.spotId || '',
      row.locationName || '',
      minutesToDuration(row.durationMinutes),
      row.tapType || '',
      row.discountCode || '',
      row.department || 'Unmapped',
      row.description || '',
      `$${row.discountAmount.toFixed(2)}`,
    ]),
    theme: 'grid',
    styles: { fontSize: 6, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      3: { cellWidth: 74 },
      5: { cellWidth: 66 },
      9: { cellWidth: 76 },
      10: { cellWidth: 88 },
      11: { halign: 'right', cellWidth: 54 },
    },
    margin: { left: 24, right: 24 },
  });

  doc.save(safeParkingExportFileName(options.fileName, 'pdf'));
}

export function createParkingExportWorkbook(summary: ParkingSummary): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  const rawRows = summary.months.flatMap(month => month.rows).map(row => ({
    Month: row.startMonth,
    Date: row.startDate,
    'Licence Plate': row.plate || '(missing)',
    'Start Time': row.startRaw,
    'Start HH:MM': minutesToTime(row.startMinutes),
    'End HH:MM': minutesToTime(row.endMinutes),
    Duration: minutesToDuration(row.durationMinutes),
    'Spot ID/Tap Token': row.spotId,
    Location: row.locationName,
    'Tap Signs/Spot': row.tapType,
    'Discount Code': row.discountCode,
    'Code Family': row.codeFamilyKey,
    Department: row.department || 'Unmapped',
    Description: row.description,
    'Discount Amount': money(row.discountAmount),
    'Missing Plate': row.hasMissingPlate ? 'Yes' : 'No',
  }));

  const departmentRows = summary.departmentSummaries.map(summaryRow => ({
    Month: summaryRow.month,
    Department: summaryRow.department,
    'Code Family': summaryRow.codeFamilyKey,
    'Total Value': money(summaryRow.totalValue),
    Sessions: summaryRow.sessionCount,
    'Unique Plates': summaryRow.uniquePlateCount,
    'Previous Month Value': money(summaryRow.previousValue),
    'Change Value': money(summaryRow.changeValue),
    'Change Percent': percent(summaryRow.changePercent),
    'High Usage Flag': summaryRow.isHighUsage ? 'Yes' : 'No',
  }));

  const flagRows = summary.platePatterns.map(pattern => ({
    Month: pattern.month,
    Plate: pattern.displayPlate,
    Department: pattern.department,
    'Total Value': money(pattern.totalValue),
    Sessions: pattern.sessionCount,
    'Active Days': pattern.activeDays,
    'Long Sessions': pattern.longSessionCount,
    'Top Spot': pattern.topSpotId,
    'Top Location': pattern.topLocationName,
    'Top Location Days': pattern.topLocationDays,
    'Max Consecutive Weekdays': pattern.maxConsecutiveWeekdays,
    'Unusual Timing Count': pattern.unusualTimingCount,
    'Multiple Daily Session Days': pattern.multipleDailySessionDays,
    Flags: pattern.flags.join(', '),
  }));

  const overviewRows = [{
    'Imported At': summary.metadata.importedAt,
    'Imported By': summary.metadata.importedBy,
    Months: summary.metadata.monthCount,
    Rows: summary.metadata.totalRows,
    'Total Value': money(summary.metadata.totalValue),
  }];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overviewRows), 'Overview');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(departmentRows), 'Department Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(flagRows), 'Flagged Plates');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawRows), 'Raw Rows');
  return workbook;
}

export function exportParkingWorkbook(summary: ParkingSummary, fileName = 'parking-usage-report.xlsx'): void {
  XLSX.writeFile(createParkingExportWorkbook(summary), fileName);
}
