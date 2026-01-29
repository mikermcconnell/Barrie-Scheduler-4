
import * as XLSX from 'xlsx';
import { extractDirectionFromName } from './routeDirectionConfig';

// --- Types ---

export type DayType = 'Weekday' | 'Saturday' | 'Sunday';
export type Direction = 'North' | 'South';

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

    // External Connections (from Step 5 Connection Optimizer)
    externalConnections?: import('./connectionTypes').ExternalConnection[];

    // Band Assignment (from New Schedule wizard)
    assignedBand?: string; // 'A', 'B', 'C', 'D', 'E' - determined by departure time

    // Partial Trip Support (start/end at mid-route stops)
    startStopIndex?: number; // 0-based index of first active stop (undefined = 0)
    endStopIndex?: number;   // 0-based index of last active stop (undefined = last)

    // Block Position Flags (from GTFS block assignment)
    isBlockStart?: boolean; // True if this is the first trip in a block
    isBlockEnd?: boolean;   // True if this is the last trip in a block

    // Original GTFS block ID (for linking trips on same physical bus)
    gtfsBlockId?: string;
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
    terminusStop: string | null; // The turnaround stop between directions (auto-detected)
}


// --- Helpers ---

const toMinutes = (timeStr: string | number): number | null => {
    if (timeStr === null || timeStr === undefined || timeStr === '') return null;

    if (typeof timeStr === 'number') {
        // Excel decimal days: 0.5 = 12:00 PM, 0.99 = 11:45 PM
        // Post-midnight times: 1.02 = 12:30 AM (the "1" = next day, 0.02 = 30 min)
        //
        // CRITICAL FIX: Any value >= 1.0 needs the fractional part extracted
        // Previous bug: Values between 1.0 and 2.0 were multiplied by 24*60 directly,
        // causing 1.02 (12:30 AM) to become 1469 min instead of 30 min.

        // Small integers are NOT times - they're likely IDs or other data
        if (Number.isInteger(timeStr) && timeStr < 100) {
            return null;
        }

        // Values >= 1.0 are dates with time component - extract just the time (fractional part)
        if (timeStr >= 1) {
            const fraction = timeStr % 1;
            // If fraction is very small (pure integer date with no time), not a valid time
            if (fraction < 0.001) return null;
            return Math.round(fraction * 24 * 60);
        }

        // Values < 1.0 are pure time fractions (0.5 = noon, 0.75 = 6 PM)
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
        // Sort trips by start time to maintain chronological sequence
        const sortedTrips = trips.sort((a, b) => a.startTime - b.startTime);

        const northTrips = sortedTrips.filter(t => t.direction === 'North');
        const southTrips = sortedTrips.filter(t => t.direction === 'South');

        // Pair by TIME SEQUENCE: find South trip that starts within 15 min of North trip ending
        // This handles cases where blocks have unequal N/S counts or different start times
        const MAX_PAIRING_GAP = 15; // minutes
        const usedSouthTrips = new Set<string>();
        const pairedRows: { nTrip?: MasterTrip; sTrip?: MasterTrip; pairIndex: number }[] = [];

        // First, pair each North trip with its matching South trip
        northTrips.forEach((nTrip, idx) => {
            // Find South trip that starts within MAX_PAIRING_GAP of North trip ending
            let bestMatch: MasterTrip | undefined;
            let bestGap = Infinity;

            for (const sTrip of southTrips) {
                if (usedSouthTrips.has(sTrip.id)) continue;
                const gap = sTrip.startTime - nTrip.endTime;
                if (gap >= 0 && gap <= MAX_PAIRING_GAP && gap < bestGap) {
                    bestGap = gap;
                    bestMatch = sTrip;
                }
            }

            if (bestMatch) {
                usedSouthTrips.add(bestMatch.id);
                pairedRows.push({ nTrip, sTrip: bestMatch, pairIndex: idx });
            } else {
                // North trip with no matching South (end of day pullout)
                pairedRows.push({ nTrip, sTrip: undefined, pairIndex: idx });
            }
        });

        // Add any unpaired South trips (start of day pullin - South before first North)
        southTrips.forEach(sTrip => {
            if (!usedSouthTrips.has(sTrip.id)) {
                pairedRows.push({ nTrip: undefined, sTrip, pairIndex: pairedRows.length });
            }
        });

        // Sort paired rows by the earliest trip time in each pair
        pairedRows.sort((a, b) => {
            const aTime = a.nTrip?.startTime ?? a.sTrip?.startTime ?? 0;
            const bTime = b.nTrip?.startTime ?? b.sTrip?.startTime ?? 0;
            return aTime - bTime;
        });

        // Reassign pairIndex after sorting
        pairedRows.forEach((row, idx) => { row.pairIndex = idx; });

        // Create rows from paired data
        for (const { nTrip, sTrip, pairIndex } of pairedRows) {
            const pairTrips = [nTrip, sTrip].filter(Boolean) as MasterTrip[];

            if (pairTrips.length === 0) continue;

            const totalTravelTime = pairTrips.reduce((sum, t) => sum + t.travelTime, 0);
            const totalRecoveryTime = pairTrips.reduce((sum, t) => sum + t.recoveryTime, 0);

            // Cycle time = span from first departure to final departure (after recovery)
            // endTime is the ARRIVAL time at final stop, so we need to add final stop recovery
            const firstTrip = pairTrips[0];
            const lastTrip = pairTrips[pairTrips.length - 1];

            // Get recovery at the final stop (not total trip recovery)
            // For block-ending trips, don't include phantom recovery
            const lastTripStops = Object.keys(lastTrip.stops);
            const finalStopName = lastTripStops[lastTripStops.length - 1];
            const finalStopRecovery = lastTrip.isBlockEnd ? 0 : (lastTrip.recoveryTimes?.[finalStopName] || 0);

            const spanTime = getTripDuration(firstTrip.startTime, lastTrip.endTime);
            const totalCycleTime = spanTime + finalStopRecovery;

            rows.push({
                blockId: `${blockId}`, // Same block ID, different row per pair
                trips: pairTrips,
                northStops: northTable.stops,
                southStops: southTable.stops,
                totalTravelTime,
                totalRecoveryTime,
                totalCycleTime,
                pairIndex // Track which round-trip cycle this is (0 = first, 1 = second, etc.)
            });
        }
    });

    // Sort rows by initial departure time (earliest trip start), early to late
    rows.sort((a, b) => {
        const aStart = a.trips[0]?.startTime ?? 0;
        const bStart = b.trips[0]?.startTime ?? 0;
        return aStart - bStart;
    });

    // Extract route name (remove direction suffix)
    const routeBase = northTable.routeName.replace(/ \(North\).*$/, '');

    // Helper to normalize stop names for comparison
    const normalizeStopName = (name: string): string => {
        return name
            .toLowerCase()
            .replace(/\s*\(\d+\)\s*/g, '') // Remove numbered suffixes like (2), (3), (4)
            .replace(/\s*(hub|terminal|station|stop|plaza|centre|center)\s*/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    // Determine final stops arrays - handle case where all stops are in northTable
    let finalNorthStops = northTable.stops;
    let finalSouthStops = southTable.stops;
    let finalNorthStopIds = northTable.stopIds;
    let finalSouthStopIds = southTable.stopIds;
    let terminusStop: string | null = null;

    // Check if southStops is empty - need to auto-split northStops AND trip data
    if (southTable.stops.length === 0 && northTable.stops.length > 0) {
        // Find the terminus (Downtown) - it should appear twice in the combined array
        const terminusKeywords = ['downtown', 'allandale', 'georgian', 'terminal'];
        let terminusIndex = -1;
        let secondTerminusIndex = -1;

        for (let i = 0; i < northTable.stops.length; i++) {
            const normalized = normalizeStopName(northTable.stops[i]);
            if (terminusKeywords.some(kw => normalized.includes(kw))) {
                // Found first terminus occurrence - look for the second one
                for (let j = i + 1; j < northTable.stops.length; j++) {
                    const normalized2 = normalizeStopName(northTable.stops[j]);
                    if (terminusKeywords.some(kw => normalized2.includes(kw))) {
                        // Found second terminus - split between them
                        terminusIndex = i;
                        secondTerminusIndex = j;
                        terminusStop = northTable.stops[i];

                        // Split the stop arrays
                        finalNorthStops = northTable.stops.slice(0, i + 1);
                        finalSouthStops = northTable.stops.slice(j);

                        // Split the stop IDs
                        finalNorthStopIds = {};
                        finalSouthStopIds = {};
                        finalNorthStops.forEach(stop => {
                            if (northTable.stopIds[stop]) {
                                finalNorthStopIds[stop] = northTable.stopIds[stop];
                            }
                        });
                        finalSouthStops.forEach(stop => {
                            if (northTable.stopIds[stop]) {
                                finalSouthStopIds[stop] = northTable.stopIds[stop];
                            }
                        });

                        // IMPORTANT: Also update the rows to use split trip data
                        // Each "north" trip actually contains full round-trip data
                        // We need to create synthetic south trips from the same data
                        rows.forEach(row => {
                            row.trips.forEach(trip => {
                                if (trip.direction === 'North') {
                                    // Create a synthetic south trip from the same stop data
                                    const southTrip: MasterTrip = {
                                        ...trip,
                                        id: `${trip.id}-south`,
                                        direction: 'South' as const,
                                        // Keep the same stops data - it has times for all stops
                                    };
                                    row.trips.push(southTrip);
                                }
                            });
                            // Update row's stop arrays
                            row.northStops = finalNorthStops;
                            row.southStops = finalSouthStops;
                        });

                        console.log('[RoundTrip] Auto-split stops and trips at terminus:', {
                            terminus: terminusStop,
                            northStops: finalNorthStops,
                            southStops: finalSouthStops,
                            rowsUpdated: rows.length
                        });
                        break;
                    }
                }
                if (terminusIndex >= 0) break;
            }
        }
    } else {
        // Normal case - detect terminus from existing north/south split
        const lastNorthStop = northTable.stops[northTable.stops.length - 1];
        const firstSouthStop = southTable.stops[0];

        if (lastNorthStop && firstSouthStop) {
            if (lastNorthStop === firstSouthStop) {
                terminusStop = lastNorthStop;
            } else {
                const normalizedNorth = normalizeStopName(lastNorthStop);
                const normalizedSouth = normalizeStopName(firstSouthStop);

                if (normalizedNorth === normalizedSouth) {
                    terminusStop = lastNorthStop;
                } else {
                    const keyWords = ['downtown', 'allandale', 'georgian', 'park place', 'terminal'];
                    for (const keyword of keyWords) {
                        if (normalizedNorth.includes(keyword) && normalizedSouth.includes(keyword)) {
                            terminusStop = lastNorthStop;
                            break;
                        }
                    }
                }
            }
        }
    }

    return {
        routeName: routeBase,
        northStops: finalNorthStops,
        southStops: finalSouthStops,
        northStopIds: finalNorthStopIds,
        southStopIds: finalSouthStopIds,
        rows,
        terminusStop
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

