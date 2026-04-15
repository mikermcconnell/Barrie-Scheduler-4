import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    saveDraftMock,
    saveSystemDraftMock,
    generateSystemDraftNameMock,
} = vi.hoisted(() => ({
    saveDraftMock: vi.fn(),
    saveSystemDraftMock: vi.fn(),
    generateSystemDraftNameMock: vi.fn((dayType: string) => `${dayType} System Draft`),
}));

vi.mock('../utils/services/draftService', () => ({
    saveDraft: saveDraftMock,
}));

vi.mock('../utils/services/systemDraftService', () => ({
    saveSystemDraft: saveSystemDraftMock,
    generateSystemDraftName: generateSystemDraftNameMock,
}));

import {
    convertToMasterSchedule,
    importAllRoutesFromGTFS,
    importRouteFromGTFS,
    processTripsForRoute,
} from '../utils/gtfs/gtfsImportService';
import type { ParsedGTFSFeed, ProcessedGTFSTrip } from '../utils/gtfs/gtfsTypes';

function buildFeed(overrides?: Partial<ParsedGTFSFeed>): ParsedGTFSFeed {
    return {
        agency: [],
        routes: [
            {
                route_id: 'route-10',
                route_short_name: '10',
                route_long_name: 'Route 10',
                route_type: 3,
            },
        ],
        stops: [
            { stop_id: 'A', stop_name: 'Stop A', stop_lat: 44.1, stop_lon: -79.1 },
            { stop_id: 'B', stop_name: 'Stop B', stop_lat: 44.2, stop_lon: -79.2 },
            { stop_id: 'C', stop_name: 'Stop C', stop_lat: 44.3, stop_lon: -79.3 },
            { stop_id: 'PARK', stop_name: 'Park Place', stop_lat: 44.31, stop_lon: -79.71 },
            { stop_id: 'HUB', stop_name: 'Downtown Hub', stop_lat: 44.39, stop_lon: -79.69 },
            { stop_id: 'GEORGIAN', stop_name: 'Georgian College', stop_lat: 44.41, stop_lon: -79.68 },
        ],
        trips: [],
        stopTimes: [],
        calendar: [],
        calendarDates: [],
        ...overrides,
    };
}

function buildProcessedTrip(
    overrides: Partial<ProcessedGTFSTrip> & Pick<ProcessedGTFSTrip, 'tripId' | 'direction' | 'stopTimes' | 'startTime' | 'endTime' | 'travelTime'>
): ProcessedGTFSTrip {
    return {
        routeId: 'route-10',
        serviceId: 'weekday',
        blockId: 'bus-1',
        headsign: null,
        shapeId: null,
        ...overrides,
    };
}

beforeEach(() => {
    saveDraftMock.mockReset();
    saveSystemDraftMock.mockReset();
    generateSystemDraftNameMock.mockClear();

    saveDraftMock.mockResolvedValue('draft-1');
    saveSystemDraftMock.mockResolvedValue('system-draft-1');
});

