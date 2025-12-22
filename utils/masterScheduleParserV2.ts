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

// --- Types ---

export interface StopInfo {
    name: string;
    id: string;
    columnIndex: number;
    isRecovery: boolean;  // True if this is an "R" (recovery) column
}

export interface ParsedTrip {
    rowIndex: number;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    timeBand: string;  // Morning, Midday, Evening, Peak, Night
    times: Record<string, string>;  // Stop name -> time string
    recoveryTimes: Record<string, number>;  // Recovery column index -> minutes
    startTime: number | null;  // Minutes from midnight
    endTime: number | null;    // Minutes from midnight
    travelTime: number;        // Minutes
}

export interface ParsedSection {
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    stops: StopInfo[];
    trips: ParsedTrip[];
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

    // Excel stores times as decimal fractions (0.5 = 12:00 PM)
    if (typeof value === 'number') {
        // If > 1, it might be a date+time serial. Extract just the time portion.
        const timePortion = value > 1 ? value % 1 : value;
        return Math.round(timePortion * 24 * 60);
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

    // Handle plain number (recovery time in minutes)
    const num = parseInt(str);
    if (!isNaN(num) && num >= 0 && num < 60) {
        return num;  // Likely a recovery time
    }

    return null;
};

const formatMinutesToTime = (minutes: number): string => {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 && h < 24 ? 'PM' : 'AM';

    if (h > 12) h -= 12;
    if (h === 0) h = 12;

    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
};

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

        // Check only columns that map to stops to avoid noise
        const hasTimeData = currentStops.some(stop => {
            const cell = row[stop.columnIndex];
            const time = parseTimeToMinutes(cell);
            return time !== null && time > 60; // Valid time > 1:00 AM
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

const parseStopNamesRow = (row: any[]): StopInfo[] => {
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

        stops.push({
            name,
            id: '',
            columnIndex: i,
            isRecovery
        });
    }

    // Handle duplicates by appending suffix (2), (3) etc.
    const nameCounts: Record<string, number> = {};
    for (const stop of stops) {
        // Do NOT rename Recovery columns.
        if (stop.isRecovery) continue;

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
    const recoveryTimes: Record<string, number> = {};
    let startTime: number | null = null;
    let endTime: number | null = null;

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
            const minutes = parseTimeToMinutes(cellValue);

            // Reject very small minute values (0-59) as stop times UNLESS:
            // 1. The cell was a decimal Excel time (0.xxx format)
            // 2. The cell contained AM/PM text indicating it's an actual time
            // Integer values like 1, 2, 3 in stop columns are likely priority/sequence numbers
            const isExcelTime = typeof cellValue === 'number' && cellValue > 0 && cellValue < 1;
            const hasAmPmIndicator = typeof cellValue === 'string' && /[ap]m?/i.test(cellValue);
            const isValidStopTime = minutes !== null && (minutes >= 60 || isExcelTime || hasAmPmIndicator);

            if (isValidStopTime) {
                times[stop.name] = formatMinutesToTime(minutes);

                if (startTime === null) startTime = minutes;
                endTime = minutes;
            }
        }
    }

    // Skip rows with no valid times or insufficient data (need at least 2 points for a trip)
    if (Object.keys(times).length < 2) return null;

    const timeBand = String(row[1] || '').trim();
    const travelTime = (startTime !== null && endTime !== null) ? (endTime - startTime) : 0;

    return {
        rowIndex: rowIdx,
        dayType: 'Weekday',  // Will be set by section
        timeBand,
        times,
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
