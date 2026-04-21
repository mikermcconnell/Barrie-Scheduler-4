import type { MasterScheduleContent, MasterScheduleEntry } from '../utils/masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';

const ALLANDALE = 'Barrie Allandale Transit Terminal';

function buildTrip({
    id,
    blockId,
    direction,
    tripNumber,
    rowId,
    startTime,
    allandaleArrival,
    allandaleDeparture,
    endTime,
    startStop,
    endStop,
}: {
    id: string;
    blockId: string;
    direction: 'North' | 'South';
    tripNumber: number;
    rowId: number;
    startTime: number;
    allandaleArrival: string;
    allandaleDeparture: string;
    endTime: number;
    startStop: string;
    endStop: string;
}): MasterTrip {
    return {
        id,
        blockId,
        direction,
        tripNumber,
        rowId,
        startTime,
        endTime,
        recoveryTime: 5,
        travelTime: endTime - startTime - 5,
        cycleTime: endTime - startTime,
        stops: {
            [startStop]: clock(startTime),
            [ALLANDALE]: allandaleDeparture,
            [endStop]: clock(endTime - 5),
        },
        arrivalTimes: {
            [ALLANDALE]: allandaleArrival,
        },
        recoveryTimes: {
            [ALLANDALE]: 5,
        },
    };
}

function clock(minutes: number): string {
    const hours24 = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${mins.toString().padStart(2, '0')} ${period}`;
}

function buildNorthTable(routeNumber: '8A' | '8B'): MasterRouteTable {
    const startStop = routeNumber === '8A' ? 'RVH / Yonge Street' : 'Essa / Ferndale';
    return {
        routeName: `${routeNumber} (Weekday) (North)`,
        stops: [startStop, ALLANDALE, 'Georgian College'],
        stopIds: {},
        trips: [
            buildTrip({
                id: `${routeNumber}-north-801`,
                blockId: '801',
                direction: 'North',
                tripNumber: 1,
                rowId: 1,
                startTime: routeNumber === '8A' ? 360 : 480,
                allandaleArrival: routeNumber === '8A' ? '6:20 AM' : '8:20 AM',
                allandaleDeparture: routeNumber === '8A' ? '6:25 AM' : '8:25 AM',
                endTime: routeNumber === '8A' ? 405 : 525,
                startStop,
                endStop: 'Georgian College',
            }),
            buildTrip({
                id: `${routeNumber}-north-802`,
                blockId: '802',
                direction: 'North',
                tripNumber: 2,
                rowId: 2,
                startTime: routeNumber === '8A' ? 420 : 540,
                allandaleArrival: routeNumber === '8A' ? '7:20 AM' : '9:20 AM',
                allandaleDeparture: routeNumber === '8A' ? '7:25 AM' : '9:25 AM',
                endTime: routeNumber === '8A' ? 465 : 585,
                startStop,
                endStop: 'Georgian College',
            }),
        ],
    };
}

function buildSouthTable(routeNumber: '8A' | '8B'): MasterRouteTable {
    const endStop = routeNumber === '8A' ? 'Park Place Terminal' : 'Mapleview / Essa';
    return {
        routeName: `${routeNumber} (Weekday) (South)`,
        stops: ['Georgian College', ALLANDALE, endStop],
        stopIds: {},
        trips: [
            buildTrip({
                id: `${routeNumber}-south-801`,
                blockId: '801',
                direction: 'South',
                tripNumber: 1,
                rowId: 3,
                startTime: routeNumber === '8A' ? 420 : 540,
                allandaleArrival: routeNumber === '8A' ? '7:20 AM' : '9:20 AM',
                allandaleDeparture: routeNumber === '8A' ? '7:25 AM' : '9:25 AM',
                endTime: routeNumber === '8A' ? 465 : 585,
                startStop: 'Georgian College',
                endStop,
            }),
            buildTrip({
                id: `${routeNumber}-south-802`,
                blockId: '802',
                direction: 'South',
                tripNumber: 2,
                rowId: 4,
                startTime: routeNumber === '8A' ? 480 : 600,
                allandaleArrival: routeNumber === '8A' ? '8:20 AM' : '10:20 AM',
                allandaleDeparture: routeNumber === '8A' ? '8:25 AM' : '10:25 AM',
                endTime: routeNumber === '8A' ? 525 : 645,
                startStop: 'Georgian College',
                endStop,
            }),
        ],
    };
}

export function createRoute8SandboxContentFixture() {
    const route8A: MasterScheduleContent = {
        northTable: buildNorthTable('8A'),
        southTable: buildSouthTable('8A'),
        metadata: {
            routeNumber: '8A',
            dayType: 'Weekday',
            uploadedAt: '2026-04-17T10:00:00.000Z',
        },
    };

    const route8B: MasterScheduleContent = {
        northTable: buildNorthTable('8B'),
        southTable: buildSouthTable('8B'),
        metadata: {
            routeNumber: '8B',
            dayType: 'Weekday',
            uploadedAt: '2026-04-17T10:00:00.000Z',
        },
    };

    return {
        dayType: 'Weekday' as const,
        sourceSnapshots: {
            '8A': {
                routeNumber: '8A' as const,
                routeIdentity: '8A-Weekday' as const,
                version: 3,
                updatedAt: '2026-04-17T10:00:00.000Z',
                publishedAt: '2026-04-17T10:15:00.000Z',
            },
            '8B': {
                routeNumber: '8B' as const,
                routeIdentity: '8B-Weekday' as const,
                version: 5,
                updatedAt: '2026-04-17T10:00:00.000Z',
                publishedAt: '2026-04-17T10:15:00.000Z',
            },
        },
        sourceCopies: {
            '8A': JSON.parse(JSON.stringify(route8A)) as MasterScheduleContent,
            '8B': JSON.parse(JSON.stringify(route8B)) as MasterScheduleContent,
        },
        workingCopies: {
            '8A': JSON.parse(JSON.stringify(route8A)) as MasterScheduleContent,
            '8B': JSON.parse(JSON.stringify(route8B)) as MasterScheduleContent,
        },
        notes: '',
    };
}

export function createRoute8MasterPairFixture(): Record<'8A' | '8B', { entry: MasterScheduleEntry; content: MasterScheduleContent }> {
    const sandbox = createRoute8SandboxContentFixture();
    return {
        '8A': {
            entry: {
                id: '8A-Weekday',
                routeNumber: '8A',
                dayType: 'Weekday',
                currentVersion: 3,
                storagePath: 'teams/test/masterSchedules/8A-Weekday_v3.json',
                tripCount: 4,
                northStopCount: 3,
                southStopCount: 3,
                updatedAt: new Date('2026-04-17T10:00:00.000Z'),
                updatedBy: 'tester',
                uploaderName: 'Tester',
                source: 'draft',
                publishedAt: new Date('2026-04-17T10:15:00.000Z'),
            },
            content: sandbox.sourceCopies['8A'],
        },
        '8B': {
            entry: {
                id: '8B-Weekday',
                routeNumber: '8B',
                dayType: 'Weekday',
                currentVersion: 5,
                storagePath: 'teams/test/masterSchedules/8B-Weekday_v5.json',
                tripCount: 4,
                northStopCount: 3,
                southStopCount: 3,
                updatedAt: new Date('2026-04-17T10:00:00.000Z'),
                updatedBy: 'tester',
                uploaderName: 'Tester',
                source: 'draft',
                publishedAt: new Date('2026-04-17T10:15:00.000Z'),
            },
            content: sandbox.sourceCopies['8B'],
        },
    };
}