describe('processTripsForRoute', () => {
    it('keeps timepoints, maps direction, and carries terminal recovery from the next trip in the same GTFS block', () => {
        const feed = buildFeed({
            trips: [
                {
                    route_id: 'route-10',
                    service_id: 'weekday',
                    trip_id: 'trip-1',
                    direction_id: 1,
                    block_id: 'block-1',
                    trip_headsign: 'Northbound',
                },
                {
                    route_id: 'route-10',
                    service_id: 'weekday',
                    trip_id: 'trip-2',
                    direction_id: 1,
                    block_id: 'block-1',
                    trip_headsign: 'Northbound',
                },
            ],
            stopTimes: [
                {
                    trip_id: 'trip-1',
                    arrival_time: '06:00:00',
                    departure_time: '06:00:00',
                    stop_id: 'A',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-1',
                    arrival_time: '06:15:00',
                    departure_time: '06:15:00',
                    stop_id: 'B',
                    stop_sequence: 2,
                    timepoint: 0,
                },
                {
                    trip_id: 'trip-1',
                    arrival_time: '06:30:00',
                    departure_time: '06:30:00',
                    stop_id: 'C',
                    stop_sequence: 3,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2',
                    arrival_time: '06:40:00',
                    departure_time: '06:40:00',
                    stop_id: 'C',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2',
                    arrival_time: '06:55:00',
                    departure_time: '06:55:00',
                    stop_id: 'A',
                    stop_sequence: 2,
                    timepoint: 1,
                },
            ],
        });

        const trips = processTripsForRoute(
            feed,
            'route-10',
            'weekday',
            {
                feedUrl: 'https://example.com/gtfs.zip',
                directionMapping: {
                    'route-10': {
                        0: 'South',
                        1: 'North',
                    },
                },
            },
            { timepointsOnly: true }
        );

        expect(trips).toHaveLength(2);
        expect(trips[0].direction).toBe('North');
        expect(trips[0].stopTimes.map((stop) => stop.stopName)).toEqual(['Stop A', 'Stop C']);
        expect(trips[0].startTime).toBe(360);
        expect(trips[0].endTime).toBe(390);
        expect(trips[0].stopTimes[1].departureMinutes).toBe(400);
        expect(trips[1].startTime).toBe(400);
    });

    it('parses post-midnight GTFS times without collapsing them back into the same day', () => {
        const feed = buildFeed({
            trips: [
                {
                    route_id: 'route-10',
                    service_id: 'weekday',
                    trip_id: 'trip-overnight',
                    direction_id: 0,
                    block_id: 'block-9',
                },
            ],
            stopTimes: [
                {
                    trip_id: 'trip-overnight',
                    arrival_time: '24:10:00',
                    departure_time: '24:10:00',
                    stop_id: 'A',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-overnight',
                    arrival_time: '24:35:00',
                    departure_time: '24:35:00',
                    stop_id: 'C',
                    stop_sequence: 2,
                    timepoint: 1,
                },
            ],
        });

        const trips = processTripsForRoute(
            feed,
            'route-10',
            'weekday',
            {
                feedUrl: 'https://example.com/gtfs.zip',
                directionMapping: {
                    'route-10': {
                        0: 'South',
                        1: 'North',
                    },
                },
            }
        );

        expect(trips).toHaveLength(1);
        expect(trips[0].startTime).toBe(1450);
        expect(trips[0].endTime).toBe(1475);
        expect(trips[0].travelTime).toBe(25);
        expect(trips[0].direction).toBe('South');
    });
});

