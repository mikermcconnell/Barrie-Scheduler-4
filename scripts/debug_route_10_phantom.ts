
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parseMasterScheduleV2, ParsedTrip } from '../utils/masterScheduleParserV2';

const filePath = path.resolve('August Master (3).xlsx');

console.log(`Reading file: ${filePath}`);
const fileBuffer = fs.readFileSync(filePath);
const buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;

console.log("Parsing...");
const result = parseMasterScheduleV2(buffer);

const route10 = result.routes.find(r => r.routeName === '10');

if (!route10) {
    console.error("Route 10 not found!");
    process.exit(1);
}

console.log(`Analyzing Route 10 (${route10.sections.length} sections)...`);

route10.sections.forEach((section, sIdx) => {
    console.log(`\nSection ${sIdx + 1} (${section.dayType}):`);

    // Log basic info
    console.log(`  Trips: ${section.trips.length}`);
    console.log(`  Stops: ${section.stops.length}`);

    // Sort by start time just in case
    const sortedTrips = [...section.trips].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    if (sortedTrips.length > 0) {
        const firstTrip = sortedTrips[0];
        console.log(`  [FIRST TRIP] Row ${firstTrip.rowIndex + 1}`);
        console.log(`  Start Time Min: ${firstTrip.startTime}`);
    }
});
