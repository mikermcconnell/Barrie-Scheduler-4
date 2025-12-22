
import { describe, it, expect } from 'vitest';
import { assignBlocksInterlined } from '../utils/blockAssignment';
import { ParsedSection, ParsedTrip } from '../utils/masterScheduleParserV2';

describe('Interline Block Assignment', () => {
    it('should link trips based on Recovery Time', () => {
        // Mock Trips
        // Route 8A: Arrives Allandale at 8:07 (487 min), Recovery 5 min
        const tripA: ParsedTrip = {
            id: 'T1',
            rowIndex: 1,
            tripNumber: 1,
            blockId: '',
            direction: 'North',
            startTime: 400,
            endTime: 487, // 8:07 PM
            stops: {},
            recoveryTimes: { 'Allandale GO': 5 },
            travelTime: 87,
            recoveryTime: 5,
            cycleTime: 92,
            isRecovery: false,
            // Additional fields needed by blockAssignment helper overrides
        } as any;

        // Route 8B: Departs Allandale at 8:12 (492 min)
        const tripB: ParsedTrip = {
            id: 'T2',
            rowIndex: 2,
            tripNumber: 2,
            blockId: '',
            direction: 'North',
            startTime: 492, // 8:12 PM (487 + 5)
            endTime: 550,
            stops: {},
            recoveryTimes: {},
            travelTime: 58,
            recoveryTime: 0,
            cycleTime: 58,
            isRecovery: false
        } as any;

        const sectionA: ParsedSection = {
            dayType: 'Weekday',
            trips: [tripA], // tripA ends at Allandale
            stops: [
                { name: 'Start', id: 'stop-start', columnIndex: 2, isRecovery: false },
                { name: 'Allandale GO', id: 'stop-allandale', columnIndex: 3, isRecovery: false }
            ]
        };

        const sectionB: ParsedSection = {
            dayType: 'Weekday',
            trips: [tripB], // tripB starts at Allandale
            stops: [
                { name: 'Allandale GO', id: 'stop-allandale', columnIndex: 2, isRecovery: false },
                { name: 'End', id: 'stop-end', columnIndex: 3, isRecovery: false }
            ]
        };

        // Run Assignment
        const result = assignBlocksInterlined([
            { section: sectionA, routeName: '8A' },
            { section: sectionB, routeName: '8B' }
        ]);

        // Assert
        expect(result.blocks.length).toBe(1); // Should be unified
        const block = result.blocks[0];
        expect(block.trips.length).toBe(2);
        expect(block.trips[0].routeName).toBe('8A');
        expect(block.trips[1].routeName).toBe('8B');

        // Check Interline Links (stopName was added to the interface)
        expect(block.trips[0].interlineNext).toEqual({ route: '8B', time: 492, stopName: 'Allandale GO' });
        expect(block.trips[1].interlinePrev).toEqual({ route: '8A', time: 487, stopName: 'Allandale GO' });
    });
});
