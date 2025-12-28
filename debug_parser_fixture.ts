
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parseMasterScheduleV2 } from './utils/masterScheduleParserV2';

const FIXTURE_PATH = path.join(__dirname, 'tests/fixtures/master_schedule.xlsx');

console.log(`Checking fixture at: ${FIXTURE_PATH}`);

try {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    console.log('Sheet Names found in Workbook:', workbook.SheetNames);

    const result = parseMasterScheduleV2(fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer);

    console.log('Parse Result Routes:', result.routes.map(r => r.routeName));
    console.log('Parse Result Warnings:', result.warnings);
    console.log('Parse Result Errors:', result.errors);

} catch (err) {
    console.error('Error reading file:', err);
}
