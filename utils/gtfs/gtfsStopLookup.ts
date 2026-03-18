/**
 * GTFS Stop Lookup
 *
 * Builds a stop name → stop_id map from the local GTFS stops.txt file.
 * Used by the schedule generator to assign real stop codes instead of sequential numbers.
 */

import stopsRaw from '../../gtfs/stops.txt?raw';

interface GtfsStopRecord {
    stop_id: string;
    stop_code: string;
    stop_name: string;
}

export interface GtfsStopWithCoords {
    stop_id: string;
    stop_code?: string;
    stop_name: string;
    lat: number;
    lon: number;
}

function normalizeStopLookupKey(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return '';

    if (/^\d+$/.test(trimmed)) {
        return String(Number(trimmed));
    }

    return trimmed.replace(/\s+/g, ' ');
}

function parseCsvRow(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            // Escaped quote inside quoted value ("")
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    values.push(current.trim());
    return values;
}

function parseStopsCsv(raw: string): GtfsStopRecord[] {
    const lines = raw.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = parseCsvRow(lines[0]).map(h => h.replace(/^\uFEFF/, '').trim());
    const idIdx = headers.indexOf('stop_id');
    const codeIdx = headers.indexOf('stop_code');
    const nameIdx = headers.indexOf('stop_name');

    if (idIdx === -1 || nameIdx === -1) return [];

    const records: GtfsStopRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = parseCsvRow(line);

        if (values[nameIdx]) {
            records.push({
                stop_id: values[idIdx] || '',
                stop_code: codeIdx >= 0 ? (values[codeIdx] || '') : '',
                stop_name: values[nameIdx],
            });
        }
    }
    return records;
}

/**
 * Build a map of stop name → stop_id from GTFS stops.txt.
 * For duplicate names, the first occurrence wins.
 */
export function buildStopNameToIdMap(): Record<string, string> {
    const stops = parseStopsCsv(stopsRaw);
    const map: Record<string, string> = {};
    for (const stop of stops) {
        const name = stop.stop_name;
        if (!map[name]) {
            map[name] = stop.stop_id;
        }
    }
    return map;
}

let cachedStopsWithCoords: GtfsStopWithCoords[] | null = null;
let cachedStopCoordsLookup: Map<string, { lat: number; lon: number }> | null = null;

/**
 * Parse all stops with lat/lon coordinates from GTFS stops.txt.
 * Cached after first call.
 */
export function getAllStopsWithCoords(): GtfsStopWithCoords[] {
    if (cachedStopsWithCoords) return cachedStopsWithCoords;

    const lines = stopsRaw.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = parseCsvRow(lines[0]).map(h => h.replace(/^\uFEFF/, '').trim());
    const idIdx = headers.indexOf('stop_id');
    const codeIdx = headers.indexOf('stop_code');
    const nameIdx = headers.indexOf('stop_name');
    const latIdx = headers.indexOf('stop_lat');
    const lonIdx = headers.indexOf('stop_lon');

    if (idIdx === -1 || nameIdx === -1 || latIdx === -1 || lonIdx === -1) return [];

    const results: GtfsStopWithCoords[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const lat = parseFloat(values[latIdx]);
        const lon = parseFloat(values[lonIdx]);
        if (!values[nameIdx] || isNaN(lat) || isNaN(lon)) continue;
        results.push({
            stop_id: values[idIdx] || '',
            stop_code: codeIdx >= 0 ? (values[codeIdx] || '') : '',
            stop_name: values[nameIdx],
            lat,
            lon,
        });
    }

    cachedStopsWithCoords = results;
    return results;
}

function getStopCoordsLookup(): Map<string, { lat: number; lon: number }> {
    if (cachedStopCoordsLookup) return cachedStopCoordsLookup;

    const lookup = new Map<string, { lat: number; lon: number }>();
    for (const stop of getAllStopsWithCoords()) {
        for (const rawKey of [stop.stop_id, stop.stop_code, stop.stop_name]) {
            if (!rawKey) continue;
            const key = normalizeStopLookupKey(rawKey);
            if (!key || lookup.has(key)) continue;
            lookup.set(key, { lat: stop.lat, lon: stop.lon });
        }
    }

    cachedStopCoordsLookup = lookup;
    return lookup;
}

export function findStopCoords(stopId?: string | null, stopName?: string | null): { lat: number; lon: number } | null {
    const lookup = getStopCoordsLookup();

    for (const rawKey of [stopId, stopName]) {
        if (!rawKey) continue;
        const key = normalizeStopLookupKey(rawKey);
        if (!key) continue;
        const coords = lookup.get(key);
        if (coords) return coords;
    }

    return null;
}

/**
 * Find the nearest GTFS stop name within maxKm radius using haversine distance.
 * Returns null if no stop is within range.
 */
export function findNearestStopName(lat: number, lon: number, maxKm: number = 0.5): string | null {
    const stops = getAllStopsWithCoords();
    const R = 6371;
    let bestName: string | null = null;
    let bestDist = maxKm;

    for (const stop of stops) {
        const dLat = (stop.lat - lat) * Math.PI / 180;
        const dLon = (stop.lon - lon) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat * Math.PI / 180) * Math.cos(stop.lat * Math.PI / 180)
            * Math.sin(dLon / 2) ** 2;
        const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (d < bestDist) {
            bestDist = d;
            bestName = stop.stop_name;
        }
    }

    return bestName;
}
