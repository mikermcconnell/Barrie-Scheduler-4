
import * as fs from 'fs';
import * as path from 'path';

const filePath = 'c:\\Users\\Mike McConnell\\Documents\\mike_apps\\Scheduler 4\\Runtime Bars - 400 EXPRESS S - 2025-10-01 - 2025-10-31.csv';
const content = fs.readFileSync(filePath, 'utf-8');
const rows = content.split('\n');
const header = rows[0].split(',');

const uniqueSegments = new Set();
header.forEach((h, i) => {
    if (i > 0 && h.trim()) uniqueSegments.add(h.trim());
});

console.log("Unique Segments Found:", Array.from(uniqueSegments));
console.log("Total Columns:", header.length);
