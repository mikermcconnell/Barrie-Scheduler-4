import { describe, expect, it } from 'vitest';
import { filterDailySummaries, type TimeRange } from '../components/Performance/PerformanceFilterBar';
import type { DailySummary, DayType } from '../utils/performanceDataTypes';

function makeDay(date: string, dayType: DayType): DailySummary {
    return {
        date,
        dayType,
        system: {
            otp: {
                total: 0,
                onTime: 0,
                early: 0,
                late: 0,
                onTimePercent: 0,
                earlyPercent: 0,
                latePercent: 0,
                avgDeviationSeconds: 0,
            },
            totalRidership: 0,
            totalBoardings: 0,
            totalAlightings: 0,
            vehicleCount: 0,
            tripCount: 0,
            wheelchairTrips: 0,
            avgSystemLoad: 0,
            peakLoad: 0,
        },
        byRoute: [],
        byHour: [],
        byStop: [],
        byTrip: [],
        loadProfiles: [],
        dataQuality: {
            totalRecords: 0,
            inBetweenFiltered: 0,
            missingAVL: 0,
            missingAPC: 0,
            detourRecords: 0,
            tripperRecords: 0,
            loadCapped: 0,
            apcExcludedFromLoad: 0,
        },
        schemaVersion: 1,
    };
}

function runRange(summaries: DailySummary[], timeRange: TimeRange, dayType: DayType | 'all' = 'all') {
    return filterDailySummaries(summaries, timeRange, dayType).map(d => d.date);
}

describe('filterDailySummaries', () => {
    const days = [
        makeDay('2025-01-01', 'weekday'),
        makeDay('2025-01-02', 'weekday'),
        makeDay('2025-01-03', 'weekday'),
        makeDay('2025-01-04', 'saturday'),
        makeDay('2025-01-05', 'sunday'),
        makeDay('2025-01-06', 'weekday'),
        makeDay('2025-01-07', 'weekday'),
        makeDay('2025-01-08', 'weekday'),
        makeDay('2025-01-09', 'weekday'),
        makeDay('2025-01-10', 'weekday'),
    ];

    it('anchors yesterday to the latest imported day, not wall-clock today', () => {
        expect(runRange(days, 'yesterday')).toEqual(['2025-01-09']);
    });

    it('uses an inclusive 7-day window anchored to latest imported day', () => {
        expect(runRange(days, 'past-week')).toEqual([
            '2025-01-04',
            '2025-01-05',
            '2025-01-06',
            '2025-01-07',
            '2025-01-08',
            '2025-01-09',
            '2025-01-10',
        ]);
    });

    it('applies day type filter after time-range filtering', () => {
        expect(runRange(days, 'past-week', 'weekday')).toEqual([
            '2025-01-06',
            '2025-01-07',
            '2025-01-08',
            '2025-01-09',
            '2025-01-10',
        ]);
    });
});
