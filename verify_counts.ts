
import * as fs from 'fs';
import * as path from 'path';
import { parseRideCo } from './utils/csvParsers';

const filePath = path.join(process.cwd(), 'RideCo - Template ToD Shifts November 16 2025 (Active).csv');
const fileContent = fs.readFileSync(filePath, 'utf-8');

console.log(`Reading file: ${filePath}`);
const shifts = parseRideCo(fileContent);

console.log(`Total Shifts Parsed: ${shifts.length}`);

const counts = {
    Weekday: 0,
    Saturday: 0,
    Sunday: 0,
    Other: 0
};

shifts.forEach(s => {
    if (s.dayType === 'Weekday') counts.Weekday++;
    else if (s.dayType === 'Saturday') counts.Saturday++;
    else if (s.dayType === 'Sunday') counts.Sunday++;
    else {
        counts.Other++;
        console.log(`Unknown Day Type: ${s.dayType} for shift ${s.id}`);
    }
});

console.log('--- Shift Counts ---');
console.log(`Weekday: ${counts.Weekday} (Expected: 13)`);
console.log(`Saturday: ${counts.Saturday} (Expected: 9)`);
console.log(`Sunday:   ${counts.Sunday}   (Expected: 8)`);

if (counts.Weekday === 13 && counts.Saturday === 9 && counts.Sunday === 8) {
    console.log('\nSUCCESS: Counts match user expectations.');
} else {
    console.error('\nFAIL: Counts do not match.');
}
