
import * as fs from 'fs';
import { parseMasterScheduleV2, debugParseMasterSchedule } from './utils/masterScheduleParserV2';
import { assignBlocksToRoute, Block } from './utils/blockAssignment';
import { format } from 'path';

const main = () => {
    const fileBuffer = fs.readFileSync('August Master (3).xlsx');
    const buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const result = parseMasterScheduleV2(buffer);

    const r7 = result.routes.find(r => r.routeName === '7');
    if (!r7) {
        console.error('Route 7 not found');
        return;
    }

    const assignments = assignBlocksToRoute(r7);
    const weekday = assignments.get('7-Weekday');

    if (!weekday) {
        console.error('No Weekday section for Route 7');
        return;
    }

    console.log('--- Current Block Assignments (Sorted by Block ID) ---');
    // Sort by ID to see 1, 2, 3
    const sortedBlocks = [...weekday.blocks].sort((a, b) => a.blockId.localeCompare(b.blockId, undefined, { numeric: true }));

    sortedBlocks.forEach(b => {
        const firstTrip = b.trips[0];
        console.log(`${b.blockId}: Starts ${formatTime(b.startTime)} @ ${firstTrip.firstStopName}`);

        // Find first Park Place time
        const ppTrip = b.trips.find(t => t.times['Park Place'] || t.times['PARK PLACE']);
        if (ppTrip) {
            console.log(`     First Park Place: ${ppTrip.times['Park Place'] || ppTrip.times['PARK PLACE']}`);
        } else {
            console.log(`     Does NOT serve Park Place`);
        }
    });
}

const formatTime = (minutes: number): string => {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 && h < 24 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, '0')}${period.charAt(0).toLowerCase()}`;
};

main();
