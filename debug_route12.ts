/**
 * Debug script to analyze Route 12 Weekday block assignment issue
 */
import * as fs from 'fs';
import { parseMasterScheduleV2 } from './utils/masterScheduleParserV2';
import { assignBlocksToSection, debugBlockAssignment } from './utils/blockAssignment';

const main = () => {
    console.log("=== Route 12 Weekday Block Assignment Debug ===\n");

    // Read the master schedule
    const fileBuffer = fs.readFileSync('August Master (3).xlsx');
    const buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
    const result = parseMasterScheduleV2(buffer);

    // Find Route 12
    const route12 = result.routes.find(r => r.routeName === '12');
    if (!route12) {
        console.error('Route 12 not found');
        console.log('Available routes:', result.routes.map(r => r.routeName).join(', '));
        return;
    }

    console.log(`Route 12 found with ${route12.sections.length} sections`);

    // Find Weekday section
    const weekdaySection = route12.sections.find(s => s.dayType === 'Weekday');
    if (!weekdaySection) {
        console.error('No Weekday section found for Route 12');
        console.log('Available sections:', route12.sections.map(s => s.dayType).join(', '));
        return;
    }

    console.log(`\nWeekday section: ${weekdaySection.trips.length} trips`);
    console.log(`Stops (${weekdaySection.stops.length}):`, weekdaySection.stops.filter(s => !s.isRecovery).map(s => s.name).join(' -> '));

    // Show first/last stop
    const firstStop = weekdaySection.stops.find(s => !s.isRecovery);
    const lastStop = [...weekdaySection.stops].filter(s => !s.isRecovery).pop();
    console.log(`First stop: ${firstStop?.name || 'N/A'}`);
    console.log(`Last stop: ${lastStop?.name || 'N/A'}`);

    // Analyze trips
    console.log('\n--- Trip Analysis (First 20 trips) ---');
    const sortedTrips = [...weekdaySection.trips].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));

    sortedTrips.slice(0, 20).forEach((trip, idx) => {
        console.log(`Trip ${idx + 1}: Start ${formatTime(trip.startTime!)} End ${formatTime(trip.endTime!)}`);
    });

    // Look for time collisions (multiple trips starting at same time)
    console.log('\n--- Time Collision Analysis ---');
    const startTimeMap = new Map<number, number>();
    for (const trip of weekdaySection.trips) {
        const t = trip.startTime ?? 0;
        startTimeMap.set(t, (startTimeMap.get(t) || 0) + 1);
    }

    const collisions = [...startTimeMap.entries()].filter(([time, count]) => count > 1);
    if (collisions.length > 0) {
        console.log(`Found ${collisions.length} time collisions (multiple trips starting at same time):`);
        collisions.forEach(([time, count]) => {
            console.log(`  ${formatTime(time)}: ${count} trips`);
        });
    } else {
        console.log('No collisions found');
    }

    // Look for time chains (trip end -> trip start exact match)
    console.log('\n--- Time Chain Analysis ---');
    const endTimeMap = new Map<number, typeof sortedTrips>();
    for (const trip of weekdaySection.trips) {
        const t = trip.endTime ?? 0;
        if (!endTimeMap.has(t)) endTimeMap.set(t, []);
        endTimeMap.get(t)!.push(trip);
    }

    let chainMatches = 0;
    for (const trip of sortedTrips) {
        const startT = trip.startTime ?? 0;
        const matches = endTimeMap.get(startT) || [];
        if (matches.length > 0) {
            chainMatches++;
            if (chainMatches <= 10) {
                console.log(`  ${formatTime(startT)}: ${matches.length} trip(s) end at this time, 1 trip starts -> can chain`);
            }
        }
    }
    console.log(`Total potential chain links: ${chainMatches}`);

    // Run block assignment
    console.log('\n--- Block Assignment Result ---');
    const blockResult = assignBlocksToSection(weekdaySection, '12');

    console.log(`Blocks: ${blockResult.blocks.length}`);
    console.log(`Assigned: ${blockResult.stats.assignedTrips}/${blockResult.stats.totalTrips}`);
    console.log(`Avg trips/block: ${blockResult.stats.avgTripsPerBlock.toFixed(1)}`);

    // Show blocks
    console.log('\n--- Block Details ---');
    blockResult.blocks.forEach((block, idx) => {
        console.log(`\n[${block.blockId}] ${block.trips.length} trips, ${formatTime(block.startTime)} - ${formatTime(block.endTime)}`);

        // Show trip chain
        block.trips.forEach((t, tidx) => {
            const prefix = tidx === 0 ? '  START ' : tidx === block.trips.length - 1 ? '  END   ' : '        ';
            console.log(`${prefix}${formatTime(t.startTime!)} -> ${formatTime(t.endTime!)}`);
        });
    });
};

const formatTime = (minutes: number): string => {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 && h < 24 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
};

main();
