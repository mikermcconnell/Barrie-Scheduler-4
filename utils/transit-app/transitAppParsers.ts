/**
 * Transit App CSV Parsers
 *
 * Detects file types by name pattern and parses each CSV type into typed rows.
 * Uses manual CSV splitting (no PapaParse dependency).
 */

import type {
    TransitAppFileType,
    DetectedTransitAppFile,
    TransitAppLineRow,
    TransitAppTripRow,
    TransitAppLocationRow,
    TransitAppTripLegRow,
    TransitAppUsersRow,
    TransitAppParsedData,
    TransitAppFileStats,
} from './transitAppTypes';

// ============ FILE DETECTION ============

const FILE_TYPE_PATTERNS: { type: TransitAppFileType; regex: RegExp }[] = [
    { type: 'go_trip_legs', regex: /^go_trip_legs_(\d{4}-\d{2}-\d{2})\.csv$/i },
    { type: 'planned_go_trip_legs', regex: /^planned_go_trip_legs_(\d{4}-\d{2}-\d{2})\.csv$/i },
    { type: 'tapped_trip_view_legs', regex: /^tapped_trip_view_legs_(\d{4}-\d{2}-\d{2})\.csv$/i },
    { type: 'lines', regex: /^lines_(\d{4}-\d{2}-\d{2})\.csv$/i },
    { type: 'trips', regex: /^trips_(\d{4}-\d{2}-\d{2})\.csv$/i },
    { type: 'locations', regex: /^locations_(\d{4}-\d{2}-\d{2})\.csv$/i },
    { type: 'users', regex: /^users\.csv$/i },
];

export function detectFileType(filename: string): { type: TransitAppFileType; date: string | null } | null {
    // Strip path prefixes — just use the filename
    const baseName = filename.replace(/^.*[\\/]/, '');
    for (const { type, regex } of FILE_TYPE_PATTERNS) {
        const match = baseName.match(regex);
        if (match) {
            return { type, date: match[1] || null };
        }
    }
    return null;
}

export function detectTransitAppFiles(files: File[]): {
    detected: DetectedTransitAppFile[];
    unrecognized: File[];
} {
    const detected: DetectedTransitAppFile[] = [];
    const unrecognized: File[] = [];

    for (const file of files) {
        // Use webkitRelativePath if available (folder upload), otherwise name
        const filename = file.webkitRelativePath || file.name;
        const result = detectFileType(filename);
        if (result) {
            detected.push({ file, type: result.type, date: result.date });
        } else {
            unrecognized.push(file);
        }
    }

    // Sort detected by type then date
    detected.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return (a.date || '').localeCompare(b.date || '');
    });

    return { detected, unrecognized };
}

// ============ GENERIC CSV HELPERS ============

function parseCSVRows(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    const pushCell = () => {
        row.push(cell.trim());
        cell = '';
    };

    const pushRow = () => {
        if (row.length === 0) return;
        const hasData = row.some(value => value.length > 0);
        if (hasData) rows.push(row);
        row = [];
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuotes && text[i + 1] === '"') {
                cell += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (ch === ',' && !inQuotes) {
            pushCell();
            continue;
        }

        if ((ch === '\n' || ch === '\r') && !inQuotes) {
            pushCell();
            pushRow();
            if (ch === '\r' && text[i + 1] === '\n') i++;
            continue;
        }

        cell += ch;
    }

    if (cell.length > 0 || row.length > 0) {
        pushCell();
        pushRow();
    }

    return rows;
}

