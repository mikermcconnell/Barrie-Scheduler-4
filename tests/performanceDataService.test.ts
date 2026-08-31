import { describe, expect, it, vi } from 'vitest';
import {
    buildStorageJsonUploadData,
    getTotalRecordsForSummary,
    mapWithConcurrency,
    mergePerformanceSummaryMetadata,
    resolveMergedCleanHistoryStartDate,
} from '../utils/performanceDataService';
import type { PerformanceDataSummary, PerformanceMetadata } from '../utils/performanceDataTypes';

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
