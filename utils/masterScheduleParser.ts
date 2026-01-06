
import * as XLSX from 'xlsx';

// --- Types ---

// --- Interline Configuration ---

export type DayType = 'Weekday' | 'Saturday' | 'Sunday';
export type Direction = 'North' | 'South';

export interface InterlineRule {
    id: string;
    fromRoute: string;           // "8A"
    fromDirection: Direction;
    toRoute: string;             // "8B"
    toDirection: Direction;
    atStop: string;              // "Allandale Terminal"
    timeRange?: {                // Optional: only apply during certain hours
        start: number;           // Minutes from midnight (e.g., 1200 = 8:00 PM)
        end: number;             // Minutes from midnight (e.g., 1440 = midnight)
    };
    days: DayType[];             // Which days this rule applies
    enabled: boolean;
}

export interface InterlineConfig {
    rules: InterlineRule[];
    lastUpdated?: string;        // ISO timestamp
}

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
    stops: Record<string, string>; // Departure times per stop
    arrivalTimes?: Record<string, string>; // Arrival times per stop (before recovery)

    // Interline Metadata
    interlineNext?: { route: string; time: number; stopName?: string }; // Route it turns into
    interlinePrev?: { route: string; time: number; stopName?: string }; // Route it came from

    // Band Assignment (from New Schedule wizard)
    assignedBand?: string; // 'A', 'B', 'C', 'D', 'E' - determined by departure time

    // Partial Trip Support (start/end at mid-route stops)
    startStopIndex?: number; // 0-based index of first active stop (undefined = 0)
    endStopIndex?: number;   // 0-based index of last active stop (undefined = last)
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
    pairIndex: number; // Which round-trip cycle this is (0 = first, 1 = second, etc.)
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
        // Heuristic: If > 2.0 and has decimal, it's a date.
        // If < 2.0, it's a time fraction.
        // If it's a small integer (< 100), it's likely NOT a time (could be block ID, stop ID, etc.)

        // Small integers are NOT times - they're likely IDs or other data
        if (Number.isInteger(timeStr) && timeStr < 100) {
            return null;
        }

        if (timeStr > 2) {
            const fraction = timeStr % 1;
            // If fraction is very small (pure integer date), not a valid time
            if (fraction < 0.001) return null;
            return Math.round(fraction * 24 * 60);
        }
        return Math.round(timeStr * 24 * 60);
    }

    const str = String(timeStr).trim().toLowerCase();

    // Skip obviously invalid strings (headers)
    if (str.includes('route') || str.includes('block') || str.includes('notes')) return null;

    // Bare numbers without colons or AM/PM are NOT valid times
    // They could be block IDs, stop IDs, recovery minutes, etc.
    // Only treat as time if it has proper time formatting
    if (!str.includes(':') && !str.includes('am') && !str.includes('pm')) {
        return null;
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

    // Normalize hours to 0-23 range (handle times past midnight like 25:00 -> 1:00)
    h = h % 24;

    const period = h >= 12 ? 'PM' : 'AM';

    // Convert to 12-hour format
    if (h === 0) {
        h = 12; // Midnight
    } else if (h > 12) {
        h -= 12;
    }

    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
};

