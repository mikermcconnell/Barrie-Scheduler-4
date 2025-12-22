
import * as fs from 'fs';
import * as path from 'path';
import { parseMasterScheduleV2 } from './utils/masterScheduleParserV2';
import { adaptV2ToV1 } from './utils/parserAdapter';

const FIXTURE_PATH = path.join(process.cwd(), 'tests/fixtures/master_schedule.xlsx');

const analyzeInterline = () => {
    if (!fs.existsSync(FIXTURE_PATH)) {
        console.error("Fixture not found:", FIXTURE_PATH);
        return;
    }

    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const v2Result = parseMasterScheduleV2(arrayBuffer);

    // Extract 8A and 8B trips
    const r8A = v2Result.routes.find(r => r.routeName === '8A');
    const r8B = v2Result.routes.find(r => r.routeName === '8B');

    if (!r8A || !r8B) {
        console.log("Routes 8A or 8B not found in fixture.");
        return;
    }

    const trips8A = r8A.sections.flatMap(s => s.trips.map(t => ({ ...t, route: '8A' })));
    const trips8B = r8B.sections.flatMap(s => s.trips.map(t => ({ ...t, route: '8B' })));

    const allTrips = [...trips8A, ...trips8B].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));

    // analyze gaps
    console.log("Analyzing 8A -> 8B gaps:");
    for (let i = 0; i < allTrips.length - 1; i++) {
        const t1 = allTrips[i];
        const t2 = allTrips[i + 1];

        // Check if they are different routes
        if (t1.route !== t2.route) {
            const gap = (t2.startTime ?? 0) - (t1.endTime ?? 0);
            if (gap >= 0 && gap <= 30) {
                console.log(`${t1.route} End ${t1.endTime} -> ${t2.route} Start ${t2.startTime} (Gap: ${gap}m)`);
            }
        }
    }
};

analyzeInterline();
