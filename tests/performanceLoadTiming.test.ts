import { beforeEach, describe, expect, it } from 'vitest';
import {
    buildPerformanceLoadProfileKey,
    getExpectedPerformanceLoadUnits,
    getPerformanceLoadEstimateMs,
    recordPerformanceLoadDuration,
} from '../utils/performanceLoadTiming';
import type { PerformanceMetadata } from '../utils/performanceDataTypes';

describe('performance load timing', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('uses the median of the five most recent successful durations', () => {
        const profile = 'operations:overview';
        [9000, 1000, 5000, 3000, 7000, 2000].forEach(duration => {
            recordPerformanceLoadDuration(profile, duration);
        });

        expect(getPerformanceLoadEstimateMs(profile)).toBe(3000);
    });

    it('ignores corrupt storage and invalid durations', () => {
        window.localStorage.setItem('scheduler4:performance-load-timings:v1', '{bad json');
        recordPerformanceLoadDuration('operations:overview', Number.NaN);

        expect(getPerformanceLoadEstimateMs('operations:overview')).toBeNull();
    });

    it('counts only monthly files overlapping the requested range', () => {
        const metadata: PerformanceMetadata = {
            importedAt: '2026-08-31T12:00:00Z',
            importedBy: 'test-user',
            dateRange: { start: '2026-05-01', end: '2026-08-31' },
            dayCount: 123,
            totalRecords: 456,
            monthlyStoragePaths: {
                '2026-05': 'may.json',
                '2026-06': 'june.json',
                '2026-07': 'july.json',
                '2026-08': 'august.json',
            },
        };

        expect(getExpectedPerformanceLoadUnits(
            'team-1',
            metadata,
            'all',
            'team-1',
            { dateRange: { start: '2026-06-15', end: '2026-08-02' }, detailMode: 'overview' },
        )).toBe(3);
        expect(getExpectedPerformanceLoadUnits(
            'team-1',
            metadata,
            'all',
            'shared-team',
            { detailMode: 'overview' },
        )).toBe(1);
    });

    it('builds anonymous profile buckets without team, route, or date identifiers', () => {
        const key = buildPerformanceLoadProfileKey({
            kind: 'detail',
            unitCount: 3,
            routeScoped: true,
            detailMode: 'ridership',
        });

        expect(key).toBe('operations:detail:storage:route:ridership:2-4');
    });
});
