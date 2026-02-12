/**
 * Golden Path Integration Test — Schedule Generator
 *
 * Tests the full generateSchedule pipeline with realistic Route 7 inputs:
 * - 3 stops per direction (round trip)
 * - 2 blocks covering morning service (06:00 – 09:00)
 * - 2 time bands (peak + midday)
 *
 * Validates: trip count, time progression, block assignment, stop structure,
 * and the fundamental invariants that should never regress.
 */
import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../utils/schedule/scheduleGenerator';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { TripBucketAnalysis, TimeBand, DirectionBandSummary } from '../utils/ai/runtimeAnalysis';
import type { SegmentRawData } from '../components/NewSchedule/utils/csvParser';

// ── Realistic Route 7 fixtures (3 stops, round trip, 2 bands) ──

const config: ScheduleConfig = {
    routeNumber: '7',
    cycleMode: 'Strict',
    cycleTime: 60,   // 60-minute cycle
    blocks: [
        { id: '7-1', startTime: '06:00', endTime: '09:00', startStop: 'Park Place' },
        { id: '7-2', startTime: '06:30', endTime: '09:30', startStop: 'Park Place' }
    ]
};

const buckets: TripBucketAnalysis[] = [
    {
        timeBucket: '06:00 - 06:29',
        totalP50: 50,
        totalP80: 55,
        assignedBand: 'A',
        isOutlier: false,
        ignored: false,
        details: [
            { segmentName: 'Park Place to Georgian College', p50: 12, p80: 14 },
            { segmentName: 'Georgian College to Rose Street', p50: 13, p80: 15 },
            { segmentName: 'Rose Street to Georgian College', p50: 12, p80: 14 },
            { segmentName: 'Georgian College to Park Place', p50: 13, p80: 15 }
        ]
    },
    {
        timeBucket: '06:30 - 06:59',
        totalP50: 50,
        totalP80: 55,
        assignedBand: 'A',
        isOutlier: false,
        ignored: false,
        details: [
            { segmentName: 'Park Place to Georgian College', p50: 12, p80: 14 },
            { segmentName: 'Georgian College to Rose Street', p50: 13, p80: 15 },
            { segmentName: 'Rose Street to Georgian College', p50: 12, p80: 14 },
            { segmentName: 'Georgian College to Park Place', p50: 13, p80: 15 }
        ]
    },
    {
        timeBucket: '07:00 - 07:29',
        totalP50: 52,
        totalP80: 58,
        assignedBand: 'B',
        isOutlier: false,
        ignored: false,
        details: [
            { segmentName: 'Park Place to Georgian College', p50: 13, p80: 15 },
            { segmentName: 'Georgian College to Rose Street', p50: 13, p80: 15 },
            { segmentName: 'Rose Street to Georgian College', p50: 13, p80: 15 },
            { segmentName: 'Georgian College to Park Place', p50: 13, p80: 15 }
        ]
    }
];

const bands: TimeBand[] = [
    { id: 'A', label: 'Early Morning', min: 50, max: 50, avg: 50, color: '#ef4444', count: 2 },
    { id: 'B', label: 'Morning Peak', min: 52, max: 52, avg: 52, color: '#f59e0b', count: 1 }
];

const bandSummary: DirectionBandSummary = {
    North: [
        {
            bandId: 'A', color: '#ef4444', avgTotal: 25,
            segments: [
                { segmentName: 'Park Place to Georgian College', avgTime: 12 },
                { segmentName: 'Georgian College to Rose Street', avgTime: 13 }
            ],
            timeSlots: ['06:00', '06:30']
        },
        {
            bandId: 'B', color: '#f59e0b', avgTotal: 26,
            segments: [
                { segmentName: 'Park Place to Georgian College', avgTime: 13 },
                { segmentName: 'Georgian College to Rose Street', avgTime: 13 }
            ],
            timeSlots: ['07:00']
        }
    ],
    South: [
        {
            bandId: 'A', color: '#ef4444', avgTotal: 25,
            segments: [
                { segmentName: 'Rose Street to Georgian College', avgTime: 12 },
                { segmentName: 'Georgian College to Park Place', avgTime: 13 }
            ],
            timeSlots: ['06:00', '06:30']
        },
        {
            bandId: 'B', color: '#f59e0b', avgTotal: 26,
            segments: [
                { segmentName: 'Rose Street to Georgian College', avgTime: 13 },
                { segmentName: 'Georgian College to Park Place', avgTime: 13 }
            ],
            timeSlots: ['07:00']
        }
    ]
};

