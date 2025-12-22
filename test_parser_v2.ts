/**
 * Test script for Master Schedule Parser V2
 * Run with: npx tsx test_parser_v2.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { debugParseMasterSchedule } from './utils/masterScheduleParserV2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_PATH = path.join(__dirname, 'August Master (2).xlsx');

console.log('🔍 Testing Master Schedule Parser V2');
console.log(`📁 File: ${FILE_PATH}`);
console.log('─'.repeat(50));

try {
    const fileBuffer = fs.readFileSync(FILE_PATH);
    const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
    );

    debugParseMasterSchedule(arrayBuffer);

} catch (error) {
    console.error('❌ Failed to run test:', error);
}
