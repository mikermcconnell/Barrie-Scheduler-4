import * as fs from 'fs';
import * as path from 'path';
import { parseScheduleMaster } from './utils/csvParsers';

const csvPath = '08.2025 Schedule Master (TOD).csv';
const csvText = fs.readFileSync(csvPath, 'utf-8');

const schedules = parseScheduleMaster(csvText);
const requirements = schedules['Weekday'];

// 5:15 AM is slot 21 (5 * 4 + 1)
const slot515 = 21;
const req515 = requirements[slot515];

// 12:00 PM is slot 48 (12 * 4)
const slot1200 = 48;
const req1200 = requirements[slot1200];

console.log(`5:15 AM (Slot ${slot515}): Total ${req515.total} (North: ${req515.north}, South: ${req515.south}, Floater: ${req515.floater})`);
console.log(`12:00 PM (Slot ${slot1200}): Total ${req1200.total}`);
