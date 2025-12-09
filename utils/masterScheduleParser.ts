
import * as XLSX from 'xlsx';

// --- Types ---

export interface TripPoint {
    stopId: string;
    time: string; // "06:30 AM"
    isRecovery: boolean;
    minutes: number; // Minutes from midnight
}

export interface MasterTrip {
    id: string; // Unique ID
    blockId: string; // "101", "102" etc.
    direction: 'North' | 'South';
    tripNumber: number; // Sequence in block
    rowId: number; // Original Excel row index

    // Times
    startTime: number;
    endTime: number;
    recoveryTime: number; // Minutes recovered AFTER this trip
    travelTime: number; // Minutes driving
    cycleTime: number; // Travel + Recovery

    // Validation Flags
    isOverlap?: boolean;
    isTightRecovery?: boolean;

    // Data
    stops: Record<string, string>;
}

export interface MasterRouteTable {
    routeName: string; // "400"
    stops: string[]; // All stops in order
    trips: MasterTrip[];
}

// --- Helpers ---

const toMinutes = (timeStr: string | number): number | null => {
    if (timeStr === null || timeStr === undefined || timeStr === '') return null;

    if (typeof timeStr === 'number') {
        // Excel decimal days (e.g. 0.5 = 12:00 PM)
        // Fix: If > 2, assume it's a Serial Date + Time. Strip the integer part.
        // exception: If it's effectively an integer (e.g. 15), treat as minutes (recovery) IF context implies? 
        // But this function is generic. 
        // Heuristic: If > 2.0 and has decimal, it's a date.
        // If < 2.0, it's a time fraction.

        if (timeStr > 2) {
            const fraction = timeStr % 1;
            // If fraction is very small? 
            return Math.round(fraction * 24 * 60);
        }
        return Math.round(timeStr * 24 * 60);
    }

    const str = String(timeStr).trim().toLowerCase();

    // Skip obviously invalid strings (headers)
    if (str.includes('route') || str.includes('block') || str.includes('notes')) return null;

    // Handle "5" or "10" (raw minutes) - usually for recovery
    if (!str.includes(':') && !str.includes('am') && !str.includes('pm')) {
        const num = parseInt(str);
        return isNaN(num) ? null : num;
    }

    let [hStr, mStr] = str.split(':');
    let h = parseInt(hStr);
    let m = parseInt(mStr?.replace(/\D+/g, '') || '0');

    if (str.includes('pm') && h !== 12) h += 12;
    if (str.includes('am') && h === 12) h = 0;

    return (h * 60) + m;
};

const fromMinutes = (minutes: number): string => {
    let h = Math.floor(minutes / 60);
    let m = Math.round(minutes % 60);

    // Handle rounding up 60 mins
    if (m === 60) {
        h += 1;
        m = 0;
    }

    const period = h >= 12 && h < 24 ? 'PM' : 'AM';

    if (h > 12) h -= 12;
    if (h === 0 || h === 24) h = 12;
    if (h > 24) h -= 24;

    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
};

// --- Validation Logic ---
export const validateRouteTable = (table: MasterRouteTable): MasterRouteTable => {
    // Group by Block
    const blocks: Record<string, MasterTrip[]> = {};
    table.trips.forEach(t => {
        if (!blocks[t.blockId]) blocks[t.blockId] = [];
        blocks[t.blockId].push(t);
    });

    Object.values(blocks).forEach(blockTrips => {
        // Sort by trip number
        blockTrips.sort((a, b) => a.tripNumber - b.tripNumber);

        for (let i = 0; i < blockTrips.length; i++) {
            const trip = blockTrips[i];

            // Checks
            trip.isOverlap = false;
            trip.isTightRecovery = false;

            // Recovery Check (Local)
            if (trip.recoveryTime < 5) trip.isTightRecovery = true;

            // Overlap Check (vs Previous Trip)
            if (i > 0) {
                const prev = blockTrips[i - 1];
                const prevEnd = prev.endTime + prev.recoveryTime; // When bus is actually free? 
                // Usually Recovery is AFTER trip. So Bus Free at End + Rec.
                // Next trip must start >= Prev End + Prev Rec.
                // Or is Recovery part of the "Wait"? 
                // Definition: Cycle Time = Travel + Recovery.
                // So Trip A End -> Recovery -> Trip B Start.
                // Thus Trip B Start must be >= Trip A End + Trip A Recovery.

                if (trip.startTime < (prev.endTime + prev.recoveryTime)) {
                    trip.isOverlap = true;
                }
            }
        }
    });

    return table;
};

