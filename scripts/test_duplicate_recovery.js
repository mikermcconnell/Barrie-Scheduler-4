
const runTest = () => {
    console.log("Testing Multiple Recovery Columns Logic...");

    // 1. Simulate Deduplication Logic (V2 Parser)
    const rawStops = [
        { name: "StopA", isRecovery: false },
        { name: "R", isRecovery: true },
        { name: "StopB", isRecovery: false },
        { name: "R", isRecovery: true } // Duplicate Name
    ];

    const stops = [];
    const nameCounts = {};

    // Apply V2 Dedupe Logic
    for (const raw of rawStops) {
        const stop = { ...raw };
        const baseName = stop.name; // Logic applied to ALL columns now
        if (nameCounts[baseName]) {
            nameCounts[baseName]++;
            stop.name = `${baseName} (${nameCounts[baseName]})`;
        } else {
            nameCounts[baseName] = 1;
        }
        stops.push(stop);
    }

    console.log("Deduped Stops:", stops.map(s => s.name));

    // 2. Simulate Trip Data (V2 Parser would produce this with unique keys)
    // If V2 parser honors unique keys, recoveryTimes looks like this:
    const recoveryTimes = {
        "R": 5,
        "R (2)": 10
    };

    // 3. Simulate Adapter Logic
    const remappedRecovery = {};
    let lastStopName = null;

    for (const stop of stops) {
        if (!stop.isRecovery) {
            lastStopName = stop.name;
        } else {
            const val = recoveryTimes[stop.name]; // Lookup using deduped name
            if (val !== undefined && lastStopName) {
                remappedRecovery[lastStopName] = val;
            }
        }
    }

    console.log("Remapped Recovery:", remappedRecovery);

    // 4. Verify
    if (remappedRecovery["StopA"] === 5 && remappedRecovery["StopB"] === 10) {
        console.log("✅ SUCCESS: Both recovery columns mapped correctly.");
    } else {
        console.log("❌ FAIL: Mapping incorrect.");
    }
};

runTest();
