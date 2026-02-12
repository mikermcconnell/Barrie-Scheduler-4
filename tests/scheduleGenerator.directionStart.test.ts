import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../utils/schedule/scheduleGenerator';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { TripBucketAnalysis, TimeBand, DirectionBandSummary } from '../utils/ai/runtimeAnalysis';
import type { SegmentRawData } from '../components/NewSchedule/utils/csvParser';

// Shared Route 7 test fixtures (3 stops per direction, Georgian College is mid-route)
const route7Buckets: TripBucketAnalysis[] = [
    {
        timeBucket: '06:00 - 06:29',
        totalP50: 40,
        totalP80: 45,
        assignedBand: 'A',
        isOutlier: false,
        ignored: false,
        details: [
            { segmentName: 'Park Place to Georgian College', p50: 10, p80: 12 },
            { segmentName: 'Georgian College to Rose Street', p50: 10, p80: 12 },
            { segmentName: 'Rose Street to Georgian College', p50: 10, p80: 12 },
            { segmentName: 'Georgian College to Park Place', p50: 10, p80: 12 }
        ]
    }
];

const route7Bands: TimeBand[] = [
    { id: 'A', label: 'Band A', min: 40, max: 40, avg: 40, color: '#ef4444', count: 1 }
];

const route7BandSummary: DirectionBandSummary = {
    North: [{
        bandId: 'A',
        color: '#ef4444',
        avgTotal: 40,
        segments: [
            { segmentName: 'Park Place to Georgian College', avgTime: 10 },
            { segmentName: 'Georgian College to Rose Street', avgTime: 10 }
        ],
        timeSlots: ['06:00']
    }],
    South: [{
        bandId: 'A',
        color: '#ef4444',
        avgTotal: 40,
        segments: [
            { segmentName: 'Rose Street to Georgian College', avgTime: 10 },
            { segmentName: 'Georgian College to Park Place', avgTime: 10 }
        ],
        timeSlots: ['06:00']
    }]
};

const route7SegmentsMap: Record<string, SegmentRawData[]> = {
    North: [
        {
            segmentName: 'Park Place to Georgian College',
            timeBuckets: { '06:00 - 06:29': { p50: 10, p80: 12 } }
        },
        {
            segmentName: 'Georgian College to Rose Street',
            timeBuckets: { '06:00 - 06:29': { p50: 10, p80: 12 } }
        }
    ],
    South: [
        {
            segmentName: 'Rose Street to Georgian College',
            timeBuckets: { '06:00 - 06:29': { p50: 10, p80: 12 } }
        },
        {
            segmentName: 'Georgian College to Park Place',
            timeBuckets: { '06:00 - 06:29': { p50: 10, p80: 12 } }
        }
    ]
};

