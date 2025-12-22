
import { MasterTrip } from '../utils/masterScheduleParser';
import { smartSortTrips } from '../utils/parserAdapter';

console.log('🔍 Verifying Smart Overlap Sort Logic');

// Helper to create a dummy trip
const createTrip = (id: string, startTime: number, stops: Record<string, string>): MasterTrip => ({
    id,
    startTime,
    tripNumber: 0, // Dummy number
    rowId: 0,
    endTime: 0,
    recoveryTime: 0,
    recoveryTimes: {},
    cycleTime: 0,
    travelTime: 0,
    stops,
    isOverlap: false,
    blockId: id,
    direction: 'North',
    isTightRecovery: false
});

// TEST CASE: The Route 7 Scenario
// Trip A (7-W2): Starts (Park Place) 5:33 -> ... -> Georgian 6:28
// Trip B (7-W3): Starts (Georgian) 5:59

const tripA = createTrip('Trip A (W2)', 333, { // 5:33 AM = 333 min
    'Park Place': '5:33 AM',
    'Georgian College': '6:28 AM' // 388 min
});

const tripB = createTrip('Trip B (W3)', 359, { // 5:59 AM = 359 min
    'Georgian College': '5:59 AM' // 359 min
});

const trips = [tripA, tripB]; // Original order (A starts earlier)

// Smart Sort Logic Test
console.log('\n--- Smart Overlap Sort ---');
const smartSorted = smartSortTrips(trips);
smartSorted.forEach(t => console.log(`${t.id}: Start ${t.startTime}, Georgian ${t.stops['Georgian College']}`));

if (smartSorted[0].id === 'Trip B (W3)') {
    console.log('✅ Success: Trip B comes first (5:59 < 6:28 at Georgian), correcting the column order.');
} else {
    console.error('❌ Failed: Sorting did not correct the order.');
    process.exit(1);
}
