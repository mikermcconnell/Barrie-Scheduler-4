
import { assignBlocksBidirectional } from './utils/blockAssignment';
import { ParsedSection, StopInfo, ParsedTrip } from './utils/masterScheduleParserV2';

const northStops: StopInfo[] = [
    { name: 'SOUTH TERM', id: 'S', columnIndex: 2, isRecovery: false },
    { name: 'NORTH TERM', id: 'N', columnIndex: 3, isRecovery: false },
    { name: 'R', id: '', columnIndex: 4, isRecovery: true },
];

const southStops: StopInfo[] = [
    { name: 'NORTH TERM', id: 'N', columnIndex: 2, isRecovery: false },
    { name: 'SOUTH TERM', id: 'S', columnIndex: 3, isRecovery: false },
    { name: 'R', id: '', columnIndex: 4, isRecovery: true },
];

const createTrip = (rowIndex: number, direction: 'North' | 'South', startTotal: number): ParsedTrip => {
    return {
        rowIndex,
        dayType: 'Weekday',
        timeBand: 'Morning',
        times: {
            [direction === 'North' ? 'SOUTH TERM' : 'NORTH TERM']: `${Math.floor(startTotal / 60)}:${(startTotal % 60).toString().padStart(2, '0')}`,
            [direction === 'North' ? 'NORTH TERM' : 'SOUTH TERM']: `${Math.floor((startTotal + 30) / 60)}:${((startTotal + 30) % 60).toString().padStart(2, '0')}`,
        },
        recoveryTimes: {
            [direction === 'North' ? 'NORTH TERM' : 'SOUTH TERM']: 5, // 5 min recovery at end of EVERY trip
        },
        startTime: startTotal,
        endTime: startTotal + 30,
        travelTime: 30
    };
};

// Sequence:
// B1 Trip 1: North 8u:00 - 8:30. Rec 5. Exp: 8:35.
// B1 Trip 2: South 8:35 - 9:05. Rec 5. Exp: 9:10.
// B1 Trip 3: North 9:10 - 9:40.
const trip1 = createTrip(1, 'North', 480); // 8:00
const trip2 = createTrip(2, 'South', 515); // 8:35
const trip3 = createTrip(3, 'North', 550); // 9:10

const northSection: ParsedSection = {
    dayType: 'Weekday',
    stops: northStops,
    trips: [trip1, trip3]
};

const southSection: ParsedSection = {
    dayType: 'Weekday',
    stops: southStops,
    trips: [trip2]
};

console.log('--- Running Bidirectional Block Assignment ---');
const result = assignBlocksBidirectional(northSection, southSection, '7');

console.log(`Total Blocks: ${result.blocks.length}`);
result.blocks.forEach(b => {
    console.log(`Block ${b.blockId}: Trips [${b.trips.map(t => `${t.direction} ${t.rowIndex}`).join(', ')}]`);
});

if (result.blocks.length === 1 && result.blocks[0].trips.length === 3) {
    console.log('SUCCESS: All 3 trips were linked into a single bidirectional block.');
} else {
    console.log('FAIL: Trips were not linked correctly.');
    process.exit(1);
}
