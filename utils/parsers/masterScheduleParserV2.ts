/**
 * Master Schedule Parser V2
 * 
 * Parses Excel master schedule files with the following structure:
 * - Each sheet = one route
 * - "Stop Name" in Column A marks the header row for stop names
 * - "Stop ID" in Column A marks the header row for stop IDs
 * - Trip data follows until next "Stop Name" or end of data
 * - Day type (Weekday/Saturday/Sunday) spelled vertically in Column A
 * - "R" columns = Recovery time (minutes)
 * - Trips can have empty cells (partial trips that don't serve all stops)
 */

import * as XLSX from 'xlsx';
import { validateDirection, type Direction } from '../config/routeDirectionConfig';

// --- Types ---

export interface StopInfo {
    name: string;
    id: string;
    columnIndex: number;
    isRecovery: boolean;  // True if this is an "R" (recovery) column
    departureColumnIndex?: number;  // If this stop has ARR→R→DEP pattern, this is the DEP column
}

export interface ParsedTrip {
    rowIndex: number;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    timeBand: string;  // Morning, Midday, Evening, Peak, Night
    times: Record<string, string>;  // Stop name -> time string
    timesMinutes?: Record<string, number>;  // Stop name -> minutes (supports >1440)
    recoveryTimes: Record<string, number>;  // Recovery column index -> minutes
    startTime: number | null;  // Minutes from midnight
    endTime: number | null;    // Minutes from midnight
    travelTime: number;        // Minutes
    direction?: Direction | 'Loop' | null;  // North, South, Loop, or null if unknown
}

export interface ParsedSection {
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    stops: StopInfo[];
    trips: ParsedTrip[];
    direction?: Direction | 'Loop' | null;  // Section-level direction
}

export interface ParsedRoute {
    routeName: string;       // Sheet name (e.g., "400", "7", "101")
    sections: ParsedSection[];
}

export interface ParseResult {
    routes: ParsedRoute[];
    errors: string[];
    warnings: string[];
}

// --- Time Utilities ---

export const parseTimeToMinutes = (value: any): number | null => {
    if (value === null || value === undefined || value === '') return null;

    // Excel stores times as decimal fractions of a day:
    // - 0.5 = 12:00 PM (noon)
    // - 0.99 = 11:45 PM
    // - 1.02 = 12:30 AM next day (the "1" = next day, 0.02 = 30 min)
    //
    // CRITICAL FIX: Values >= 1.0 must preserve the day offset.
    // Example: 1.02 (12:30 AM next day) becomes 1470 minutes.
    if (typeof value === 'number') {
        // Small integers (< 100) are likely block IDs, stop IDs, recovery minutes - NOT times
        if (Number.isInteger(value) && value < 100) {
            return null;
        }

        // Values >= 1.0 are dates with time - preserve day offset
        if (value >= 1) {
            const wholeDays = Math.floor(value);
            const timePortion = value % 1;
            // Reject very small fractions - likely residual data, not real times
            // 0.004 = ~6 minutes, so times before 12:06 AM from numeric sources are rejected
            // Legitimate early AM times like 12:07 AM (0.00486) will still pass
            if (timePortion < 0.004) return null;
            return (wholeDays * 24 * 60) + Math.round(timePortion * 24 * 60);
        }

        // Values < 1.0 are pure time fractions (0.5 = noon, 0.02 = 12:30 AM)
        // Reject very small values (< 0.004 = ~6 minutes) as these are likely residual data
        // Transit schedules rarely have times at 12:01 AM, 12:02 AM etc.
        if (value > 0 && value < 0.004) return null;

        return Math.round(value * 24 * 60);
    }

    let str = String(value).trim().toLowerCase();

    // Skip obviously non-time values
    if (str.length === 0) return null;
    if (str.includes('stop') || str.includes('route') || str.includes('depart') || str.includes('arrive')) return null;

    // Sanitize string: remove anything that isn't a digit, colon, space, or a/p/m
    // This handles hidden characters, non-breaking spaces, etc.
    str = str.replace(/[^0-9:amp\s]/g, '');

    // Handle "HH:MM AM/PM" format (allow 'a' or 'p' shorthand)
    const timeMatch = str.match(/(\d{1,2}):(\d{2})\s*(a|p|am|pm)?/i);
    if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const periodChar = timeMatch[3]?.toLowerCase()[0]; // 'a' or 'p'

        if (periodChar === 'p' && hours !== 12) hours += 12;
        if (periodChar === 'a' && hours === 12) hours = 0;

        return hours * 60 + minutes;
    }

    // NOTE: Plain numbers (like "8") should NOT be treated as times here.
    // They could be block IDs, stop IDs, or other data.
    // Recovery times are handled separately in parseTripRow with isRecovery check.
    // Only strings with ":" or "am/pm" should be parsed as times.

    return null;
};

