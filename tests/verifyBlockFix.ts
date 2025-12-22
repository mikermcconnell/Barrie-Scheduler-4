import { ParsedTrip, StopInfo } from '../utils/masterScheduleParserV2';
import { assignBlocksToSection, assignBlocksBidirectional, BlockedTrip } from '../utils/blockAssignment';

// Mock Data to verify Recovery Time linking logic
// Trip 1: Downtown -> Mall. Ends 10:00 AM. Recovery 10 mins. Total expected start for next trip: 10:10 AM.
// Trip 2: Mall -> Downtown. Starts 10:10 AM.

const runTest = () => {
    console.log("=== Verifying Block Assignment Recovery Fix ===\n");

    const stops: StopInfo[] = [
        { name: "Downtown", id: "001", columnIndex: 0, isRecovery: false },
        { name: "Mall", id: "002", columnIndex: 1, isRecovery: false },
        { name: "Suburbs", id: "003", columnIndex: 2, isRecovery: false }
    ];

    // Trip 1
    const trip1: ParsedTrip = {
        rowIndex: 1, dayType: 'Weekday', timeBand: 'Morning',
        times: { "Downtown": "9:30 AM", "Mall": "10:00 AM" },
        recoveryTimes: { "Mall": 10 }, // 10 min recovery at Mall
        startTime: 570, // 9:30
        endTime: 600,   // 10:00
        travelTime: 30
    };

    // Trip 2 (Starts 10:10 AM from Mall -> Suburbs)
    const trip2: ParsedTrip = {
        rowIndex: 2, dayType: 'Weekday', timeBand: 'Morning',
        times: { "Mall": "10:10 AM", "Suburbs": "10:40 AM" },
        recoveryTimes: {},
        startTime: 610, // 10:10
        endTime: 640,
        travelTime: 30
    };

    const section = {
        dayType: 'Weekday' as const,
        stops,
        trips: [trip1, trip2]
    };

    // We use a mock route name "RT1"
    const result = assignBlocksToSection(section, "RT1");

    console.log(`  Blocks Created: ${result.blocks.length}`);
    result.blocks.forEach(b => {
        console.log(`  Block ${b.blockId}: ${b.trips.length} trips`);
        b.trips.forEach(t => console.log(`    - ${t.startTime} -> ${t.endTime} (${t.firstStopName} -> ${t.lastStopName})`));
    });

    // Check implementation
    // If bug exists: expectedStart is 10:00 (trip1.endTime). Trip 2 starts 10:10. Difference 10. No match. -> 2 Blocks.
    // If fixed: expectedStart is 10:00 + 10 = 10:10. Match! -> 1 Block.

    if (result.blocks.length === 1 && result.blocks[0].trips.length === 2) {
        console.log("  ✅ PASS: Linked correctly with recovery time.");
    } else {
        console.log("  ❌ FAIL: Trips NOT linked. Bug confirmed.");
    }

    // --- Bidirectional Test ---
    console.log("\n=== Verifying Bidirectional Logic ===\n");
    // Trip 3: North (Ends 12:00 + 5 min recovery) -> Trip 4: South (Starts 12:05)
    const trip3: ParsedTrip = {
        rowIndex: 3, dayType: 'Weekday', timeBand: 'Morning',
        times: { "Downtown": "11:30 AM", "Mall": "12:00 PM" },
        recoveryTimes: { "Mall": 5 },
        startTime: 690, // 11:30
        endTime: 720,   // 12:00
        travelTime: 30
    };
    const trip4: ParsedTrip = {
        rowIndex: 4, dayType: 'Weekday', timeBand: 'Morning',
        times: { "Mall": "12:05 PM", "Downtown": "12:35 PM" },
        recoveryTimes: {},
        startTime: 725, // 12:05
        endTime: 755,
        travelTime: 30
    };

    // Bidirectional test setup
    const northSection = { dayType: 'Weekday' as const, stops, trips: [trip3] };
    const southSection = { dayType: 'Weekday' as const, stops, trips: [trip4] };

    const resultBi = assignBlocksBidirectional(northSection, southSection, "RT1");
    console.log(`  Bidirectional Blocks: ${resultBi.blocks.length}`);
    if (resultBi.blocks.length === 1 && resultBi.blocks[0].trips.length === 2) {
        console.log("  ✅ PASS: Bidirectional trips linked correctly with recovery.");
    } else {
        console.log("  ❌ FAIL: Bidirectional trips NOT linked.");
        console.log(`     Values: End ${trip3.endTime} + Rec 5 = ${trip3.endTime! + 5}. Start ${trip4.startTime}.`);
    }
};

runTest();