describe('convertToMasterSchedule', () => {
    it('merges partial trips into a complete stop list and keeps terminal recovery columns available', () => {
        const content = convertToMasterSchedule(
            [
                buildProcessedTrip({
                    tripId: 'north-1',
                    direction: 'North',
                    blockId: 'bus-1',
                    startTime: 360,
                    endTime: 370,
                    travelTime: 10,
                    stopTimes: [
                        {
                            stopId: 'A',
                            stopName: 'Stop A',
                            arrivalTime: '06:00:00',
                            departureTime: '06:00:00',
                            arrivalMinutes: 360,
                            departureMinutes: 360,
                            sequence: 1,
                            isTimepoint: true,
                        },
                        {
                            stopId: 'B',
                            stopName: 'Stop B',
                            arrivalTime: '06:10:00',
                            departureTime: '06:12:00',
                            arrivalMinutes: 370,
                            departureMinutes: 372,
                            sequence: 2,
                            isTimepoint: true,
                        },
                    ],
                }),
                buildProcessedTrip({
                    tripId: 'north-2',
                    direction: 'North',
                    blockId: 'bus-1',
                    startTime: 375,
                    endTime: 390,
                    travelTime: 15,
                    stopTimes: [
                        {
                            stopId: 'B',
                            stopName: 'Stop B',
                            arrivalTime: '06:15:00',
                            departureTime: '06:15:00',
                            arrivalMinutes: 375,
                            departureMinutes: 375,
                            sequence: 1,
                            isTimepoint: true,
                        },
                        {
                            stopId: 'C',
                            stopName: 'Stop C',
                            arrivalTime: '06:30:00',
                            departureTime: '06:30:00',
                            arrivalMinutes: 390,
                            departureMinutes: 390,
                            sequence: 2,
                            isTimepoint: true,
                        },
                    ],
                }),
                buildProcessedTrip({
                    tripId: 'south-1',
                    direction: 'South',
                    blockId: 'bus-2',
                    startTime: 420,
                    endTime: 450,
                    travelTime: 30,
                    stopTimes: [
                        {
                            stopId: 'C',
                            stopName: 'Stop C',
                            arrivalTime: '07:00:00',
                            departureTime: '07:00:00',
                            arrivalMinutes: 420,
                            departureMinutes: 420,
                            sequence: 1,
                            isTimepoint: true,
                        },
                        {
                            stopId: 'B',
                            stopName: 'Stop B',
                            arrivalTime: '07:15:00',
                            departureTime: '07:15:00',
                            arrivalMinutes: 435,
                            departureMinutes: 435,
                            sequence: 2,
                            isTimepoint: true,
                        },
                        {
                            stopId: 'A',
                            stopName: 'Stop A',
                            arrivalTime: '07:30:00',
                            departureTime: '07:30:00',
                            arrivalMinutes: 450,
                            departureMinutes: 450,
                            sequence: 3,
                            isTimepoint: true,
                        },
                    ],
                }),
            ],
            '10',
            'Weekday'
        );

        expect(content.northTable.stops).toEqual(['Stop A', 'Stop B', 'Stop C']);
        expect(content.northTable.stopIds).toEqual({
            'Stop A': 'A',
            'Stop B': 'B',
            'Stop C': 'C',
        });
        expect(content.northTable.trips[0].blockId).toBe('10-1');
        expect(content.northTable.trips[1].blockId).toBe('10-1');
        expect(content.northTable.trips[1].recoveryTimes?.['Stop C']).toBe(0);
        expect(content.northTable.trips[1].travelTime).toBe(15);
        expect(content.metadata.notes).toBe('Imported from GTFS feed');
    });

    it('adds suffixes when the same stop name appears more than once in a trip', () => {
        const content = convertToMasterSchedule(
            [
                buildProcessedTrip({
                    tripId: 'loop-1',
                    direction: 'North',
                    blockId: 'loop-bus',
                    startTime: 360,
                    endTime: 390,
                    travelTime: 30,
                    stopTimes: [
                        {
                            stopId: 'HUB',
                            stopName: 'Downtown Hub',
                            arrivalTime: '06:00:00',
                            departureTime: '06:00:00',
                            arrivalMinutes: 360,
                            departureMinutes: 360,
                            sequence: 1,
                            isTimepoint: true,
                        },
                        {
                            stopId: 'MID',
                            stopName: 'College',
                            arrivalTime: '06:10:00',
                            departureTime: '06:10:00',
                            arrivalMinutes: 370,
                            departureMinutes: 370,
                            sequence: 2,
                            isTimepoint: true,
                        },
                        {
                            stopId: 'HUB',
                            stopName: 'Downtown Hub',
                            arrivalTime: '06:30:00',
                            departureTime: '06:35:00',
                            arrivalMinutes: 390,
                            departureMinutes: 395,
                            sequence: 3,
                            isTimepoint: true,
                        },
                    ],
                }),
            ],
            '100',
            'Weekday'
        );

        expect(content.northTable.stops).toEqual([
            'Downtown Hub',
            'College',
            'Downtown Hub (2)',
        ]);
        expect(content.northTable.stopIds).toEqual({
            'Downtown Hub': 'HUB',
            College: 'MID',
            'Downtown Hub (2)': 'HUB',
        });
        expect(content.northTable.trips[0].stops['Downtown Hub (2)']).toBe('6:30 AM');
        expect(content.northTable.trips[0].recoveryTimes?.['Downtown Hub (2)']).toBe(5);
    });
});

