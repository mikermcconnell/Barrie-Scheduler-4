import { Shift, Requirement, Zone } from '../demandTypes';
import {
    TIME_SLOTS_PER_DAY,
    hoursToSlots,
    minutesToSlot,
    minutesToSlotsCeil,
} from '../demandConstants';

// Helper to parse time "HH:MM", "HH:MM AM/PM", or Excel numeric time to the active TOD slot index
const parseTimeToSlot = (timeValue: CellValue): number => {
    if (timeValue === null || timeValue === undefined || timeValue === '') return 0;

    if (typeof timeValue === 'number') {
        const fractionalDay = timeValue >= 1 ? timeValue - Math.floor(timeValue) : timeValue;
        return minutesToSlot(Math.round(fractionalDay * 24 * 60));
    }

    // Normalize
    const cleanTime = String(timeValue).trim().toLowerCase();

    // Handle "24:00" or "0:00"
    if (cleanTime === '0:00' || cleanTime === '24:00') return 0; // Midnight start

    let hours = 0;
    let minutes = 0;

    // Check for AM/PM
    const isPM = cleanTime.includes('pm');
    const isAM = cleanTime.includes('am');

    // Remove am/pm
    const timeOnly = cleanTime.replace('am', '').replace('pm', '').trim();
    const parts = timeOnly.split(':');

    if (parts.length >= 2) {
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
    } else {
        // Maybe just "14" or "14.00"
        hours = parseFloat(parts[0]);
    }

    // Adjust 12-hour format
    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    return minutesToSlot(hours * 60 + minutes);
};

export const parseScheduleMaster = (csvText: string): Record<string, Requirement[]> => {
    const lines = csvText.split(/\r?\n/);
    const schedules: Record<string, Requirement[]> = {};

    const parseSection = (startRowIndex: number, endRowIndex: number): Requirement[] => {
        const requirements: Requirement[] = [];
        for (let i = 0; i < TIME_SLOTS_PER_DAY; i++) {
            requirements.push({
                slotIndex: i,
                north: 0,
                south: 0,
                floater: 0,
                total: 0
            });
        }

        // Header is usually the row after the section title (e.g. "Weekday" is row 3, Header is row 4)
        // But let's look for the header row within the range
        let headerRowIndex = -1;
        for (let i = startRowIndex; i <= endRowIndex; i++) {
            if (lines[i].includes('City Area') && lines[i].includes('5:15')) {
                headerRowIndex = i;
                break;
            }
        }

        if (headerRowIndex === -1) return requirements;

        const headers = lines[headerRowIndex].split(',').map(h => h.trim().toLowerCase());
        const cityAreaIndex = headers.findIndex(h => h.includes('city area'));

        if (cityAreaIndex === -1) return requirements;

        const timeColIndices: { [slot: number]: number } = {};
        headers.forEach((header, index) => {
            if (header.includes(':')) {
                const slot = parseTimeToSlot(header);
                timeColIndices[slot] = index;
            }
        });
        const sortedHeaderSlots = Object.keys(timeColIndices)
            .map(slot => parseInt(slot, 10))
            .sort((a, b) => a - b);
        const headerCoverageSlots = Math.max(
            1,
            sortedHeaderSlots
                .slice(1)
                .map((slot, index) => slot - sortedHeaderSlots[index])
                .filter(delta => delta > 0)[0] ?? 1,
        );

        for (let i = headerRowIndex + 1; i <= endRowIndex; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;

            const cols = line.split(',');
            const cityArea = cols[cityAreaIndex]?.trim();

            if (!cityArea) continue;

            let zone: 'north' | 'south' | 'floater' | null = null;
            if (cityArea.toLowerCase().includes('north')) zone = 'north';
            else if (cityArea.toLowerCase().includes('south')) zone = 'south';
            else if (cityArea.toLowerCase().includes('floater')) zone = 'floater';

            if (zone) {
                for (const [slotStr, colIdx] of Object.entries(timeColIndices)) {
                    const slot = parseInt(slotStr, 10);
                    const val = cols[colIdx];

                    if (val && val.trim() === '1') {
                        for (let offset = 0; offset < headerCoverageSlots; offset++) {
                            const activeSlot = slot + offset;
                            if (activeSlot >= 0 && activeSlot < TIME_SLOTS_PER_DAY) {
                                requirements[activeSlot][zone]++;
                                requirements[activeSlot].total++;
                            }
                        }
                    }
                }
            }
        }
        return requirements;
    };

    // Find section starts
    let weekdayStart = -1, saturdayStart = -1, sundayStart = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        if (line.startsWith('weekday')) weekdayStart = i;
        else if (line.startsWith('saturday')) saturdayStart = i;
        else if (line.startsWith('sunday')) sundayStart = i;
    }

    // Define ranges based on user input and file structure
    // Weekday: Row 3-11 (Index 2-10)
    // Saturday: Row 13-20 (Index 12-19)
    // Sunday: Row 22-29 (Index 21-28)

    // Dynamic detection is safer
    if (weekdayStart !== -1) {
        // Weekday ends where Saturday starts (minus some buffer) or EOF
        const end = saturdayStart !== -1 ? saturdayStart - 1 : lines.length;
        schedules['Weekday'] = parseSection(weekdayStart, end);
    }

    if (saturdayStart !== -1) {
        const end = sundayStart !== -1 ? sundayStart - 1 : lines.length;
        schedules['Saturday'] = parseSection(saturdayStart, end);
    }

    if (sundayStart !== -1) {
        schedules['Sunday'] = parseSection(sundayStart, lines.length);
    }

    return schedules;
};