const formatMinutesToTime = (minutes: number): string => {
    // Normalize hours to 0-23 range (handles times past midnight like 25:00 → 1:00)
    let h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    h = ((h % 24) + 24) % 24;

    const period = h >= 12 ? 'PM' : 'AM';

    if (h > 12) h -= 12;
    if (h === 0) h = 12;

    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
};

const applyDayOffset = (
    rawMinutes: number,
    lastAdjusted: number | null,
    offset: number
): { adjusted: number; offset: number } => {
    let adjusted = rawMinutes;
    let nextOffset = offset;

    if (rawMinutes >= 1440) {
        adjusted = rawMinutes;
        nextOffset = Math.floor(rawMinutes / 1440) * 1440;
    } else {
        if (lastAdjusted !== null && rawMinutes + nextOffset < lastAdjusted - 60) {
            nextOffset += 1440;
        }
        adjusted = rawMinutes + nextOffset;
    }

    return { adjusted, offset: nextOffset };
};

const MIDNIGHT_ROLLOVER_THRESHOLD = 210; // 3:30 AM

// --- Day Type Detection ---

const parseDayTypeFromCell = (cellValue: string): 'Weekday' | 'Saturday' | 'Sunday' => {
    const val = cellValue.trim().toLowerCase();

    // Check for full words
    if (val.includes('sunday')) return 'Sunday';
    if (val.includes('saturday')) return 'Saturday';
    if (val.includes('weekday')) return 'Weekday';

    // Check for first letter patterns
    if (val.startsWith('su')) return 'Sunday';
    if (val.startsWith('sa')) return 'Saturday';
    if (val.startsWith('w')) return 'Weekday';

    // Default
    return 'Weekday';
};

// --- Core Parser ---

export const parseMasterScheduleV2 = (fileData: ArrayBuffer): ParseResult => {
    const result: ParseResult = {
        routes: [],
        errors: [],
        warnings: []
    };

    try {
        const workbook = XLSX.read(fileData, { type: 'array' });

        // Detect if this is an export format file
        // Export format has "ROUTE X - DAYTYPE" in cell A1 of sheets
        const isExportFormat = detectExportFormat(workbook);

        if (isExportFormat) {
            return parseExportFormatWorkbook(workbook);
        }

        // Original format parsing continues below
        for (const sheetName of workbook.SheetNames) {
            // Skip sheets that don't look like route names
            // Route sheets are typically numeric or alphanumeric (400, 7A, 101, etc.)
            const isRouteSheet = /^[\dA-Za-z]+$/.test(sheetName.trim()) &&
                !sheetName.toLowerCase().includes('summary') &&
                !sheetName.toLowerCase().includes('template');

            if (!isRouteSheet) {
                result.warnings.push(`Skipping sheet "${sheetName}" - doesn't appear to be a route`);
                continue;
            }

            try {
                const route = parseSheet(workbook.Sheets[sheetName], sheetName);

                // CORRECTION: If route has multiple sections all labeled "Weekday" (or duplicates), 
                // enforce Weekday -> Saturday -> Sunday order.
                if (route.sections.length > 1) {
                    if (activeSectionsAreDistinctDays(route.sections)) {
                        const order = ['Weekday', 'Saturday', 'Sunday'];
                        route.sections.forEach((sec, idx) => {
                            if (idx < 3) sec.dayType = order[idx] as any;
                        });
                    }
                }

                if (route.sections.length > 0) {
                    result.routes.push(route);
                } else {
                    result.warnings.push(`Sheet "${sheetName}" had no valid sections`);
                }
            } catch (err) {
                result.errors.push(`Error parsing sheet "${sheetName}": ${err}`);
            }
        }
    } catch (err) {
        result.errors.push(`Failed to read Excel file: ${err}`);
    }

    return result;
};

