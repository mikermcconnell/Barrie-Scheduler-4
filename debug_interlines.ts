
import * as fs from 'fs';
import * as path from 'path';
import { parseMasterScheduleV2 } from './utils/masterScheduleParserV2';
import { adaptV2ToV1 } from './utils/parserAdapter';

const filePath = path.resolve(process.cwd(), 'August Master (3).xlsx');

if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

try {
    const fileBuffer = fs.readFileSync(filePath);
    const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const v2Result = parseMasterScheduleV2(arrayBuffer);

    // Adapt to V1 triggers the block assignment and interlining logic
    const tables = adaptV2ToV1(v2Result);

    console.log(`\n=== INTERLINED TRIPS ===\n`);
    let count = 0;

    tables.forEach(table => {
        table.trips.forEach(trip => {
            if (trip.interlineNext || trip.interlinePrev) {
                count++;

                // Format times
                const formatTime = (t: number | undefined) => {
                    if (t === undefined) return 'N/A';
                    const h = Math.floor(t / 60);
                    const m = t % 60;
                    const p = h >= 12 && h < 24 ? 'PM' : 'AM';
                    const h12 = h > 12 ? h - 12 : (h === 0 || h === 24 ? 12 : h);
                    return `${h12}:${m.toString().padStart(2, '0')} ${p}`;
                };

                const dir = trip.direction || 'N/A';

                console.log(`[${table.routeName}] Block ${trip.blockId} Trip #${trip.tripNumber} (${dir})`);
                console.log(`  Start: ${formatTime(trip.startTime)} | End: ${formatTime(trip.endTime)}`);

                if (trip.interlineNext) {
                    console.log(`  ➡️  Interlines TO: Route ${trip.interlineNext.route} at ${formatTime(trip.interlineNext.time)} (Stop: ${trip.interlineNext.stopName})`);
                }

                if (trip.interlinePrev) {
                    console.log(`  ⬅️  Interlines FROM: Route ${trip.interlinePrev.route} at ${formatTime(trip.interlinePrev.time)} (Stop: ${trip.interlinePrev.stopName})`);
                }
                console.log('');
            }
        });
    });

    if (count === 0) {
        console.log('No interlined trips found.');
    } else {
        console.log(`Found ${count} interlined trips.`);
    }

} catch (error) {
    console.error('Error running script:', error);
}
