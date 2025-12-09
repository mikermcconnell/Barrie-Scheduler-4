
import { parseTransposedShifts } from './utils/csvParsers';

// Mock the timeToSlot function behavior locally for the test if needed, 
// but we want to test the actual exported function behavior.
// We can just call parseTransposedShifts with a string.

const mockCsv = `Label,Shift 1,Shift 2,Shift 3,Shift 4
Run ID,Example,Shift1,Shift2,Shift3
Service Start Time,13:00,14:00,08:00,09:00
Service End Time,00:00,02:00,16:00,17:00`;

console.log("Testing text content:");
console.log(mockCsv);

const result = parseTransposedShifts(mockCsv, 'csv');

console.log("\nParsing Results:");
result.forEach((shift, index) => {
    const durationSlots = shift.endSlot - shift.startSlot;
    const durationHours = durationSlots / 4;
    console.log(`Shift ${index}: ${shift.rawStart} to ${shift.rawEnd}`);
    console.log(`  Slots: ${shift.startSlot} -> ${shift.endSlot}`);
    console.log(`  Duration: ${durationHours} hours`);

    if (durationHours <= 0) {
        console.error(`  FAIL: Negative or zero duration detected!`);
    } else {
        console.log(`  PASS: Positive duration.`);
    }
});
