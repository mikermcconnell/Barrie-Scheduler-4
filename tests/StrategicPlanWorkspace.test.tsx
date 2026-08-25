import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategicPlanWorkspace } from '../components/Analytics/StrategicPlanWorkspace';

const loadProfile = vi.fn();

vi.mock('../utils/strategic-plan/serviceProfileData', () => ({
    loadStrategicPlanServiceProfile: () => loadProfile(),
}));

const row = (routeShortName: string, routeName: string, revenueHours: number) => ({
    routeName,
    routeShortName,
    serviceSpan: '6:00 AM–1:30 AM (+1)',
    peakFrequencyMinutes: 30,
    peakFrequencySpan: '6:00 AM–8:00 PM',
    offPeakFrequencyMinutes: 60,
    offPeakFrequencySpan: '8:00 PM–1:00 AM (+1)',
    revenueHours,
});

describe('StrategicPlanWorkspace', () => {
    let container: HTMLDivElement;
    let root: Root;
    const onBack = vi.fn();

    beforeEach(async () => {
        onBack.mockReset();
        loadProfile.mockReset();
        loadProfile.mockResolvedValue({
            feedPublisherName: 'Barrie Transit',
            feedVersion: 'test-feed',
            feedStartDate: '2026-05-27',
            feedEndDate: '2026-08-29',
            rowsByDayType: {
                Weekday: [row('400', 'EXPRESS', 42.5)],
                Saturday: [row('100', 'RED', 20.1)],
                Sunday: [row('101', 'BLUE', 15.4)],
            },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(<StrategicPlanWorkspace onBack={onBack} />));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('loads the static-GTFS table and switches service days', async () => {
        await act(async () => { await Promise.resolve(); });
        expect(container.textContent).toContain('5-Year Strategic Plan');
        expect(container.textContent).toContain('EXPRESS');
        expect(container.textContent).toContain('Version test-feed');

        const saturdayTab = Array.from(container.querySelectorAll('[role="tab"]'))
            .find(tab => tab.textContent === 'Saturday') as HTMLButtonElement;
        act(() => saturdayTab.click());

        expect(container.textContent).toContain('RED');
        expect(saturdayTab.getAttribute('aria-selected')).toBe('true');
    });

    it('returns to Planning Data from the workspace header', async () => {
        await act(async () => { await Promise.resolve(); });
        const back = container.querySelector('[aria-label="Back to Planning Data"]') as HTMLButtonElement;
        act(() => back.click());
        expect(onBack).toHaveBeenCalledOnce();
    });
});
