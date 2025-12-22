
import { assignBlocksToSection } from './utils/blockAssignment';
import { ParsedSection, ParsedTrip } from './utils/masterScheduleParserV2';

// Mock Trip Helper - creates minimal ParsedTrip for testing
const createTrip = (timeStr: string, minutes: number): ParsedTrip => ({
    rowIndex: 0,
    dayType: 'Weekday',
    timeBand: '',
    times: { 'Start': timeStr },
    recoveryTimes: {},
    startTime: minutes,
    endTime: minutes + 60,
    travelTime: 60
});

const runTest = () => {
    console.log('--- Testing Operational Day Sorting (4am - 3:30am) ---');

    // 5:00 AM = 300 min (Start of Day)
    // 11:00 PM = 1380 min (Late Night)
    // 1:00 AM = 60 min (Very Late Night / Next Morning relative to clock, but END of operational day)

    // Unsorted Input Order
    const trips = [
        createTrip('01:00', 60),   // Should be LAST (Sort Time 1500)
        createTrip('23:00', 1380), // Should be Middle (Sort Time 1380)
        createTrip('05:00', 300)   // Should be FIRST (Sort Time 300)
    ];

    const section: ParsedSection = {
        trips,
        stops: [],
        dayType: 'Weekday'
    };

    const result = assignBlocksToSection(section, 'TestRoute');

    console.log('\nResulting Block Order:');
    result.blocks.forEach(b => {
        const t = b.trips[0];
        console.log(`Block ${b.blockId}: Starts at ${t.startTime} (Raw Min: ${t.startTime})`);
    });

    const b1 = result.blocks[0].trips[0];
    const b2 = result.blocks[1].trips[0];
    const b3 = result.blocks[2].trips[0];

    let passed = true;
    if (b1.startTime !== 300) { console.error('❌ Block 1 should be 5:00 AM'); passed = false; }
    if (b2.startTime !== 1380) { console.error('❌ Block 2 should be 11:00 PM'); passed = false; }
    if (b3.startTime !== 60) { console.error('❌ Block 3 should be 1:00 AM'); passed = false; }

    if (passed) console.log('\n✅ SUCCESS: Operational sorting logic works!');
    else console.log('\n❌ FAILED: Sorting order is incorrect.');
};

runTest();
