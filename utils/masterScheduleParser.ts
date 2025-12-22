
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
    recoveryTimes?: Record<string, number>; // Recovery time per stop (granularity)
    travelTime: number; // Minutes driving
    cycleTime: number; // Travel + Recovery

    // Validation Flags
    isOverlap?: boolean;
    isTightRecovery?: boolean;

    // Data
    stops: Record<string, string>;

    // Interline Metadata
    interlineNext?: { route: string; time: number; stopName?: string }; // Route it turns into
    interlinePrev?: { route: string; time: number; stopName?: string }; // Route it came from
}

export interface MasterRouteTable {
    routeName: string; // "400"
    stops: string[]; // All stops in order
    stopIds: Record<string, string>; // Map stop name -> stop ID (e.g., "Park Place" -> "777")
    trips: MasterTrip[];
}

// --- Round-Trip View Types ---
export interface RoundTripRow {
    blockId: string; // "400-1"
    trips: MasterTrip[]; // Ordered sequence: N-S-N-S... for full cycle
    northStops: string[]; // Stop names for North direction
    southStops: string[]; // Stop names for South direction
    totalTravelTime: number; // Sum of all travel times
    totalRecoveryTime: number; // Sum of all recovery times
    totalCycleTime: number; // Total time from first departure to last arrival + final recovery
}

export interface RoundTripTable {
    routeName: string; // "400 (Weekday)"
    northStops: string[]; // All North direction stops
    southStops: string[]; // All South direction stops
    northStopIds: Record<string, string>; // Map north stop name -> ID
    southStopIds: Record<string, string>; // Map south stop name -> ID
    rows: RoundTripRow[]; // Each row is one bus/block's full day
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

        // Extract stop IDs from the row BELOW the header (where "Stop ID" row is)
        const northStopIds: Record<string, string> = {};
        const southStopIds: Record<string, string> = {};
        const stopIdRowIdx = stopHeaderRowIdx + 1;
        if (stopIdRowIdx < data.length) {
            const stopIdRow = data[stopIdRowIdx];
            // Check if this row looks like an ID row (first value in stop columns should be numeric or short)
            northCols.forEach(col => {
                const idVal = String(stopIdRow[col.idx] || "").trim();
                // Only consider it a stop ID if it looks numeric or very short (not a time)
                if (idVal && (/^\d+$/.test(idVal) || idVal.length <= 4)) {
                    northStopIds[col.name] = idVal;
                }
            });
            southCols.forEach(col => {
                const idVal = String(stopIdRow[col.idx] || "").trim();
                if (idVal && (/^\d+$/.test(idVal) || idVal.length <= 4)) {
                    southStopIds[col.name] = idVal;
                }
            });
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
            // Uses EXACT time matching: Trip N endTime === Trip N+1 startTime (0 min tolerance)
            // Chains N→S→N→S based on terminus time continuity
            let blockCounter = 1;
            const assignedTripIds = new Set<string>();
            const northTrips = rawTrips.filter(t => t.direction === 'North').sort((a, b) => a.startTime - b.startTime);
            const southTrips = rawTrips.filter(t => t.direction === 'South').sort((a, b) => a.startTime - b.startTime);

            /**
             * Find next trip in opposite direction where startTime exactly matches current endTime.
             * This represents a bus immediately continuing from one trip to the next at the terminus.
             */
            const findMatchingTrip = (currentTrip: MasterTrip): MasterTrip | undefined => {
                const targetTime = currentTrip.endTime; // Exact match required
                const oppositeTrips = currentTrip.direction === 'North' ? southTrips : northTrips;

                return oppositeTrips.find(t =>
                    !assignedTripIds.has(t.id) &&
                    t.startTime === targetTime // EXACT match, 0 tolerance
                );
            };

            // Start blocks from earliest North trips
            northTrips.forEach(startTrip => {
                if (assignedTripIds.has(startTrip.id)) return;

                const currentBlockId = `${sheetName}-${blockCounter++}`; // e.g. "400-1"
                let currentTrip: MasterTrip | undefined = startTrip;
                let sequence = 1;

                // Chain trips: N→S→N→S... using exact time matching
                while (currentTrip) {
                    currentTrip.blockId = currentBlockId;
                    currentTrip.tripNumber = sequence++;
                    assignedTripIds.add(currentTrip.id);

                    // Find next matching trip in opposite direction
                    currentTrip = findMatchingTrip(currentTrip);
                }
            });

            // Handle South trips that didn't chain from North (start new blocks)
            southTrips.forEach(startTrip => {
                if (assignedTripIds.has(startTrip.id)) return;

                const currentBlockId = `${sheetName}-${blockCounter++}`;
                let currentTrip: MasterTrip | undefined = startTrip;
                let sequence = 1;

                while (currentTrip) {
                    currentTrip.blockId = currentBlockId;
                    currentTrip.tripNumber = sequence++;
                    assignedTripIds.add(currentTrip.id);

                    currentTrip = findMatchingTrip(currentTrip);
                }
            });

            // Create Output Tables
            const dayLabel = day === 'Weekday' ? '' : ` (${day})`;

            if (northCols.length > 0) {
                const tableNorth: MasterRouteTable = {
                    routeName: `${sheetName}${dayLabel} (North)${northDest}`, // e.g. "400 (Saturday) (North) (To RVH)"
                    stops: northCols.map(c => c.name),
                    stopIds: northStopIds,
                    trips: rawTrips.filter(t => t.direction === 'North').sort((a, b) => a.startTime - b.startTime) // Sort by TIME
                };
                if (tableNorth.trips.length > 0) tables.push(validateRouteTable(tableNorth));
            }

            if (southCols.length > 0) {
                const tableSouth: MasterRouteTable = {
                    routeName: `${sheetName}${dayLabel} (South)${southDest}`,
                    stops: southCols.map(c => c.name),
                    stopIds: southStopIds,
                    trips: rawTrips.filter(t => t.direction === 'South').sort((a, b) => a.startTime - b.startTime) // Sort by TIME
                };
                if (tableSouth.trips.length > 0) tables.push(validateRouteTable(tableSouth));
            }
        });
    });

    return tables;
};

