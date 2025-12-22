
import * as fs from 'fs';
import * as path from 'path';
import { parseMasterScheduleV2 } from './utils/masterScheduleParserV2';
import { adaptV2ToV1 } from './utils/parserAdapter';

const filePath = path.join(process.cwd(), 'August Master (3).xlsx');
console.log(`Reading file: ${filePath}`);

try {
    const fileBuffer = fs.readFileSync(filePath);
    const buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;

    // 1. Run V2 Parser
    console.log('\n--- Running V2 Parser ---');
    const v2Result = parseMasterScheduleV2(buffer);

    // Find Route 10 (Exact)
    const route10 = v2Result.routes.find(r => r.routeName === '10');

    if (!route10) {
        console.error('Route 10 not found!');
    } else {
        console.log(`Route 10 found with ${route10.sections.length} sections.`);
        const section = route10.sections[0]; // Weekday

        console.log('Stops and Recovery Alignment:');
        let pendingStop = '';
        section.stops.forEach((s, i) => {
            if (!s.isRecovery) pendingStop = s.name;
            const recVal = s.isRecovery ? `Assigns to: ${pendingStop}` : '';
            console.log(`  [${i}] ${s.name.padEnd(20)} ${recVal}`);
        });
    }

    // 2. Run Adapter
    console.log('\n--- Running Adapter ---');
    const adaptedTables = adaptV2ToV1(v2Result);

    // Find Route 10 Weekday
    const table10 = adaptedTables.find(t => t.routeName === '10 (Weekday)' || t.routeName === '10 (Weekday) (Loop)' || t.routeName === '10');

    if (!table10) {
        console.log('Adapted table for Route 10 Weekday not found. Available:', adaptedTables.map(t => t.routeName).filter(n => n.includes('10')));
    } else {
        console.log(`Found adapted table: ${table10.routeName}`);
        console.log('Stops List:', table10.stops);

        if (table10.trips.length > 0) {
            const trip = table10.trips[0];
            console.log('\nFirst Trip Recovery Times (Adapted):');
            console.log(JSON.stringify(trip.recoveryTimes, null, 2));

            // Simulate stopsWithRecovery logic
            const stopsWithRecovery = new Set<string>();
            table10.trips.forEach(t => {
                if (t.recoveryTimes) {
                    Object.entries(t.recoveryTimes).forEach(([stop, min]) => {
                        if (min !== undefined && min !== null) stopsWithRecovery.add(stop);
                    });
                }
            });

            console.log('\nCalculated stopsWithRecovery:', Array.from(stopsWithRecovery));

            // Verify inference
            console.log('\nRecovery Sources:');
            table10.stops.forEach((stop, i) => {
                const rec = trip.recoveryTimes[stop];
                const cleanName = stop.replace(/\s\(\d+\)$/, '').trim();

                // Helper to check next stop
                let isInferred = false;
                if (i < table10.stops.length - 1) {
                    const next = table10.stops[i + 1];
                    const nextClean = next.replace(/\s\(\d+\)$/, '').trim();
                    if (cleanName === nextClean && rec !== undefined) {
                        isInferred = true;
                    }
                }

                if (rec !== undefined) {
                    console.log(`  Stop "${stop}" has recovery: ${rec} ${isInferred ? '(Inferred/Pair)' : '(Explicit/R col)'}`);
                }
            });
            // Check intersection with table.stops
            table10.stops.forEach(stop => {
                const has = stopsWithRecovery.has(stop);
                console.log(`Table Stop: "${stop}" [len: ${stop.length}] -> Has Recovery? ${has}`);
            });

            // Deep inspect keys
            console.log('\nDeep Inspect Keys:');
            const recKey = Object.keys(trip.recoveryTimes)[0]; // "Leacock at Frost"
            const tableKey = table10.stops[1]; // "Leacock at Frost"

            if (recKey && tableKey) {
                console.log(`Recovery Key: "${recKey}" codes: ${recKey.split('').map(c => c.charCodeAt(0)).join(',')}`);
                console.log(`Table Key:    "${tableKey}" codes: ${tableKey.split('').map(c => c.charCodeAt(0)).join(',')}`);
                console.log(`Match? ${recKey === tableKey}`);
            }
        }
    }
} catch (err) {
    console.error('Error:', err);
}
