import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterScheduleContent, MasterScheduleEntry } from '../utils/masterScheduleTypes';
import type { RegionalConnectionsProps } from '../utils/regional-transit/types';

const state = vi.hoisted(() => ({
    team: { id: 'local', dataSourceTeamIds: undefined } as { id: string; dataSourceTeamIds?: { masterSchedules: string } },
    getAll: vi.fn(), getMaster: vi.fn(), regional: vi.fn(),
    toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('../components/contexts/TeamContext', () => ({ useTeam: () => ({ team: state.team, hasTeam: true }) }));
vi.mock('../components/contexts/ToastContext', () => ({ useToast: () => state.toast }));
vi.mock('../utils/services/masterScheduleService', () => ({
    getAllMasterSchedules: state.getAll, getMasterSchedule: state.getMaster, deleteMasterSchedule: vi.fn(),
}));
vi.mock('../components/connections/RegionalTransitConnections', () => ({
    RegionalTransitConnections: (props: RegionalConnectionsProps) => {
        state.regional(props);
        return <div data-testid="regional-grid" data-source={props.readTeamId}>GO connection grid</div>;
    },
}));
vi.mock('../components/ScheduleEditor', () => ({ ScheduleEditor: () => <div>Route schedule view</div> }));
vi.mock('../components/PlatformTimeline', () => ({ PlatformTimeline: () => <div>Platform timeline view</div> }));
vi.mock('../components/VersionHistoryPanel', () => ({ VersionHistoryPanel: (): null => null }));
vi.mock('../components/TeamManagement', () => ({ TeamManagement: (): null => null }));
import { MasterScheduleBrowser } from '../components/MasterScheduleBrowser';

const entry = {
    id: '8A-Weekday', routeNumber: '8A', dayType: 'Weekday', currentVersion: 3,
    updatedAt: new Date('2026-09-01T12:00:00'), uploaderName: 'Planner', source: 'draft',
} as MasterScheduleEntry;
const content: MasterScheduleContent = {
    northTable: { routeName: '8A (North)', stops: ['Allandale'], stopIds: { Allandale: '9003' }, trips: [] },
    southTable: { routeName: '8A (South)', stops: [], stopIds: {}, trips: [] },
    metadata: { routeNumber: '8A', dayType: 'Weekday', uploadedAt: '2026-09-01' },
};
let root: Root | undefined;
let host: HTMLDivElement;
const render = async () => {
    await act(async () => {
        root ??= createRoot(host);
        root.render(<MasterScheduleBrowser />);
    });
};
const click = async (name: string) => {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent?.replace(/\s+/g, '') === name.replace(/\s+/g, ''));
    expect(button, `Button ${name}`).toBeTruthy();
    await act(async () => button!.click());
};
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    state.team = { id: 'local' };
    vi.clearAllMocks();
    state.getAll.mockResolvedValue([entry]);
    state.getMaster.mockResolvedValue({ entry, content });
    host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
    await act(async () => root?.unmount()); root = undefined; host.remove();
});
describe('Master Schedule regional connections integration', () => {
    it('adds the tab after Platforms without route-edit actions or bogus route fetches', async () => {
        await render();
        const names = [...host.querySelectorAll('button')].map(b => b.textContent?.trim());
        expect(names.indexOf('Regional Transit Connections')).toBe(names.indexOf('Platforms') + 1);
        await click('Regional Transit Connections');
        expect(host.textContent).toContain('GO connection grid');
        expect(host.textContent).not.toContain('Copy to Draft');
        expect(host.textContent).not.toContain('Route regional-connections');
        expect(state.getMaster.mock.calls.every(([, identity]) => identity !== 'regional-connections-Weekday')).toBe(true);
        const props = state.regional.mock.lastCall![0] as RegionalConnectionsProps;
        expect(props.readTeamId).toBe('local');
        expect(props.schedules[0].currentVersion).toBe(3);
        expect(props.dayTypeForDate!('2026-10-05')).toBe('Weekday');
        expect(props.dayTypeForDate!('2026-10-12')).toBe('No Service');
        await click('Platforms'); expect(host.textContent).toContain('Platform timeline view');
        await click('8A8A'); expect(host.textContent).toContain('Route schedule view');
    });
    it('uses the existing authorized shared-master source without changing ownership', async () => {
        state.team = { id: 'local', dataSourceTeamIds: { masterSchedules: 'partner' } };
        state.getAll.mockImplementation(async (id: string) => id === 'partner' ? [entry] : []);
        await render(); await click('Regional Transit Connections');
        expect(host.querySelector('[data-source="partner"]')).not.toBeNull();
        expect(state.getAll.mock.calls.map(([id]) => id)).toEqual(['local', 'partner']);
    });
    it('refreshes the authorized master list so new publications appear and reports failed refreshes', async () => {
        await render(); await click('Regional Transit Connections');
        const refresh = (state.regional.mock.lastCall![0] as RegionalConnectionsProps).onRefreshSchedules!;
        state.getAll.mockResolvedValue([entry, { ...entry, id: '7-Weekday', routeNumber: '7' }]);
        await act(async () => { await refresh(); });
        expect((state.regional.mock.lastCall![0] as RegionalConnectionsProps).schedules).toHaveLength(2);
        expect(host.querySelector('[data-source="local"]')).not.toBeNull();
        state.getAll.mockRejectedValue(new Error('Permission denied'));
        await act(async () => { await expect(refresh()).rejects.toThrow('could not be refreshed'); });
    });
    it('hides old-source content during team changes and ignores a late old team list', async () => {
        let resolveOld: (entries: MasterScheduleEntry[]) => void = () => {};
        state.getAll.mockImplementation((id: string) => id === 'local'
            ? new Promise<MasterScheduleEntry[]>(resolve => { resolveOld = resolve; })
            : Promise.resolve([entry]));
        await render();
        await click('Regional Transit Connections');
        state.team = { id: 'new-team' };
        await render();
        expect(host.querySelector('[data-source="new-team"]')).not.toBeNull();
        await act(async () => resolveOld([entry]));
        expect(host.querySelector('[data-source="local"]')).toBeNull();
        expect(host.querySelector('[data-source="new-team"]')).not.toBeNull();
    });
});
