import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { PerformanceDataSummary } from '../utils/performanceDataTypes';

const accessState = vi.hoisted(() => ({ allowDwell: true }));
const canAccess = vi.hoisted(() => (feature: string) =>
    feature !== 'operationsOperatorDwell' || accessState.allowDwell
);

vi.mock('../hooks/useWorkspaceAccess', () => ({
    useWorkspaceAccess: () => ({ canAccess, loading: false }),
}));

vi.mock('../hooks/usePerformanceData', () => ({
    usePerformanceDataQuery: (): {
        data: null;
        isError: boolean;
        isFetching: boolean;
        refetch: ReturnType<typeof vi.fn>;
    } => ({
        data: null,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
    }),
}));

vi.mock('../utils/features', () => ({
    isFeatureEnabled: (feature: string) => feature !== 'operationsImportHealth',
    isFeatureUnderConstruction: () => false,
}));

vi.mock('../utils/lazyWithRetry', () => ({
    lazyWithRetry: (_loader: unknown, label: string) =>
        (): React.ReactElement => <div data-testid={label}>{label}</div>,
}));

vi.mock('../components/Performance/PerformanceFilterBar', () => ({
    PerformanceFilterBar: (): null => null,
    filterDailySummaries: (days: unknown[]) => days,
    getPerformanceDateWindow: (): null => null,
}));

vi.mock('../components/Performance/PerformanceImportHealthPanel', () => ({
    PerformanceImportHealthPanel: (): null => null,
}));

import { PerformanceWorkspace } from '../components/Performance/PerformanceWorkspace';

const data = {
    dailySummaries: [],
    metadata: {
        dateRange: { start: '2026-07-01', end: '2026-07-31' },
        dayCount: 0,
        totalRecords: 0,
    },
} as unknown as PerformanceDataSummary;

describe('PerformanceWorkspace navigation', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        accessState.allowDwell = true;
        window.location.hash = '';
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        window.location.hash = '';
    });

    async function renderWorkspace(): Promise<void> {
        await act(async () => {
            root.render(
                <PerformanceWorkspace
                    data={data}
                    onReimport={() => undefined}
                    onBack={() => undefined}
                />
            );
        });
    }

    it('restores Ridership on refresh and records tab changes in the URL', async () => {
        window.location.hash = '#operations/performance/ridership';
        await renderWorkspace();

        expect(container.textContent).toContain('performance-ridership-module');
        expect(container.querySelector('[data-tab="ridership"]')?.getAttribute('aria-pressed')).toBe('true');

        const otpButton = container.querySelector('[data-tab="otp"]') as HTMLButtonElement;
        await act(async () => otpButton.click());

        expect(window.location.hash).toBe('#operations/performance/otp');
        expect(container.textContent).toContain('performance-otp-module');
    });

    it('updates the selected section when browser history changes the hash', async () => {
        window.location.hash = '#operations/performance/ridership';
        await renderWorkspace();

        await act(async () => {
            window.location.hash = '#operations/performance/otp';
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });

        expect(container.querySelector('[data-tab="otp"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('performance-otp-module');
    });

    it('falls back safely when the requested section is inaccessible', async () => {
        accessState.allowDwell = false;
        window.location.hash = '#operations/performance/operator-dwell';
        await renderWorkspace();

        expect(window.location.hash).toBe('#operations/performance');
        expect(container.querySelector('[data-tab="overview"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('performance-system-overview');
    });
});
