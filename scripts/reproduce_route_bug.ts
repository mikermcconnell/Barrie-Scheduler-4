
import * as XLSX from 'xlsx';
import { parseMasterScheduleV2 } from '../utils/masterScheduleParserV2';

// Create a mock workbook
const wb = XLSX.utils.book_new();

// Sheet "10" - Route 10
// Row 1: Stop Name | ...
// Row 2: Stop ID   | ...
// Row 3: Data      | ...
const data10 = [
    ['Stop Name', 'Ignore', 'Stop A', 'Stop B', 'Stop C'],
    ['Stop ID', 'Ignore', '1001', '1002', '1003'],
    ['Weekday', 'Morning', '10:00a', '10:15a', '10:30a'],
];
const ws10 = XLSX.utils.aoa_to_sheet(data10);
XLSX.utils.book_append_sheet(wb, ws10, "10");

// Sheet "100" - Route 100
const data100 = [
    // GHOST HEADER (Route 10 Data copied by accident)
    ['Stop Name', 'Ignore', 'Stop A', 'Stop B', 'Stop C'],
    ['Stop ID', 'Ignore', '1001', '1002', '1003'],
    // Ghost data?
    // Ghost data (VALID TIMES to prevent filtering)
    ['Weekday', 'Morning', '10:00a', '10:15a', '10:30a'],

    // REAL HEADER (Route 100)
    ['', '', '', '', ''],
    ['Stop Name', 'Ignore', 'Stop X', 'Stop Y', 'Stop Z'],
    ['Stop ID', 'Ignore', '2001', '2002', '2003'],
    ['Weekday', 'Morning', '11:00a', '11:15a', '11:30a'],
    ['Weekday', 'Morning', '12:00p', '12:15p', '12:30p'], // Extra trip to win the "size" check
];
const ws100 = XLSX.utils.aoa_to_sheet(data100);
XLSX.utils.book_append_sheet(wb, ws100, "100");

// Write to buffer
const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

import { adaptV2ToV1 } from '../utils/parserAdapter';

// ... (previous imports and setup)

// Parse
console.log("Parsing mock workbook...");
const result = parseMasterScheduleV2(buffer);

console.log("Adapting to V1 Tables...");
const tables = adaptV2ToV1(result);

// Analyze Tables
const table10 = tables.find(t => t.routeName.includes('10') && t.routeName.includes('Weekday'));
const table100 = tables.find(t => t.routeName.includes('100') && t.routeName.includes('Weekday')); // Using Weekday for both in mock

if (!table10 || !table100) {
    console.error("FAIL: Could not find both tables.");
    console.log("Found tables:", tables.map(t => t.routeName));
    process.exit(1);
}

console.log("\nTable 10 Stops:", table10.stops);
console.log("Table 100 Stops:", table100.stops);

// Assertions
let failed = false;

if (table10.stops.includes('Stop X')) {
    console.error("\nFAIL: Table 10 contains stops from Route 100!");
    failed = true;
}

if (table100.stops.includes('Stop A')) {
    console.error("\nFAIL: Table 100 contains stops from Route 10!");
    failed = true;
}

if (!failed) {
    console.log("\nPASS: Tables have distinct stops.");
} else {
    console.log("\nFAIL: Tables share stops.");
}

