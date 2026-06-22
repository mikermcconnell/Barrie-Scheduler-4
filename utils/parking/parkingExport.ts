import * as XLSX from 'xlsx';
import type { ParkingSummary } from './parkingTypes';

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
