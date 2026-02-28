// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseMasterScheduleV2 } from '../utils/parsers/masterScheduleParserV2';
import { adaptV2ToV1 } from '../utils/parsers/parserAdapter';

const FIXTURE_PATH = path.join(__dirname, 'fixtures/master_schedule.xlsx');

describe('Master Schedule Parser (Golden Master)', () => {
    it('should match the golden snapshot for the entire schedule', () => {
        // 1. Read the stable fixture file
        const fileBuffer = fs.readFileSync(FIXTURE_PATH);
        const buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;

        // 2. Parse using V2 Logic
        const v2Result = parseMasterScheduleV2(buffer);

        // 3. Run Adapter Logic (since this is what the UI uses)
        const adaptedTables = adaptV2ToV1(v2Result);

        // 4. Create a deterministic output object
        // We sort routes to ensure stability if array order changes slightly
        const snapshotData = adaptedTables.sort((a, b) => a.routeName.localeCompare(b.routeName)).map(table => ({
            route: table.routeName,
            stats: {
                tripCount: table.trips.length,
                stopCount: table.stops.length,
            },
            // Include sample detailed data to catch regression
            trips: table.trips.map(t => ({
                id: t.id,
                blockId: t.blockId,
                direction: t.direction,
                times: t.stops,
                recovery: t.recoveryTimes
            }))
        }));

        // 5. Assert against Golden Master
        // Vitest will create '__snapshots__/parser.test.ts.snap' on first run
        expect(snapshotData).toMatchSnapshot();
    });
});
