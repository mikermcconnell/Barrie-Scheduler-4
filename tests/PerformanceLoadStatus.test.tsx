import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PerformanceLoadStatus } from '../components/Performance/PerformanceLoadStatus';
import { recordPerformanceLoadDuration } from '../utils/performanceLoadTiming';

describe('PerformanceLoadStatus', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
        window.localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it('waits 500 ms before showing first-use estimating feedback', async () => {
        await act(async () => {
            root.render(
                <PerformanceLoadStatus
                    isLoading
                    profileKey="operations:overview"
                    label="dashboard overview"
                />,
            );
        });

        await act(async () => vi.advanceTimersByTime(499));
        expect(container.querySelector('[data-testid="performance-load-status"]')).toBeNull();

        await act(async () => vi.advanceTimersByTime(1));
        expect(container.textContent).toContain('Estimating time…');
    });

    it('shows a learned countdown and never displays zero while still loading', async () => {
        recordPerformanceLoadDuration('operations:overview', 3000);
        await act(async () => {
            root.render(
                <PerformanceLoadStatus
                    isLoading
                    profileKey="operations:overview"
                    label="dashboard overview"
                />,
            );
        });

        await act(async () => vi.advanceTimersByTime(500));
        expect(container.textContent).toContain('About 3 seconds remaining');

        await act(async () => vi.advanceTimersByTime(3000));
        expect(container.textContent).toContain('Taking longer than usual…');
        expect(container.textContent).not.toContain('0 seconds remaining');
    });

    it('shows real monthly-file progress with accessible progress semantics', async () => {
        await act(async () => {
            root.render(
                <PerformanceLoadStatus
                    isLoading
                    profileKey="operations:detail:storage:all-routes:overview:2-4"
                    label="Past 3 Months"
                    progress={{
                        phase: 'downloading',
                        completedUnits: 1,
                        totalUnits: 3,
                        unitLabel: 'monthly-file',
                    }}
                />,
            );
        });

        await act(async () => vi.advanceTimersByTime(1000));
        expect(container.textContent).toContain('1 of 3 monthly files');
        expect(container.textContent).toContain('About 2 seconds remaining');
        const progressbar = container.querySelector('[role="progressbar"]');
        expect(progressbar?.getAttribute('aria-valuenow')).toBe('1');
        expect(progressbar?.getAttribute('aria-valuemax')).toBe('3');
    });
});
