import React, { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../utils/connections/connectionLibraryService', () => ({
    getConnectionLibrary: vi.fn(async () => null),
    getRouteConnectionConfig: vi.fn(async () => null),
    saveConnectionLibrary: vi.fn(async () => undefined),
    saveRouteConnectionConfig: vi.fn(async () => undefined),
}));
vi.mock('../utils/services/masterScheduleService', () => ({
    getMasterSchedule: vi.fn(async () => null),
    getAllMasterSchedules: vi.fn(async () => []),
}));

import { GuidedConnections } from '../components/GuidedSchedule/connections/GuidedConnections';
import { applyGenerated, createGuidedBuildState } from '../components/GuidedSchedule/build/guidedBuildState';
import { saveRouteConnectionConfig } from '../utils/connections/connectionLibraryService';
import type { ConnectionLibrary, ConnectionTarget, RouteConnection, RouteConnectionConfig } from '../utils/connections/connectionTypes';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import { recalculateTrip } from '../hooks/useScheduleEditing';
import { TimeUtils } from '../utils/timeUtils';

const t = (h: number, m: number) => h * 60 + m;
const NORTH = ['Park Place', 'Downtown Hub'];
const SOUTH = ['Downtown Hub', 'Park Place'];
const STOP_IDS = { 'Park Place': '777', 'Downtown Hub': '1' };

const makeTrip = (id: string, direction: 'North' | 'South', start: number, run: number, recovery: number, tripNumber: number): MasterTrip => {
    const [first, last] = direction === 'North' ? NORTH : SOUTH;
    const trip: MasterTrip = {
        id, blockId: '2-1', direction, tripNumber, rowId: tripNumber,
        startTime: start, endTime: start + run + recovery, recoveryTime: recovery, recoveryTimes: { [last]: recovery },
        travelTime: run, cycleTime: run + recovery,
        stops: { [first]: TimeUtils.fromMinutes(start), [last]: TimeUtils.fromMinutes(start + run + recovery) },
        arrivalTimes: { [last]: TimeUtils.fromMinutes(start + run) },
    };
    recalculateTrip(trip, direction === 'North' ? NORTH : SOUTH);
    return trip;
};

const schedules = (): MasterRouteTable[] => [
    { routeName: '2 (Saturday) (North)', stops: NORTH, stopIds: STOP_IDS, trips: [makeTrip('N2', 'North', t(7, 20), 30, 8, 3), makeTrip('N3', 'North', t(8, 40), 30, 8, 5)] },
    { routeName: '2 (Saturday) (South)', stops: SOUTH, stopIds: STOP_IDS, trips: [makeTrip('S2', 'South', t(7, 58), 32, 10, 4)] },
];

const target = (id: string, name: string, stopCode: string, time: number): ConnectionTarget => ({
    id, name, type: 'manual', stopCode, createdAt: '', updatedAt: '',
    times: [{ id: `${id}-t`, time, daysActive: ['Saturday'], enabled: true }],
});

const LIBRARY: ConnectionLibrary = {
    targets: [
        target('r12', 'Route 12 southbound', '777', t(8, 31)),   // S2 arrives PP 8:30 → 1 min (tight)
        target('hub', 'Route 7 at the Hub', '1', t(7, 53)),       // S2 leaves Hub 7:58 → 5 min (met)
    ],
    updatedAt: '', updatedBy: '',
};

const conn = (id: string, targetId: string, stopCode: string, type: RouteConnection['connectionType'], min: number, max: number, priority: number): RouteConnection => ({
    id, targetId, stopCode, connectionType: type, bufferMinutes: min, maxWaitMinutes: max, priority, enabled: true,
});

const Harness: React.FC<{ initial: RouteConnection[]; onApply: (tables: MasterRouteTable[]) => void; onConfig?: (config: RouteConnectionConfig) => void }> = ({ initial, onApply, onConfig }) => {
    const [config, setConfig] = useState<RouteConnectionConfig>({ routeIdentity: '2-Saturday', connections: initial });
    const [library, setLibrary] = useState<ConnectionLibrary>(LIBRARY);
    return (
        <GuidedConnections
            routeNumber="2"
            dayType="Saturday"
            schedules={schedules()}
            teamId="team"
            userId="user"
            connectionLibrary={library}
            setConnectionLibrary={setLibrary}
            routeConnectionConfig={config}
            setRouteConnectionConfig={next => { setConfig(next); onConfig?.(next); }}
            onApply={tables => onApply(tables)}
        />
    );
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
});

const render = (element: React.ReactElement) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(element));
};

const page = () => container!;
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const byTestId = (id: string, scope: ParentNode = page()) => {
    const found = scope.querySelector(`[data-testid="${id}"]`);
    if (!found) throw new Error(`Missing data-testid ${id}`);
    return found;
};
const byLabel = (label: string) => {
    const found = Array.from(page().querySelectorAll<HTMLElement>('[aria-label]')).find(element => element.getAttribute('aria-label') === label);
    if (!found) throw new Error(`Missing label ${label}`);
    return found;
};
const button = (name: string | RegExp, scope: ParentNode = page()) => {
    const found = Array.from(scope.querySelectorAll('button')).find(element => (typeof name === 'string' ? text(element) === name : name.test(text(element))));
    if (!found) throw new Error(`Missing button ${name}`);
    return found;
};
const click = (element: Element) => act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const choose = (select: HTMLSelectElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
});
const drag = (type: string, element: Element, extra: Record<string, unknown>) => act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
    element.dispatchEvent(event);
});

