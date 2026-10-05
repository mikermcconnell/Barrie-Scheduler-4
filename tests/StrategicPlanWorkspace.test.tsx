import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategicPlanWorkspace } from '../components/Analytics/StrategicPlanWorkspace';
import type { TransitAppDataSummary } from '../utils/transit-app/transitAppTypes';
import type { FleetPlanWorkbook } from '../utils/fleet-plan/types';

const loadProfile = vi.fn();

vi.mock('../utils/strategic-plan/serviceProfileData', () => ({
    loadStrategicPlanServiceProfile: () => loadProfile(),
}));

vi.mock('../components/MasterScheduleBrowser', () => ({
    MasterScheduleBrowser: ({ readOnly }: { readOnly?: boolean }) => (
        <div>Canonical Master Schedule {readOnly ? 'read-only evidence' : 'editable'}</div>
    ),
}));

vi.mock('../components/Analytics/RidershipTrendsWorkspace', () => ({
    RidershipTrendsWorkspace: ({
        accessContext,
        backLabel,
    }: {
        accessContext?: string;
        backLabel?: string;
    }) => <div>Annual Ridership module · {accessContext} · {backLabel}</div>,
}));

vi.mock('../components/Analytics/StrategicWorkplanWorkspace', () => ({
    StrategicWorkplanWorkspace: ({ teamId }: { teamId: string }) => (
        <div>Shared Strategic Workplan for {teamId}</div>
    ),
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

const transitAppData: TransitAppDataSummary = {
    routeMetrics: { daily: [], summary: [] },
    tripDistribution: { hourly: [], daily: [] },
    locationDensity: {
        cells: [],
        bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
        totalPoints: 0,
    },
    transferPatterns: [],
    routeLegs: [],
    appUsage: [],
    metadata: {
        importedAt: '2026-08-25T12:00:00.000Z',
        importedBy: 'test-user',
        dateRange: { start: '2026-01-01', end: '2026-07-31' },
        fileStats: {
            totalFiles: 1,
            dateRange: { start: '2026-01-01', end: '2026-07-31' },
            filesByType: {
                lines: 0,
                trips: 0,
                locations: 0,
                go_trip_legs: 0,
                planned_go_trip_legs: 0,
                tapped_trip_view_legs: 0,
                users: 1,
            },
            rowsParsed: 0,
            rowsSkipped: 0,
        },
    },
};

const fleetPlanData: FleetPlanWorkbook = {
    schemaVersion: 1,
    metadata: {
        templateVersion: 'test-v1',
        sourceFileName: 'Fleet Plan 2026.xlsx',
        importedAt: '2026-08-01T12:00:00.000Z',
        importedBy: 'planner-a',
        updatedAt: '2026-08-25T12:00:00.000Z',
        updatedBy: 'planner-b',
        currentVersion: 7,
        storagePath: 'teams/team-a/fleetPlan/v7.json',
    },
    sheets: [{
        key: 'diesel-12m',
        name: '12m Buses',
        title: '12m Diesel Buses',
        rows: [{
            id: 'bus-2201',
            unitNumber: '2201',
            makeModel: 'Nova LFS',
            year: '2022',
            timeline: {
                '2027': '2201',
                '2028': 'RETIRE',
                '2029': 'PURCHASE',
                '2030': '2301',
                '2031': '2301',
                '2032': '2301',
            },
        }],
    }],
};

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
        await act(async () => root.render(
            <StrategicPlanWorkspace
                onBack={onBack}
                transitAppData={transitAppData}
                transitAppAvailable
                fleetPlanData={fleetPlanData}
                ridershipTeamId="barrie-team"
                requestingTeamId="dillon-team"
                workplanTeamId="barrie-team"
            />,
        ));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('loads the static-GTFS table and switches service days', async () => {
        await act(async () => { await Promise.resolve(); });
        expect(container.textContent).toContain('2027–2032 Strategic Plan');
        expect(container.textContent).toContain('Strategic Plan workspaces');

        const serviceWorkspace = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Current Scheduled Service Route Summaries')) as HTMLButtonElement;
        act(() => serviceWorkspace.click());

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

    it('opens the team-shared Project Work Plan from the Strategic Plan landing page', async () => {
        await act(async () => { await Promise.resolve(); });
        const workplanWorkspace = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Project Work Plan')) as HTMLButtonElement;

        await act(async () => {
            workplanWorkspace.click();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Shared Strategic Workplan for barrie-team');
    });

    it('separates editable project control from the evidence-card library', async () => {
        await act(async () => { await Promise.resolve(); });
        expect(container.textContent).toContain('Shared project control');
        expect(container.textContent).toContain('Open full schedule');
        expect(container.textContent).toContain('Read-only source workspaces remain separate from project-control edits.');
    });

    it('shows the complete shared Transit App analysis without import controls', async () => {
        await act(async () => { await Promise.resolve(); });
        const transitAppSection = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Trip Planning Trends')) as HTMLButtonElement;

        act(() => transitAppSection.click());

        expect(container.textContent).toContain('same complete aggregated summary');
        expect(container.textContent).toContain('Evidence period: 2026-01-01 to 2026-07-31');
        expect(container.textContent).toContain('Overview');
        expect(container.textContent).toContain('OD Pair');
        expect(container.textContent).not.toContain('Re-import Data');
    });

    it('opens the canonical Master Schedule as a read-only workspace card', async () => {
        await act(async () => { await Promise.resolve(); });
        const masterScheduleWorkspace = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Published Route Schedules')) as HTMLButtonElement;

        await act(async () => {
            masterScheduleWorkspace.click();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Published Route Schedules');
        expect(container.textContent).toContain('Canonical Master Schedule read-only evidence');
        expect(container.textContent).toContain('creates no copied schedule');
    });

    it('shows the canonical Fleet Plan as read-only 2027–2032 evidence', async () => {
        await act(async () => { await Promise.resolve(); });
        const fleetPlanWorkspace = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Bus Fleet Plan')) as HTMLButtonElement;

        act(() => fleetPlanWorkspace.click());

        expect(container.textContent).toContain('Bus Fleet Plan');
        expect(container.textContent).toContain('same canonical shared workbook');
        expect(container.textContent).toContain('Fleet Plan 2026.xlsx');
        expect(container.textContent).toContain('2201');
        expect(container.textContent).toContain('RETIRE');
        expect(container.textContent).not.toContain('Save shared plan');
        expect(container.textContent).not.toContain('Replace workbook');
    });

    it('opens annual Ridership Trends with Strategic Plan access context', async () => {
        await act(async () => { await Promise.resolve(); });
        const ridershipWorkspace = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Annual Ridership')) as HTMLButtonElement;

        await act(async () => {
            ridershipWorkspace.click();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Annual Ridership module');
        expect(container.textContent).toContain('strategicPlan');
        expect(container.textContent).toContain('Strategic Plan workspaces');
    });
});
