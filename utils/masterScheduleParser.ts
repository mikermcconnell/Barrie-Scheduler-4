
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
    if (!timeStr) return null;
    if (typeof timeStr === 'number') {
        // Excel decimal days (e.g. 0.5 = 12:00 PM)
        return Math.round(timeStr * 24 * 60);
    }

    const str = String(timeStr).trim().toLowerCase();

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

export const parseMasterSchedule = (fileData: ArrayBuffer): MasterRouteTable[] => {
    const workbook = XLSX.read(fileData, { type: 'array' });
    const tables: MasterRouteTable[] = [];

    // 1. Filter Sheets: Only Numeric (e.g. "400", "8")
    const validSheets = workbook.SheetNames.filter(name => !isNaN(parseInt(name)));

    validSheets.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (data.length < 5) return; // Skip empty/malformed sheets

        // 2. Identify Structure (North vs South)
        // Heuristic: Look for "North" and "South" in row 0 or 1
        // We expect a layout like: | ... North ... | R | ... South ... | R |

        // Find header row (usually row 1 or 2, containing "Park Place" or similar)
        // Actually, let's find the row with the most filled columns, that's likely the stops header
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

        // Split Columns by Direction
        // We look for the FIRST "R" or "Recovery" column to split North/South
        // Or if we know the specific layout from the prompt.
        // Prompt Impl: 400 North | ... | Arrive | R | 400 South | ... | Arrive | R

        let northCols: { name: string, idx: number }[] = [];
        let southCols: { name: string, idx: number }[] = [];
        let northRecoveryIdx = -1;
        let southRecoveryIdx = -1;

        const metadataCols = ['block', 'time band', 'time band code', 'stop name', 'weekday', 'sat', 'sun', 'drivers', 'notes'];

        headerRow.forEach((col, idx) => {
            const val = col.trim();
            const lowerVal = val.toLowerCase();
            if (!val) return;

            // Skip Metadata
            if (metadataCols.includes(lowerVal)) return;

            // Check for Recovery column
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
                // Only add to South if we haven't hit the 2nd Recovery yet
                southCols.push({ name: val, idx });
            }
        });

        // Debug Log
        console.log(`[Parser] Sheet: ${sheetName}, Row: ${stopHeaderRowIdx}`);
        console.log(`[Parser] North Cols: ${northCols.map(c => c.name).join(', ')} (Rec: ${northRecoveryIdx})`);
        console.log(`[Parser] South Cols: ${southCols.map(c => c.name).join(', ')} (Rec: ${southRecoveryIdx})`);

        // Parse Trips
        const trips: MasterTrip[] = [];

        // Start reading data rows (below header)
        for (let r = stopHeaderRowIdx + 1; r < data.length; r++) {
            const row = data[r];

            // --- Parse North Trip ---
            const northStops: Record<string, string> = {};
            let nStart: number | null = null;
            let nEnd: number | null = null;

            northCols.forEach(col => {
                const val = row[col.idx];
                const cleanVal = typeof val === 'number' ? fromMinutes(toMinutes(val) || 0) : String(val);
                northStops[col.name] = cleanVal;

                const mins = toMinutes(val);
                if (mins !== null) {
                    if (nStart === null) nStart = mins;
                    nEnd = mins;
                }
            });

            // North Recovery
            let nRec = 0;
            if (northRecoveryIdx !== -1) {
                nRec = parseInt(String(row[northRecoveryIdx])) || 0;
            }

            if (nStart !== null && nEnd !== null) {
                trips.push({
                    id: `N-${r}`,
                    blockId: 'Unassigned', // Will assign later
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

            southCols.forEach(col => {
                const val = row[col.idx];
                const cleanVal = typeof val === 'number' ? fromMinutes(toMinutes(val) || 0) : String(val);
                southStops[col.name] = cleanVal;

                const mins = toMinutes(val);
                if (mins !== null) {
                    if (sStart === null) sStart = mins;
                    sEnd = mins;
                }
            });

            // South Recovery
            let sRec = 0;
            if (southRecoveryIdx !== -1) {
                sRec = parseInt(String(row[southRecoveryIdx])) || 0;
            }

            if (sStart !== null && sEnd !== null) {
                trips.push({
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

        // 3. Ping Pong Block Logic
        // Sort all trips by Start Time first (helper for finding next)
        // Actually, we need to preserve row structure for the first link? 
        // NO, the prompt says: "North (Row 1) -> South (Row 1)". So same row link is strongest.
        // Then "South (Row 1) -> North (Next Available)".

        let blockCounter = 1;
        const assignedTripIds = new Set<string>();

        // Separate lists for easier lookup
        const northTrips = trips.filter(t => t.direction === 'North').sort((a, b) => a.startTime - b.startTime);
        const southTrips = trips.filter(t => t.direction === 'South').sort((a, b) => a.startTime - b.startTime);

        // Helper to find trip by row (for that direct horizontal link)
        const findSouthByRow = (row: number) => southTrips.find(t => t.rowId === row);

        // Iterate through North trips to start blocks
        northTrips.forEach(startTrip => {
            if (assignedTripIds.has(startTrip.id)) return;

            // Start a new Block
            const currentBlockId = `${sheetName}-${blockCounter++}`;
            let currentTrip: MasterTrip | undefined = startTrip;
            let sequence = 1;

            while (currentTrip) {
                // Assign Block
                currentTrip.blockId = currentBlockId;
                currentTrip.tripNumber = sequence++;
                assignedTripIds.add(currentTrip.id);

                // Find Next Trip
                let nextTrip: MasterTrip | undefined = undefined;

                if (currentTrip.direction === 'North') {
                    // Rule 1: North -> South is typically SAME ROW
                    nextTrip = findSouthByRow(currentTrip.rowId);

                    // Validation: Does it fit?
                    // South Start >= North End + North Recovery
                    if (nextTrip && assignedTripIds.has(nextTrip.id)) nextTrip = undefined; // Already taken?

                    // If no same-row match (or invalid), we could look for ANY South trip? 
                    // Buses usually run N -> S immediately. If they deadhead elsewhere it's different.
                    // User said "Start Stop = End Stop". 
                    // Let's assume Row Link is dominant.
                } else {
                    // Rule 2: South -> North is NEXT AVAILABLE
                    // South End + South Rec = North Start
                    const minStartTime = currentTrip.endTime + currentTrip.recoveryTime;

                    // Find first North trip that starts >= minStartTime
                    nextTrip = northTrips.find(t =>
                        !assignedTripIds.has(t.id) &&
                        t.startTime >= minStartTime &&
                        (t.startTime - minStartTime) < 60 // Heuristic: Don't wait more than an hour?
                    );
                }

                currentTrip = nextTrip;
            }
        });

        // Capture any stragglers (South starts?) using new blocks
        southTrips.forEach(t => {
            if (!assignedTripIds.has(t.id)) {
                const currentBlockId = `${sheetName}-${blockCounter++}`;
                let currentTrip: MasterTrip | undefined = t;
                let sequence = 1;

                while (currentTrip) {
                    currentTrip.blockId = currentBlockId;
                    currentTrip.tripNumber = sequence++;
                    assignedTripIds.add(currentTrip.id);

                    // Try to link South -> North logic
                    if (currentTrip.direction === 'South') {
                        const minStartTime = currentTrip.endTime + currentTrip.recoveryTime;
                        currentTrip = northTrips.find(n =>
                            !assignedTripIds.has(n.id) &&
                            n.startTime >= minStartTime &&
                            n.startTime - minStartTime < 60
                        );
                    } else {
                        // North -> South (Same Row)
                        currentTrip = findSouthByRow(currentTrip.rowId);
                        if (currentTrip && assignedTripIds.has(currentTrip.id)) currentTrip = undefined;
                    }
                }
            }
        });

        const table: MasterRouteTable = {
            routeName: sheetName,
            stops: [...northCols.map(c => c.name), ...southCols.map(c => c.name)], // Merged stops for table view? Or keep separate?
            trips: trips.sort((a, b) => {
                if (a.blockId !== b.blockId) return a.blockId.localeCompare(b.blockId, undefined, { numeric: true });
                return a.tripNumber - b.tripNumber;
            })
        };

        tables.push(validateRouteTable(table));
    });

    return tables;
};