function parseFloatOrNull(val: string | undefined): number | null {
    const normalized = (val || '').trim();
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function safeInt(val: string): number {
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
}

// ============ PER-TYPE PARSERS ============

export function parseLinesFile(text: string, date: string): { rows: TransitAppLineRow[]; skipped: number } {
    const csvRows = parseCSVRows(text);
    if (csvRows.length < 2) return { rows: [], skipped: 0 };

    const header = csvRows[0].map(h => h.toLowerCase());
    const nameIdx = header.indexOf('route_short_name');
    const viewsIdx = header.indexOf('nearby_views');
    const tapsIdx = header.indexOf('nearby_taps');
    const sugIdx = header.indexOf('tapped_routing_suggestions');
    const goIdx = header.indexOf('go_trips');

    if (nameIdx === -1) return { rows: [], skipped: csvRows.length - 1 };

    const rows: TransitAppLineRow[] = [];
    let skipped = 0;

    for (let i = 1; i < csvRows.length; i++) {
        const r = csvRows[i];
        if (!r[nameIdx]) { skipped++; continue; }
        rows.push({
            route_short_name: r[nameIdx],
            nearby_views: viewsIdx >= 0 ? safeInt(r[viewsIdx]) : 0,
            nearby_taps: tapsIdx >= 0 ? safeInt(r[tapsIdx]) : 0,
            tapped_routing_suggestions: sugIdx >= 0 ? safeInt(r[sugIdx]) : 0,
            go_trips: goIdx >= 0 ? safeInt(r[goIdx]) : 0,
            date,
        });
    }

    return { rows, skipped };
}

export function parseTripsFile(text: string): { rows: TransitAppTripRow[]; skipped: number } {
    const csvRows = parseCSVRows(text);
    if (csvRows.length < 2) return { rows: [], skipped: 0 };

    const header = csvRows[0].map(h => h.toLowerCase());
    const uidIdx = header.indexOf('user_id');
    const sLonIdx = header.indexOf('start_longitude');
    const sLatIdx = header.indexOf('start_latitude');
    const eLonIdx = header.indexOf('end_longitude');
    const eLatIdx = header.indexOf('end_latitude');
    const tsIdx = header.indexOf('timestamp');
    const arrIdx = header.indexOf('arrive_by');
    const leaveIdx = header.indexOf('leave_at');

    if (uidIdx === -1 || tsIdx === -1) return { rows: [], skipped: csvRows.length - 1 };

    const rows: TransitAppTripRow[] = [];
    let skipped = 0;

    for (let i = 1; i < csvRows.length; i++) {
        const r = csvRows[i];
        if (!r[uidIdx] || !r[tsIdx]) { skipped++; continue; }

        const startLonParsed = sLonIdx >= 0 ? parseFloatOrNull(r[sLonIdx]) : null;
        const startLatParsed = sLatIdx >= 0 ? parseFloatOrNull(r[sLatIdx]) : null;
        const endLonParsed = eLonIdx >= 0 ? parseFloatOrNull(r[eLonIdx]) : null;
        const endLatParsed = eLatIdx >= 0 ? parseFloatOrNull(r[eLatIdx]) : null;

        const startCoordsValid = startLonParsed !== null && startLatParsed !== null;
        const endCoordsValid = endLonParsed !== null && endLatParsed !== null;

        rows.push({
            user_id: r[uidIdx],
            start_longitude: startCoordsValid ? startLonParsed : 0,
            start_latitude: startCoordsValid ? startLatParsed : 0,
            end_longitude: endCoordsValid ? endLonParsed : 0,
            end_latitude: endCoordsValid ? endLatParsed : 0,
            timestamp: r[tsIdx],
            arrive_by: arrIdx >= 0 ? (r[arrIdx] || '') : '',
            leave_at: leaveIdx >= 0 ? (r[leaveIdx] || '') : '',
        });
    }

    return { rows, skipped };
}

export function parseLocationsFile(text: string): { rows: TransitAppLocationRow[]; skipped: number } {
    const csvRows = parseCSVRows(text);
    if (csvRows.length < 2) return { rows: [], skipped: 0 };

    const header = csvRows[0].map(h => h.toLowerCase());
    const uidIdx = header.indexOf('user_id');
    const lonIdx = header.indexOf('longitude');
    const latIdx = header.indexOf('latitude');
    const tsIdx = header.indexOf('timestamp');

    if (lonIdx === -1 || latIdx === -1) return { rows: [], skipped: csvRows.length - 1 };

    const rows: TransitAppLocationRow[] = [];
    let skipped = 0;

    for (let i = 1; i < csvRows.length; i++) {
        const r = csvRows[i];
        const lon = parseFloatOrNull(r[lonIdx]);
        const lat = parseFloatOrNull(r[latIdx]);
        if (lat === null || lon === null) { skipped++; continue; }
        if (lat === 0 && lon === 0) { skipped++; continue; }
        rows.push({
            user_id: uidIdx >= 0 ? (r[uidIdx] || '') : '',
            longitude: lon,
            latitude: lat,
            timestamp: tsIdx >= 0 ? (r[tsIdx] || '') : '',
        });
    }

    return { rows, skipped };
}

export function parseTripLegsFile(text: string): { rows: TransitAppTripLegRow[]; skipped: number } {
    const csvRows = parseCSVRows(text);
    if (csvRows.length < 2) return { rows: [], skipped: 0 };

    const header = csvRows[0].map(h => h.toLowerCase());
    const tripIdx = header.indexOf('user_trip_id');
    const startIdx = header.indexOf('start_time');
    const endIdx = header.indexOf('end_time');
    const sLonIdx = header.indexOf('start_longitude');
    const sLatIdx = header.indexOf('start_latitude');
    const eLonIdx = header.indexOf('end_longitude');
    const eLatIdx = header.indexOf('end_latitude');
    const svcIdx = header.indexOf('service_name');
    const routeIdx = header.indexOf('route_short_name');
    const modeIdx = header.indexOf('mode');
    const sStopIdx = header.indexOf('start_stop_name');
    const eStopIdx = header.indexOf('end_stop_name');
    // go_trip_legs extras
    const distIdx = header.indexOf('distance');
    const progIdx = header.indexOf('progression');
    const helpIdx = header.indexOf('users_helped');

    if (tripIdx === -1) return { rows: [], skipped: csvRows.length - 1 };

    const rows: TransitAppTripLegRow[] = [];
    let skipped = 0;

    for (let i = 1; i < csvRows.length; i++) {
        const r = csvRows[i];
        if (!r[tripIdx]) { skipped++; continue; }

        const startLonParsed = sLonIdx >= 0 ? parseFloatOrNull(r[sLonIdx]) : null;
        const startLatParsed = sLatIdx >= 0 ? parseFloatOrNull(r[sLatIdx]) : null;
        const endLonParsed = eLonIdx >= 0 ? parseFloatOrNull(r[eLonIdx]) : null;
        const endLatParsed = eLatIdx >= 0 ? parseFloatOrNull(r[eLatIdx]) : null;

        const startCoordsValid = startLonParsed !== null && startLatParsed !== null;
        const endCoordsValid = endLonParsed !== null && endLatParsed !== null;

        const row: TransitAppTripLegRow = {
            user_trip_id: r[tripIdx],
            start_time: startIdx >= 0 ? (r[startIdx] || '') : '',
            end_time: endIdx >= 0 ? (r[endIdx] || '') : '',
            start_longitude: startCoordsValid ? startLonParsed : 0,
            start_latitude: startCoordsValid ? startLatParsed : 0,
            end_longitude: endCoordsValid ? endLonParsed : 0,
            end_latitude: endCoordsValid ? endLatParsed : 0,
            service_name: svcIdx >= 0 ? (r[svcIdx] || '') : '',
            route_short_name: routeIdx >= 0 ? (r[routeIdx] || '') : '',
            mode: modeIdx >= 0 ? (r[modeIdx] || '') : '',
            start_stop_name: sStopIdx >= 0 ? (r[sStopIdx] || '') : '',
            end_stop_name: eStopIdx >= 0 ? (r[eStopIdx] || '') : '',
        };
        const distance = distIdx >= 0 ? parseFloatOrNull(r[distIdx]) : null;
        const progression = progIdx >= 0 ? parseFloatOrNull(r[progIdx]) : null;
        if (distance !== null) row.distance = distance;
        if (progression !== null) row.progression = progression;
        if (helpIdx >= 0 && r[helpIdx]) row.users_helped = safeInt(r[helpIdx]);
        rows.push(row);
    }

    return { rows, skipped };
}

export function parseUsersFile(text: string): { rows: TransitAppUsersRow[]; skipped: number } {
    const csvRows = parseCSVRows(text);
    if (csvRows.length < 2) return { rows: [], skipped: 0 };

    const header = csvRows[0].map(h => h.toLowerCase());
    const dateIdx = header.indexOf('date');
    const usersIdx = header.indexOf('users');
    const sessIdx = header.indexOf('sessions');
    const dlIdx = header.indexOf('downloads');

    if (dateIdx === -1) return { rows: [], skipped: csvRows.length - 1 };

    const rows: TransitAppUsersRow[] = [];
    let skipped = 0;

    for (let i = 1; i < csvRows.length; i++) {
        const r = csvRows[i];
        if (!r[dateIdx]) { skipped++; continue; }
        rows.push({
            date: r[dateIdx],
            users: usersIdx >= 0 ? safeInt(r[usersIdx]) : 0,
            sessions: sessIdx >= 0 ? safeInt(r[sessIdx]) : 0,
            downloads: dlIdx >= 0 ? safeInt(r[dlIdx]) : 0,
        });
    }

    return { rows, skipped };
}

// ============ BATCH PARSING ============

export interface ParseProgress {
    phase: string;
    current: number;
    total: number;
}

export async function parseAllFiles(
    detected: DetectedTransitAppFile[],
    onProgress?: (p: ParseProgress) => void
): Promise<{ data: TransitAppParsedData; stats: TransitAppFileStats }> {
    const data: TransitAppParsedData = {
        lines: [],
        trips: [],
        locations: [],
        goTripLegs: [],
        plannedTripLegs: [],
        tappedTripLegs: [],
        users: [],
    };

    const filesByType: Record<TransitAppFileType, number> = {
        lines: 0, trips: 0, locations: 0,
        go_trip_legs: 0, planned_go_trip_legs: 0, tapped_trip_view_legs: 0, users: 0,
    };

    let totalRowsParsed = 0;
    let totalRowsSkipped = 0;
    const allDates: string[] = [];

    // Process files in batches of 10 to limit concurrent reads
    const BATCH_SIZE = 10;
    for (let batchStart = 0; batchStart < detected.length; batchStart += BATCH_SIZE) {
        const batch = detected.slice(batchStart, batchStart + BATCH_SIZE);

        const results = await Promise.all(
            batch.map(async (df) => {
                const text = await df.file.text();
                return { df, text };
            })
        );

        for (const { df, text } of results) {
            filesByType[df.type]++;
            if (df.date) allDates.push(df.date);

            switch (df.type) {
                case 'lines': {
                    const { rows, skipped } = parseLinesFile(text, df.date || '');
                    data.lines.push(...rows);
                    totalRowsParsed += rows.length;
                    totalRowsSkipped += skipped;
                    break;
                }
                case 'trips': {
                    const { rows, skipped } = parseTripsFile(text);
                    data.trips.push(...rows);
                    totalRowsParsed += rows.length;
                    totalRowsSkipped += skipped;
                    break;
                }
                case 'locations': {
                    const { rows, skipped } = parseLocationsFile(text);
                    data.locations.push(...rows);
                    totalRowsParsed += rows.length;
                    totalRowsSkipped += skipped;
                    break;
                }
                case 'go_trip_legs': {
                    const { rows, skipped } = parseTripLegsFile(text);
                    data.goTripLegs.push(...rows);
                    totalRowsParsed += rows.length;
                    totalRowsSkipped += skipped;
                    break;
                }
                case 'planned_go_trip_legs': {
                    const { rows, skipped } = parseTripLegsFile(text);
                    data.plannedTripLegs.push(...rows);
                    totalRowsParsed += rows.length;
                    totalRowsSkipped += skipped;
                    break;
                }
                case 'tapped_trip_view_legs': {
                    const { rows, skipped } = parseTripLegsFile(text);
                    data.tappedTripLegs.push(...rows);
                    totalRowsParsed += rows.length;
                    totalRowsSkipped += skipped;
                    break;
                }
                case 'users': {
                    const { rows, skipped } = parseUsersFile(text);
                    data.users.push(...rows);
                    totalRowsParsed += rows.length;
                    totalRowsSkipped += skipped;
                    break;
                }
            }
        }

        onProgress?.({
            phase: `Parsing files`,
            current: Math.min(batchStart + BATCH_SIZE, detected.length),
            total: detected.length,
        });
    }

    // Compute date range
    allDates.sort();
    const dateRange = allDates.length > 0
        ? { start: allDates[0], end: allDates[allDates.length - 1] }
        : null;

    const stats: TransitAppFileStats = {
        totalFiles: detected.length,
        dateRange,
        filesByType,
        rowsParsed: totalRowsParsed,
        rowsSkipped: totalRowsSkipped,
    };

    return { data, stats };
}
