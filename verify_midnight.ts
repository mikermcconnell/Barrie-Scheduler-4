
import { parseRideCo } from './utils/csvParsers';

// Test parseRideCo with midnight crossing shifts
// Note: parseRideCo expects a specific row-based format matching the RideCo template

// Create mock CSV matching the expected RideCo format (columns are shifts, rows are data fields)
// Row indices: 9=Shift Num, 10=Day, 13=Zone, 14=Bus, 15=Start, 16=End, 17=Break Start, 18=Break End, 19=Break Duration
const mockRows = [
    ['', '', ''],  // 0
    ['', '', ''],  // 1
    ['', '', ''],  // 2
    ['', '', ''],  // 3
    ['', '', ''],  // 4
    ['', '', ''],  // 5
    ['', '', ''],  // 6
    ['', '', ''],  // 7
    ['', '', ''],  // 8
    ['Shift Number', 'Shift1', 'Shift2', 'Shift3', 'Shift4'],  // 9
    ['Day', 'Weekday', 'Weekday', 'Weekday', 'Weekday'],  // 10
    ['', '', '', '', ''],  // 11
    ['', '', '', '', ''],  // 12
    ['Zone', 'North', 'South', 'Floater', 'North'],  // 13
    ['Bus', 'Bus 01', 'Bus 02', 'Bus 03', 'Bus 04'],  // 14
    ['Service Start Time', '13:00', '14:00', '08:00', '22:00'],  // 15
    ['Service End Time', '00:00', '02:00', '16:00', '06:00'],  // 16 - midnight crossings
    ['Break Start Time', '17:00', '18:00', '12:00', '02:00'],  // 17
    ['Break End Time', '17:30', '18:30', '12:30', '02:30'],  // 18
    ['Break Duration', '30', '30', '30', '30'],  // 19
];

console.log("Testing parseRideCo with midnight-crossing shifts...");

const result = parseRideCo(mockRows);

console.log("\nParsing Results:");
result.forEach((shift, index) => {
    const durationSlots = shift.endSlot - shift.startSlot;
    const durationHours = durationSlots / 4;
    console.log(`Shift ${index}: ${shift.driverName} (${shift.zone})`);
    console.log(`  Slots: ${shift.startSlot} -> ${shift.endSlot}`);
    console.log(`  Duration: ${durationHours} hours`);

    if (durationHours <= 0) {
        console.error(`  FAIL: Negative or zero duration detected!`);
    } else {
        console.log(`  PASS: Positive duration.`);
    }
});
