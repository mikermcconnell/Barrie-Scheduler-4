
import { assignBlocksToSection } from './utils/blockAssignment';
import { ParsedSection, StopInfo, ParsedTrip } from './utils/masterScheduleParserV2';

// Simulate Route 10 data from screenshot
const stops: StopInfo[] = [
    { name: 'DOWNTOWN #1', id: '1', columnIndex: 2, isRecovery: false },
    { name: 'LEACOCK AT FROST #898', id: '898', columnIndex: 3, isRecovery: false },
    { name: 'R', id: '', columnIndex: 4, isRecovery: true },
    { name: 'LEACOCK AT FROST #898 (2)', id: '898', columnIndex: 5, isRecovery: false },
    { name: 'GEORGIAN MALL #441', id: '441', columnIndex: 6, isRecovery: false },
    { name: 'R', id: '', columnIndex: 7, isRecovery: true },
    { name: 'GEORGIAN MALL #441 (2)', id: '441', columnIndex: 8, isRecovery: false },
    { name: 'GEORGIAN COLLEGE #335', id: '335', columnIndex: 9, isRecovery: false },
    { name: 'R', id: '', columnIndex: 10, isRecovery: true },
    { name: 'GEORGIAN COLLEGE #335 (2)', id: '335', columnIndex: 11, isRecovery: false },
    { name: 'DOWNTOWN #1 (2)', id: '1', columnIndex: 12, isRecovery: false },
    { name: 'R', id: '', columnIndex: 13, isRecovery: true }, // Screenshot shows "R" before final "DOWNTOWN"
    { name: 'DOWNTOWN #1 (3)', id: '1', columnIndex: 14, isRecovery: false },
];

const createTrip = (rowIndex: number, startHour: number, startMin: number): ParsedTrip => {
    const startTotal = startHour * 60 + startMin;
    const endTotal = startTotal + 60; // 60 min loop
    return {
        rowIndex,
        dayType: 'Weekday',
        timeBand: 'Morning',
        times: {
            'DOWNTOWN #1': `${startHour}:${startMin.toString().padStart(2, '0')} AM`,
            'DOWNTOWN #1 (2)': `${(startHour)}:${(startMin + 55).toString().padStart(2, '0')} AM`, // dummy time
            'DOWNTOWN #1 (3)': `${(startHour + 1)}:${startMin.toString().padStart(2, '0')} AM`,
        },
        recoveryTimes: {
            'DOWNTOWN #1 (2)': 5, // Recovery of 5 mins BEFORE the last stop
        },
        startTime: startTotal,
        endTime: endTotal,
        travelTime: 60
    };
};

// 10-1 starts at 5:40 AM, ends at 6:40 AM
const trip1 = createTrip(1, 5, 40);
// 10-3 starts at 6:40 AM, ends at 7:40 AM
const trip3 = createTrip(3, 6, 40);

const section: ParsedSection = {
    dayType: 'Weekday',
    stops,
    trips: [trip1, trip3]
};

console.log('--- Running Block Assignment ---');
const result = assignBlocksToSection(section, '10');

console.log(`Total Blocks: ${result.blocks.length}`);
result.blocks.forEach(b => {
    console.log(`Block ${b.blockId}: Trips [${b.trips.map(t => t.rowIndex).join(', ')}]`);
});

if (result.blocks.length > 1) {
    console.log('FAIL: Trips were not linked into a single block.');
} else {
    console.log('SUCCESS: Trips were linked into a single block.');
}
