/**
 * Tests for Interline Display Logic
 *
 * Verifies that the interline DEP time lookup works correctly:
 * - Only applies to Route 8A/8B
 * - Only applies at Allandale Terminal
 * - Only applies during interline hours (8pm+ weekday/Sat, all day Sunday)
 * - Returns the next same-route departure time
 */

import { describe, it, expect } from 'vitest';
import { getInterlineDepartureTime } from '../components/schedule/RoundTripTableView';
import type { MasterTrip } from '../utils/masterScheduleParser';

// Helper to create a minimal MasterTrip for testing
const createTrip = (
    id: string,
    startTime: number,
    stops: Record<string, string>,
    direction: 'North' | 'South' = 'North'
): MasterTrip => ({
    id,
    blockId: 'B1',
    direction,
    tripNumber: 1,
    rowId: 1,
    startTime,
    endTime: startTime + 30,
    recoveryTime: 5,
    cycleTime: 35,
    travelTime: 30,
    stops,
    isOverlap: false,
    isTightRecovery: false,
});

describe('Interline Display Logic', () => {
    describe('isInInterlineWindow', () => {
        it('should apply to Sunday trips all day', () => {
            const trip = createTrip('t1', 600, { 'Allandale': '10:00 AM' }); // 10 AM
            const allTrips = [
                trip,
                createTrip('t2', 660, { 'Allandale': '11:00 AM' }), // Next departure at 11 AM
            ];

            const result = getInterlineDepartureTime(trip, 'Allandale', allTrips, '8A (Sunday)');
            expect(result).toBe(660); // Should find next departure
        });

        it('should NOT apply to weekday trips before 8pm', () => {
            const trip = createTrip('t1', 600, { 'Allandale': '10:00 AM' }); // 10 AM = 600 min
            const allTrips = [
                trip,
                createTrip('t2', 660, { 'Allandale': '11:00 AM' }),
            ];

            const result = getInterlineDepartureTime(trip, 'Allandale', allTrips, '8A (Weekday)');
            expect(result).toBeNull(); // Before 8pm, no interline logic
        });

        it('should apply to weekday trips after 8pm', () => {
            const trip = createTrip('t1', 1207, { 'Allandale': '8:07 PM' }); // 8:07 PM
            const allTrips = [
                trip,
                createTrip('t2', 1262, { 'Allandale': '9:02 PM' }), // Next 8A at 9:02 PM
            ];

            const result = getInterlineDepartureTime(trip, 'Allandale', allTrips, '8A (Weekday)');
            expect(result).toBe(1262); // Should find next departure at 9:02 PM
        });

        it('should apply to Saturday trips after 8pm', () => {
            const trip = createTrip('t1', 1230, { 'Allandale': '8:30 PM' });
            const allTrips = [
                trip,
                createTrip('t2', 1290, { 'Allandale': '9:30 PM' }),
            ];

            const result = getInterlineDepartureTime(trip, 'Allandale', allTrips, '8A (Saturday)');
            expect(result).toBe(1290);
        });
    });

    describe('isInterlineRoute', () => {
        it('should only apply to Route 8A', () => {
            const trip = createTrip('t1', 1230, { 'Allandale': '8:30 PM' });
            const allTrips = [trip, createTrip('t2', 1290, { 'Allandale': '9:30 PM' })];

            expect(getInterlineDepartureTime(trip, 'Allandale', allTrips, '8A (Weekday)')).toBe(1290);
        });

        it('should only apply to Route 8B', () => {
            const trip = createTrip('t1', 1230, { 'Allandale': '8:30 PM' });
            const allTrips = [trip, createTrip('t2', 1290, { 'Allandale': '9:30 PM' })];

            expect(getInterlineDepartureTime(trip, 'Allandale', allTrips, '8B (Weekday)')).toBe(1290);
        });

        it('should NOT apply to other routes', () => {
            const trip = createTrip('t1', 1230, { 'Allandale': '8:30 PM' });
            const allTrips = [trip, createTrip('t2', 1290, { 'Allandale': '9:30 PM' })];

            expect(getInterlineDepartureTime(trip, 'Allandale', allTrips, '7 (Weekday)')).toBeNull();
            expect(getInterlineDepartureTime(trip, 'Allandale', allTrips, '100 (Weekday)')).toBeNull();
        });
    });

    describe('direction check (northbound only)', () => {
        it('should apply to NORTHBOUND trips', () => {
            const trip = createTrip('t1', 1230, { 'Allandale': '8:30 PM' }, 'North');
            const allTrips = [trip, createTrip('t2', 1290, { 'Allandale': '9:30 PM' }, 'North')];

            const result = getInterlineDepartureTime(trip, 'Allandale', allTrips, '8A (Weekday)');
            expect(result).toBe(1290);
        });

        it('should NOT apply to SOUTHBOUND trips', () => {
            const trip = createTrip('t1', 1230, { 'Allandale': '8:30 PM' }, 'South');
            const allTrips = [trip, createTrip('t2', 1290, { 'Allandale': '9:30 PM' }, 'South')];

            const result = getInterlineDepartureTime(trip, 'Allandale', allTrips, '8A (Weekday)');
            expect(result).toBeNull(); // Southbound does not interline
        });
    });

    describe('isInterlineStop', () => {
        it('should apply to Allandale Terminal', () => {
            const trip = createTrip('t1', 1230, { 'Barrie Allandale Transit Terminal': '8:30 PM' });
            const allTrips = [trip, createTrip('t2', 1290, { 'Barrie Allandale Transit Terminal': '9:30 PM' })];

            const result = getInterlineDepartureTime(
                trip,
                'Barrie Allandale Transit Terminal',
                allTrips,
                '8A (Weekday)'
            );
            expect(result).toBe(1290);
        });

        it('should match Allandale with platform suffix', () => {
            const trip = createTrip('t1', 1230, { 'Barrie Allandale Transit Terminal - Platform 5': '8:30 PM' });
            const allTrips = [
                trip,
                createTrip('t2', 1290, { 'Barrie Allandale Transit Terminal - Platform 5': '9:30 PM' })
            ];

            const result = getInterlineDepartureTime(
                trip,
                'Barrie Allandale Transit Terminal - Platform 5',
                allTrips,
                '8A (Weekday)'
            );
            expect(result).toBe(1290);
        });

        it('should NOT apply to other stops', () => {
            const trip = createTrip('t1', 1230, { 'Georgian College': '8:30 PM' });
            const allTrips = [trip, createTrip('t2', 1290, { 'Georgian College': '9:30 PM' })];

            const result = getInterlineDepartureTime(trip, 'Georgian College', allTrips, '8A (Weekday)');
            expect(result).toBeNull();
        });
    });

    describe('getInterlineDepartureTime', () => {
        it('should find the NEXT departure after arrival', () => {
            const arrivalTrip = createTrip('t1', 1200, { 'Allandale': '8:07 PM' }); // Arrives 8:07
            const allTrips = [
                arrivalTrip,
                createTrip('t2', 1202, { 'Allandale': '8:02 PM' }), // Before arrival - ignore
                createTrip('t3', 1262, { 'Allandale': '9:02 PM' }), // First after arrival
                createTrip('t4', 1322, { 'Allandale': '10:02 PM' }), // Second after arrival
            ];

            const result = getInterlineDepartureTime(arrivalTrip, 'Allandale', allTrips, '8A (Weekday)');
            expect(result).toBe(1262); // Should be first departure AFTER 8:07 PM
        });

        it('should return null if no next departure exists', () => {
            const lastTrip = createTrip('t1', 1380, { 'Allandale': '11:00 PM' }); // Last trip of night
            const allTrips = [lastTrip];

            const result = getInterlineDepartureTime(lastTrip, 'Allandale', allTrips, '8A (Weekday)');
            expect(result).toBeNull();
        });

        it('should not return the same trip', () => {
            const trip = createTrip('t1', 1230, { 'Allandale': '8:30 PM' });
            const allTrips = [trip]; // Only this trip exists

            const result = getInterlineDepartureTime(trip, 'Allandale', allTrips, '8A (Weekday)');
            expect(result).toBeNull();
        });

        it('should handle the realistic 8A/8B interline scenario', () => {
            // Realistic scenario:
            // 8A arrives Allandale at 8:07 PM (trip ends)
            // Bus becomes 8B, departs 8:12 PM (not our concern - different route)
            // 8B does its loop...
            // Next 8A departs Allandale at 8:42 PM (this is what DEP should show)

            const trip8A_1 = createTrip('8a-1', 1150, { 'Allandale': '8:07 PM' }); // Arrives 8:07
            const trip8A_2 = createTrip('8a-2', 1262, { 'Allandale': '8:42 PM' }); // Next 8A departs 8:42

            const allTrips8A = [trip8A_1, trip8A_2];

            const result = getInterlineDepartureTime(trip8A_1, 'Allandale', allTrips8A, '8A (Weekday)');
            expect(result).toBe(1242); // DEP should show 8:42 PM (1242 minutes = 20*60+42)

            // The gap (8:07 -> 8:42 = 35 minutes) indicates interline occurred
            // Bus spent this time running as 8B
        });
    });
});
