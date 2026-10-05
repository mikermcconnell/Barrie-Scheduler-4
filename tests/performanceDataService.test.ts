import { describe, expect, it, vi } from 'vitest';
vi.mock('../utils/sharedWorkspaceDataClient', () => ({
    requestSharedWorkspaceData: vi.fn(),
}));

import {
    buildStorageJsonUploadData,
    getPerformanceMonthlyPaths,
    getPerformanceData,
    getSharedPerformanceDateWindows,
    getTotalRecordsForSummary,
    mapWithConcurrency,
    mergePerformanceSummaryMetadata,
    resolveMergedCleanHistoryStartDate,
} from '../utils/performanceDataService';
import { buildPerformanceDashboardView } from '../utils/performanceDashboardView';
import type { PerformanceDataSummary, PerformanceMetadata } from '../utils/performanceDataTypes';
import { buildStopLoadLookup } from '../utils/schedule/cascadeStoryUtils';
import { requestSharedWorkspaceData } from '../utils/sharedWorkspaceDataClient';

describe('performanceDataService metadata merge', () => {
    it('prefers Firestore metadata when the stored summary JSON is missing newer runtime flags', () => {
        const summary: PerformanceDataSummary = {
            dailySummaries: [],
            metadata: {
                importedAt: '2026-03-30T11:00:00.000Z',
                importedBy: 'storage-json',
                dateRange: { start: '2026-03-20', end: '2026-03-30' },
                dayCount: 11,
                totalRecords: 1234,
            },
            schemaVersion: 8,
        };

        const metadata: PerformanceMetadata = {
            importedAt: '2026-03-31T05:00:00.000Z',
            importedBy: 'auto-ingest',
            dateRange: { start: '2026-03-22', end: '2026-03-31' },
            dayCount: 10,
            totalRecords: 1400,
            runtimeLogicVersion: 3,
            cleanHistoryStartDate: '2026-03-22',
            storagePath: 'teams/team-1/performanceData/latest.json',
            overviewStoragePath: 'teams/team-1/performanceData/latest-overview.json',
        };

        const merged = mergePerformanceSummaryMetadata(summary, metadata);

        expect(merged.metadata.importedAt).toBe('2026-03-31T05:00:00.000Z');
        expect(merged.metadata.importedBy).toBe('auto-ingest');
        expect(merged.metadata.dateRange).toEqual({ start: '2026-03-22', end: '2026-03-31' });
        expect(merged.metadata.dayCount).toBe(10);
        expect(merged.metadata.totalRecords).toBe(1400);
        expect(merged.metadata.runtimeLogicVersion).toBe(3);
        expect(merged.metadata.cleanHistoryStartDate).toBe('2026-03-22');
        expect(merged.metadata.storagePath).toBe('teams/team-1/performanceData/latest.json');
        expect(merged.metadata.overviewStoragePath).toBe('teams/team-1/performanceData/latest-overview.json');
    });

    it('keeps existing summary metadata when Firestore metadata omits optional runtime fields', () => {
        const summary: PerformanceDataSummary = {
            dailySummaries: [],
            metadata: {
                importedAt: '2026-03-31T05:00:00.000Z',
                importedBy: 'auto-ingest',
                dateRange: { start: '2026-03-22', end: '2026-03-31' },
                dayCount: 10,
                totalRecords: 1400,
                runtimeLogicVersion: 3,
                cleanHistoryStartDate: '2026-03-22',
            },
            schemaVersion: 8,
        };

        const metadata: PerformanceMetadata = {
            importedAt: '2026-03-31T05:00:00.000Z',
            importedBy: 'auto-ingest',
            dateRange: { start: '2026-03-22', end: '2026-03-31' },
            dayCount: 10,
            totalRecords: 1400,
        };

        const merged = mergePerformanceSummaryMetadata(summary, metadata);

        expect(merged.metadata.runtimeLogicVersion).toBe(3);
        expect(merged.metadata.cleanHistoryStartDate).toBe('2026-03-22');
    });
});

describe('performanceDataService storage upload payload', () => {
    it('serializes JSON into a binary upload payload instead of relying on raw string upload helpers', async () => {
        const payload = buildStorageJsonUploadData({
            hello: 'world',
            count: 2,
        });

        if (payload instanceof Blob) {
            expect(payload.type).toBe('application/json');
            expect(payload.size).toBeGreaterThan(0);
            return;
        }

        expect(new TextDecoder().decode(payload)).toBe('{"hello":"world","count":2}');
    });
});

