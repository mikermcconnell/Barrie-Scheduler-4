
import * as fs from 'fs';
import { parseMasterScheduleV2 } from './utils/masterScheduleParserV2';
import { adaptV2ToV1 } from './utils/parserAdapter';

const main = () => {
    const fileBuffer = fs.readFileSync('August Master (3).xlsx');
    const buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const result = parseMasterScheduleV2(buffer);
    const tables = adaptV2ToV1(result);

    const r7 = tables.find(t => t.routeName.includes('7') && t.routeName.includes('Weekday'));
    if (!r7) {
        console.error('Route 7 Weekday not found');
        return;
    }

    // Look for trips that start mid-route
    // Trip 7-1 (first movement) usually starts at Georgian College? Or Downtown?
    // Let's print the first few trips and their Allandale/Peggy Hill recovery times

    console.log(`Checking ${r7.trips.length} trips for Ghost Recovery...`);

    r7.trips.forEach(trip => {
        // specific check for the columns seen in the screenshot
        // "PEGGY HILL COMMUNITY CENTRE" and "ALLANDALE GO STATION"
        const stopsToCheck = ['PEGGY HILL COMMUNITY CENTRE', 'ALLANDALE GO STATION', 'Allandale GO Station', 'Peggy Hill Community Centre'];

        stopsToCheck.forEach(stopName => {
            // Find actual key if case differs
            const key = Object.keys(trip.stops).find(k => k.toLowerCase() === stopName.toLowerCase()) || stopName;

            const hasTime = !!trip.stops[key];
            const hasRecovery = !!trip.recoveryTimes[key];

            if (!hasTime && hasRecovery) {
                console.error(`❌ FAILURE: Trip ${trip.id} (Block ${trip.blockId}) has Recovery at ${key} (${trip.recoveryTimes[key]}) but NO time!`);
            }
        });
    });
};

main();
