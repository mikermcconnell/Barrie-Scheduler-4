
import { ParsedTrip, StopInfo } from '../utils/masterScheduleParserV2';
import { assignBlocksToSection, BlockedTrip } from '../utils/blockAssignment';
import { parseMasterScheduleV2, parseTimeToMinutes } from '../utils/masterScheduleParserV2';
import * as XLSX from 'xlsx';

// Mock Data for Route 12 (Teleportation Issue)
// Trip 1: South GO -> Park Place (Ends 6:00 AM)
// Trip 2: South GO -> Park Place (Stars 6:08 AM)
// Recovery at Park Place = 0? Or maybe 8 mins?
// The issue is Trip 1 ends at Park Place. Trip 2 starts at South GO.
// The gap is 8 mins. 
// If recovery matches gap, it links. But locations are wrong.

const runTest = () => {
    console.log("=== Verifying Route 12 Fixes ===\n");

    // --- Test 1: Block Assignment (Teleportation) ---
    console.log("Test 1: Block Assignment (Location Check)");

    const stops: StopInfo[] = [
        { name: "Barrie South GO", id: "725", columnIndex: 0, isRecovery: false },
        { name: "Park Place", id: "777", columnIndex: 1, isRecovery: false }
    ];

    // Mock Trips
    const trip1: ParsedTrip = {
        rowIndex: 1, dayType: 'Weekday', timeBand: 'Morning',
        times: { "Barrie South GO": "5:30 AM", "Park Place": "6:00 AM" },
        recoveryTimes: { "Park Place": 8 }, // 8 min recovery at Park Place
        startTime: 330, // 5:30
        endTime: 360,   // 6:00
        travelTime: 30
    };

    // Trip 2 starts at 6:08 AM at BARRIE SOUTH GO (Not Park Place)
    // 6:00 + 8 min recovery = 6:08. Time matches exactly.
    const trip2: ParsedTrip = {
        rowIndex: 2, dayType: 'Weekday', timeBand: 'Morning',
        times: { "Barrie South GO": "6:08 AM", "Park Place": "6:38 AM" },
        recoveryTimes: {},
        startTime: 368, // 6:08
        endTime: 398,
        travelTime: 30
    };

    const section = {
        dayType: 'Weekday' as const,
        stops,
        trips: [trip1, trip2]
    };

    const result = assignBlocksToSection(section, "12");

    console.log(`  Blocks Created: ${result.blocks.length}`);
    result.blocks.forEach(b => {
        console.log(`  Block ${b.blockId}: ${b.trips.length} trips`);
        b.trips.forEach(t => console.log(`    - ${t.startTime} -> ${t.endTime} (${t.firstStopName} -> ${t.lastStopName})`));
    });

    // Test 1a: Split 6:02 -> 6:08 (Gap 6 mins != 0)
    if (result.blocks.some(b => b.startTime === 330 && b.trips.length === 1)) {
        console.log("  ✅ PASS: 5:30 -> 6:00 -> 6:08 (Gap 8) SPLIT correctly.");
    } else {
        console.log("  ❌ FAIL: 5:30 -> 6:08 matched? Should have split.");
    }

    // Test 1b: Link 7:40 -> 7:40 (Gap 0)
    const trip3: ParsedTrip = {
        rowIndex: 3, dayType: 'Weekday', timeBand: 'Morning',
        times: { "Barrie South GO": "7:10 AM", "Park Place": "7:40 AM" }, // Ends 7:40
        recoveryTimes: {},
        startTime: 430, // 7:10
        endTime: 460,   // 7:40
        travelTime: 30
    };
    const trip4: ParsedTrip = {
        rowIndex: 4, dayType: 'Weekday', timeBand: 'Morning',
        times: { "Barrie South GO": "7:40 AM", "Park Place": "8:10 AM" }, // Starts 7:40
        recoveryTimes: {},
        startTime: 460, // 7:40
        endTime: 490,
        travelTime: 30
    };

    const sectionLink = {
        dayType: 'Weekday' as const,
        stops,
        trips: [trip3, trip4]
    };
    const resultLink = assignBlocksToSection(sectionLink, "12");

    if (resultLink.blocks.length === 1 && resultLink.blocks[0].trips.length === 2) {
        console.log("  ✅ PASS: 7:40 -> 7:40 (Gap 0) LINKED correctly.");
    } else {
        console.log("  ❌ FAIL: 7:40 -> 7:40 (Gap 0) NOT linked.");
    }

    // --- Test 2: Phantom Trips (Sparse Data) ---
    console.log("\nTest 2: Phantom Trip Filtering");

    // We will simulate the `parseTripRow` behavior indirectly or mock it?
    // Since we can't easily import the internal `parseTripRow` without exporting it,
    // we will rely on checking if we can modify the parser code first.
    // Actually, I'll just verify the logic change by code review or small unit test if I could import it.
    // For now, let's assume I modify the code and run this test again with a real file if possible,
    // or just rely on the Block Assignment test which I CAN import.

    // Actually, I can create a mini-excel buffer to test the parser export `parseMasterScheduleV2`

    const wb = XLSX.utils.book_new();
    const wsData = [
        ["Stop Name", "Stop ID", "Stop A", "Stop B"],
        ["", "", "A", "B"], // Header row 2
        ["Weekday", "", "", ""],
        ["Morning", "", "10:00 AM", "10:30 AM"], // Valid Trip
        ["Morning", "", "11:00 AM", ""],         // INVALID (Only 1 time) - Should be skipped
        ["Morning", "", "", ""]                  // Empty - Should be skipped
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "12");
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const parserResult = parseMasterScheduleV2(buffer);
    const route = parserResult.routes[0];
    if (route) {
        const trips = route.sections[0].trips;
        console.log(`  Trips Parsed: ${trips.length}`);
        if (trips.length === 1) {
            console.log("  ✅ PASS: Only valid trip parsed (Sparse row skipped)");
        } else {
            console.log(`  ❌ FAIL: ${trips.length} trips parsed (Sparse/Empty row NOT skipped)`);
            trips.forEach(t => console.log(`    Trip at row ${t.rowIndex}: ${JSON.stringify(t.times)}`));
        }
    } else {
        console.log("  ❌ FAIL: Route not parsed");
    }

};

runTest();
