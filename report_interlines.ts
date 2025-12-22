
import * as fs from 'fs';
import * as path from 'path';
import { parseMasterScheduleV2 } from './utils/masterScheduleParserV2';

const FIXTURE_PATH = path.join(process.cwd(), 'tests/fixtures/master_schedule.xlsx');

const reportInterlines = () => {
    if (!fs.existsSync(FIXTURE_PATH)) {
        console.error("Fixture not found:", FIXTURE_PATH);
        return;
    }

    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const v2Result = parseMasterScheduleV2(buffer);

    // Extract 8A and 8B sections
    const r8A = v2Result.routes.find(r => r.routeName === '8A');
    const r8B = v2Result.routes.find(r => r.routeName === '8B');

    if (!r8A || !r8B) {
        console.log("Routes 8A or 8B not found.");
        return;
    }

    const sections = [
        ...r8A.sections.map(s => ({ section: s, routeName: '8A' })),
        ...r8B.sections.map(s => ({ section: s, routeName: '8B' }))
    ];

    console.log("\n=== INSPECTING CANDIDATE TRIPS ===");

    // Helper to print trip
    const printTrip = (label: string, trip: any) => {
        console.log(`\n${label} (Row ${trip.rowIndex}):`);
        console.log(`  Start: ${trip.startTime} (${formatTime(trip.startTime)})`);
        console.log(`  End:   ${trip.endTime} (${formatTime(trip.endTime)})`);
        console.log("  Stops:");
        Object.entries(trip.times).forEach(([stop, time]) => {
            console.log(`    ${stop}: ${time}`);
        });
        if (trip.recoveryTimes) {
            Object.entries(trip.recoveryTimes).forEach(([stop, rec]) => {
                console.log(`    [REC] ${stop}: ${rec}`);
            });
        }
    };

    const t8A_37 = sections.find(s => s.routeName === '8A')?.section.trips.find(t => t.rowIndex === 37);
    if (t8A_37) printTrip("8A Trip 37", t8A_37);

    const t8B_36 = sections.find(s => s.routeName === '8B')?.section.trips.find(t => t.rowIndex === 36);
    if (t8B_36) printTrip("8B Trip 36", t8B_36);
};

const formatTime = (minutes: number): string => {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 && h < 24 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    if (h > 24) h -= 24;
    return `${h}:${m.toString().padStart(2, '0')}${period}`;
};

reportInterlines();
