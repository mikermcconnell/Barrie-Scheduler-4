
// Mock structures based on V2, Adapter, and UI
// We want to simulate valid inputs to adaptV2ToV1 and see the output keys

const runTest = () => {
    // 1. Mock V2 Result
    const mockStops = [
        { name: "Downtown", isRecovery: false, id: "1" },
        { name: "R", isRecovery: true, id: "" },
        { name: "Leacock", isRecovery: false, id: "2" }
    ];

    const mockTrip = {
        rowIndex: 2,
        dayType: 'Weekday',
        timeBand: 'Morning',
        times: { "Downtown": "10:00", "Leacock": "10:30" },
        // CURRENT BUGGY STATE: Keys are "R"
        recoveryTimes: { "R": 5 },
        startTime: 600,
        endTime: 630,
        travelTime: 30
    };

    const mockSection = {
        dayType: 'Weekday',
        stops: mockStops,
        trips: [mockTrip]
    };

    const mockRoute = {
        routeName: "Test Route",
        sections: [mockSection]
    };

    // 2. Mock Adapter Logic (convertTrip being the critical part)
    // This duplicates the CURRENT implementation in parserAdapter.ts
    const convertTrip_Current = (trip, stops) => {
        return {
            id: 'T-1',
            // ... other fields
            // BUG: Helper just passes the map through
            recoveryTimes: trip.recoveryTimes,
            recoveryTime: 5
        };
    };

    const convertedTrip = convertTrip_Current(mockTrip, mockStops);

    console.log("Converted Trip Recovery Times Keys:", Object.keys(convertedTrip.recoveryTimes));

    // 3. Verify Mismatch
    // UI expects key "Downtown" (the stop before "R")
    if (convertedTrip.recoveryTimes["Downtown"] === 5) {
        console.log("✅ SUCCESS: Found recovery for Downtown");
    } else {
        console.log("❌ FAIL: Did not find recovery for Downtown. Found: " + JSON.stringify(convertedTrip.recoveryTimes));
    }

    // 4. Proposed Fix Logic
    console.log("\nTesting Proposed Fix...");

    const remappedRecovery = {};
    let lastStopName = null;

    for (const stop of mockStops) {
        if (!stop.isRecovery) {
            lastStopName = stop.name;
        } else {
            // It's a recovery column. Check if we have data for THIS column name "R"
            const val = mockTrip.recoveryTimes[stop.name];
            if (val !== undefined && lastStopName) {
                remappedRecovery[lastStopName] = val;
            }
        }
    }

    console.log("Fixed Recovery Map:", remappedRecovery);
    if (remappedRecovery["Downtown"] === 5) {
        console.log("✅ FIXED: Found recovery for Downtown");
    }
};

runTest();
