
import { parseRideCo } from './utils/csvParsers';

const mockCsv = `Label,Shift 1,Shift 2,Shift 3
Service Start Time,9:00 AM,14:00,14:00
Service End Time,5:00 PM,19:00,0:00
Break 1 Window Start Time,11:00 AM,16:30,20:00
Break 1 Duration (min),15,40.00,40.00`;

console.log("Testing text content:");
console.log(mockCsv);

const shifts = parseRideCo(mockCsv);

console.log("\nParsing Results:");
shifts.forEach((shift, index) => {
    console.log(`Shift ${index}:`);
    console.log(`  Slots: ${shift.startSlot} -> ${shift.endSlot}`);
    console.log(`  Break: Start=${shift.breakStartSlot}, Duration=${shift.breakDurationSlots}`);

    if (shift.breakDurationSlots > 0) {
        console.log(`  PASS: Has break.`);
    } else {
        console.log(`  FAIL: No break detected.`);
    }
});
