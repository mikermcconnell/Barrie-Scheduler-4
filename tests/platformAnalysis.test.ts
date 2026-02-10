import { describe, expect, it } from 'vitest';
import type { MasterTrip } from '../utils/masterScheduleParser';
import type { MasterScheduleContent } from '../utils/masterScheduleTypes';
import type { HubConfig } from '../utils/platformConfig';
import { aggregatePlatformData } from '../utils/platformAnalysis';

const TEST_HUBS: HubConfig[] = [
    {
        name: 'Test Hub',
        stopCodes: ['HUB1'],
        stopNamePatterns: ['test hub'],
        platforms: [
            { platformId: 'P1', routes: ['8A', '8B'], capacity: 1 }
        ]
    }
];

const STOP_SPLIT_HUBS: HubConfig[] = [
    {
        name: 'Allandale-like',
        stopCodes: ['9003', '9005'],
        stopNamePatterns: ['allandale'],
        platforms: [
            { platformId: 'P3 (9003)', routes: ['8A'], capacity: 1 },
            { platformId: 'P5 (9005)', routes: ['8A'], capacity: 1 }
        ]
    }
];

const DIRECTIONAL_VARIANT_HUBS: HubConfig[] = [
    {
        name: 'Directional Hub',
        stopCodes: ['HUB12'],
        stopNamePatterns: ['directional hub'],
        platforms: [
            { platformId: 'P12', routes: ['12A', '12B'], capacity: 2 }
        ]
    }
];