const segmentsMap: Record<string, SegmentRawData[]> = {
    North: [
        { segmentName: 'Park Place to Georgian College', timeBuckets: { '06:00 - 06:29': { p50: 12, p80: 14 }, '06:30 - 06:59': { p50: 12, p80: 14 }, '07:00 - 07:29': { p50: 13, p80: 15 } } },
        { segmentName: 'Georgian College to Rose Street', timeBuckets: { '06:00 - 06:29': { p50: 13, p80: 15 }, '06:30 - 06:59': { p50: 13, p80: 15 }, '07:00 - 07:29': { p50: 13, p80: 15 } } }
    ],
    South: [
        { segmentName: 'Rose Street to Georgian College', timeBuckets: { '06:00 - 06:29': { p50: 12, p80: 14 }, '06:30 - 06:59': { p50: 12, p80: 14 }, '07:00 - 07:29': { p50: 13, p80: 15 } } },
        { segmentName: 'Georgian College to Park Place', timeBuckets: { '06:00 - 06:29': { p50: 13, p80: 15 }, '06:30 - 06:59': { p50: 13, p80: 15 }, '07:00 - 07:29': { p50: 13, p80: 15 } } }
    ]
};

describe('Schedule Generator — Golden Path Integration', () => {

    const tables = generateSchedule(config, buckets, bands, bandSummary, segmentsMap, 'Weekday');

    it('returns at least one table', () => {
        expect(tables.length).toBeGreaterThanOrEqual(1);
    });

    it('all tables have route number "7"', () => {
        for (const table of tables) {
            // routeName includes dayType and direction, e.g. "7 (Weekday) (North)"
            expect(table.routeName).toContain('7');
        }
    });

    it('generates trips (non-empty schedule)', () => {
        const totalTrips = tables.reduce((sum, t) => sum + t.trips.length, 0);
        expect(totalTrips).toBeGreaterThan(0);
    });

    it('trip times progress forward within same block (no time-travel)', () => {
        for (const table of tables) {
            for (let i = 1; i < table.trips.length; i++) {
                const prevTrip = table.trips[i - 1];
                const currTrip = table.trips[i];
                // Same block: next trip must start same or later
                if (prevTrip.blockId && currTrip.blockId && prevTrip.blockId === currTrip.blockId) {
                    const prevStart = prevTrip.startTime;
                    const currStart = currTrip.startTime;
                    expect(currStart).toBeGreaterThanOrEqual(prevStart);
                }
            }
        }
    });

    it('every trip has stop departure times', () => {
        for (const table of tables) {
            for (const trip of table.trips) {
                // MasterTrip.stops is Record<string, string> — departure times per stop
                expect(Object.keys(trip.stops).length).toBeGreaterThanOrEqual(1);
            }
        }
    });

    it('block IDs are assigned from config', () => {
        const allBlockIds = tables.flatMap(t => t.trips.map(trip => trip.blockId)).filter(Boolean);
        expect(allBlockIds.length).toBeGreaterThan(0);
        // All assigned block IDs should come from our config
        const configBlockIds = config.blocks!.map(b => b.id);
        for (const blockId of allBlockIds) {
            expect(configBlockIds).toContain(blockId);
        }
    });

    it('tables have correct stop structure', () => {
        for (const table of tables) {
            // MasterRouteTable.stops is string[] of stop names
            expect(table.stops.length).toBeGreaterThanOrEqual(2);
            // Stop names should include our route's timepoints
            const hasKnownStop = table.stops.some(name =>
                name.includes('Park Place') || name.includes('Georgian College') || name.includes('Rose Street')
            );
            expect(hasKnownStop).toBe(true);
        }
    });

    it('trips have valid direction (North or South)', () => {
        for (const table of tables) {
            for (const trip of table.trips) {
                expect(['North', 'South']).toContain(trip.direction);
            }
        }
    });

    it('no trip has negative travel time', () => {
        for (const table of tables) {
            for (const trip of table.trips) {
                expect(trip.travelTime).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('stop departure times progress forward within each trip', () => {
        for (const table of tables) {
            for (const trip of table.trips) {
                const stopTimes = Object.values(trip.stops)
                    .map(parseTimeStr)
                    .filter((t): t is number => t !== null);
                for (let i = 1; i < stopTimes.length; i++) {
                    expect(stopTimes[i]).toBeGreaterThanOrEqual(stopTimes[i - 1]);
                }
            }
        }
    });
});

// ── Helpers ──

function parseTimeStr(str: string): number | null {
    if (!str || str.trim() === '') return null;
    const parts = str.split(':');
    if (parts.length !== 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}
