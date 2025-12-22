/**
 * Deep debug script to analyze Route 12 trip data in detail
 */
import * as fs from 'fs';
import { parseMasterScheduleV2 } from './utils/masterScheduleParserV2';

const main = () => {
    console.log("=== Route 12 Deep Trip Analysis ===\n");

    const fileBuffer = fs.readFileSync('August Master (3).xlsx');
    const buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const result = parseMasterScheduleV2(buffer);

    const route12 = result.routes.find(r => r.routeName === '12');
    if (!route12) {
        console.error('Route 12 not found');
        return;
    }

    const weekdaySection = route12.sections.find(s => s.dayType === 'Weekday');
    if (!weekdaySection) {
        console.error('No Weekday section');
        return;
    }

    console.log("=== STOPS ===");
    weekdaySection.stops.forEach((stop, idx) => {
        console.log(`  [${idx}] ${stop.name} (col ${stop.columnIndex}) ${stop.isRecovery ? '[RECOVERY]' : ''}`);
    });

    console.log("\n=== TRIPS WITH SUSPICIOUS TIMES ===");
    // Look for trips starting before 5:00 AM
    const suspiciousTrips = weekdaySection.trips.filter(t =>
        (t.startTime !== null && t.startTime < 300)  // Before 5:00 AM
    );

    suspiciousTrips.forEach(trip => {
        console.log(`\nTrip Row ${trip.rowIndex}:`);
        console.log(`  Start: ${formatTime(trip.startTime!)} End: ${formatTime(trip.endTime!)}`);
        console.log(`  Times:`, Object.entries(trip.times).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(', '));
        console.log(`  Full times:`, trip.times);
    });

    // Also show the last 5 trips to see what ends when
    console.log("\n=== LAST 5 TRIPS (sorted by start time) ===");
    const sorted = [...weekdaySection.trips].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    sorted.slice(-5).forEach(trip => {
        console.log(`  Row ${trip.rowIndex}: Start ${formatTime(trip.startTime!)} End ${formatTime(trip.endTime!)}`);
    });

    console.log("\n=== TRIPS WITH 12:0X TIMES ===");
    const midnight = weekdaySection.trips.filter(t => {
        const s = t.startTime ?? 0;
        const e = t.endTime ?? 0;
        return (s >= 0 && s <= 10) || (e >= 0 && e <= 10);  // 12:00 - 12:10 AM
    });
    console.log(`Found ${midnight.length} trips with 12:0X AM times`);
    midnight.forEach(trip => {
        console.log(`  Row ${trip.rowIndex}: ${formatTime(trip.startTime!)} -> ${formatTime(trip.endTime!)}`);
    });
};

const formatTime = (minutes: number): string => {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 && h < 24 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
};

main();
