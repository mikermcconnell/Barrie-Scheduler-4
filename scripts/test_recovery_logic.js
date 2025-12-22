// import { MasterTrip } from '../utils/masterScheduleParser';

// Mock TimeUtils
const TimeUtils = {
    toMinutes: (timeStr) => {
        if (!timeStr) return null;
        let [hStr, mStr] = timeStr.split(':');
        let m = parseInt(mStr.replace(/\D+$/g, ''));
        let h = parseInt(hStr);
        if (timeStr.includes('PM') && h !== 12) h += 12;
        if (timeStr.includes('AM') && h === 12) h = 0;
        return (h * 60) + m;
    },
    fromMinutes: (totalMinutes) => {
        let h = Math.floor(totalMinutes / 60);
        const m = Math.round(totalMinutes % 60);
        const period = h >= 12 && h < 24 ? 'PM' : 'AM';
        if (h > 12) h -= 12;
        if (h === 0) h = 12;
        return `${h}:${(m % 60).toString().padStart(2, '0')} ${period}`;
    }
};

// Mock Test
const runTest = () => {
    console.log("Starting Recovery Logic Test...");

    // Setup Mock Trip
    const trip = {
        id: 'T-1',
        stops: {
            'Leacock Arrive': '5:53 AM',
            'Leacock Depart': '5:56 AM',
            'Georgian': '6:08 AM'
        },
        recoveryTimes: {
            'Leacock Arrive': 3
        },
        recoveryTime: 3
    };

    const tableStops = ['Leacock Arrive', 'Leacock Depart', 'Georgian'];

    // Simulate Edit: Change 5:53 AM -> 5:54 AM
    const col = 'Leacock Arrive';
    const val = '5:54 AM';

    console.log(`Editing ${col} to ${val}...`);
    trip.stops[col] = val;

    // Logic from FixedRouteWorkspace
    const recoveryMin = trip.recoveryTimes?.[col];
    if (recoveryMin && recoveryMin > 0) {
        const colIdx = tableStops.indexOf(col);
        if (colIdx !== -1 && colIdx < tableStops.length - 1) {
            const nextCol = tableStops[colIdx + 1];
            const currentMin = TimeUtils.toMinutes(val);

            if (currentMin !== null) {
                const newNextTime = TimeUtils.fromMinutes(currentMin + recoveryMin);
                trip.stops[nextCol] = newNextTime;
                console.log(`Updated ${nextCol} to ${newNextTime}`);
            }
        }
    }

    // Verify
    const expected = '5:57 AM';
    if (trip.stops['Leacock Depart'] === expected) {
        console.log("✅ PASSED: Departure updated correctly.");
    } else {
        console.error(`❌ FAILED: Expected ${expected}, got ${trip.stops['Leacock Depart']}`);
    }
};

runTest();
