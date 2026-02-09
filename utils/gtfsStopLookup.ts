/**
 * GTFS Stop Lookup
 *
 * Builds a stop name → stop_id map from the local GTFS stops.txt file.
 * Used by the schedule generator to assign real stop codes instead of sequential numbers.
 */

import stopsRaw from '../gtfs/stops.txt?raw';

interface GtfsStopRecord {
    stop_id: string;
    stop_code: string;
    stop_name: string;
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
