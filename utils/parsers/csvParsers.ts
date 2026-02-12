import { Shift, Requirement, Zone } from '../demandTypes';
import { TIME_SLOTS_PER_DAY } from '../demandConstants';

// Helper to parse time "HH:MM" or "HH:MM AM/PM" to slot index (0-95)
const parseTimeToSlot = (timeStr: string): number => {
    if (!timeStr) return 0;

    // Normalize
    const cleanTime = timeStr.trim().toLowerCase();

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

    // Calculate slot
    // Slot 0 = 00:00
    // Slot 1 = 00:15
    return Math.floor((hours * 60 + minutes) / 15);
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
                        requirements[slot][zone]++;
                        requirements[slot].total++;
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

// Helper to safely convert cell value to string
const cellToString = (cell: CellValue): string => {
    if (cell === null || cell === undefined) return '';
    return String(cell).trim();
};

export const parseRideCo = (input: string | RowData[]): Shift[] => {
    let lines: RowData[];

    if (typeof input === 'string') {
        lines = input.split(/\r?\n/).map(l => l.split(','));
    } else {
        lines = input;
    }

    const shifts: Shift[] = [];

    // User specified fixed row structure (0-indexed):
    // Row 10 (Index 9): Shift Number (Header)
    // Row 11 (Index 10): Weekday
    // Row 14 (Index 13): Zone Area (Driver/Zone)
    // Row 15 (Index 14): Bus Number (Shift Label)
    // Row 16 (Index 15): Service Start Time
    // Row 17 (Index 16): Service End Time
    // Row 18 (Index 17): Break Start Time
    // Row 19 (Index 18): Break End Time

    const ROW_SHIFT_NUM = 9;
    const ROW_DAY = 10;
    const ROW_ZONE = 13;
    const ROW_BUS_NUM = 14;
    const ROW_START = 15;
    const ROW_END = 16;
    const ROW_BREAK_START = 17;
    const ROW_BREAK_END = 18;
    const ROW_BREAK_DURATION = 19;

    if (lines.length <= ROW_BREAK_END) {
        console.error("RideCo file is too short");
        return [];
    }

    const shiftNumRow = lines[ROW_SHIFT_NUM];
    const dayRow = lines[ROW_DAY];
    const zoneRow = lines[ROW_ZONE];
    const busNumRow = lines[ROW_BUS_NUM];
    const startRow = lines[ROW_START];
    const endRow = lines[ROW_END];
    const breakStartRow = lines[ROW_BREAK_START];
    const breakEndRow = lines[ROW_BREAK_END];
    const breakDurationRow = lines[ROW_BREAK_DURATION];

    // Determine start column. Look for "Shift1" or "Shift 1" in Row 10 (Index 9)
    // Or just assume it starts at column 2 (Index 2) as per previous observation,
    // but let's try to find "Shift1" to be safe, or default to 2.
    let startColIndex = 2;
    const shift1Index = shiftNumRow.findIndex(cell => cellToString(cell).toLowerCase().replace(/\s/g, '') === 'shift1');
    if (shift1Index !== -1) {
        startColIndex = shift1Index;
    }

    const numCols = shiftNumRow.length;

    for (let c = startColIndex; c < numCols; c++) {
        // Basic validation: must have a start and end time
        if (!startRow[c] || !endRow[c]) continue;

        // Parse Zone from Row 14
        const zoneRaw = cellToString(zoneRow[c]);
        let zone = Zone.FLOATER;
        if (zoneRaw.toLowerCase().includes('north')) zone = Zone.NORTH;
        else if (zoneRaw.toLowerCase().includes('south')) zone = Zone.SOUTH;

        // Parse Bus Number / Label from Row 15
        const busNum = cellToString(busNumRow[c]) || `Shift ${c}`;

        // Parse Times
        const startStr = cellToString(startRow[c]);
        const endStr = cellToString(endRow[c]);

        const startSlot = parseTimeToSlot(startStr);
        let endSlot = parseTimeToSlot(endStr);

        // Handle overnight (end < start)
        if (endSlot < startSlot) endSlot += 96; // Add 24 hours

        // Parse Break
        let breakStartSlot = 0;
        let breakDurationSlots = 0;

        const breakStartStr = cellToString(breakStartRow[c]);
        const breakEndStr = cellToString(breakEndRow[c]);

        if (breakStartStr && breakEndStr &&
            !breakStartStr.match(/^n\/b$/i) &&
            !breakEndStr.match(/^n\/b$/i)) {
            const bStart = parseTimeToSlot(breakStartStr);
            let bEnd = parseTimeToSlot(breakEndStr);

            if (bEnd < bStart) bEnd += 96; // Overnight break?

            // Adjust break start if it looks like it's before shift start (overnight shift case)
            if (bStart < startSlot && endSlot > 96) {
                // This is tricky without dates. Assuming break is within shift.
                // If shift is 18:00 - 02:00 (72 - 104), and break is 22:00 (88), it works.
                // If shift is 22:00 - 06:00 (88 - 120), and break is 02:00 (8), we need to add 96 to break.
                // Let's use the logic: if break start < shift start, add 24h
                // But only if shift crosses midnight.
            }
            if (bStart < startSlot && endSlot >= 96) {
                // Break is likely next day
                // But wait, parseTimeToSlot handles 0-24h.
                // If shift is 22:00 (88) to 06:00 (24+24=48? no 6*4=24. 96+24=120).
                // Break at 02:00 is slot 8. 8 < 88. So add 96 -> 104. Correct.
                // What if shift is 08:00 to 16:00. Break at 12:00. 32 to 64. Break 48. 48 > 32. OK.
                // So if bStart < startSlot, assume next day.
                // EXCEPT if shift didn't cross midnight? No, start < end usually.
                // If start > end, we added 96 to end.
                // So if bStart < startSlot, it's probably next day.
                // UNLESS it's a data error.
                // Let's trust the "N/B" check first.
                // If bStart < startSlot, add 96.
            }

            let finalBreakStart = bStart;
            if (finalBreakStart < startSlot) finalBreakStart += 96;

            breakStartSlot = finalBreakStart;

            // Try to use explicit duration first
            const explicitDurationStr = cellToString(breakDurationRow[c]);
            if (explicitDurationStr) {
                const minutes = parseFloat(explicitDurationStr);
                if (!isNaN(minutes) && minutes > 0) {
                    breakDurationSlots = Math.ceil(minutes / 15);
                } else {
                    // Fallback to window
                    breakDurationSlots = bEnd - bStart;
                }
            } else {
                breakDurationSlots = bEnd - bStart;
            }

            // Handle wrap around calculation and validate
            if (breakDurationSlots < 0) breakDurationSlots += 96;
            // If still negative or unreasonably large (> 4 hours), treat as no break
            if (breakDurationSlots < 0 || breakDurationSlots > 16) {
                console.warn(`Invalid break duration (${breakDurationSlots} slots) for shift ${c}, resetting to 0`);
                breakDurationSlots = 0;
                breakStartSlot = startSlot;
            }
        } else {
            // No break or N/B
            breakDurationSlots = 0;
            breakStartSlot = startSlot; // Just to be safe
        }

        shifts.push({
            id: `imported-${c}-${Math.random().toString(36).substring(2, 7)}`,
            driverName: zoneRaw && !zoneRaw.includes('Floater') && !zoneRaw.includes('North') && !zoneRaw.includes('South') ? zoneRaw : busNum, // Use Zone field as name if it looks like a name, otherwise Bus Num
            // Actually user said Row 14 is "zone area". Row 15 is "bus number".
            // Let's use Bus Number as the primary identifier/name for now as it's unique per shift usually.
            // Or maybe combine them?
            // Let's use Bus Number as driverName for now.
            // Wait, Row 14 data in example was "Floater", "North", "South".
            // So Row 14 is definitely Zone.
            // Row 15 data was "Bus 01", "Bus 02".
            // So Driver Name should probably be "Bus 01" (as a placeholder for the vehicle/shift).
            zone: zone,
            startSlot,
            endSlot,
            breakStartSlot,
            breakDurationSlots
        });

        // Parse Day Type
        const dayRaw = cellToString(dayRow[c]).toLowerCase();
        let dayType: 'Weekday' | 'Saturday' | 'Sunday' = 'Weekday'; // Default
        if (dayRaw.includes('sat')) dayType = 'Saturday';
        else if (dayRaw.includes('sun')) dayType = 'Sunday';
        else if (dayRaw.includes('weekday')) dayType = 'Weekday';

        shifts[shifts.length - 1].dayType = dayType;
    }

    return shifts;
};
