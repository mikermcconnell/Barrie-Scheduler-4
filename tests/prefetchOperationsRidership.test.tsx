import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PerformanceDataSummary, PerformanceMetadata } from '../utils/performanceDataTypes';

const serviceMock = vi.hoisted(() => ({
    getPerformanceMetadata: vi.fn(),
    getPerformanceOverviewData: vi.fn(),
    getPerformanceData: vi.fn(),
    savePerformanceData: vi.fn(),
}));

vi.mock('../utils/performanceDataService', () => serviceMock);

import {
    prefetchOperationsRidership,
    usePerformanceDataQuery,
    usePerformanceMetadataQuery,
    usePerformanceOverviewQuery,
} from '../hooks/usePerformanceData';
import { resolveDetailDateRange } from '../utils/performanceDetailDateRange';

const metadata: PerformanceMetadata = {
    importedAt: '2026-10-06T08:00:00Z',
    importedBy: 'importer',
    dateRange: { start: '2026-01-01', end: '2026-10-05' },
    dayCount: 278,
    totalRecords: 1000,
    monthlyStoragePaths: { '2026-09': 'sep.json', '2026-10': 'oct.json' },
    dashboardMonthlyStoragePaths: {
        ridership: { '2026-09': 'ridership-sep.json', '2026-10': 'ridership-oct.json' },
    },
};

const summary = { dailySummaries: [], metadata } as unknown as PerformanceDataSummary;

describe('prefetchOperationsRidership', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        Object.values(serviceMock).forEach(mock => mock.mockReset());
        serviceMock.getPerformanceMetadata.mockResolvedValue(metadata);
        serviceMock.getPerformanceOverviewData.mockResolvedValue(summary);
        serviceMock.getPerformanceData.mockResolvedValue(summary);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('fills the exact cache entries the dashboard reads for Past Week ridership', async () => {
        const queryClient = new QueryClient();
        await prefetchOperationsRidership(queryClient, 'barrie', 'barrie');

        expect(serviceMock.getPerformanceData).toHaveBeenCalledWith(
            'barrie',
            metadata,
            'all',
            'barrie',
            { dateRange: { start: '2026-09-22', end: '2026-10-05' }, detailMode: 'ridership' },
        );

        const seen: Record<string, unknown> = {};
        const Dashboard = (): null => {
            const meta = usePerformanceMetadataQuery('barrie', 'barrie');
            const overview = usePerformanceOverviewQuery('barrie', true, meta.data, 'barrie');
            const detail = usePerformanceDataQuery('barrie', true, meta.data, 'all', 'barrie', {
                dateRange: resolveDetailDateRange(meta.data, 'past-week', null, null, true),
                detailMode: 'ridership',
            });
            seen.metadata = meta.data;
            seen.overview = overview.data;
            seen.detail = detail.data;
            return null;
        };

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}><Dashboard /></QueryClientProvider>,
        ));

        expect(seen).toEqual({ metadata, overview: summary, detail: summary });
        expect(serviceMock.getPerformanceMetadata).toHaveBeenCalledTimes(1);
        expect(serviceMock.getPerformanceOverviewData).toHaveBeenCalledTimes(1);
        expect(serviceMock.getPerformanceData).toHaveBeenCalledTimes(1);
    });

    it('stops after metadata when the team has no performance import', async () => {
        serviceMock.getPerformanceMetadata.mockResolvedValue(null);
        await prefetchOperationsRidership(new QueryClient(), 'other-team', 'other-team');

        expect(serviceMock.getPerformanceOverviewData).not.toHaveBeenCalled();
        expect(serviceMock.getPerformanceData).not.toHaveBeenCalled();
    });
});