// Helper for handling midnight crossover - calculates duration when trip may cross midnight
const getTripDuration = (startTime: number, endTime: number): number => {
    if (endTime >= startTime) {
        return endTime - startTime;
    }
    // Trip crosses midnight - endTime is next day
    return (endTime + 1440) - startTime;
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
            let nStartStopIndex: number | undefined = undefined;
            let nEndStopIndex: number | undefined = undefined;

            northCols.forEach((col, stopIdx) => {
                const val = row[col.idx];
                if (String(val).toLowerCase().includes('route')) return;

                const mins = toMinutes(val);
                if (mins !== null) {
                    if (nStart === null) {
                        nStart = mins;
                        nStartStopIndex = stopIdx;
                    }
                    nEnd = mins;
                    nEndStopIndex = stopIdx;
                    validNStops++;
                    northStops[col.name] = fromMinutes(mins);
                } else if (val) {
                    northStops[col.name] = String(val);
                }
            });

            let nRec = 0;
            if (northRecoveryIdx !== -1) nRec = parseInt(String(row[northRecoveryIdx])) || 0;

            // Use getTripDuration to handle midnight crossover
            const nTravelTime = nStart !== null && nEnd !== null ? getTripDuration(nStart, nEnd) : 0;

            if (nStart !== null && nEnd !== null && validNStops >= 2 && nTravelTime > 1) {
                tripsByDay[currentDayScope].push({
                    id: `N-${r}`,
                    blockId: 'Unassigned',
                    direction: 'North',
                    tripNumber: 0,
                    rowId: r,
                    startTime: nStart,
                    endTime: nEnd,
                    recoveryTime: nRec,
                    travelTime: nTravelTime,
                    cycleTime: nTravelTime + nRec,
                    stops: northStops,
                    // Track partial trip indices (only set if not starting/ending at first/last stop)
                    startStopIndex: nStartStopIndex !== 0 ? nStartStopIndex : undefined,
                    endStopIndex: nEndStopIndex !== northCols.length - 1 ? nEndStopIndex : undefined
                });
            }

            // --- Parse South Trip ---
            const southStops: Record<string, string> = {};
            let sStart: number | null = null;
            let sEnd: number | null = null;
            let validSStops = 0;
            let sStartStopIndex: number | undefined = undefined;
            let sEndStopIndex: number | undefined = undefined;

            southCols.forEach((col, stopIdx) => {
                const val = row[col.idx];
                if (String(val).toLowerCase().includes('route')) return;

                const mins = toMinutes(val);
                if (mins !== null) {
                    if (sStart === null) {
                        sStart = mins;
                        sStartStopIndex = stopIdx;
                    }
                    sEnd = mins;
                    sEndStopIndex = stopIdx;
                    validSStops++;
                    southStops[col.name] = fromMinutes(mins);
                } else if (val) {
                    southStops[col.name] = String(val);
                }
            });

            let sRec = 0;
            if (southRecoveryIdx !== -1) sRec = parseInt(String(row[southRecoveryIdx])) || 0;

            // Use getTripDuration to handle midnight crossover
            const sTravelTime = sStart !== null && sEnd !== null ? getTripDuration(sStart, sEnd) : 0;

            if (sStart !== null && sEnd !== null && validSStops >= 2 && sTravelTime > 1) {
                tripsByDay[currentDayScope].push({
                    id: `S-${r}`,
                    blockId: 'Unassigned',
                    direction: 'South',
                    tripNumber: 0,
                    rowId: r,
                    startTime: sStart,
                    endTime: sEnd,
                    recoveryTime: sRec,
                    travelTime: sTravelTime,
                    cycleTime: sTravelTime + sRec,
                    stops: southStops,
                    // Track partial trip indices (only set if not starting/ending at first/last stop)
                    startStopIndex: sStartStopIndex !== 0 ? sStartStopIndex : undefined,
                    endStopIndex: sEndStopIndex !== southCols.length - 1 ? sEndStopIndex : undefined
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
    // Ensure direction is set based on source table (in case it's missing from stored data)
    const northTripsWithDirection = northTable.trips.map(t => ({
        ...t,
        direction: 'North' as const
    }));
    const southTripsWithDirection = southTable.trips.map(t => ({
        ...t,
        direction: 'South' as const
    }));

    // Combine all trips and group by blockId
    const allTrips = [...northTripsWithDirection, ...southTripsWithDirection];
    const blockGroups: Record<string, MasterTrip[]> = {};

    allTrips.forEach(trip => {
        if (!blockGroups[trip.blockId]) {
            blockGroups[trip.blockId] = [];
        }
        blockGroups[trip.blockId].push(trip);
    });

    // Build rows - one per TRIP PAIR (N+S cycle), not per block
    // Each row represents one round-trip cycle
    const rows: RoundTripRow[] = [];

    Object.entries(blockGroups).forEach(([blockId, trips]) => {
        // Sort trips by tripNumber to maintain journey sequence
        const sortedTrips = trips.sort((a, b) => a.tripNumber - b.tripNumber);

        // Pair up trips: North1 + South1 = Row1, North2 + South2 = Row2, etc.
        // Trips alternate N-S-N-S based on tripNumber
        const northTrips = sortedTrips.filter(t => t.direction === 'North');
        const southTrips = sortedTrips.filter(t => t.direction === 'South');

        // Create one row per pair
        const maxPairs = Math.max(northTrips.length, southTrips.length);

        for (let i = 0; i < maxPairs; i++) {
            const nTrip = northTrips[i];
            const sTrip = southTrips[i];
            const pairTrips = [nTrip, sTrip].filter(Boolean) as MasterTrip[];

            if (pairTrips.length === 0) continue;

            const totalTravelTime = pairTrips.reduce((sum, t) => sum + t.travelTime, 0);
            const totalRecoveryTime = pairTrips.reduce((sum, t) => sum + t.recoveryTime, 0);

            // Cycle time for this round trip pair - handle midnight crossover
            const firstTrip = pairTrips[0];
            const lastTrip = pairTrips[pairTrips.length - 1];
            const totalCycleTime = getTripDuration(firstTrip.startTime, lastTrip.endTime);

            rows.push({
                blockId: `${blockId}`, // Same block ID, different row per pair
                trips: pairTrips,
                northStops: northTable.stops,
                southStops: southTable.stops,
                totalTravelTime,
                totalRecoveryTime,
                totalCycleTime,
                pairIndex: i // Track which round-trip cycle this is (0 = first, 1 = second, etc.)
            });
        }
    });

    // Sort rows by: 1) pair index (cycle number), 2) block ID, 3) start time as tiebreaker
    rows.sort((a, b) => {
        // First, group by trip pair/cycle number
        const pairDiff = a.pairIndex - b.pairIndex;
        if (pairDiff !== 0) return pairDiff;

        // Within same cycle, sort by block ID numerically
        const aBlock = a.blockId.replace(/\D/g, '-').split('-').map(Number);
        const bBlock = b.blockId.replace(/\D/g, '-').split('-').map(Number);
        for (let i = 0; i < Math.max(aBlock.length, bBlock.length); i++) {
            const diff = (aBlock[i] || 0) - (bBlock[i] || 0);
            if (diff !== 0) return diff;
        }

        // Fallback to start time
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

// --- Interline Rule Application ---

/**
 * Extract route number from routeName (e.g., "8A (Weekday) (North)" -> "8A")
 */
const extractRouteNumber = (routeName: string): string => {
    // Take first word/token before any parentheses or spaces with descriptors
    const match = routeName.match(/^([\dA-Za-z]+)/);
    return match ? match[1] : routeName;
};

/**
 * Extract day type from routeName (e.g., "8A (Saturday) (North)" -> "Saturday")
 */
const extractDayType = (routeName: string): DayType => {
    if (routeName.includes('Saturday')) return 'Saturday';
    if (routeName.includes('Sunday')) return 'Sunday';
    return 'Weekday';
};

/**
 * Extract direction from routeName (e.g., "8A (Weekday) (North)" -> "North")
 */
const extractDirection = (routeName: string): Direction | null => {
    if (routeName.includes('(North)')) return 'North';
    if (routeName.includes('(South)')) return 'South';
    return null;
};

/**
 * Fuzzy match for stop names - handles case differences and extra spaces
 * For interline matching, we need to match base names with their numbered variants
 */
const stopNameMatches = (stopName: string, ruleStop: string, exactOnly: boolean = false): boolean => {
    const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
    const a = normalize(stopName);
    const b = normalize(ruleStop);

    // Exact match after normalization
    if (a === b) return true;

    // For interline matching: allow "Stop Name" to match "Stop Name (2)", "Stop Name (3)", etc.
    // Strip the (n) suffix from the stop name and compare
    const stripSuffix = (s: string) => s.replace(/\s*\(\d+\)$/, '');
    const aBase = stripSuffix(a);
    const bBase = stripSuffix(b);

    // If base names match, it's a match (e.g., "terminal (3)" matches "terminal")
    if (aBase === bBase) return true;
    if (aBase === b) return true;  // stopName has suffix, ruleStop doesn't
    if (a === bBase) return true;  // ruleStop has suffix, stopName doesn't

    // For exact matching mode (interline), stop here
    if (exactOnly) return false;

    // Partial match (one contains the other) - but avoid matching unrelated stops
    if (!a.match(/\(\d+\)$/)) {
        if (a.includes(b) || b.includes(a)) return true;
    }

    // Match if they start the same (for truncated names)
    const minLen = Math.min(a.length, b.length);
    if (minLen >= 10 && a.substring(0, minLen) === b.substring(0, minLen)) return true;

    return false;
};

/**
 * Parse a time string like "8:07 PM" to minutes from midnight
 */
const parseTimeString = (timeStr: string): number | null => {
    if (!timeStr) return null;
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const period = match[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h * 60 + m;
};

/**
 * Get the ARRIVAL time (in minutes) at a specific stop for a trip
 * Uses arrivalTimes if available, otherwise falls back to stops (departure time)
 * Uses exact matching to avoid "(2)", "(3)" suffix columns
 */
const getArrivalTimeAtStop = (trip: MasterTrip, stopName: string): number | null => {
    // Check arrivalTimes first (more accurate for interline matching)
    if (trip.arrivalTimes) {
        for (const tripStop of Object.keys(trip.arrivalTimes)) {
            if (stopNameMatches(tripStop, stopName, true)) { // exact match
                return parseTimeString(trip.arrivalTimes[tripStop]);
            }
        }
    }
    // Fall back to stops (departure time) if no arrival time - use exact match
    for (const tripStop of Object.keys(trip.stops)) {
        if (stopNameMatches(tripStop, stopName, true)) { // exact match
            return parseTimeString(trip.stops[tripStop]);
        }
    }
    return null;
};

/**
 * Get the DEPARTURE time (in minutes) at a specific stop for a trip
 * If expectedTime is provided, returns the time closest to it (for multi-visit stops)
 */
const getDepartureTimeAtStop = (trip: MasterTrip, stopName: string, expectedTime?: number): number | null => {
    const matchingTimes: number[] = [];

    for (const tripStop of Object.keys(trip.stops)) {
        if (stopNameMatches(tripStop, stopName, true)) {
            const time = parseTimeString(trip.stops[tripStop]);
            if (time !== null) {
                matchingTimes.push(time);
            }
        }
    }

    if (matchingTimes.length === 0) return null;

    // If no expected time, return the first match
    if (expectedTime === undefined) {
        return matchingTimes[0];
    }

    // Find the time closest to expected
    let closest = matchingTimes[0];
    let minDiff = Math.abs(matchingTimes[0] - expectedTime);

    for (const time of matchingTimes) {
        const diff = Math.abs(time - expectedTime);
        if (diff < minDiff) {
            minDiff = diff;
            closest = time;
        }
    }

    return closest;
};

/**
 * Check if a trip matches an interline rule
 * Returns the ARRIVAL time at the interline stop if matched, null otherwise
 */
const tripMatchesRule = (
    trip: MasterTrip,
    rule: InterlineRule,
    routeName: string,
    dayType: DayType,
    tableStops: string[],
    debug: boolean = false
): number | null => {
    if (!rule.enabled) return null;

    // Check route match
    const routeNum = extractRouteNumber(routeName);
    if (routeNum !== rule.fromRoute) return null;

    // Check direction - handle both standard ("North"/"South") and terminus-based directions
    // If trip.direction is a stop name (not "North"/"South"), skip strict direction matching
    // but still try to infer direction from terminus name
    const isStandardDirection = trip.direction === 'North' || trip.direction === 'South';
    if (isStandardDirection) {
        if (trip.direction !== rule.fromDirection) return null;
    } else {
        // Direction is a terminus name - skip direction filtering for terminus-based data
        // The time range and stop matching will still filter appropriately
    }

    // Check day type
    if (!rule.days.includes(dayType)) return null;

    // Get the ARRIVAL time at the interline stop (bus arrives, dwells, then leaves as different route)
    const arrivalTimeAtStop = getArrivalTimeAtStop(trip, rule.atStop);
    if (arrivalTimeAtStop === null) return null;

    // Check time range (if specified) - use arrival time at interline stop
    if (rule.timeRange) {
        const start = rule.timeRange.start;
        const end = rule.timeRange.end;

        // Handle midnight crossover: range spans midnight if:
        // - end > 1440 (e.g., 1535 = 1:35 AM next day = 1440 + 95)
        // - end < start (e.g., start=1200 (8PM), end=120 (2AM))
        const spansMidnight = end > 1440 || end < start;

        if (spansMidnight) {
            // Normalize end time to 0-1440 range for comparison
            const normalizedEnd = end > 1440 ? end - 1440 : end;

            // Range like 8PM (1200) to 1:35AM (1535 -> 95 mins)
            // Valid if time >= start (evening) OR time <= normalizedEnd (early morning)
            if (arrivalTimeAtStop < start && arrivalTimeAtStop > normalizedEnd) {
                return null;
            }
        } else {
            // Normal range (doesn't span midnight)
            if (arrivalTimeAtStop < start || arrivalTimeAtStop > end) {
                return null;
            }
        }
    }

    return arrivalTimeAtStop;
};

/**
 * Get recovery time at a specific stop, handling name matching with suffixes
 */
const getRecoveryAtStop = (trip: MasterTrip, stopName: string): number => {
    if (!trip.recoveryTimes) return 0;

    // Try exact match first
    if (trip.recoveryTimes[stopName] !== undefined) {
        return trip.recoveryTimes[stopName];
    }

    // Try fuzzy match (handle "(2)", "(3)" suffixes)
    for (const key of Object.keys(trip.recoveryTimes)) {
        if (stopNameMatches(key, stopName, false)) {
            return trip.recoveryTimes[key];
        }
    }

    return 0;
};

/**
 * Find the corresponding trip in the target route that DEPARTS from the interline stop
 * after the source trip ARRIVES (accounting for dwell time at the terminal)
 */
const findInterlineTarget = (
    tables: MasterRouteTable[],
    rule: InterlineRule,
    sourceArrivalTime: number,
    sourceDayType: DayType,
    sourceRecovery: number = 0  // Recovery time from source trip's R column
): { table: MasterRouteTable; trip: MasterTrip } | null => {
    // Find the target route table - handle both standard and terminus-based directions
    const targetTable = tables.find(t => {
        const routeNum = extractRouteNumber(t.routeName);
        const direction = extractDirection(t.routeName);
        const dayType = extractDayType(t.routeName);

        // Route must match
        if (routeNum !== rule.toRoute) return false;

        // Day must match
        if (dayType !== sourceDayType) return false;

        // Direction: if table has standard direction, check it; otherwise accept any
        if (direction !== null) {
            return direction === rule.toDirection;
        }

        // No direction in table name - accept it (terminus-based data)
        return true;
    });

    if (!targetTable) return null;

    // Find trip that DEPARTS from the interline stop shortly after the source ARRIVES
    // Use actual recovery time from column 4 if available, otherwise default to 5 min
    const actualDwell = sourceRecovery > 0 ? sourceRecovery : 5;
    const TOLERANCE = 3;  // Allow +/- 3 min tolerance

    // Expected departure time for target = source arrival + actual recovery/dwell
    const expectedDepartureTime = sourceArrivalTime + actualDwell;

    const targetTrip = targetTable.trips.find(t => {
        // Pass expected time to find the closest matching column
        const targetDepartureTime = getDepartureTimeAtStop(t, rule.atStop, expectedDepartureTime);
        if (targetDepartureTime === null) return false;

        // Target should depart close to expected time (arrival + recovery)
        const timeDiff = targetDepartureTime - sourceArrivalTime;
        const expectedDiff = actualDwell;
        return Math.abs(timeDiff - expectedDiff) <= TOLERANCE;
    });

    return targetTrip ? { table: targetTable, trip: targetTrip } : null;
};

/**
 * Apply interline rules to a set of route tables.
 * Mutates the trips in place, adding interlineNext/interlinePrev metadata.
 *
 * @param tables - Array of MasterRouteTable to process
 * @param rules - Array of InterlineRule to apply
 * @returns Statistics about applied interlines
 */
export const applyInterlineRules = (
    tables: MasterRouteTable[],
    rules: InterlineRule[]
): { applied: number; skipped: number } => {
    let applied = 0;
    let skipped = 0;

    const enabledRules = rules.filter(r => r.enabled);
    if (enabledRules.length === 0) return { applied, skipped };

    for (const table of tables) {
        const dayType = extractDayType(table.routeName);

        for (const trip of table.trips) {
            // Skip if already has interline set
            if (trip.interlineNext) continue;

            // Check each rule
            for (const rule of enabledRules) {
                // tripMatchesRule returns the time at the interline stop, or null if no match
                const timeAtInterlineStop = tripMatchesRule(trip, rule, table.routeName, dayType, table.stops, false);

                if (timeAtInterlineStop !== null) {
                    // Get the actual recovery time at the interline stop (from column 4)
                    const recoveryAtStop = getRecoveryAtStop(trip, rule.atStop);

                    // Find the target trip using the time and recovery at the interline stop
                    const target = findInterlineTarget(tables, rule, timeAtInterlineStop, dayType, recoveryAtStop);

                    if (target) {
                        // Set interline on source trip
                        trip.interlineNext = {
                            route: rule.toRoute,
                            time: timeAtInterlineStop,
                            stopName: rule.atStop
                        };

                        // Set interline on target trip
                        target.trip.interlinePrev = {
                            route: rule.fromRoute,
                            time: timeAtInterlineStop,
                            stopName: rule.atStop
                        };

                        applied++;
                    } else {
                        skipped++;
                    }
                    break; // Only apply first matching rule
                }
            }
        }
    }
    return { applied, skipped };
};

/**
 * Clear all interline metadata from tables
 */
export const clearInterlineMetadata = (tables: MasterRouteTable[]): void => {
    for (const table of tables) {
        for (const trip of table.trips) {
            delete trip.interlineNext;
            delete trip.interlinePrev;
        }
    }
};

/**
 * Auto-detect potential interline rules based on time matching between routes.
 * Looks for trips where one route ends and another starts at the same stop/time.
 *
 * @param tables - Array of MasterRouteTable to analyze
 * @returns Array of suggested InterlineRule (disabled by default for user review)
 */
export const detectInterlineRules = (tables: MasterRouteTable[]): InterlineRule[] => {
    const suggestions: InterlineRule[] = [];
    const seenPairs = new Set<string>();

    // Group tables by day type
    const byDayType: Record<DayType, MasterRouteTable[]> = {
        'Weekday': [],
        'Saturday': [],
        'Sunday': []
    };

    for (const table of tables) {
        const dayType = extractDayType(table.routeName);
        byDayType[dayType].push(table);
    }

    // For each day type, look for matching trip ends/starts
    for (const [dayType, dayTables] of Object.entries(byDayType)) {
        for (const sourceTable of dayTables) {
            const sourceRoute = extractRouteNumber(sourceTable.routeName);
            const sourceDir = extractDirection(sourceTable.routeName);
            const lastStop = sourceTable.stops[sourceTable.stops.length - 1];

            if (!sourceDir) continue;

            for (const targetTable of dayTables) {
                const targetRoute = extractRouteNumber(targetTable.routeName);
                const targetDir = extractDirection(targetTable.routeName);
                const firstStop = targetTable.stops[0];

                if (!targetDir) continue;

                // Skip same route+direction (not an interline)
                if (sourceRoute === targetRoute && sourceDir === targetDir) continue;

                // Check if last stop of source matches first stop of target
                if (lastStop !== firstStop) continue;

                // Look for time-matched trips
                let matchCount = 0;
                for (const sourceTrip of sourceTable.trips) {
                    const matchingTarget = targetTable.trips.find(t => t.startTime === sourceTrip.endTime);
                    if (matchingTarget) matchCount++;
                }

                // If we have multiple matches, suggest a rule
                if (matchCount >= 2) {
                    const pairKey = `${sourceRoute}-${sourceDir}-${targetRoute}-${targetDir}-${lastStop}`;
                    if (seenPairs.has(pairKey)) continue;
                    seenPairs.add(pairKey);

                    suggestions.push({
                        id: `auto-${Date.now()}-${suggestions.length}`,
                        fromRoute: sourceRoute,
                        fromDirection: sourceDir,
                        toRoute: targetRoute,
                        toDirection: targetDir,
                        atStop: lastStop,
                        days: [dayType as DayType],
                        enabled: false // Disabled by default - user must review
                    });
                }
            }
        }
    }

    return suggestions;
};