const parseSheet = (sheet: XLSX.WorkSheet, sheetName: string): ParsedRoute => {
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const route: ParsedRoute = {
        routeName: sheetName,
        sections: []
    };

    let currentSection: ParsedSection | null = null;
    let currentStops: StopInfo[] = [];
    let sectionCounter = 0;  // Track section number: 0=Weekday, 1=Saturday, 2=Sunday

    // Day type mapping based on section order
    const dayTypeByOrder: ('Weekday' | 'Saturday' | 'Sunday')[] = ['Weekday', 'Saturday', 'Sunday'];

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
        const row = data[rowIdx];
        const colA = String(row[0] || '').trim();
        const colALower = colA.toLowerCase();
        const colB = String(row[1] || '').trim().toLowerCase();

        // Check for section headers (fuzzy match)
        if (/stop\s*name/i.test(colALower) || /stop\s*name/i.test(colB)) {
            // If we have a previous section, finalize it
            if (currentSection && currentSection.trips.length > 0) {
                route.sections.push(currentSection);
            }

            // Parse stop names from this row
            currentStops = parseStopNamesRow(row);

            continue;
        }

        if (/stop\s*id/i.test(colALower) || /stop\s*id/i.test(colB)) {
            // Parse stop IDs and merge with stop names
            parseStopIdsRow(row, currentStops);

            // Determine day type by peeking at the next few rows
            // default to section order if not found
            let dayType: 'Weekday' | 'Saturday' | 'Sunday' = dayTypeByOrder[Math.min(sectionCounter, 2)];

            // Peek at next 5 rows to find a day type string "Weekday", "Saturday", "Sunday"
            for (let peekIdx = rowIdx + 1; peekIdx < Math.min(rowIdx + 6, data.length); peekIdx++) {
                const peekRow = data[peekIdx];
                const cell = String(peekRow[0] || '').trim();
                const detected = parseDayTypeFromCell(cell);
                if (detected) {
                    dayType = detected;
                    break;
                }
            }

            sectionCounter++; // Still increment, but we might overwrite later logic if we find duplicates

            // Start new section
            currentSection = {
                dayType,
                stops: [...currentStops],
                trips: []
            };

            continue;
        }

        // If we don't have a current section, skip
        if (!currentSection) continue;

        // Check if this looks like a data row (has time values)
        // Robustness: ensure we check actual columns mapped to stops
        let validTimeCount = 0;

        // Check only non-recovery columns for time data
        // Recovery columns have small values (5, 10, 15) that could be confused with early AM times
        // For actual stop times, we accept any valid time >= 0 (including 12:00 AM - 1:00 AM)
        const hasTimeData = currentStops.some(stop => {
            if (stop.isRecovery) return false; // Skip recovery columns for this check
            const cell = row[stop.columnIndex];
            const time = parseTimeToMinutes(cell);
            return time !== null && time >= 0;
        });

        // Fallback: Check raw row if stops aren't reliable? 
        // No, using currentStops is safer.

        if (hasTimeData) {
            // Parse as trip row
            const trip = parseTripRow(row, currentStops, rowIdx);
            if (trip) {
                currentSection.trips.push(trip);
            } else {
                console.warn(`  Row ${rowIdx} skipped: hasTimeData=true but parseTripRow failed.`);
            }
        } else {
            // Debug logging for rows that "look" like data but failed
            // Only log if it has SOME text content to avoid empty row noise
            const hasText = row.some((c: any) => c && String(c).trim().length > 0);
            if (hasText) {
                // console.log(`  Row ${rowIdx} skipped: No valid times found. First cell: ${colA}`);
            }
        }
    }

    // Finalize last section
    if (currentSection && currentSection.trips.length > 0) {
        route.sections.push(currentSection);
    }

    return route;
};