// --- Core Parser ---

export const parseMasterSchedule = (fileData: ArrayBuffer, mode: 'auto' | 'fixed' | 'tod' = 'auto'): MasterRouteTable[] => {
    const workbook = XLSX.read(fileData, { type: 'array' });
    const tables: MasterRouteTable[] = [];

    // 1. Filter Sheets
    let validSheets: string[] = [];
    const allSheets = workbook.SheetNames;

    if (mode === 'fixed') {
        validSheets = allSheets.filter(name => !isNaN(parseInt(name)));
    } else if (mode === 'tod') {
        validSheets = allSheets.filter(name => name.toLowerCase().includes('tod'));
    } else {
        // 'auto' - Prioritize "ToD" sheet, otherwise use Numeric
        const todSheet = allSheets.find(name => name.toLowerCase().includes('tod'));
        if (todSheet) {
            console.log('Found ToD sheet:', todSheet);
            validSheets = [todSheet];
        } else {
            validSheets = allSheets.filter(name => !isNaN(parseInt(name)));
        }
    }

    validSheets.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (data.length < 5) return;

        // 2. Identify Structure (North vs South)
        let stopHeaderRowIdx = -1;
        let maxCols = 0;

        for (let i = 0; i < 5; i++) {
            const row = data[i];
            const filled = row.filter(c => c && String(c).trim().length > 0).length;
            if (filled > maxCols) {
                maxCols = filled;
                stopHeaderRowIdx = i;
            }
        }

        if (stopHeaderRowIdx === -1) return;

        const headerRow = data[stopHeaderRowIdx].map(String);
        let northCols: { name: string, idx: number }[] = [];
        let southCols: { name: string, idx: number }[] = [];
        let northRecoveryIdx = -1;
        let southRecoveryIdx = -1;

        const metadataCols = ['block', 'time band', 'time band code', 'stop name', 'weekday', 'sat', 'sun', 'drivers', 'notes'];
        let splitFound = false;

        headerRow.forEach((col, idx) => {
            const val = col.trim();
            const lowerVal = val.toLowerCase();
            if (!val) return;
            if (metadataCols.includes(lowerVal)) return;

            if (val === 'R' || val === 'Recovery' || val === 'Rec' || val === 'Layover') {
                if (!splitFound) {
                    northRecoveryIdx = idx;
                    splitFound = true;
                } else if (southRecoveryIdx === -1) {
                    southRecoveryIdx = idx;
                }
                return;
            }

            if (!splitFound) {
                northCols.push({ name: val, idx });
            } else if (southRecoveryIdx === -1) {
                southCols.push({ name: val, idx });
            }
        });

        // Attempt to find destination labels in the row ABOVE the header
        let northDest = "";
        let southDest = "";
        if (stopHeaderRowIdx > 0) {
            const destRow = data[stopHeaderRowIdx - 1];
            // Check first column of North section and first column of South section
            if (northCols.length > 0) {
                const val = String(destRow[northCols[0].idx] || "").trim();
                if (val.toLowerCase().includes("to ")) northDest = ` (${val})`;
            }
            if (southCols.length > 0) {
                const val = String(destRow[southCols[0].idx] || "").trim();
                if (val.toLowerCase().includes("to ")) southDest = ` (${val})`;
            }
        }


        // Data buckets by Day Type
        const tripsByDay: Record<string, MasterTrip[]> = {
            'Weekday': [],
            'Saturday': [],
            'Sunday': []
        };
        let currentDayScope = 'Weekday';

        // Start reading data rows
        for (let r = stopHeaderRowIdx + 1; r < data.length; r++) {
            const row = data[r];
            const rowStr = row.map(c => String(c).toLowerCase()).join(' ');

            // Detect Day Switch
            if (rowStr.includes('saturday')) currentDayScope = 'Saturday';
            else if (rowStr.includes('sunday')) currentDayScope = 'Sunday';

            // --- Parse North Trip ---
            const northStops: Record<string, string> = {};
            let nStart: number | null = null;
            let nEnd: number | null = null;
            let validNStops = 0;

            northCols.forEach(col => {
                const val = row[col.idx];
                if (String(val).toLowerCase().includes('route')) return;

                const mins = toMinutes(val);
                if (mins !== null) {
                    if (nStart === null) nStart = mins;
                    nEnd = mins;
                    validNStops++;
                    northStops[col.name] = fromMinutes(mins);
                } else if (val) {
                    northStops[col.name] = String(val);
                }
            });

            let nRec = 0;
            if (northRecoveryIdx !== -1) nRec = parseInt(String(row[northRecoveryIdx])) || 0;

            if (nStart !== null && nEnd !== null && validNStops >= 2 && (nEnd - nStart) > 1) {
                tripsByDay[currentDayScope].push({
                    id: `N-${r}`,
                    blockId: 'Unassigned',
                    direction: 'North',
                    tripNumber: 0,
                    rowId: r,
                    startTime: nStart,
                    endTime: nEnd,
                    recoveryTime: nRec,
                    travelTime: nEnd - nStart,
                    cycleTime: (nEnd - nStart) + nRec,
                    stops: northStops
                });
            }

            // --- Parse South Trip ---
            const southStops: Record<string, string> = {};
            let sStart: number | null = null;
            let sEnd: number | null = null;
            let validSStops = 0;

            southCols.forEach(col => {
                const val = row[col.idx];
                if (String(val).toLowerCase().includes('route')) return;

                const mins = toMinutes(val);
                if (mins !== null) {
                    if (sStart === null) sStart = mins;
                    sEnd = mins;
                    validSStops++;
                    southStops[col.name] = fromMinutes(mins);
                } else if (val) {
                    southStops[col.name] = String(val);
                }
            });

            let sRec = 0;
            if (southRecoveryIdx !== -1) sRec = parseInt(String(row[southRecoveryIdx])) || 0;

            if (sStart !== null && sEnd !== null && validSStops >= 2 && (sEnd - sStart) > 1) {
                tripsByDay[currentDayScope].push({
                    id: `S-${r}`,
                    blockId: 'Unassigned',
                    direction: 'South',
                    tripNumber: 0,
                    rowId: r,
                    startTime: sStart,
                    endTime: sEnd,
                    recoveryTime: sRec,
                    travelTime: sEnd - sStart,
                    cycleTime: (sEnd - sStart) + sRec,
                    stops: southStops
                });
            }
        }

        // Process Blocks & Create Tables per Day
        ['Weekday', 'Saturday', 'Sunday'].forEach(day => {
            const rawTrips = tripsByDay[day];
            if (rawTrips.length === 0) return;

            // --- Block Logic (Per Day) ---
            let blockCounter = 1;
            const assignedTripIds = new Set<string>();
            const northTrips = rawTrips.filter(t => t.direction === 'North').sort((a, b) => a.startTime - b.startTime);
            const southTrips = rawTrips.filter(t => t.direction === 'South').sort((a, b) => a.startTime - b.startTime);
            const findSouthByRow = (row: number) => southTrips.find(t => t.rowId === row);

            // North Starts
            northTrips.forEach(startTrip => {
                if (assignedTripIds.has(startTrip.id)) return;
                const currentBlockId = `${sheetName}-${blockCounter++}`; // e.g. "400-1"
                let currentTrip: MasterTrip | undefined = startTrip;
                let sequence = 1;

                while (currentTrip) {
                    currentTrip.blockId = currentBlockId;
                    currentTrip.tripNumber = sequence++;
                    assignedTripIds.add(currentTrip.id);

                    let nextTrip: MasterTrip | undefined = undefined;
                    if (currentTrip.direction === 'North') {
                        nextTrip = findSouthByRow(currentTrip.rowId);
                        if (nextTrip && assignedTripIds.has(nextTrip.id)) nextTrip = undefined;
                    } else {
                        const minStartTime = currentTrip.endTime + currentTrip.recoveryTime;
                        nextTrip = northTrips.find(t => !assignedTripIds.has(t.id) && t.startTime >= minStartTime && (t.startTime - minStartTime) < 60);
                    }
                    currentTrip = nextTrip;
                }
            });

            // South Stragglers
            southTrips.forEach(t => {
                if (!assignedTripIds.has(t.id)) {
                    const currentBlockId = `${sheetName}-${blockCounter++}`;
                    let currentTrip: MasterTrip | undefined = t;
                    let sequence = 1;
                    while (currentTrip) {
                        currentTrip.blockId = currentBlockId;
                        currentTrip.tripNumber = sequence++;
                        assignedTripIds.add(currentTrip.id);
                        if (currentTrip.direction === 'South') {
                            const minStartTime = currentTrip.endTime + currentTrip.recoveryTime;
                            currentTrip = northTrips.find(n => !assignedTripIds.has(n.id) && n.startTime >= minStartTime && n.startTime - minStartTime < 60);
                        } else {
                            currentTrip = findSouthByRow(currentTrip.rowId);
                            if (currentTrip && assignedTripIds.has(currentTrip.id)) currentTrip = undefined;
                        }
                    }
                }
            });

            // Create Output Tables
            const dayLabel = day === 'Weekday' ? '' : ` (${day})`;

            if (northCols.length > 0) {
                const tableNorth: MasterRouteTable = {
                    routeName: `${sheetName}${dayLabel} (North)${northDest}`, // e.g. "400 (Saturday) (North) (To RVH)"
                    stops: northCols.map(c => c.name),
                    trips: rawTrips.filter(t => t.direction === 'North').sort((a, b) => a.startTime - b.startTime) // Sort by TIME
                };
                if (tableNorth.trips.length > 0) tables.push(validateRouteTable(tableNorth));
            }

            if (southCols.length > 0) {
                const tableSouth: MasterRouteTable = {
                    routeName: `${sheetName}${dayLabel} (South)${southDest}`,
                    stops: southCols.map(c => c.name),
                    trips: rawTrips.filter(t => t.direction === 'South').sort((a, b) => a.startTime - b.startTime) // Sort by TIME
                };
                if (tableSouth.trips.length > 0) tables.push(validateRouteTable(tableSouth));
            }
        });
    });

    return tables;
};