describe('performanceDataService merge helpers', () => {
    it('sums total records from all merged days instead of only the newest import', () => {
        const summary: PerformanceDataSummary = {
            dailySummaries: [
                { date: '2026-04-14', dataQuality: { totalRecords: 100 } } as any,
                { date: '2026-04-15', dataQuality: { totalRecords: 200 } } as any,
                { date: '2026-04-16', dataQuality: { totalRecords: 300 } } as any,
            ],
            metadata: {
                importedAt: '2026-04-17T00:00:00.000Z',
                importedBy: 'tester',
                dateRange: { start: '2026-04-14', end: '2026-04-16' },
                dayCount: 3,
                totalRecords: 300,
            },
            schemaVersion: 8,
        };

        expect(getTotalRecordsForSummary(summary)).toBe(600);
    });

    it('preserves the older clean-history start date when merging a new manual import', () => {
        expect(resolveMergedCleanHistoryStartDate('2026-04-16', '2026-03-30')).toBe('2026-03-30');
        expect(resolveMergedCleanHistoryStartDate('2026-03-29', '2026-03-30')).toBe('2026-03-29');
        expect(resolveMergedCleanHistoryStartDate(undefined, '2026-03-30')).toBe('2026-03-30');
    });
});

describe('performanceDataService bounded work', () => {
    it('caps concurrent tasks while processing every item', async () => {
        let active = 0;
        let maxActive = 0;
        const completed: number[] = [];
        let release: (() => void) | undefined;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });

        const work = mapWithConcurrency([1, 2, 3, 4, 5, 6], 4, async item => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await gate;
            completed.push(item);
            active -= 1;
        });

        await vi.waitFor(() => expect(maxActive).toBe(4));
        release?.();
        await work;

        expect(maxActive).toBe(4);
        expect(completed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('reports monotonic completion progress for concurrent work', async () => {
        const progress: Array<[number, number]> = [];

        await mapWithConcurrency(
            [1, 2, 3, 4],
            2,
            async () => Promise.resolve(),
            (completed, total) => progress.push([completed, total]),
        );

        expect(progress).toEqual([
            [1, 4],
            [2, 4],
            [3, 4],
            [4, 4],
        ]);
    });
});