const parseStopNamesRow = (row: any[], debugDayType?: string): StopInfo[] => {
    const stops: StopInfo[] = [];

    for (let i = 2; i < row.length; i++) {  // Start from column C (index 2)
        const value = String(row[i] || '').trim();

        // Check for "Sandwiched" empty column: StopX -> [Empty] -> StopX => Recovery
        // This handles cases where the "R" header is missing but the column exists between Arrive/Depart
        let isInferredRecovery = false;
        if (!value) {
            const prev = String(row[i - 1] || '').trim();
            const next = String(row[i + 1] || '').trim();
            if (prev && next && prev === next) {
                isInferredRecovery = true;
            }
        }

        if (!value && !isInferredRecovery) continue;

        // Skip summary columns
        if (value.toLowerCase().includes('travel') ||
            value.toLowerCase().includes('cycle') ||
            value.toLowerCase().includes('frequency') ||
            value.toLowerCase().includes('ratio') ||
            value.toLowerCase().includes('connection') ||
            value.toLowerCase().includes('priorities')) {
            break;  // Stop parsing when we hit summary columns
        }

        const isRecovery = isInferredRecovery ||
            value.toUpperCase() === 'R' ||
            value.toLowerCase() === 'recovery' ||
            value.toLowerCase() === 'layover';

        // If inferred, force name to "R" for consistency
        let name = value;
        if (isRecovery && stops.length > 0) {
            name = stops[stops.length - 1].name;
        } else if (isInferredRecovery) {
            name = 'R';
        }

        // FIX: Detect ARR → R → DEP pattern for the same stop
        // If this is a non-recovery column with the same name as a recent stop
        // that was followed by a recovery column, it's the DEP column - not a new stop
        if (!isRecovery && stops.length >= 2) {
            const prevStop = stops[stops.length - 1];
            const prevPrevStop = stops[stops.length - 2];
            // Pattern: STOP(ARR) → R → STOP(DEP) with same name
            // Use case-insensitive comparison to handle Excel inconsistencies
            if (prevStop.isRecovery && !prevPrevStop.isRecovery &&
                prevPrevStop.name.toLowerCase() === name.toLowerCase()) {
                // This is the DEP column for the same stop - store its index on the ARR stop
                prevPrevStop.departureColumnIndex = i;
                continue; // Don't add as a separate stop
            }
        }

        stops.push({
            name,
            id: '',
            columnIndex: i,
            isRecovery
        });
    }

    // Handle duplicates by appending suffix (2), (3) etc.
    // This handles legitimate cases like loop routes that pass through the same stop twice
    // The ARR→R→DEP pattern for the same stop is already handled above
    const nameCounts: Record<string, number> = {};
    for (const stop of stops) {
        const baseName = stop.name;
        if (nameCounts[baseName]) {
            nameCounts[baseName]++;
            stop.name = `${baseName} (${nameCounts[baseName]})`;
        } else {
            nameCounts[baseName] = 1;
        }
    }

    return stops;
};

const parseStopIdsRow = (row: any[], stops: StopInfo[]): void => {
    for (const stop of stops) {
        const value = String(row[stop.columnIndex] || '').trim();
        if (value && !stop.isRecovery) {
            stop.id = value;
        }
    }
};

