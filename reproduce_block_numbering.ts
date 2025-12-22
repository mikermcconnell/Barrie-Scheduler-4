
import { assignBlocksToSection, BlockedTrip } from './utils/blockAssignment';
import { ParsedSection, ParsedTrip, StopInfo } from './utils/masterScheduleParserV2';

// Mock Data Setup
const mockStops: StopInfo[] = [
    { name: 'Stop A', id: 'A', columnIndex: 0, isRecovery: false },
    { name: 'Stop B', id: 'B', columnIndex: 1, isRecovery: false }
];

// Helper to create a trip
const createTrip = (id: string, start: number, end: number): ParsedTrip => ({
    rowIndex: 0,
    dayType: 'Weekday',
    timeBand: 'Morning',
    times: {
        'Stop A': String(start), // Just for show
        'Stop B': String(end)
    },
    recoveryTimes: {},
    startTime: start,
    endTime: end,
    travelTime: end - start
});

// Scenario:
// Trip 1: Start 6:00 (360), End 7:00 (420)
// Trip 2: Start 6:10 (370), End 6:20 (380)
// Trip 3: Start 6:20 (380), End 6:50 (410)
//
// Expected Current Behavior (Start Time Sort):
// Order: Trip 1 (360), Trip 2 (370), Trip 3 (380)
// Block 1 -> Trip 1 (Ends 7:00)
// Block 2 -> Trip 2 (Ends 6:20)
// Block 3 -> Trip 3 (Ends 6:50)
// Result: Block 1 ends latest. Block 2 ends earliest.
//
// Desired Behavior (End Time Sort):
// Order: Trip 2 (380), Trip 3 (410), Trip 1 (420)
// Block 1 -> Trip 2 (Ends 6:20)
// Block 2 -> Trip 3 (Ends 6:50)
// Block 3 -> Trip 1 (Ends 7:00)

const trips: ParsedTrip[] = [
    createTrip('Trip1', 360, 420), // 6:00 - 7:00
    createTrip('Trip2', 370, 380), // 6:10 - 6:20
    createTrip('Trip3', 380, 410)  // 6:20 - 6:50
];

const section: ParsedSection = {
    dayType: 'Weekday',
    stops: mockStops,
    trips: trips
};

console.log('--- Running Block Assignment ---');
const result = assignBlocksToSection(section, 'RouteTest');

console.log('\nResult Blocks:');
result.blocks.forEach(b => {
    const firstTrip = b.trips[0];
    console.log(`${b.blockId}: Start ${firstTrip.startTime} -> End ${firstTrip.endTime}`);
});
