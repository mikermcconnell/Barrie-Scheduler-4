import { describe, expect, it } from 'vitest';
import {
    filterDailySummaries,
    getPerformanceDateWindow,
    type PerformanceDateWindow,
    type TimeRange,
} from '../components/Performance/PerformanceFilterBar';
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

function runRange(
    summaries: DailySummary[],
    timeRange: TimeRange,
    dayType: DayType | 'all' = 'all',
    selectedDate?: string | null,
    customDateRange?: PerformanceDateWindow | null,
) {
    return filterDailySummaries(summaries, timeRange, dayType, selectedDate, customDateRange).map(d => d.date);
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

    it('keeps the exact calendar window when its first service day is missing', () => {
        const daysWithMissingBoundary = days.filter(day => day.date !== '2025-01-04');
        expect(getPerformanceDateWindow(daysWithMissingBoundary, 'past-week')).toEqual({
            start: '2025-01-04',
            end: '2025-01-10',
        });
        expect(runRange(daysWithMissingBoundary, 'past-week')).toEqual([
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

    it('uses an inclusive 90-day window for the three-month range', () => {
        const longRange = Array.from({ length: 100 }, (_, index) => {
            const date = new Date(Date.UTC(2025, 0, 1 + index));
            return makeDay(date.toISOString().slice(0, 10), 'weekday');
        });

        const result = runRange(longRange, 'past-three-months');
        expect(result).toHaveLength(90);
        expect(result[0]).toBe('2025-01-11');
        expect(result.at(-1)).toBe('2025-04-10');
    });

    it('uses latest imported day when single-day has no explicit selectedDate', () => {
        expect(runRange(days, 'single-day')).toEqual(['2025-01-10']);
    });

    it('filters to explicit selectedDate for single-day', () => {
        expect(runRange(days, 'single-day', 'all', '2025-01-06')).toEqual(['2025-01-06']);
    });

    it('uses inclusive custom start and end dates', () => {
        const customRange = { start: '2025-01-03', end: '2025-01-06' };
        expect(getPerformanceDateWindow(days, 'custom', null, customRange)).toEqual(customRange);
        expect(runRange(days, 'custom', 'all', null, customRange)).toEqual([
            '2025-01-03',
            '2025-01-04',
            '2025-01-05',
            '2025-01-06',
        ]);
    });

    it('combines a custom range with the shared day type filter', () => {
        expect(runRange(days, 'custom', 'weekday', null, {
            start: '2025-01-03',
            end: '2025-01-06',
        })).toEqual(['2025-01-03', '2025-01-06']);
    });

    it('rejects incomplete, invalid, and reversed custom ranges', () => {
        expect(runRange(days, 'custom', 'all', null, null)).toEqual([]);
        expect(runRange(days, 'custom', 'all', null, { start: '', end: '2025-01-06' })).toEqual([]);
        expect(runRange(days, 'custom', 'all', null, { start: '2025-01-07', end: '2025-01-06' })).toEqual([]);
    });
});