const parseTripRow = (row: any[], stops: StopInfo[], rowIdx: number): ParsedTrip | null => {
    const times: Record<string, string> = {};
    const timesMinutes: Record<string, number> = {};
    const recoveryTimes: Record<string, number> = {};
    let startTime: number | null = null;
    let endTime: number | null = null;
    let offset = 0;
    let lastAdjusted: number | null = null;

    for (const stop of stops) {
        const cellValue = row[stop.columnIndex];
        if (stop.isRecovery) {
            // Recovery column - handle specifically as integer minutes
            let recMin: number | null = null;

            if (typeof cellValue === 'number') {
                recMin = Math.round(cellValue); // Round to nearest integer (fixes 0.9999 -> 1)
            } else if (cellValue) {
                // Try parsing string "3" or "3 min"
                const str = String(cellValue).replace(/[^0-9.]/g, ''); // Allow decimal point
                const parsed = parseFloat(str);
                if (!isNaN(parsed)) recMin = Math.round(parsed);
            }

            if (recMin !== null && recMin < 60) {
                recoveryTimes[stop.name] = recMin;
            }

        } else {
            // Regular time column
            // If this stop has a departureColumnIndex (ARR→R→DEP pattern), use DEP column
            // Otherwise use the stop's main column
            const timeColumnIndex = stop.departureColumnIndex ?? stop.columnIndex;
            const timeValue = row[timeColumnIndex];
            const minutes = parseTimeToMinutes(timeValue);

            // Reject very small minute values (0-59) as stop times UNLESS:
            // 1. The cell was a decimal Excel time (includes post-midnight times >= 1.0)
            // 2. The cell contained AM/PM text indicating it's an actual time
            // 3. The cell is in HH:MM format with colon (e.g., "0:23" for 12:23 AM)
            // Integer values like 1, 2, 3 in stop columns are likely priority/sequence numbers
            // CRITICAL: Post-midnight times are >= 1.0 (e.g., 1.02 = 12:30 AM) - must include these!
            const isExcelTime = typeof timeValue === 'number' && timeValue >= 0 && !Number.isInteger(timeValue);
            const hasAmPmIndicator = typeof timeValue === 'string' && /[ap]m?/i.test(timeValue);
            const hasTimeFormat = typeof timeValue === 'string' && /\d{1,2}:\d{2}/.test(timeValue);
            const isValidStopTime = minutes !== null && (minutes >= 60 || isExcelTime || hasAmPmIndicator || hasTimeFormat);

            if (isValidStopTime) {
                const adjustedInfo = applyDayOffset(minutes, lastAdjusted, offset);
                const adjusted = adjustedInfo.adjusted;
                offset = adjustedInfo.offset;
                lastAdjusted = adjusted;

                times[stop.name] = formatMinutesToTime(adjusted);
                timesMinutes[stop.name] = adjusted;

                if (startTime === null) startTime = adjusted;
                endTime = adjusted;
            }
        }
    }

    // Skip rows with no valid times or insufficient data (need at least 2 points for a trip)
    if (Object.keys(times).length < 2) return null;

    const timeBand = String(row[1] || '').trim();

    if (startTime !== null && endTime !== null
        && startTime < MIDNIGHT_ROLLOVER_THRESHOLD
        && !Object.values(timesMinutes).some(v => v >= 1440)
    ) {
        startTime += 1440;
        endTime += 1440;
        for (const key of Object.keys(timesMinutes)) {
            timesMinutes[key] += 1440;
        }
    }

    const travelTime = (startTime !== null && endTime !== null) ? (endTime - startTime) : 0;

    return {
        rowIndex: rowIdx,
        dayType: 'Weekday',  // Will be set by section
        timeBand,
        times,
        timesMinutes,
        recoveryTimes,
        startTime,
        endTime,
        travelTime
    };
};

// --- Debug Helper ---