describe('scheduleGenerator start direction selection', () => {
    it('treats suffix and ARR/DEP variations as the same terminal when choosing first direction', () => {
        const config: ScheduleConfig = {
            routeNumber: '8A',
            cycleMode: 'Strict',
            cycleTime: 30,
            blocks: [
                {
                    id: '8A-1',
                    startTime: '06:00',
                    endTime: '06:31',
                    startStop: 'DEPART Park Place (2)'
                }
            ]
        };

        const buckets: TripBucketAnalysis[] = [
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 20,
                totalP80: 25,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'Park Place to Georgian College', p50: 10, p80: 12 },
                    { segmentName: 'Georgian College to Park Place', p50: 10, p80: 13 }
                ]
            }
        ];

        const bands: TimeBand[] = [
            { id: 'A', label: 'Band A', min: 20, max: 20, avg: 20, color: '#ef4444', count: 1 }
        ];

        const bandSummary: DirectionBandSummary = {
            North: [{
                bandId: 'A',
                color: '#ef4444',
                avgTotal: 20,
                segments: [{ segmentName: 'Park Place to Georgian College', avgTime: 10 }],
                timeSlots: ['06:00']
            }],
            South: [{
                bandId: 'A',
                color: '#ef4444',
                avgTotal: 20,
                segments: [{ segmentName: 'Georgian College to Park Place', avgTime: 10 }],
                timeSlots: ['06:00']
            }]
        };

        const segmentsMap: Record<string, SegmentRawData[]> = {
            North: [{
                segmentName: 'Park Place to Georgian College',
                timeBuckets: {
                    '06:00 - 06:29': { p50: 10, p80: 12 }
                }
            }],
            South: [{
                segmentName: 'Georgian College to Park Place',
                timeBuckets: {
                    '06:00 - 06:29': { p50: 10, p80: 13 }
                }
            }]
        };

        const tables = generateSchedule(config, buckets, bands, bandSummary, segmentsMap, 'Weekday');
        const northTable = tables.find(t => t.routeName.includes('(North)'));
        const southTable = tables.find(t => t.routeName.includes('(South)'));

        expect(northTable).toBeDefined();
        expect(southTable).toBeDefined();

        // The first trip should start in North because Park Place matches North origin.
        expect(northTable!.trips[0].startTime).toBe(360);
        expect(southTable!.trips[0].startTime).toBeGreaterThan(360);
    });

    it('matches Park Place against PARK PL abbreviations when picking first direction', () => {
        const config: ScheduleConfig = {
            routeNumber: '8A',
            cycleMode: 'Strict',
            cycleTime: 30,
            blocks: [
                {
                    id: '8A-1',
                    startTime: '06:00',
                    endTime: '06:31',
                    startStop: 'Park Place'
                }
            ]
        };

        const buckets: TripBucketAnalysis[] = [
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 20,
                totalP80: 25,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [
                    { segmentName: 'B. SOUTH GO to PARK PL', p50: 10, p80: 12 },
                    { segmentName: 'PARK PLACE to GEORGIAN COLLEGE', p50: 10, p80: 12 }
                ]
            }
        ];

        const bands: TimeBand[] = [
            { id: 'A', label: 'Band A', min: 20, max: 20, avg: 20, color: '#ef4444', count: 1 }
        ];

        const bandSummary: DirectionBandSummary = {
            North: [{
                bandId: 'A',
                color: '#ef4444',
                avgTotal: 20,
                segments: [
                    { segmentName: 'B. SOUTH GO to PARK PL', avgTime: 5 },
                    { segmentName: 'PARK PL to GEORGIAN COLLEGE', avgTime: 5 }
                ],
                timeSlots: ['06:00']
            }],
            South: [{
                bandId: 'A',
                color: '#ef4444',
                avgTotal: 20,
                segments: [
                    { segmentName: 'PARK PLACE to GEORGIAN COLLEGE', avgTime: 5 },
                    { segmentName: 'GEORGIAN COLLEGE to B SOUTH GO', avgTime: 5 }
                ],
                timeSlots: ['06:00']
            }]
        };

        const segmentsMap: Record<string, SegmentRawData[]> = {
            North: [
                {
                    segmentName: 'B. SOUTH GO to PARK PL',
                    timeBuckets: { '06:00 - 06:29': { p50: 5, p80: 6 } }
                },
                {
                    segmentName: 'PARK PL to GEORGIAN COLLEGE',
                    timeBuckets: { '06:00 - 06:29': { p50: 5, p80: 6 } }
                }
            ],
            South: [
                {
                    segmentName: 'PARK PLACE to GEORGIAN COLLEGE',
                    timeBuckets: { '06:00 - 06:29': { p50: 5, p80: 6 } }
                },
                {
                    segmentName: 'GEORGIAN COLLEGE to B SOUTH GO',
                    timeBuckets: { '06:00 - 06:29': { p50: 5, p80: 6 } }
                }
            ]
        };

        const tables = generateSchedule(config, buckets, bands, bandSummary, segmentsMap, 'Weekday');
        const northTable = tables.find(t => t.routeName.includes('(North)'));
        const southTable = tables.find(t => t.routeName.includes('(South)'));

        expect(northTable).toBeDefined();
        expect(southTable).toBeDefined();

        expect(southTable!.trips[0].startTime).toBe(360);
        expect(northTable!.trips[0].startTime).toBeGreaterThan(360);
    });

    it('uses startDirection to resolve ambiguous mid-route stop (Route 7 Georgian College → South)', () => {
        const config: ScheduleConfig = {
            routeNumber: '7',
            cycleMode: 'Strict',
            cycleTime: 60,
            blocks: [
                {
                    id: '7-1',
                    startTime: '06:00',
                    endTime: '07:01',
                    startStop: 'Georgian College',
                    startDirection: 'South'
                }
            ]
        };

        const tables = generateSchedule(
            config, route7Buckets, route7Bands, route7BandSummary, route7SegmentsMap, 'Weekday'
        );
        const northTable = tables.find(t => t.routeName.includes('(North)'));
        const southTable = tables.find(t => t.routeName.includes('(South)'));

        expect(northTable).toBeDefined();
        expect(southTable).toBeDefined();

        // First trip should be South (from Georgian College) because startDirection = 'South'
        expect(southTable!.trips[0].startTime).toBe(360);
        expect(northTable!.trips[0].startTime).toBeGreaterThan(360);
    });

    it('produces partial first trip with startStopIndex when start stop is mid-route', () => {
        const config: ScheduleConfig = {
            routeNumber: '7',
            cycleMode: 'Strict',
            cycleTime: 60,
            blocks: [
                {
                    id: '7-1',
                    startTime: '06:00',
                    endTime: '08:01',
                    startStop: 'Georgian College',
                    startDirection: 'South'
                }
            ]
        };

        const tables = generateSchedule(
            config, route7Buckets, route7Bands, route7BandSummary, route7SegmentsMap, 'Weekday'
        );
        const southTable = tables.find(t => t.routeName.includes('(South)'));
        const northTable = tables.find(t => t.routeName.includes('(North)'));

        expect(southTable).toBeDefined();
        expect(northTable).toBeDefined();

        // First trip (South): partial — starts at Georgian College (index 1), skips Rose Street
        const firstTrip = southTable!.trips[0];
        expect(firstTrip.startStopIndex).toBe(1);
        // South timepoints: Rose Street, Georgian College, Park Place
        // Rose Street should NOT have a stop time (skipped)
        expect(firstTrip.stops['Rose Street']).toBeUndefined();
        // Georgian College and Park Place should have stop times
        expect(firstTrip.stops['Georgian College']).toBeDefined();
        expect(firstTrip.stops['Park Place']).toBeDefined();

        // Travel time should be ~10 min (only Georgian College → Park Place), not 20
        expect(firstTrip.travelTime).toBeLessThanOrEqual(15);

        // Recovery should be proportional to travel, not inflated by half-cycle gap
        // With 10 min travel and 15% ratio → ~2 min recovery (NOT 20+ min)
        expect(firstTrip.recoveryTime).toBeLessThanOrEqual(5);

        // Second trip (North) should be a full trip (no startStopIndex)
        const secondTrip = northTable!.trips[0];
        expect(secondTrip.startStopIndex).toBeUndefined();
        expect(secondTrip.stops['Park Place']).toBeDefined();
        expect(secondTrip.stops['Georgian College']).toBeDefined();
        expect(secondTrip.stops['Rose Street']).toBeDefined();
    });

    it('defaults to North when startStop is ambiguous and no startDirection is provided', () => {
        const config: ScheduleConfig = {
            routeNumber: '7',
            cycleMode: 'Strict',
            cycleTime: 60,
            blocks: [
                {
                    id: '7-1',
                    startTime: '06:00',
                    endTime: '07:01',
                    startStop: 'Georgian College'
                    // NO startDirection — should default to North
                }
            ]
        };

        const tables = generateSchedule(
            config, route7Buckets, route7Bands, route7BandSummary, route7SegmentsMap, 'Weekday'
        );
        const northTable = tables.find(t => t.routeName.includes('(North)'));
        const southTable = tables.find(t => t.routeName.includes('(South)'));

        expect(northTable).toBeDefined();
        expect(southTable).toBeDefined();

        // Without startDirection, ambiguous stop defaults to North
        expect(northTable!.trips[0].startTime).toBe(360);
        expect(southTable!.trips[0].startTime).toBeGreaterThan(360);
    });
});
