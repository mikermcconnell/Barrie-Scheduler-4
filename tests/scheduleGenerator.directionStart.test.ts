import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../utils/scheduleGenerator';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { TripBucketAnalysis, TimeBand, DirectionBandSummary } from '../utils/runtimeAnalysis';
import type { SegmentRawData } from '../components/NewSchedule/utils/csvParser';

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
});
