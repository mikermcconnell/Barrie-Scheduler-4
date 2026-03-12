import { describe, expect, it } from 'vitest';
import { analyzeNetworkConnections } from '../utils/network-connections/networkConnectionAnalysis';
import type { NetworkConnectionScheduleInput } from '../utils/network-connections/networkConnectionTypes';
import type { MasterScheduleContent, MasterScheduleEntry } from '../utils/masterScheduleTypes';

const SHARED_STOP_ID = '2';
const SHARED_STOP_NAME = 'Downtown Hub';
const UNIQUE_NORTH_STOP_ID = '485';
const UNIQUE_NORTH_STOP_NAME = 'Maple at Ross';
const UNIQUE_SOUTH_STOP_ID = '607';
const UNIQUE_SOUTH_STOP_NAME = 'Victoria Village';

function buildSchedule(
    routeNumber: string,
    northTimes: string[],
    southTimes: string[],
): NetworkConnectionScheduleInput {
    const entry: MasterScheduleEntry = {
        id: `${routeNumber}-Weekday`,
        routeNumber,
        dayType: 'Weekday',
        currentVersion: 1,
        storagePath: '',
        tripCount: northTimes.length + southTimes.length,
        northStopCount: 2,
        southStopCount: 2,
        updatedAt: new Date('2026-03-11T12:00:00Z'),
        updatedBy: 'test',
        uploaderName: 'Test',
        source: 'draft',
    };

    const content: MasterScheduleContent = {
        northTable: {
            routeName: `${routeNumber} (Weekday) (North)`,
            stops: [UNIQUE_NORTH_STOP_NAME, SHARED_STOP_NAME],
            stopIds: { [UNIQUE_NORTH_STOP_NAME]: UNIQUE_NORTH_STOP_ID, [SHARED_STOP_NAME]: SHARED_STOP_ID },
            trips: northTimes.map((time, index) => ({
                id: `${routeNumber}-N-${index + 1}`,
                blockId: routeNumber,
                direction: 'North',
                tripNumber: index + 1,
                rowId: index + 1,
                startTime: 0,
                endTime: 0,
                recoveryTime: 0,
                travelTime: 0,
                cycleTime: 0,
                stops: {
                    [UNIQUE_NORTH_STOP_NAME]: time,
                    [SHARED_STOP_NAME]: time,
                },
                stopMinutes: {
                    [UNIQUE_NORTH_STOP_NAME]: parseTime(time),
                    [SHARED_STOP_NAME]: parseTime(time),
                },
            })),
        },
        southTable: {
            routeName: `${routeNumber} (Weekday) (South)`,
            stops: [SHARED_STOP_NAME, UNIQUE_SOUTH_STOP_NAME],
            stopIds: { [SHARED_STOP_NAME]: SHARED_STOP_ID, [UNIQUE_SOUTH_STOP_NAME]: UNIQUE_SOUTH_STOP_ID },
            trips: southTimes.map((time, index) => ({
                id: `${routeNumber}-S-${index + 1}`,
                blockId: routeNumber,
                direction: 'South',
                tripNumber: index + 1,
                rowId: index + 1,
                startTime: 0,
                endTime: 0,
                recoveryTime: 0,
                travelTime: 0,
                cycleTime: 0,
                stops: {
                    [SHARED_STOP_NAME]: time,
                    [UNIQUE_SOUTH_STOP_NAME]: time,
                },
                stopMinutes: {
                    [SHARED_STOP_NAME]: parseTime(time),
                    [UNIQUE_SOUTH_STOP_NAME]: parseTime(time),
                },
            })),
        },
        metadata: {
            routeNumber,
            dayType: 'Weekday',
            uploadedAt: new Date('2026-03-11T12:00:00Z').toISOString(),
        },
    };

    return { entry, content };
}

function parseTime(value: string): number {
    const match = value.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (!match) return 0;
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const meridiem = match[3].toUpperCase();
    if (meridiem === 'PM' && hour !== 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return (hour * 60) + minute;
}

describe('analyzeNetworkConnections', () => {
    it('builds a shared-stop hub and route-pair patterns from master schedules', () => {
        const schedules = [
            buildSchedule('1', ['7:55 AM', '8:25 AM'], ['8:00 AM']),
            buildSchedule('2', ['8:00 AM'], ['8:05 AM', '8:35 AM']),
        ];

        const result = analyzeNetworkConnections({
            schedules,
            dayType: 'Weekday',
            timeBand: 'full_day',
        });

        expect(result.summary.hubCount).toBeGreaterThan(0);
        expect(result.hubs[0]?.routeNumbers).toContain('1');
        expect(result.hubs[0]?.routeNumbers).toContain('2');
        const pattern = result.patterns.find((item) => item.fromService.routeNumber === '1' && item.toService.routeNumber === '2');
        expect(pattern).toBeTruthy();
        expect(pattern?.opportunities[0]?.fromStopId).toBe(SHARED_STOP_ID);
        expect(pattern?.opportunities[0]?.fromStopName).toBe(SHARED_STOP_NAME);
    });

    it('classifies repeated misses as weak patterns with recommendations', () => {
        const schedules = [
            buildSchedule('1', ['7:55 AM', '8:25 AM'], []),
            buildSchedule('2', ['8:40 AM'], []),
        ];

        const result = analyzeNetworkConnections({
            schedules,
            dayType: 'Weekday',
            timeBand: 'full_day',
        });

        const weakPattern = result.patterns.find((pattern) =>
            pattern.fromService.routeNumber === '1' && pattern.toService.routeNumber === '2',
        );

        expect(weakPattern).toBeTruthy();
        expect(weakPattern?.severity).toBe('weak');
        expect(weakPattern?.recommendations.length).toBeGreaterThan(0);
    });
});
