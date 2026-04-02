import { describe, expect, it } from 'vitest';
import { mergePerformanceSummaryMetadata } from '../utils/performanceDataService';
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