// Type for Excel/CSV row data (cells can be strings or numbers)
type CellValue = string | number | null | undefined;
type RowData = CellValue[];

const normalizeHeaderCell = (cell: CellValue): string =>
    cellToString(cell).toLowerCase().replace(/[^a-z0-9]/g, '');

const parseCsvRows = (csvText: string): RowData[] => {
    const rows: RowData[] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                cell += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            continue;
        }

        cell += char;
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
};

const findRideCoRowIndex = (
    lines: RowData[],
    labels: string[],
    fallbackIndex?: number,
    startIndex = 0,
): number => {
    const normalizedLabels = labels.map(label => label.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const searchLines = lines.slice(startIndex);

    const exactMatch = searchLines.findIndex(row => {
        const cellsToScan = row.slice(0, 3).map(normalizeHeaderCell);
        return cellsToScan.some(cell => normalizedLabels.includes(cell));
    });

    if (exactMatch !== -1) {
        return exactMatch + startIndex;
    }

    const looseMatch = searchLines.findIndex(row => {
        const cellsToScan = row.slice(0, 3).map(normalizeHeaderCell);
        return cellsToScan.some(cell =>
            cell.length > 0 &&
            normalizedLabels.some(label => cell.includes(label) || label.includes(cell))
        );
    });

    if (looseMatch !== -1) {
        return looseMatch + startIndex;
    }

    return fallbackIndex ?? -1;
};

const findRideCoShiftHeaderRowIndex = (lines: RowData[], fallbackIndex = -1): number => {
    const rowIndex = lines.findIndex(row =>
        row.some(cell => /^shift\d+$/i.test(normalizeHeaderCell(cell)))
    );

    return rowIndex !== -1 ? rowIndex : fallbackIndex;
};

// Helper to safely convert cell value to string
const cellToString = (cell: CellValue): string => {
    if (cell === null || cell === undefined) return '';
    return String(cell).trim();
};

export interface RideCoSkippedColumn {
    columnIndex: number;
    columnLabel: string;
    shiftHeader: string;
    reason: string;
}

export interface RideCoImportReport {
    sourceName?: string;
    sheetName?: string;
    shiftCount: number;
    countsByDay: Record<'Weekday' | 'Saturday' | 'Sunday', number>;
    scannedColumnCount: number;
    skippedColumns: RideCoSkippedColumn[];
    warnings: string[];
    missingRequiredRows: string[];
    detectedRows: Record<string, number | undefined>;
}

export interface RideCoParseResult {
    shifts: Shift[];
    report: RideCoImportReport;
}

const createEmptyRideCoReport = (
    sourceName?: string,
    sheetName?: string,
): RideCoImportReport => ({
    sourceName,
    sheetName,
    shiftCount: 0,
    countsByDay: {
        Weekday: 0,
        Saturday: 0,
        Sunday: 0,
    },
    scannedColumnCount: 0,
    skippedColumns: [],
    warnings: [],
    missingRequiredRows: [],
    detectedRows: {},
});

const excelColumnLabel = (columnIndex: number): string => {
    let dividend = columnIndex + 1;
    let label = '';

    while (dividend > 0) {
        const modulo = (dividend - 1) % 26;
        label = String.fromCharCode(65 + modulo) + label;
        dividend = Math.floor((dividend - modulo) / 26);
    }

    return label;
};

const hasCellValue = (cell: CellValue): boolean => cellToString(cell).length > 0;

const addRideCoSkippedColumn = (
    report: RideCoImportReport,
    columnIndex: number,
    shiftHeader: string,
    reason: string,
) => {
    report.skippedColumns.push({
        columnIndex,
        columnLabel: excelColumnLabel(columnIndex),
        shiftHeader: shiftHeader || `Column ${excelColumnLabel(columnIndex)}`,
        reason,
    });
};

const applyRideCoShiftCounts = (report: RideCoImportReport, shifts: Shift[]) => {
    report.shiftCount = shifts.length;
    report.countsByDay = shifts.reduce<RideCoImportReport['countsByDay']>((counts, shift) => {
        const dayType = shift.dayType ?? 'Weekday';
        counts[dayType] += 1;
        return counts;
    }, {
        Weekday: 0,
        Saturday: 0,
        Sunday: 0,
    });
};

const normalizeRideCoInput = (input: string | RowData[]): RowData[] => (
    typeof input === 'string' ? parseCsvRows(input) : input
);

const parseRideCoRowsWithReport = (
    lines: RowData[],
    sourceName?: string,
    sheetName?: string,
): RideCoParseResult => {
    const shifts: Shift[] = [];
    const report = createEmptyRideCoReport(sourceName, sheetName);

    // User specified fixed row structure (0-indexed), but real templates may include
    // cover/instruction rows or workbook tabs. Detect the rows by labels first.
    const ROW_SHIFT_NUM = findRideCoShiftHeaderRowIndex(lines);
    const tableSearchStart = ROW_SHIFT_NUM >= 0 ? ROW_SHIFT_NUM + 1 : 0;
    const ROW_DAY = findRideCoRowIndex(lines, ['Day', 'Day Type'], 10, tableSearchStart);
    const ROW_ZONE = findRideCoRowIndex(lines, ['Driver (optional)', 'Driver', 'Zone', 'Zone Area'], 13, tableSearchStart);
    const ROW_BUS_NUM = findRideCoRowIndex(lines, ['Shift Label', 'Bus #', 'Bus Number'], 14, tableSearchStart);
    const ROW_START = findRideCoRowIndex(lines, ['Service Start Time', 'Start Time'], 15, tableSearchStart);
    const ROW_END = findRideCoRowIndex(lines, ['Service End Time', 'End Time'], 16, tableSearchStart);
    const ROW_BREAK_START = findRideCoRowIndex(lines, ['Break 1 Window Start Time', 'Break Start'], 17, tableSearchStart);
    const ROW_BREAK_END = findRideCoRowIndex(lines, ['Break 1 Window End Time', 'Break End'], 18, tableSearchStart);
    const ROW_BREAK_DURATION = findRideCoRowIndex(lines, ['Break 1 Duration (min)', 'Break Duration'], 19, tableSearchStart);

    report.detectedRows = {
        shiftHeader: ROW_SHIFT_NUM >= 0 ? ROW_SHIFT_NUM + 1 : undefined,
        day: ROW_DAY >= 0 ? ROW_DAY + 1 : undefined,
        zone: ROW_ZONE >= 0 ? ROW_ZONE + 1 : undefined,
        shiftLabel: ROW_BUS_NUM >= 0 ? ROW_BUS_NUM + 1 : undefined,
        serviceStart: ROW_START >= 0 ? ROW_START + 1 : undefined,
        serviceEnd: ROW_END >= 0 ? ROW_END + 1 : undefined,
        breakStart: ROW_BREAK_START >= 0 ? ROW_BREAK_START + 1 : undefined,
        breakEnd: ROW_BREAK_END >= 0 ? ROW_BREAK_END + 1 : undefined,
        breakDuration: ROW_BREAK_DURATION >= 0 ? ROW_BREAK_DURATION + 1 : undefined,
    };

    if (ROW_SHIFT_NUM < 0 || !lines[ROW_SHIFT_NUM]) {
        report.missingRequiredRows.push('Shift header row');
    }
    if (ROW_START < 0 || !lines[ROW_START]) {
        report.missingRequiredRows.push('Service Start Time row');
    }
    if (ROW_END < 0 || !lines[ROW_END]) {
        report.missingRequiredRows.push('Service End Time row');
    }

    if (report.missingRequiredRows.length > 0) {
        report.warnings.push(`Missing required RideCo row(s): ${report.missingRequiredRows.join(', ')}.`);
        return { shifts, report };
    }

    const shiftNumRow = lines[ROW_SHIFT_NUM];
    const dayRow = lines[ROW_DAY] || [];
    const zoneRow = lines[ROW_ZONE] || [];
    const busNumRow = lines[ROW_BUS_NUM] || [];
    const startRow = lines[ROW_START];
    const endRow = lines[ROW_END];
    const breakStartRow = lines[ROW_BREAK_START] || [];
    const breakEndRow = lines[ROW_BREAK_END] || [];
    const breakDurationRow = lines[ROW_BREAK_DURATION] || [];

    let startColIndex = 2;
    const shift1Index = shiftNumRow.findIndex(cell => /^shift1$/i.test(normalizeHeaderCell(cell)));
    if (shift1Index !== -1) {
        startColIndex = shift1Index;
    }

    const numCols = Math.max(
        shiftNumRow.length,
        dayRow.length,
        zoneRow.length,
        busNumRow.length,
        startRow.length,
        endRow.length,
        breakStartRow.length,
        breakEndRow.length,
        breakDurationRow.length,
    );
    report.scannedColumnCount = Math.max(0, numCols - startColIndex);

    for (let c = startColIndex; c < numCols; c++) {
        const shiftHeader = cellToString(shiftNumRow[c]) || `Column ${excelColumnLabel(c)}`;
        const columnHasAnyShiftData = [
            shiftNumRow[c],
            dayRow[c],
            zoneRow[c],
            busNumRow[c],
            startRow[c],
            endRow[c],
            breakStartRow[c],
            breakEndRow[c],
            breakDurationRow[c],
        ].some(hasCellValue);

        if (!hasCellValue(startRow[c]) && !hasCellValue(endRow[c])) {
            if (columnHasAnyShiftData) {
                addRideCoSkippedColumn(report, c, shiftHeader, 'Missing service start and end time.');
            }
            continue;
        }

        if (!hasCellValue(startRow[c]) || !hasCellValue(endRow[c])) {
            addRideCoSkippedColumn(report, c, shiftHeader, 'Missing service start or end time.');
            continue;
        }

        const startSlot = parseTimeToSlot(startRow[c]);
        let endSlot = parseTimeToSlot(endRow[c]);
        if (!Number.isFinite(startSlot) || !Number.isFinite(endSlot)) {
            addRideCoSkippedColumn(report, c, shiftHeader, 'Invalid service start or end time.');
            continue;
        }

        if (endSlot < startSlot) endSlot += TIME_SLOTS_PER_DAY;

        const zoneRaw = cellToString(zoneRow[c]);
        let zone = Zone.FLOATER;
        if (zoneRaw.toLowerCase().includes('north')) zone = Zone.NORTH;
        else if (zoneRaw.toLowerCase().includes('south')) zone = Zone.SOUTH;

        const busNum = cellToString(busNumRow[c]) || `Shift ${c}`;
        let breakStartSlot = 0;
        let breakDurationSlots = 0;

        const breakStartValue = breakStartRow[c];
        const breakEndValue = breakEndRow[c];
        const breakStartStr = cellToString(breakStartValue);
        const breakEndStr = cellToString(breakEndValue);

        if (breakStartStr && breakEndStr &&
            !breakStartStr.match(/^n\/b$/i) &&
            !breakEndStr.match(/^n\/b$/i)) {
            const bStart = parseTimeToSlot(breakStartValue);
            let bEnd = parseTimeToSlot(breakEndValue);

            if (!Number.isFinite(bStart) || !Number.isFinite(bEnd)) {
                report.warnings.push(`${shiftHeader}: invalid break start or end time; imported without a break.`);
                breakDurationSlots = 0;
                breakStartSlot = startSlot;
            } else {
                if (bEnd < bStart) bEnd += TIME_SLOTS_PER_DAY;

                let finalBreakStart = bStart;
                if (finalBreakStart < startSlot) finalBreakStart += TIME_SLOTS_PER_DAY;

                breakStartSlot = finalBreakStart;

                const explicitDurationStr = cellToString(breakDurationRow[c]);
                if (explicitDurationStr) {
                    const minutes = parseFloat(explicitDurationStr);
                    if (!isNaN(minutes) && minutes > 0) {
                        breakDurationSlots = minutesToSlotsCeil(minutes);
                    } else {
                        breakDurationSlots = bEnd - bStart;
                    }
                } else {
                    breakDurationSlots = bEnd - bStart;
                }

                if (breakDurationSlots < 0) breakDurationSlots += TIME_SLOTS_PER_DAY;
                if (breakDurationSlots < 0 || breakDurationSlots > hoursToSlots(4)) {
                    report.warnings.push(`${shiftHeader}: invalid break duration; imported without a break.`);
                    breakDurationSlots = 0;
                    breakStartSlot = startSlot;
                }
            }
        } else if (
            (breakStartStr && !breakStartStr.match(/^n\/b$/i)) ||
            (breakEndStr && !breakEndStr.match(/^n\/b$/i))
        ) {
            report.warnings.push(`${shiftHeader}: partial break window; imported without a break.`);
            breakDurationSlots = 0;
            breakStartSlot = startSlot;
        } else {
            breakDurationSlots = 0;
            breakStartSlot = startSlot;
        }

        const dayRaw = cellToString(dayRow[c]).toLowerCase();
        let dayType: 'Weekday' | 'Saturday' | 'Sunday' = 'Weekday';
        if (dayRaw.includes('sat')) dayType = 'Saturday';
        else if (dayRaw.includes('sun')) dayType = 'Sunday';
        else if (dayRaw.includes('weekday')) dayType = 'Weekday';

        shifts.push({
            id: `imported-${c}-${Math.random().toString(36).substring(2, 7)}`,
            driverName: zoneRaw && !zoneRaw.includes('Floater') && !zoneRaw.includes('North') && !zoneRaw.includes('South') ? zoneRaw : busNum,
            zone,
            startSlot,
            endSlot,
            breakStartSlot,
            breakDurationSlots,
            dayType,
        });
    }

    applyRideCoShiftCounts(report, shifts);

    if (shifts.length === 0 && report.skippedColumns.length === 0) {
        report.warnings.push('No populated RideCo shift columns were found.');
    }

    return { shifts, report };
};

export const parseRideCoWithReport = (
    input: string | RowData[],
    options: { sourceName?: string; sheetName?: string } = {},
): RideCoParseResult => parseRideCoRowsWithReport(
    normalizeRideCoInput(input),
    options.sourceName,
    options.sheetName,
);

export const parseRideCo = (input: string | RowData[]): Shift[] => parseRideCoWithReport(input).shifts;

export const parseRideCoSheetsWithReport = (
    sheets: Array<RowData[] | { name?: string; rows: RowData[] }>,
    options: { sourceName?: string } = {},
): RideCoParseResult => {
    let bestResult: RideCoParseResult = {
        shifts: [],
        report: createEmptyRideCoReport(options.sourceName),
    };

    for (const sheet of sheets) {
        const sheetRows = Array.isArray(sheet) ? sheet : sheet.rows;
        const sheetName = Array.isArray(sheet) ? undefined : sheet.name;
        const parsed = parseRideCoRowsWithReport(sheetRows, options.sourceName, sheetName);
        if (parsed.shifts.length > bestResult.shifts.length) {
            bestResult = parsed;
        }
    }

    return bestResult;
};

export const parseRideCoSheets = (sheets: RowData[][]): Shift[] => {
    const bestResult = parseRideCoSheetsWithReport(sheets);
    return bestResult.shifts;
};