const cardNames = () => Array.from(page().querySelectorAll('[aria-label]'))
    .filter(badge => /^Rank \d+$/.test(badge.getAttribute('aria-label') ?? ''))
    .map(badge => badge.closest('[data-rank-card]')?.querySelector('p')?.textContent);

describe('GuidedConnections', () => {
    it('shows each connection with how many it meets now, in rank order', () => {
        render(<Harness initial={[conn('pp', 'r12', '777', 'meet_departing', 3, 10, 1), conn('hub', 'hub', '1', 'feed_arriving', 4, 6, 2)]} onApply={vi.fn()} />);
        expect(cardNames()).toEqual(['Route 12 southbound', 'Route 7 at the Hub']);
        expect(text(byTestId('met-pp'))).toContain('0/1 met');
        expect(text(byTestId('met-hub'))).toContain('1/1 met');
        expect(text(byTestId('connections-score'))).toContain('1 met');
    });

    it('optimizes by rank, previews the result, and applies it as one change', () => {
        const onApply = vi.fn();
        render(<Harness initial={[conn('pp', 'r12', '777', 'meet_departing', 3, 10, 1), conn('hub', 'hub', '1', 'feed_arriving', 4, 6, 2)]} onApply={onApply} />);
        click(button('Optimize by priority'));

        const result = byTestId('optimize-result');
        expect(text(result)).toContain('1 trip would move');
        expect(text(result.querySelectorAll('tr')[1])).toContain('#1Route 12 southbound0/11/1+1');
        expect(text(result.querySelectorAll('tr')[2])).toContain('#2Route 7 at the Hub1/10/1-1');
        expect(text(byTestId('met-pp'))).toContain('0 → 1/1 met');

        click(button('Apply', result));
        expect(onApply).toHaveBeenCalledTimes(1);
        const moved = onApply.mock.calls[0][0] as MasterRouteTable[];
        expect(moved[1].trips[0].stops['Downtown Hub']).toBe('7:56 AM');
        expect(page().querySelector('[data-testid="optimize-result"]')).toBeNull();
    });

    it('protects the higher-ranked connection and explains the miss it leaves', () => {
        render(<Harness initial={[conn('hub', 'hub', '1', 'feed_arriving', 4, 6, 1), conn('pp', 'r12', '777', 'meet_departing', 3, 10, 2)]} onApply={vi.fn()} />);
        click(button('Optimize by priority'));
        const result = text(byTestId('optimize-result'));
        expect(result).toContain('0 trips would move');
        expect(result).toContain('#2 Route 12 southbound 8:31a: left as is. Moving block 2-1 would break #1 Route 7 at the Hub at 7:53a.');
    });

    it('re-ranks by drag and drop and renumbers priorities', () => {
        const onConfig = vi.fn();
        render(<Harness initial={[conn('pp', 'r12', '777', 'meet_departing', 3, 10, 1), conn('hub', 'hub', '1', 'feed_arriving', 4, 6, 2)]} onApply={vi.fn()} onConfig={onConfig} />);
        const first = byLabel('Rank 1').closest('[data-rank-card]')!;
        const zone = first.parentElement!;
        const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
        drag('dragstart', first, { dataTransfer });
        drag('dragover', zone, { clientY: 9999, dataTransfer });
        drag('drop', zone, { clientY: 9999, dataTransfer });
        expect(cardNames()).toEqual(['Route 7 at the Hub', 'Route 12 southbound']);
        expect(onConfig.mock.calls.at(-1)![0].connections.map((item: RouteConnection) => [item.id, item.priority])).toEqual([['hub', 1], ['pp', 2]]);
    });

    it('limits a connection to active hours', () => {
        render(<Harness initial={[conn('pp', 'r12', '777', 'meet_departing', 3, 10, 1)]} onApply={vi.fn()} />);
        choose(byLabel('Route 12 southbound active hours') as HTMLSelectElement, '1'); // 6–9 AM
        expect(text(byTestId('met-pp'))).toContain('0/1 met');
        choose(byLabel('Route 12 southbound active hours') as HTMLSelectElement, '2'); // 3–7 PM
        expect(text(byTestId('met-pp'))).toContain('0/0 met');
    });

    it('saves the ranked connections as the route default only when asked', async () => {
        render(<Harness initial={[conn('pp', 'r12', '777', 'meet_departing', 3, 10, 1)]} onApply={vi.fn()} />);
        expect(saveRouteConnectionConfig).not.toHaveBeenCalled();
        click(button(/Save as route default/));
        expect(saveRouteConnectionConfig).toHaveBeenCalledWith('team', '2-Saturday', expect.objectContaining({ connections: [expect.objectContaining({ id: 'pp', priority: 1 })] }));
        await act(async () => { await Promise.resolve(); });
        expect(text(button(/route default/))).toBe('Saved as route default');
    });
});

describe('regenerating keeps connections', () => {
    it('keeps the connection setup when the schedule is rebuilt', () => {
        const config: RouteConnectionConfig = { routeIdentity: '2-Saturday', connections: [conn('pp', 'r12', '777', 'meet_departing', 3, 10, 1)] };
        const state = { ...createGuidedBuildState('2'), routeConnectionConfig: config };
        const next = applyGenerated(state, schedules(), state.config, 'fingerprint');
        expect(next.routeConnectionConfig).toBe(config);
    });
});