function toTime(minutes: number): string {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const h24 = Math.floor(normalized / 60);
    const m = normalized % 60;
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

function buildTrip(params: {
    id: string;
    blockId: string;
    direction: 'North' | 'South';
    arrivalMin: number;
    departureMin: number;
    gtfsBlockId?: string;
}): MasterTrip {
    const { id, blockId, direction, arrivalMin, departureMin, gtfsBlockId } = params;
    return {
        id,
        blockId,
        direction,
        tripNumber: 1,
        rowId: 1,
        startTime: arrivalMin,
        endTime: departureMin,
        recoveryTime: 0,
        travelTime: Math.max(0, departureMin - arrivalMin),
        cycleTime: Math.max(0, departureMin - arrivalMin),
        stops: {
            'Test Hub Stop': toTime(departureMin)
        },
        stopMinutes: {
            'Test Hub Stop': departureMin
        },
        arrivalTimes: {
            'Test Hub Stop': toTime(arrivalMin)
        },
        recoveryTimes: {},
        ...(gtfsBlockId ? { gtfsBlockId } : {})
    };
}

function buildContent(routeNumber: string, northTrips: MasterTrip[], southTrips: MasterTrip[]): MasterScheduleContent {
    return {
        northTable: {
            routeName: `${routeNumber} (Weekday) (North)`,
            stops: ['Test Hub Stop'],
            stopIds: { 'Test Hub Stop': 'HUB1' },
            trips: northTrips
        },
        southTable: {
            routeName: `${routeNumber} (Weekday) (South)`,
            stops: ['Test Hub Stop'],
            stopIds: { 'Test Hub Stop': 'HUB1' },
            trips: southTrips
        },
        metadata: {
            routeNumber,
            dayType: 'Weekday',
            uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
        }
    };
}

function getOnlyPlatformResult(contentList: MasterScheduleContent[], routeNumbers: string[]) {
    const analysis = aggregatePlatformData(contentList, routeNumbers, TEST_HUBS);
    expect(analysis).toHaveLength(1);
    expect(analysis[0].platforms).toHaveLength(1);
    return analysis[0].platforms[0];
}

describe('platformAnalysis bus identity', () => {
    it('does not self-conflict when overlapping events share the same GTFS block', () => {
        const route8A = buildContent('8A', [
            buildTrip({
                id: '8A-N-1',
                blockId: '8A-1',
                direction: 'North',
                arrivalMin: 360, // 6:00 AM
                departureMin: 390, // 6:30 AM
                gtfsBlockId: 'VEH-42'
            })
        ], []);

        const route8B = buildContent('8B', [], [
            buildTrip({
                id: '8B-S-1',
                blockId: '8B-9',
                direction: 'South',
                arrivalMin: 370, // 6:10 AM
                departureMin: 380, // 6:20 AM
                gtfsBlockId: 'VEH-42'
            })
        ]);

        const platform = getOnlyPlatformResult([route8A, route8B], ['8A', '8B']);

        expect(platform.peakCount).toBe(1);
        expect(platform.hasConflict).toBe(false);
        expect(platform.conflictWindows).toHaveLength(0);
    });

    it('still flags true overlap when GTFS blocks are different', () => {
        const route8A = buildContent('8A', [
            buildTrip({
                id: '8A-N-1',
                blockId: '8A-1',
                direction: 'North',
                arrivalMin: 360,
                departureMin: 390,
                gtfsBlockId: 'VEH-1'
            })
        ], []);

        const route8B = buildContent('8B', [], [
            buildTrip({
                id: '8B-S-1',
                blockId: '8B-9',
                direction: 'South',
                arrivalMin: 370,
                departureMin: 380,
                gtfsBlockId: 'VEH-2'
            })
        ]);

        const platform = getOnlyPlatformResult([route8A, route8B], ['8A', '8B']);

        expect(platform.peakCount).toBe(2);
        expect(platform.hasConflict).toBe(true);
        expect(platform.conflictWindows).toHaveLength(1);
    });

    it('normalizes block IDs so case/whitespace differences do not self-conflict', () => {
        const route8A = buildContent('8A', [
            buildTrip({
                id: '8A-N-1',
                blockId: ' 8A-1 ',
                direction: 'North',
                arrivalMin: 360,
                departureMin: 390
            })
        ], [
            buildTrip({
                id: '8A-S-1',
                blockId: '8a-1',
                direction: 'South',
                arrivalMin: 370,
                departureMin: 380
            })
        ]);

        const platform = getOnlyPlatformResult([route8A], ['8A']);

        expect(platform.peakCount).toBe(1);
        expect(platform.hasConflict).toBe(false);
        expect(platform.conflictWindows).toHaveLength(0);
    });

    it('keeps same-route visits on stop-specific platforms separate', () => {
        const firstTrip = buildTrip({
            id: '8A-N-100',
            blockId: '8A-1',
            direction: 'North',
            arrivalMin: 420,
            departureMin: 440
        });
        firstTrip.stops = { 'Allandale A': toTime(440) };
        firstTrip.arrivalTimes = { 'Allandale A': toTime(420) };

        const secondTrip = buildTrip({
            id: '8A-N-101',
            blockId: '8A-2',
            direction: 'North',
            arrivalMin: 425,
            departureMin: 445
        });
        secondTrip.stops = { 'Allandale B': toTime(445) };
        secondTrip.arrivalTimes = { 'Allandale B': toTime(425) };

        const content: MasterScheduleContent = {
            northTable: {
                routeName: '8A (Weekday) (North)',
                stops: ['Allandale A', 'Allandale B'],
                stopIds: {
                    'Allandale A': '9003',
                    'Allandale B': '9005'
                },
                trips: [firstTrip, secondTrip]
            },
            southTable: {
                routeName: '8A (Weekday) (South)',
                stops: [],
                stopIds: {},
                trips: []
            },
            metadata: {
                routeNumber: '8A',
                dayType: 'Weekday',
                uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
            }
        };

        const analysis = aggregatePlatformData([content], ['8A'], STOP_SPLIT_HUBS);
        expect(analysis).toHaveLength(1);

        const p3 = analysis[0].platforms.find(p => p.platformId === 'P3 (9003)');
        const p5 = analysis[0].platforms.find(p => p.platformId === 'P5 (9005)');

        expect(p3).toBeTruthy();
        expect(p5).toBeTruthy();
        expect(p3?.events.length).toBe(1);
        expect(p5?.events.length).toBe(1);
        expect(p3?.hasConflict).toBe(false);
        expect(p5?.hasConflict).toBe(false);
    });

    it('does not merge far-apart same-hub visits into an all-day event', () => {
        const trip = buildTrip({
            id: '8A-N-loop',
            blockId: '8A-1',
            direction: 'North',
            arrivalMin: 320,
            departureMin: 320
        });

        // Same physical hub visited multiple times in one trip.
        // Last visit is after midnight and should never merge into the late-night visit.
        trip.stops = {
            'Hub Stop A': '5:20 AM',
            'Hub Stop B': '11:05 PM',
            'Hub Stop C': '12:10 AM'
        };
        trip.arrivalTimes = {
            'Hub Stop A': '5:20 AM',
            'Hub Stop B': '11:05 PM',
            'Hub Stop C': '12:10 AM'
        };
        trip.stopMinutes = {
            'Hub Stop A': 320,
            'Hub Stop B': 1385,
            'Hub Stop C': 10
        };

        const content: MasterScheduleContent = {
            northTable: {
                routeName: '8A (Weekday) (North)',
                stops: ['Hub Stop A', 'Hub Stop B', 'Hub Stop C'],
                stopIds: {
                    'Hub Stop A': 'HUB1',
                    'Hub Stop B': 'HUB1',
                    'Hub Stop C': 'HUB1'
                },
                trips: [trip]
            },
            southTable: {
                routeName: '8A (Weekday) (South)',
                stops: [],
                stopIds: {},
                trips: []
            },
            metadata: {
                routeNumber: '8A',
                dayType: 'Weekday',
                uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
            }
        };

        const platform = getOnlyPlatformResult([content], ['8A']);
        expect(platform.events.length).toBe(3);

        const maxDuration = Math.max(
            ...platform.events.map(event => event.departureMin - event.arrivalMin)
        );
        expect(maxDuration).toBeLessThanOrEqual(30);
    });

    it('labels base route 12 as 12A/12B by direction in platform analysis', () => {
        const northTrip = buildTrip({
            id: '12-N-1',
            blockId: '12-1',
            direction: 'North',
            arrivalMin: 480,
            departureMin: 485
        });
        northTrip.stops = { 'Directional Hub Stop': toTime(485) };
        northTrip.arrivalTimes = { 'Directional Hub Stop': toTime(480) };

        const southTrip = buildTrip({
            id: '12-S-1',
            blockId: '12-2',
            direction: 'South',
            arrivalMin: 540,
            departureMin: 545
        });
        southTrip.stops = { 'Directional Hub Stop': toTime(545) };
        southTrip.arrivalTimes = { 'Directional Hub Stop': toTime(540) };

        const content: MasterScheduleContent = {
            northTable: {
                routeName: '12 (Weekday) (North)',
                stops: ['Directional Hub Stop'],
                stopIds: { 'Directional Hub Stop': 'HUB12' },
                trips: [northTrip]
            },
            southTable: {
                routeName: '12 (Weekday) (South)',
                stops: ['Directional Hub Stop'],
                stopIds: { 'Directional Hub Stop': 'HUB12' },
                trips: [southTrip]
            },
            metadata: {
                routeNumber: '12',
                dayType: 'Weekday',
                uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
            }
        };

        const analysis = aggregatePlatformData([content], ['12'], DIRECTIONAL_VARIANT_HUBS);
        expect(analysis).toHaveLength(1);
        expect(analysis[0].platforms).toHaveLength(1);

        const routes = new Set(analysis[0].platforms[0].events.map(e => e.route));
        expect(routes.has('12')).toBe(false);
        expect(routes.has('12A')).toBe(true);
        expect(routes.has('12B')).toBe(true);
    });

    it('ignores zero-duration conflict spikes from same-minute events', () => {
        const longDwell = buildTrip({
            id: '8A-N-long',
            blockId: '8A-1',
            direction: 'North',
            arrivalMin: 626,   // 10:26 AM
            departureMin: 635  // 10:35 AM
        });

        const instantTouch = buildTrip({
            id: '8B-S-instant',
            blockId: '8B-9',
            direction: 'South',
            arrivalMin: 632,   // 10:32 AM
            departureMin: 632  // 10:32 AM (zero dwell)
        });

        const content = buildContent('8A', [longDwell], [instantTouch]);
        const platform = getOnlyPlatformResult([content], ['8A']);

        expect(platform.conflictWindows).toHaveLength(0);
        expect(platform.hasConflict).toBe(false);
    });
});
