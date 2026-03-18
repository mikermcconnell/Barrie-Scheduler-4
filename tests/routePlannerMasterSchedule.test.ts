import { describe, expect, it } from 'vitest';
import type { MasterScheduleContent, MasterScheduleEntry } from '../utils/masterScheduleTypes';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';
import {
    deriveRoutePlannerMasterServiceSeed,
    findMostRecentMasterScheduleEntry,
} from '../utils/route-planner/routePlannerMasterSchedule';

function makeTrip(
    id: string,
    direction: 'North' | 'South',
    startTime: number,
    stops: Record<string, string>,
    recoveryTime: number = 5
): MasterTrip {
    return {
        id,
        blockId: `${direction}-${id}`,
        direction,
        tripNumber: 1,
        rowId: 1,
        startTime,
        endTime: startTime + 30,
        recoveryTime,
        travelTime: 30,
        cycleTime: 30 + recoveryTime,
        stops,
    };
}

const weekdayEntry: MasterScheduleEntry = {
    id: '2-Weekday',
    routeNumber: '2',
    dayType: 'Weekday',
    currentVersion: 4,
    storagePath: 'teams/test/masterSchedules/2-Weekday_v4.json',
    tripCount: 8,
    northStopCount: 2,
    southStopCount: 2,
    updatedAt: new Date('2026-03-15T12:00:00Z'),
    publishedAt: new Date('2026-03-16T08:00:00Z'),
    updatedBy: 'user-1',
    uploaderName: 'Planner',
    source: 'draft',
};

const weekdayContent: MasterScheduleContent = {
    northTable: {
        routeName: '2 Weekday North',
        stops: ['Park Place', 'Downtown Hub'],
        stopIds: {
            'Park Place': '777',
            'Downtown Hub': '2',
        },
        trips: [
            makeTrip('north-1', 'North', 360, { 'Park Place': '6:00 AM', 'Downtown Hub': '6:30 AM' }, 6),
            makeTrip('north-2', 'North', 375, { 'Park Place': '6:15 AM', 'Downtown Hub': '6:45 AM' }, 6),
            makeTrip('north-3', 'North', 390, { 'Park Place': '6:30 AM', 'Downtown Hub': '7:00 AM' }, 6),
            makeTrip('north-4', 'North', 405, { 'Park Place': '6:45 AM', 'Downtown Hub': '7:15 AM' }, 6),
        ],
    },
    southTable: {
        routeName: '2 Weekday South',
        stops: ['Downtown Hub', 'Park Place'],
        stopIds: {
            'Downtown Hub': '2',
            'Park Place': '777',
        },
        trips: [
            makeTrip('south-1', 'South', 365, { 'Downtown Hub': '6:05 AM', 'Park Place': '6:35 AM' }, 4),
            makeTrip('south-2', 'South', 380, { 'Downtown Hub': '6:20 AM', 'Park Place': '6:50 AM' }, 4),
            makeTrip('south-3', 'South', 395, { 'Downtown Hub': '6:35 AM', 'Park Place': '7:05 AM' }, 4),
            makeTrip('south-4', 'South', 410, { 'Downtown Hub': '6:50 AM', 'Park Place': '7:20 AM' }, 4),
        ],
    },
    metadata: {
        routeNumber: '2',
        dayType: 'Weekday',
        uploadedAt: '2026-03-16T08:00:00Z',
    },
};

describe('findMostRecentMasterScheduleEntry', () => {
    it('returns the most recent matching route entry across day types', () => {
        const saturdayEntry: MasterScheduleEntry = {
            ...weekdayEntry,
            id: '2-Saturday',
            dayType: 'Saturday',
            publishedAt: new Date('2026-03-10T08:00:00Z'),
            updatedAt: new Date('2026-03-10T08:00:00Z'),
        };
        const otherRouteEntry: MasterScheduleEntry = {
            ...weekdayEntry,
            id: '3-Weekday',
            routeNumber: '3',
            publishedAt: new Date('2026-03-20T08:00:00Z'),
            updatedAt: new Date('2026-03-20T08:00:00Z'),
        };

        const selected = findMostRecentMasterScheduleEntry(
            [saturdayEntry, otherRouteEntry, weekdayEntry],
            'Route 2',
        );

        expect(selected?.id).toBe('2-Weekday');
    });
});

describe('deriveRoutePlannerMasterServiceSeed', () => {
    it('derives first departure, last departure, and peak headway from master content', () => {
        const seed = deriveRoutePlannerMasterServiceSeed(weekdayEntry, weekdayContent);

        expect(seed).toEqual({
            routeNumber: '2',
            dayType: 'Weekday',
            updatedAt: new Date('2026-03-16T08:00:00Z'),
            firstDeparture: '06:00',
            lastDeparture: '06:50',
            frequencyMinutes: 15,
            layoverMinutes: 6,
            seededStops: [
                {
                    id: 'master-777-1',
                    name: 'Park Place',
                    kind: 'existing',
                    sourceStopId: '777',
                    role: 'terminal',
                    latitude: 44.3403906345005,
                    longitude: -79.6803262502088,
                    timeLabel: '06:00',
                    plannedOffsetMinutes: null,
                },
                {
                    id: 'master-2-2',
                    name: 'Downtown Hub',
                    kind: 'existing',
                    sourceStopId: '2',
                    role: 'terminal',
                    latitude: 44.387753,
                    longitude: -79.690237,
                    timeLabel: '06:00',
                    plannedOffsetMinutes: null,
                },
            ],
        });
    });
});
