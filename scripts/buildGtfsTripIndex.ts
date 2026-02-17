/**
 * Build script: reads gtfs/stop_times.txt → outputs data/gtfsTripIndex.json
 * Maps each trip_id to its earliest departure_time (HH:MM format).
 *
 * Usage: npx tsx scripts/buildGtfsTripIndex.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOP_TIMES_PATH = resolve(__dirname, '..', 'gtfs', 'stop_times.txt');
const OUTPUT_PATH = resolve(__dirname, '..', 'data', 'gtfsTripIndex.json');

const raw = readFileSync(STOP_TIMES_PATH, 'utf-8');
const lines = raw.split('\n');
const header = lines[0].split(',');

const tripIdIdx = header.indexOf('trip_id');
const departureIdx = header.indexOf('departure_time');
if (tripIdIdx === -1 || departureIdx === -1) {
    console.error('Missing required columns in stop_times.txt');
    process.exit(1);
}

// Find earliest departure per trip
const tripFirstDeparture = new Map<string, string>();

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    const tripId = cols[tripIdIdx];
    const departure = cols[departureIdx]; // HH:MM:SS

    if (!tripId || !departure) continue;

    const existing = tripFirstDeparture.get(tripId);
    if (!existing || departure < existing) {
        tripFirstDeparture.set(tripId, departure);
    }
}

// Convert HH:MM:SS → HH:MM
const result: Record<string, string> = {};
for (const [tripId, dep] of tripFirstDeparture) {
    result[tripId] = dep.slice(0, 5); // "17:40:00" → "17:40"
}

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

console.log(`✓ Generated ${Object.keys(result).length} trip entries → ${OUTPUT_PATH}`);
