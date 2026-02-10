import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/masterScheduleParser';
import { reassignBlocksForTables, MatchConfigPresets } from '../utils/blockAssignmentCore';

const createTrip = (
    id: string,
    startTime: number,
    endTime: number,
    recoveryAtTerminal: number,
    endTimeIncludesRecovery?: boolean
): MasterTrip => ({
    id,
    blockId: 'Unassigned',
    direction: 'North',
    tripNumber: 0,
    rowId: 0,
    startTime,
    endTime,
    recoveryTime: recoveryAtTerminal,
    recoveryTimes: { Terminal: recoveryAtTerminal },
    travelTime: Math.max(0, endTime - startTime),
    cycleTime: Math.max(0, endTime - startTime),
    stops: {
        Terminal: '6:00 AM',
        Mid: '6:15 AM'
    },
    endTimeIncludesRecovery
});

const createLoopTable = (trips: MasterTrip[]): MasterRouteTable => ({
    routeName: '10 (Weekday) (North)',
    // Loop route: first and last stop match, so location continuity is valid.
    stops: ['Terminal', 'Mid', 'Terminal'],
    stopIds: {},
    trips
});

describe('blockAssignmentCore endTime handling', () => {
    it('links trips when endTime is arrival and terminal recovery is separate', () => {
        const table = createLoopTable([
            createTrip('t1', 360, 390, 5, false), // 6:00 -> 6:30, +5 recovery => next at 6:35
            createTrip('t2', 395, 425, 0, false)
        ]);

        reassignBlocksForTables([table], '10', MatchConfigPresets.exact);

        expect(table.trips[0].blockId).toBe(table.trips[1].blockId);
        expect(table.trips[0].tripNumber).toBe(1);
        expect(table.trips[1].tripNumber).toBe(2);
    });

    it('links trips when endTime already includes terminal recovery', () => {
        const table = createLoopTable([
            createTrip('t1', 360, 395, 5, true), // 6:00 -> 6:35 already includes recovery
            createTrip('t2', 395, 425, 0, true)
        ]);

        reassignBlocksForTables([table], '10', MatchConfigPresets.exact);

        expect(table.trips[0].blockId).toBe(table.trips[1].blockId);
        expect(table.trips[0].tripNumber).toBe(1);
        expect(table.trips[1].tripNumber).toBe(2);
    });

    it('links across ARRIVE/DEPART split terminal when stop IDs match', () => {
        const north: MasterRouteTable = {
            routeName: '12 (Weekday) (North)',
            stops: ['B. SOUTH GO', 'ARRIVE GEORGIAN'],
            stopIds: {
                'B. SOUTH GO': '725',
                'ARRIVE GEORGIAN': '441'
            },
            trips: [{
                id: 'n1',
                blockId: 'Unassigned',
                direction: 'North',
                tripNumber: 0,
                rowId: 0,
                startTime: 336, // 5:36
                endTime: 404,   // 6:44 departure-equivalent (includes distributed recovery)
                endTimeIncludesRecovery: true,
                recoveryTime: 15,
                recoveryTimes: { 'ARRIVE GEORGIAN': 0 },
                travelTime: 53,
                cycleTime: 68,
                stops: {
                    'B. SOUTH GO': '5:36 AM',
                    'ARRIVE GEORGIAN': '6:29 AM' // Arrival display can be earlier than endTime
                }
            }]
        };

        const south: MasterRouteTable = {
            routeName: '12 (Weekday) (South)',
            stops: ['DEPART GEORGIAN', 'B. SOUTH GO'],
            stopIds: {
                'DEPART GEORGIAN': '441',
                'B. SOUTH GO': '725'
            },
            trips: [{
                id: 's1',
                blockId: 'Unassigned',
                direction: 'South',
                tripNumber: 0,
                rowId: 0,
                startTime: 404, // 6:44, matches north departure-equivalent endTime
                endTime: 457,
                endTimeIncludesRecovery: true,
                recoveryTime: 0,
                recoveryTimes: {},
                travelTime: 53,
                cycleTime: 53,
                stops: {
                    'DEPART GEORGIAN': '6:44 AM',
                    'B. SOUTH GO': '7:37 AM'
                }
            }]
        };

        reassignBlocksForTables([north, south], '12', MatchConfigPresets.exact);

        expect(north.trips[0].blockId).toBe(south.trips[0].blockId);
        expect(north.trips[0].tripNumber).toBe(1);
        expect(south.trips[0].tripNumber).toBe(2);
    });

    it('supports terminal layover gaps for generated schedules via maxGap', () => {
        const north: MasterRouteTable = {
            routeName: '12 (Weekday) (North)',
            stops: ['B. SOUTH GO', 'ARRIVE GEORGIAN'],
            stopIds: {
                'B. SOUTH GO': '725',
                'ARRIVE GEORGIAN': '441'
            },
            trips: [{
                id: 'n-gap-1',
                blockId: 'Unassigned',
                direction: 'North',
                tripNumber: 0,
                rowId: 0,
                startTime: 336, // 5:36
                endTime: 389,   // 6:29
                endTimeIncludesRecovery: true,
                recoveryTime: 0,
                recoveryTimes: {},
                travelTime: 53,
                cycleTime: 53,
                stops: {
                    'B. SOUTH GO': '5:36 AM',
                    'ARRIVE GEORGIAN': '6:29 AM'
                }
            }]
        };

        const south: MasterRouteTable = {
            routeName: '12 (Weekday) (South)',
            stops: ['DEPART GEORGIAN', 'B. SOUTH GO'],
            stopIds: {
                'DEPART GEORGIAN': '441',
                'B. SOUTH GO': '725'
            },
            trips: [{
                id: 's-gap-1',
                blockId: 'Unassigned',
                direction: 'South',
                tripNumber: 0,
                rowId: 0,
                startTime: 404, // 6:44 (15-minute layover after north arrival)
                endTime: 457,
                endTimeIncludesRecovery: true,
                recoveryTime: 0,
                recoveryTimes: {},
                travelTime: 53,
                cycleTime: 53,
                stops: {
                    'DEPART GEORGIAN': '6:44 AM',
                    'B. SOUTH GO': '7:37 AM'
                }
            }]
        };

        reassignBlocksForTables([north, south], '12', {
            timeTolerance: 1,
            checkLocation: true,
            maxGap: 30
        });

        expect(north.trips[0].blockId).toBe(south.trips[0].blockId);
        expect(north.trips[0].tripNumber).toBe(1);
        expect(south.trips[0].tripNumber).toBe(2);
    });
});