describe('importRouteFromGTFS', () => {
    it('imports a regular route and saves a draft with GTFS provenance', async () => {
        const feed = buildFeed({
            calendar: [
                {
                    service_id: 'weekday',
                    monday: 1,
                    tuesday: 1,
                    wednesday: 1,
                    thursday: 1,
                    friday: 1,
                    saturday: 0,
                    sunday: 0,
                    start_date: '20260101',
                    end_date: '20261231',
                },
            ],
            trips: [
                {
                    route_id: 'route-10',
                    service_id: 'weekday',
                    trip_id: 'trip-10-north',
                    direction_id: 1,
                    block_id: 'block-10',
                },
                {
                    route_id: 'route-10',
                    service_id: 'weekday',
                    trip_id: 'trip-10-south',
                    direction_id: 0,
                    block_id: 'block-10',
                },
            ],
            stopTimes: [
                {
                    trip_id: 'trip-10-north',
                    arrival_time: '06:00:00',
                    departure_time: '06:00:00',
                    stop_id: 'A',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-10-north',
                    arrival_time: '06:20:00',
                    departure_time: '06:20:00',
                    stop_id: 'C',
                    stop_sequence: 2,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-10-south',
                    arrival_time: '06:35:00',
                    departure_time: '06:35:00',
                    stop_id: 'C',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-10-south',
                    arrival_time: '06:55:00',
                    departure_time: '06:55:00',
                    stop_id: 'A',
                    stop_sequence: 2,
                    timepoint: 1,
                },
            ],
        });

        const result = await importRouteFromGTFS(
            feed,
            {
                routeId: 'route-10',
                routeShortName: '10',
                routeLongName: 'Route 10',
                dayType: 'Weekday',
                serviceId: 'weekday',
                tripCount: 2,
            },
            'user-1',
            'Route 10 import',
            {
                feedUrl: 'https://example.com/gtfs.zip',
                directionMapping: {
                    'route-10': {
                        0: 'South',
                        1: 'North',
                    },
                },
            }
        );

        expect(result).toEqual({
            success: true,
            routeIdentity: '10-Weekday',
            draftId: 'draft-1',
            tripCount: 2,
            northTripCount: 1,
            southTripCount: 1,
            warnings: undefined,
        });
        expect(saveDraftMock).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                name: 'Route 10 import',
                routeNumber: '10',
                dayType: 'Weekday',
                status: 'draft',
                createdBy: 'user-1',
                basedOn: expect.objectContaining({
                    type: 'gtfs',
                    importedAt: expect.any(Date),
                }),
                content: expect.objectContaining({
                    northTable: expect.objectContaining({ routeName: expect.stringContaining('10') }),
                    southTable: expect.objectContaining({ routeName: expect.stringContaining('10') }),
                }),
            })
        );
    });

    it('imports a merged A/B route into one draft', async () => {
        const feed = buildFeed({
            routes: [
                {
                    route_id: 'route-2A',
                    route_short_name: '2A',
                    route_long_name: 'Route 2A',
                    route_type: 3,
                },
                {
                    route_id: 'route-2B',
                    route_short_name: '2B',
                    route_long_name: 'Route 2B',
                    route_type: 3,
                },
            ],
            trips: [
                {
                    route_id: 'route-2A',
                    service_id: 'weekday-a',
                    trip_id: 'trip-2A-1',
                    direction_id: 1,
                    block_id: 'block-2',
                },
                {
                    route_id: 'route-2B',
                    service_id: 'weekday-b',
                    trip_id: 'trip-2B-1',
                    direction_id: 0,
                    block_id: 'block-2',
                },
            ],
            stopTimes: [
                {
                    trip_id: 'trip-2A-1',
                    arrival_time: '06:00:00',
                    departure_time: '06:00:00',
                    stop_id: 'PARK',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2A-1',
                    arrival_time: '06:25:00',
                    departure_time: '06:25:00',
                    stop_id: 'HUB',
                    stop_sequence: 2,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2B-1',
                    arrival_time: '06:35:00',
                    departure_time: '06:35:00',
                    stop_id: 'HUB',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2B-1',
                    arrival_time: '07:00:00',
                    departure_time: '07:00:00',
                    stop_id: 'PARK',
                    stop_sequence: 2,
                    timepoint: 1,
                },
            ],
        });

        const result = await importRouteFromGTFS(
            feed,
            {
                routeId: 'route-2A',
                routeShortName: '2',
                routeLongName: 'Route 2',
                dayType: 'Weekday',
                serviceId: 'weekday-a',
                tripCount: 2,
                isMergedRoute: true,
                northRouteId: 'route-2A',
                northServiceId: 'weekday-a',
                southRouteId: 'route-2B',
                southServiceId: 'weekday-b',
            },
            'user-1'
        );

        expect(result.success).toBe(true);
        expect(result.routeIdentity).toBe('2-Weekday');
        expect(result.tripCount).toBe(2);
        expect(result.northTripCount).toBe(1);
        expect(result.southTripCount).toBe(1);
        expect(saveDraftMock).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                routeNumber: '2',
                dayType: 'Weekday',
                content: expect.objectContaining({
                    northTable: expect.objectContaining({
                        routeName: expect.stringContaining('2'),
                    }),
                    southTable: expect.objectContaining({
                        routeName: expect.stringContaining('2'),
                    }),
                }),
            })
        );
    });

    it('returns a no-trips error without saving a draft', async () => {
        const result = await importRouteFromGTFS(
            buildFeed(),
            {
                routeId: 'route-10',
                routeShortName: '10',
                routeLongName: 'Route 10',
                dayType: 'Weekday',
                serviceId: 'weekday',
                tripCount: 0,
            },
            'user-1'
        );

        expect(result).toEqual({
            success: false,
            error: 'No trips found for route 10 (Weekday)',
        });
        expect(saveDraftMock).not.toHaveBeenCalled();
    });
});