export const debugParseMasterSchedule = (fileData: ArrayBuffer): void => {
    const result = parseMasterScheduleV2(fileData);

    console.log('\n=== PARSE RESULT ===\n');
    console.log(`Routes found: ${result.routes.length}`);
    console.log(`Errors: ${result.errors.length}`);
    console.log(`Warnings: ${result.warnings.length}`);

    for (const route of result.routes) {
        console.log(`\n--- Route: ${route.routeName} ---`);
        console.log(`  Sections: ${route.sections.length}`);

        for (const section of route.sections) {
            console.log(`\n  [${section.dayType}]`);
            console.log(`    Stops: ${section.stops.filter(s => !s.isRecovery).map(s => s.name).join(' → ')}`);
            console.log(`    Trips: ${section.trips.length}`);

            if (section.trips.length > 0) {
                const first = section.trips[0];
                const last = section.trips[section.trips.length - 1];
                console.log(`    First trip: ${first.startTime ? formatMinutesToTime(first.startTime) : 'N/A'}`);
                console.log(`    Last trip: ${last.startTime ? formatMinutesToTime(last.startTime) : 'N/A'}`);
            }
        }
    }

    if (result.errors.length > 0) {
        console.log('\n=== ERRORS ===');
        result.errors.forEach(e => console.log(`  ❌ ${e}`));
    }

    if (result.warnings.length > 0) {
        console.log('\n=== WARNINGS ===');
        result.warnings.forEach(w => console.log(`  ⚠️ ${w}`));
    }
};

const activeSectionsAreDistinctDays = (sections: any[]): boolean => {
    // If we have 3 sections, almost certainly W/S/S
    if (sections.length === 3) return true;

    // If we have 2 sections... could be N/S or W/Sat.
    if (sections.length === 2) {
        // Simple Jaccard
        const s1 = sections[0];
        const s2 = sections[1];
        const names1 = s1.stops.map((s: any) => s.name);
        const names2 = s2.stops.map((s: any) => s.name);
        const stops1 = new Set(names1);
        const stops2 = new Set(names2);
        const intersection = s1.stops.filter((s: any) => stops2.has(s.name)).length;
        const union = new Set([...stops1, ...stops2]).size;
        const similarity = union === 0 ? 0 : intersection / union;

        // If similarity is LOW (< 0.5), they are likely different routes/days (e.g. Loop W vs Loop Sat)
        if (similarity < 0.5) return true;

        // If similarity is HIGH (> 0.8), usually N/S of same day.
        // UNLESS the stops are in the EXACT SAME order (e.g. Route 400 W vs Route 400 Sat)
        // Check for identical order
        if (similarity > 0.8) {
            // Compare stringified arrays for quick "exact order" check
            // Normalize by removing (2), (3) etc suffixes just in case, but usually strict match is fine
            if (JSON.stringify(names1) === JSON.stringify(names2)) {
                return true; // DISTINCT days (W, Sat) because they are identical loops
            }
        }

        return false;
    }

    return false;
};

// --- Export Format Parser ---

/**
 * Detect if workbook is in export format (vs original master schedule format)
 * Export format has "ROUTE X - DAYTYPE" in cell A1
 */
const detectExportFormat = (workbook: XLSX.WorkBook): boolean => {
    console.log('[ExportDetect] Checking format, sheets:', workbook.SheetNames);
    if (workbook.SheetNames.length === 0) return false;

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

    console.log('[ExportDetect] First sheet data rows:', data.length);
    if (data.length === 0 || !data[0] || !data[0][0]) {
        console.log('[ExportDetect] No data in first cell');
        return false;
    }

    const firstCell = String(data[0][0]).trim().toUpperCase();
    console.log('[ExportDetect] First cell:', firstCell);
    const isExport = firstCell.startsWith('ROUTE ') && firstCell.includes(' - ');
    console.log('[ExportDetect] Is export format:', isExport);
    return isExport;
};

/**
 * Parse export format workbook
 * Structure per sheet:
 * - Row 1: "ROUTE X - DAYTYPE SCHEDULE"
 * - Row 2: Summary stats (SERVICE WINDOW, BLOCKS, etc.)
 * - Row 3: Direction row ("Direction" | dir1 | dir2 | ...)
 * - Row 4: Stop names (Block | Time Band | Stop1 | Stop2 | ... | Travel | Recovery | Cycle | Ratio)
 * - Row 5: ARR/DEP subheaders
 * - Row 6+: Trip data
 */