// --- Conversion Logic for OnDemandWorkspace ---

import { Requirement } from '../types';
import { TIME_SLOTS_PER_DAY } from '../constants';

export const convertMasterRouteTablesToRequirements = (tables: MasterRouteTable[]): Record<string, Requirement[]> => {
    const schedules: Record<string, Requirement[]> = {};

    tables.forEach(table => {
        const requirements: Requirement[] = [];

        // Initialize empty requirements for the day
        for (let i = 0; i < TIME_SLOTS_PER_DAY; i++) {
            requirements.push({
                slotIndex: i,
                north: 0,
                south: 0,
                floater: 0,
                total: 0
            });
        }

        // Iterate through all trips to calculate coverage/demand
        table.trips.forEach(trip => {
            // Check if trip is valid
            if (trip.startTime === undefined || trip.endTime === undefined) return;

            // Convert minutes to slots
            const startSlot = Math.floor(trip.startTime / 15);
            const endSlot = Math.ceil(trip.endTime / 15); // Use ceiling to cover the full duration? Or floor?

            // Actually, we should count it as active if it covers the slot.
            // Requirement logic typically: Is a bus required during this 15 min window?
            // If trip is 8:00 (slot 32) to 8:15 (slot 33), it covers slot 32.

            for (let slot = startSlot; slot < endSlot; slot++) {
                if (slot >= 0 && slot < TIME_SLOTS_PER_DAY) {
                    if (trip.direction === 'North') {
                        requirements[slot].north++;
                    } else if (trip.direction === 'South') {
                        requirements[slot].south++;
                    }
                    requirements[slot].total++;
                }
            }
        });

        // Use the route name (e.g., "ToD", "Weekday") as the key
        schedules[table.routeName] = requirements;
    });

    return schedules;
};