describe('importAllRoutesFromGTFS', () => {
    it('imports the requested day type into one sorted system draft and merges A/B direction routes', async () => {
        const feed = buildFeed({
            routes: [
                {
                    route_id: 'route-10',
                    route_short_name: '10',
                    route_long_name: 'Route 10',
                    route_type: 3,
                },
                {
                    route_id: 'route-2A',
                    route_short_name: '2A',
                    route_long_name: 'Route 2A',
                    route_type: 3,
                },
                {
                    route_id: 'route-2B',
                    route_short_name: '2B',
                    route_long_name: 'Route 2B',
                    route_type: 3,
                },
            ],
            calendar: [
                {
                    service_id: 'weekday-10',
                    monday: 1,
                    tuesday: 1,
                    wednesday: 1,
                    thursday: 1,
                    friday: 1,
                    saturday: 0,
                    sunday: 0,
                    start_date: '20260101',
                    end_date: '20261231',
                },
                {
                    service_id: 'weekday-2a',
                    monday: 1,
                    tuesday: 1,
                    wednesday: 1,
                    thursday: 1,
                    friday: 1,
                    saturday: 0,
                    sunday: 0,
                    start_date: '20260101',
                    end_date: '20261231',
                },
                {
                    service_id: 'weekday-2b',
                    monday: 1,
                    tuesday: 1,
                    wednesday: 1,
                    thursday: 1,
                    friday: 1,
                    saturday: 0,
                    sunday: 0,
                    start_date: '20260101',
                    end_date: '20261231',
                },
            ],
            trips: [
                {
                    route_id: 'route-10',
                    service_id: 'weekday-10',
                    trip_id: 'trip-10-north',
                    direction_id: 1,
                    block_id: 'block-10',
                },
                {
                    route_id: 'route-10',
                    service_id: 'weekday-10',
                    trip_id: 'trip-10-south',
                    direction_id: 0,
                    block_id: 'block-10',
                },
                {
                    route_id: 'route-2A',
                    service_id: 'weekday-2a',
                    trip_id: 'trip-2A-1',
                    direction_id: 1,
                    block_id: 'block-2',
                },
                {
                    route_id: 'route-2B',
                    service_id: 'weekday-2b',
                    trip_id: 'trip-2B-1',
                    direction_id: 0,
                    block_id: 'block-2',
                },
            ],
            stopTimes: [
                {
                    trip_id: 'trip-10-north',
                    arrival_time: '06:00:00',
                    departure_time: '06:00:00',
                    stop_id: 'A',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-10-north',
                    arrival_time: '06:20:00',
                    departure_time: '06:20:00',
                    stop_id: 'C',
                    stop_sequence: 2,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-10-south',
                    arrival_time: '06:35:00',
                    departure_time: '06:35:00',
                    stop_id: 'C',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-10-south',
                    arrival_time: '06:55:00',
                    departure_time: '06:55:00',
                    stop_id: 'A',
                    stop_sequence: 2,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2A-1',
                    arrival_time: '06:05:00',
                    departure_time: '06:05:00',
                    stop_id: 'PARK',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2A-1',
                    arrival_time: '06:30:00',
                    departure_time: '06:30:00',
                    stop_id: 'HUB',
                    stop_sequence: 2,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2B-1',
                    arrival_time: '06:40:00',
                    departure_time: '06:40:00',
                    stop_id: 'HUB',
                    stop_sequence: 1,
                    timepoint: 1,
                },
                {
                    trip_id: 'trip-2B-1',
                    arrival_time: '07:05:00',
                    departure_time: '07:05:00',
                    stop_id: 'PARK',
                    stop_sequence: 2,
                    timepoint: 1,
                },
            ],
        });

        const result = await importAllRoutesFromGTFS(
            feed,
            'Weekday',
            'user-1',
            undefined,
            {
                feedUrl: 'https://example.com/gtfs.zip',
                directionMapping: {
                    'route-10': {
                        0: 'South',
                        1: 'North',
                    },
                    'route-2A': {
                        0: 'South',
                        1: 'North',
                    },
                    'route-2B': {
                        0: 'South',
                        1: 'North',
                    },
                },
            }
        );

        expect(result).toEqual({
            success: true,
            systemDraftId: 'system-draft-1',
            dayType: 'Weekday',
            routeCount: 2,
            totalTrips: 4,
            routeNumbers: ['2', '10'],
            warnings: undefined,
        });
        expect(generateSystemDraftNameMock).toHaveBeenCalledWith('Weekday');
        expect(saveSystemDraftMock).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                name: 'Weekday System Draft',
                dayType: 'Weekday',
                status: 'draft',
                createdBy: 'user-1',
                routes: [
                    expect.objectContaining({ routeNumber: '2' }),
                    expect.objectContaining({ routeNumber: '10' }),
                ],
                basedOn: expect.objectContaining({
                    type: 'gtfs',
                    importedAt: expect.any(Date),
                    gtfsFeedUrl: 'https://example.com/gtfs.zip',
                }),
            })
        );
    });

    it('returns a no-routes error for a day type with no available GTFS service', async () => {
        const feed = buildFeed({
            calendar: [
                {
                    service_id: 'weekday',
                    monday: 1,
                    tuesday: 1,
                    wednesday: 1,
                    thursday: 1,
                    friday: 1,
                    saturday: 0,
                    sunday: 0,
                    start_date: '20260101',
                    end_date: '20261231',
                },
            ],
            trips: [
                {
                    route_id: 'route-10',
                    service_id: 'weekday',
                    trip_id: 'trip-10',
                    direction_id: 1,
                },
            ],
        });

        const result = await importAllRoutesFromGTFS(feed, 'Sunday', 'user-1');

        expect(result).toEqual({
            success: false,
            error: 'No routes found for Sunday in GTFS feed',
        });
        expect(saveSystemDraftMock).not.toHaveBeenCalled();
    });
});