const parseExportFormatWorkbook = (workbook: XLSX.WorkBook): ParseResult => {
    const result: ParseResult = {
        routes: [],
        errors: [],
        warnings: []
    };

    console.log('[ExportParser] Starting export format parsing, sheets:', workbook.SheetNames);

    for (const sheetName of workbook.SheetNames) {
        // Skip summary sheets
        if (sheetName.toLowerCase().includes('summary')) {
            console.log('[ExportParser] Skipping summary sheet:', sheetName);
            continue;
        }

        try {
            const sheet = workbook.Sheets[sheetName];
            const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

            if (data.length < 6) {
                result.warnings.push(`Sheet "${sheetName}" has insufficient rows for export format`);
                continue;
            }

            // Row 1: Parse route name and day type from "ROUTE X - DAYTYPE SCHEDULE"
            const titleRow = String(data[0][0] || '').trim();
            console.log('[ExportParser] Sheet:', sheetName, 'Row 1:', titleRow);
            const titleMatch = titleRow.match(/ROUTE\s+(\S+)\s*-\s*(WEEKDAY|SATURDAY|SUNDAY)/i);
            if (!titleMatch) {
                console.log('[ExportParser] Title regex failed for:', titleRow);
                result.warnings.push(`Sheet "${sheetName}" Row 1 doesn't match expected format: "${titleRow}"`);
                continue;
            }
            const routeName = titleMatch[1];
            const dayType = titleMatch[2].charAt(0).toUpperCase() + titleMatch[2].slice(1).toLowerCase() as 'Weekday' | 'Saturday' | 'Sunday';
            console.log('[ExportParser] Parsed route:', routeName, 'dayType:', dayType);

            // Row 7 (data[6]): Direction row - each stop has its own direction
            const directionRow = data[6] || [];
            // Build map of column index -> direction (using routeDirectionConfig)
            const columnDirections: Record<number, Direction | 'Loop'> = {};
            for (let i = 0; i < directionRow.length; i++) {
                const val = String(directionRow[i] || '').trim();
                if (val && val.toLowerCase() !== 'direction') {
                    // Use validateDirection for North/South detection
                    const validatedDir = validateDirection(val);
                    if (validatedDir) {
                        columnDirections[i] = validatedDir;
                    } else if (val.toLowerCase().includes('clock')) {
                        columnDirections[i] = 'Loop';
                    }
                    // Ignore unrecognized direction values
                }
            }

            // Determine the dominant direction for this section
            const directionCounts = { North: 0, South: 0, Loop: 0 };
            Object.values(columnDirections).forEach(d => {
                if (d in directionCounts) directionCounts[d as keyof typeof directionCounts]++;
            });
            const sectionDirection: Direction | 'Loop' | null =
                directionCounts.North > directionCounts.South ? 'North' :
                directionCounts.South > directionCounts.North ? 'South' :
                directionCounts.Loop > 0 ? 'Loop' : null;

            console.log('[ExportParser] Direction row sample:', directionRow.slice(0, 5), '-> dominant:', sectionDirection);

            // Row 8 (data[7]): Stop names
            const stopRow = data[7] || [];
            const stops: (StopInfo & { direction?: string })[] = [];
            const summaryColumns = ['travel', 'recovery', 'cycle', 'ratio'];
            const skipColumns = ['block', 'time band', 'timeband'];

            for (let i = 0; i < stopRow.length; i++) {
                let stopName = String(stopRow[i] || '').trim();
                if (!stopName) continue;

                const lowerName = stopName.toLowerCase();

                // Skip Block, Time Band, and summary columns
                if (skipColumns.includes(lowerName) || summaryColumns.includes(lowerName)) {
                    continue;
                }

                // Skip R (recovery) columns
                if (stopName === 'R' || lowerName === 'r') {
                    stops.push({
                        name: `R_${i}`,
                        id: '',
                        columnIndex: i,
                        isRecovery: true,
                        direction: columnDirections[i]
                    });
                    continue;
                }

                // Remove (2), (3) suffixes from stop names
                stopName = stopName.replace(/\s*\(\d+\)$/, '').trim();

                stops.push({
                    name: stopName,
                    id: '',
                    columnIndex: i,
                    isRecovery: false,
                    direction: columnDirections[i]
                });
            }

            console.log('[ExportParser] Stops found:', stops.length, stops.filter(s => !s.isRecovery).map(s => s.name));

            // Row 9 (data[8]): Check for ARR/DEP subheaders OR first data row
            const potentialSubheaderRow = data[8] || [];
            const hasSubheaders = potentialSubheaderRow.some((cell: any) => {
                const val = String(cell || '').trim().toUpperCase();
                return val === 'ARR' || val === 'DEP';
            });
            // If subheaders present, data starts at row 10 (data[9]), otherwise row 9 (data[8])
            const dataStartRow = hasSubheaders ? 9 : 8;
            console.log('[ExportParser] hasSubheaders:', hasSubheaders, 'dataStartRow:', dataStartRow, 'row sample:', potentialSubheaderRow.slice(0, 5));

            // Parse trip data
            const trips: ParsedTrip[] = [];
            for (let rowIdx = dataStartRow; rowIdx < data.length; rowIdx++) {
                const row = data[rowIdx];
                if (!row || row.length === 0) continue;

                // Skip empty rows or rows without a block ID
                const blockId = String(row[0] || '').trim();
                if (!blockId || blockId.toLowerCase() === 'block') continue;

                // Get time band (column 1)
                const timeBand = String(row[1] || '').trim();

                // Parse times for each stop
                const times: Record<string, string> = {};
                const recoveryTimes: Record<string, number> = {};
                let firstTime: number | null = null;
                let lastTime: number | null = null;
                let lastStopName: string | null = null;

                for (const stop of stops) {
                    const cellValue = row[stop.columnIndex];

                    if (stop.isRecovery) {
                        // Recovery column - parse as minutes
                        const recVal = parseInt(String(cellValue || '0'), 10);
                        if (!isNaN(recVal) && lastStopName) {
                            recoveryTimes[lastStopName] = recVal;
                        }
                    } else {
                        // Time column
                        const timeStr = String(cellValue || '').trim();
                        if (timeStr) {
                            times[stop.name] = timeStr;
                            const mins = parseTimeToMinutes(cellValue);
                            if (mins !== null) {
                                if (firstTime === null) firstTime = mins;
                                lastTime = mins;
                            }
                        }
                        lastStopName = stop.name;
                    }
                }

                // Skip rows with no times
                if (Object.keys(times).length === 0) continue;

                const travelTime = (firstTime !== null && lastTime !== null) ? lastTime - firstTime : 0;

                trips.push({
                    rowIndex: rowIdx,
                    dayType,
                    timeBand: timeBand || 'Unknown',
                    times,
                    recoveryTimes,
                    startTime: firstTime,
                    endTime: lastTime,
                    travelTime: travelTime > 0 ? travelTime : 0
                });
            }

            // Build route name with direction
            let fullRouteName = routeName;
            if (sectionDirection === 'North' || sectionDirection === 'South') {
                fullRouteName = `${routeName} (${sectionDirection})`;
            }

            // Create section
            const section: ParsedSection = {
                dayType,
                stops: stops.filter(s => !s.isRecovery),
                trips
            };

            // Find or create route
            let existingRoute = result.routes.find(r => r.routeName === routeName);
            if (!existingRoute) {
                existingRoute = {
                    routeName,
                    sections: []
                };
                result.routes.push(existingRoute);
            }

            // Set direction on section and trips (typed, no more any cast)
            section.direction = sectionDirection;
            section.trips.forEach(t => {
                t.direction = sectionDirection;
            });

            existingRoute.sections.push(section);
            console.log('[ExportParser] Added section with', trips.length, 'trips to route', routeName);

        } catch (err) {
            console.error('[ExportParser] Error parsing sheet:', sheetName, err);
            result.errors.push(`Error parsing export sheet "${sheetName}": ${err}`);
        }
    }

    console.log('[ExportParser] Final result:', result.routes.length, 'routes,', result.routes.map(r => `${r.routeName}(${r.sections.length} sections)`));
    return result;
};
