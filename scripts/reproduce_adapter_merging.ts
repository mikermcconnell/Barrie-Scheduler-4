
import { adaptV2ToV1 } from '../utils/parserAdapter';
import { ParsedRoute, ParsedTrip, StopInfo, ParseResult } from '../utils/masterScheduleParserV2';
import * as assert from 'assert';

// Mock Data Helper
const createMockTrip = (id: string, time: string, rowIndex: number): ParsedTrip => ({
    id,
    rowIndex,
    times: { 'StopA': time, 'StopB': time },
    startTime: parseInt(time) || 0,
    recoveryTimes: { 'StopB': 5 }
});

const createMockSection = (dayType: string, trips: ParsedTrip[]): any => ({
    dayType,
    stops: [
        { name: 'StopA', id: '001', columnIndex: 0, isRecovery: false },
        { name: 'StopB', id: '002', columnIndex: 1, isRecovery: false }
    ],
    trips
});

const runTest = () => {
    console.log("Running Adapter Merging Test...");

    // Scenario: Route 10 has 3 sections for 'Weekday'
    // Section 1: 5:40 AM
    // Section 2: 7:10 AM
    // Section 3: 8:10 AM
    const mockRoute: ParsedRoute = {
        routeName: '10',
        sections: [
            createMockSection('Weekday', [createMockTrip('t1', '340', 1)]), // 5:40
            createMockSection('Weekday', [createMockTrip('t2', '430', 2)]), // 7:10
            createMockSection('Weekday', [createMockTrip('t3', '490', 3)])  // 8:10
        ]
    };

    const result: ParseResult = {
        routes: [mockRoute],
        errors: []
    };

    const tables = adaptV2ToV1(result);

    console.log(`Generated ${tables.length} tables.`);
    tables.forEach(t => console.log(` - Table: ${t.routeName} with ${t.trips.length} trips`));

    // CHECK 1: Should technically produce 3 tables with current logic (bug)
    // Or 1 table if fixed.
    if (tables.length > 1) {
        console.log("[FAIL] Produced multiple tables for the same route/day. In UI, these will overwrite each other.");

        // Simulating UI Overwrite Logic
        const routeGroups: Record<string, any> = {};
        tables.forEach(table => {
            const baseName = table.routeName;
            routeGroups[baseName] = table; // Overwrite
        });

        const finalTable = routeGroups['10 (Weekday)'];
        console.log(`[UI Simulation] Final Table has ${finalTable.trips.length} trips.`);
        console.log(`[UI Simulation] First Trip Start Time: ${finalTable.trips[0].startTime}`);

        if (finalTable.trips.length < 3) { // We expect 3 trips total if merged
            console.log("[CONFIRMED BUG] UI effectively lost data due to overwrite.");
        }
    } else {
        console.log("[SUCCESS] Produced 1 unified table.");
    }
};

runTest();
