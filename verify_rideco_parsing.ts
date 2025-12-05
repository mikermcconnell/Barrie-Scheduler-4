import fs from 'fs';
import { parseRideCo } from './utils/csvParsers';

const csvPath = 'RideCo - Template ToD Shifts November 16 2025 (Active).csv';
const csvText = fs.readFileSync(csvPath, 'utf-8');

const shifts = parseRideCo(csvText);

console.log(`Total Shifts: ${shifts.length}`);

const weekdayShifts = shifts.filter(s => s.dayType === 'Weekday');
console.log(`Weekday Shifts: ${weekdayShifts.length}`);

const saturdayShifts = shifts.filter(s => s.dayType === 'Saturday');
console.log(`Saturday Shifts: ${saturdayShifts.length}`);

const sundayShifts = shifts.filter(s => s.dayType === 'Sunday');
console.log(`Sunday Shifts: ${sundayShifts.length}`);

// Check specific counts
if (weekdayShifts.length === 13) {
    console.log('SUCCESS: Weekday shifts count is 13');
} else {
    console.error(`FAILURE: Expected 13 Weekday shifts, got ${weekdayShifts.length}`);
}

// Verify Bus 10 details
// Bus 10 is likely in the "Weekday" set.
// Based on CSV, Bus 10 is the 11th data column (index 10 in 0-based data columns, but let's find it by label)
const bus10 = shifts.find(s => s.driverName === 'Bus 10' && s.dayType === 'Weekday');

if (bus10) {
    console.log(`\nBus 10 Found:`);
    console.log(`Start Slot: ${bus10.startSlot} (${bus10.startSlot / 4})`); // 12:15 is 12*4 + 1 = 49
    console.log(`End Slot: ${bus10.endSlot} (${bus10.endSlot / 4})`);     // 22:15 is 22*4 + 1 = 89
    console.log(`Break Start Slot: ${bus10.breakStartSlot} (${bus10.breakStartSlot / 4})`); // 17:00 is 17*4 = 68
    console.log(`Break Duration: ${bus10.breakDurationSlots * 15} min`); // 40 min? Wait, CSV said 40 min.

    // 12:15 -> 49
    // 22:15 -> 89
    // 17:00 -> 68
    // Duration 40 min -> 2.66 slots? 
    // Wait, the parser calculates duration from Window End - Window Start if provided?
    // In CSV: Break 1 Window Start: 17:00, End: 18:00. Duration: 40.
    // My parser logic: 
    // breakDurationSlots = bEnd - bStart; 
    // 18:00 (72) - 17:00 (68) = 4 slots = 60 mins.
    // The CSV has a specific "Break 1 Duration (min)" row (Row 20).
    // Does my parser use that?
    // Let's check csvParsers.ts.
} else {
    console.error('FAILURE: Bus 10 not found in Weekday shifts');
}