describe('performance dashboard monthly views', () => {
    const metadata: PerformanceMetadata = {
        importedAt: '2026-09-01T12:00:00.000Z',
        importedBy: 'test',
        dateRange: { start: '2026-08-01', end: '2026-08-31' },
        dayCount: 31,
        totalRecords: 1,
        monthlyStoragePaths: { '2026-08': 'full-august.json' },
        routeMonthlyStoragePaths: { '1': { '2026-08': 'route-1-august.json' } },
        dashboardMonthlyStoragePaths: {
            overview: { '2026-08': 'overview-august.json' },
        },
    };

    it('prefers a compact tab projection before route-scoped and full monthly archives', () => {
        expect(getPerformanceMonthlyPaths(metadata, '1', 'overview')).toEqual({
            '2026-08': 'overview-august.json',
        });
        expect(getPerformanceMonthlyPaths(metadata, '1', 'otp')).toEqual({
            '2026-08': 'route-1-august.json',
        });
        expect(getPerformanceMonthlyPaths(metadata, 'all', 'otp')).toEqual({
            '2026-08': 'full-august.json',
        });
    });

    it('falls back instead of silently dropping months when a compact pointer is incomplete', () => {
        const incompleteMetadata: PerformanceMetadata = {
            ...metadata,
            monthlyStoragePaths: {
                '2026-07': 'full-july.json',
                '2026-08': 'full-august.json',
            },
            dashboardMonthlyStoragePaths: {
                overview: { '2026-08': 'overview-august.json' },
            },
        };

        expect(getPerformanceMonthlyPaths(incompleteMetadata, 'all', 'overview')).toEqual({
            '2026-07': 'full-july.json',
            '2026-08': 'full-august.json',
        });
    });

    it('splits shared history into one bounded request per stored month', () => {
        const sharedMetadata: PerformanceMetadata = {
            ...metadata,
            dateRange: { start: '2026-06-15', end: '2026-08-31' },
            monthlyStoragePaths: {
                '2026-06': 'full-june.json',
                '2026-07': 'full-july.json',
                '2026-08': 'full-august.json',
            },
            dashboardMonthlyStoragePaths: {
                overview: {
                    '2026-06': 'overview-june.json',
                    '2026-07': 'overview-july.json',
                    '2026-08': 'overview-august.json',
                },
            },
        };

        expect(getSharedPerformanceDateWindows(sharedMetadata, 'all', {
            detailMode: 'overview',
            dateRange: { start: '2026-06-20', end: '2026-08-05' },
        })).toEqual([
            { start: '2026-06-20', end: '2026-06-30' },
            { start: '2026-07-01', end: '2026-07-31' },
            { start: '2026-08-01', end: '2026-08-05' },
        ]);
    });

    it('loads and merges shared months through separate bounded responses', async () => {
        const sharedMetadata: PerformanceMetadata = {
            ...metadata,
            dateRange: { start: '2026-06-01', end: '2026-08-31' },
            monthlyStoragePaths: {
                '2026-06': 'full-june.json',
                '2026-07': 'full-july.json',
                '2026-08': 'full-august.json',
            },
        };
        const requestMock = vi.mocked(requestSharedWorkspaceData);
        requestMock.mockImplementation(async request => ({
            dailySummaries: [{
                date: request.dateRange!.start,
                dataQuality: { totalRecords: 1 },
            }] as any,
            metadata: {
                ...sharedMetadata,
                dateRange: request.dateRange!,
                dayCount: 1,
                totalRecords: 1,
            },
            schemaVersion: 14,
        }));

        const progress: Array<[number, number]> = [];
        const result = await getPerformanceData(
            'source-team',
            sharedMetadata,
            'all',
            'requesting-team',
            { detailMode: 'all' },
            value => progress.push([value.completedUnits, value.totalUnits]),
        );

        expect(requestMock).toHaveBeenCalledTimes(3);
        expect(requestMock.mock.calls.map(([request]) => request.dateRange)).toEqual(expect.arrayContaining([
            { start: '2026-06-01', end: '2026-06-30' },
            { start: '2026-07-01', end: '2026-07-31' },
            { start: '2026-08-01', end: '2026-08-31' },
        ]));
        expect(result?.dailySummaries.map(day => day.date)).toEqual([
            '2026-06-01',
            '2026-07-01',
            '2026-08-01',
        ]);
        expect(progress.at(-1)).toEqual([3, 3]);
    });

    it('removes schedule-runtime evidence while retaining fields required by the selected dashboard tab', () => {
        const day = {
            date: '2026-08-31',
            byStop: [{ stopId: 'stop-1' }],
            byTrip: [{ tripId: 'trip-1' }],
            loadProfiles: [{ routeId: '1' }],
            ridershipHeatmaps: [{ routeId: '1' }],
            byOperatorDwell: { incidents: [{ id: 'incident-1' }] },
            byCascade: { incidents: [{ id: 'cascade-1' }] },
            segmentRuntimes: { entries: [{ routeId: '1' }] },
            stopSegmentRuntimes: { entries: [{ routeId: '1' }] },
            tripStopSegmentRuntimes: { entries: [{ routeId: '1' }] },
            runtimePatterns: [{ routeId: '1' }],
            routeStopDeviations: [{ routeId: '1' }],
            byRouteHour: [{ routeId: '1' }],
        } as any;
        const summary = {
            dailySummaries: [day],
            metadata,
            schemaVersion: 14,
        } as PerformanceDataSummary;

        const ridershipDay = buildPerformanceDashboardView(summary, 'ridership').dailySummaries[0];
        expect(ridershipDay.byStop).toEqual(day.byStop);
        expect(ridershipDay.ridershipHeatmaps).toEqual(day.ridershipHeatmaps);
        expect(ridershipDay.byRouteHour).toEqual(day.byRouteHour);
        expect(ridershipDay.byTrip).toEqual([]);
        expect(ridershipDay.segmentRuntimes).toBeUndefined();
        expect(ridershipDay.stopSegmentRuntimes).toBeUndefined();
        expect(ridershipDay.tripStopSegmentRuntimes).toBeUndefined();
        expect(ridershipDay.runtimePatterns).toBeUndefined();
    });

    it('keeps passenger-load context required by Dwell incident maps and timelines', () => {
        const loadProfiles = [{
            routeId: '1',
            direction: 'N',
            tripCount: 1,
            stops: [{
                stopId: 'stop-1',
                stopName: 'Stop 1',
                isTimepoint: true,
                avgBoardings: 2,
                avgAlightings: 1,
                avgLoad: 8,
                maxLoad: 10,
            }],
        }];
        const days = Array.from({ length: 14 }, (_, index) => ({
            date: `2026-08-${String(index + 1).padStart(2, '0')}`,
            loadProfiles,
            byOperatorDwell: { incidents: [] as any[] },
            byCascade: { cascades: [] as any[], byStop: [] as any[], byTerminal: [] as any[] },
        })) as any;
        const summary = {
            dailySummaries: days,
            metadata,
            schemaVersion: 14,
        } as PerformanceDataSummary;

        const projected = buildPerformanceDashboardView(summary, 'operator-dwell');
        expect(projected.dailySummaries[0].loadProfiles).toEqual(loadProfiles);
        expect(buildStopLoadLookup(projected.dailySummaries).get('1_stop-1')).toMatchObject({
            avgBoardings: 2,
            avgAlightings: 1,
            avgLoad: 8,
            dayCount: 14,
        });
    });
});