// --- Round-Trip View Builder ---
// Transforms separate North/South tables into a combined view showing full bus journeys

export const buildRoundTripView = (
    northTable: MasterRouteTable,
    southTable: MasterRouteTable
): RoundTripTable => {
    // Combine all trips and group by blockId
    const allTrips = [...northTable.trips, ...southTable.trips];
    const blockGroups: Record<string, MasterTrip[]> = {};

    allTrips.forEach(trip => {
        if (!blockGroups[trip.blockId]) {
            blockGroups[trip.blockId] = [];
        }
        blockGroups[trip.blockId].push(trip);
    });

    // Build rows - one per block
    const rows: RoundTripRow[] = Object.entries(blockGroups)
        .map(([blockId, trips]) => {
            // Sort trips by tripNumber to maintain journey sequence
            const sortedTrips = trips.sort((a, b) => a.tripNumber - b.tripNumber);

            const totalTravelTime = sortedTrips.reduce((sum, t) => sum + t.travelTime, 0);
            const totalRecoveryTime = sortedTrips.reduce((sum, t) => sum + t.recoveryTime, 0);

            // Calculate total cycle: first departure to last arrival + last recovery
            const firstTrip = sortedTrips[0];
            const lastTrip = sortedTrips[sortedTrips.length - 1];
            const totalCycleTime = firstTrip && lastTrip
                ? (lastTrip.endTime - firstTrip.startTime) + lastTrip.recoveryTime
                : 0;

            return {
                blockId,
                trips: sortedTrips,
                northStops: northTable.stops,
                southStops: southTable.stops,
                totalTravelTime,
                totalRecoveryTime,
                totalCycleTime
            };
        })
        // Sort blocks by first trip start time
        .sort((a, b) => {
            const aStart = a.trips[0]?.startTime ?? 0;
            const bStart = b.trips[0]?.startTime ?? 0;
            return aStart - bStart;
        });

    // Extract route name (remove direction suffix)
    const routeBase = northTable.routeName.replace(/ \(North\).*$/, '');

    return {
        routeName: routeBase,
        northStops: northTable.stops,
        southStops: southTable.stops,
        northStopIds: northTable.stopIds,
        southStopIds: southTable.stopIds,
        rows
    };
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
