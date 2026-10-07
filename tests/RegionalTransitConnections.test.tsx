import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegionalTransitConnections } from '../components/connections/RegionalTransitConnections';
import { fetchRegionalGoFeed } from '../utils/gtfs/regionalGoService';
import { buildDemoGoChange } from '../utils/regional-transit/demoGoChange';
import { getMasterSchedule } from '../utils/services/masterScheduleService';
import type { MasterScheduleContent, MasterScheduleEntry } from '../utils/masterScheduleTypes';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';
import type { RegionalConnectionsProps, RegionalGoFeed } from '../utils/regional-transit/types';

vi.mock('../utils/gtfs/regionalGoService', () => ({ fetchRegionalGoFeed: vi.fn() }));
vi.mock('../utils/services/masterScheduleService', () => ({ getMasterSchedule: vi.fn() }));
vi.mock('../utils/regional-transit/demoGoChange', () => ({ buildDemoGoChange: vi.fn() }));

function entry(routeNumber = '8A', version = 1): MasterScheduleEntry {
    return { id: `${routeNumber}-Weekday`, routeNumber, dayType: 'Weekday', currentVersion: version,
        storagePath: 'master.json', tripCount: 3, northStopCount: 2, southStopCount: 0, updatedAt: new Date(), updatedBy: 'u', uploaderName: 'Planner', source: 'wizard' };
}

function trip(id: string, allandale: number, south: number): MasterTrip {
    return { id, blockId: '8A-1', direction: 'North', tripNumber: 1, rowId: 1, startTime: allandale - 10, endTime: south + 10,
        recoveryTime: 0, travelTime: 30, cycleTime: 30, stops: {}, stopMinutes: { Allandale: allandale, South: south } };
}

function content(routeNumber = '8A'): MasterScheduleContent {
    return { northTable: { routeName: routeNumber, stops: ['Origin', 'Allandale', 'South', 'Destination'], stopIds: { Origin: '1', Allandale: '9003', South: '725', Destination: '2' }, trips: [trip('am', 470, 480), trip('pm', 610, 620), trip('night', 1455, 1465)] },
        southTable: { routeName: routeNumber, stops: [], stopIds: {}, trips: [] }, metadata: { routeNumber, dayType: 'Weekday', uploadedAt: new Date().toISOString() } };
}

function feed(): RegionalGoFeed {
    const train = (id: string, direction: number, allandale: string, south: string, trainNumber?: string) => ({
        trip: { trip_id: id, route_id: 'rail', service_id: 'daily', direction_id: direction, trip_short_name: trainNumber, trip_headsign: direction === 1 ? 'Union Station' : 'Allandale Waterfront GO' },
        calls: [{ trip_id: id, stop_id: 'AD', arrival_time: allandale, departure_time: allandale, stop_sequence: 1 }, { trip_id: id, stop_id: 'BA', arrival_time: south, departure_time: south, stop_sequence: 2 }],
    });
    const trains = [train('outbound-1', 1, '08:00:00', '08:10:00', '6606'), train('outbound-2', 1, '13:20:00', '13:30:00', '6606'), train('return-1', 0, '10:00:00', '10:10:00', '6911'), train('overnight-id', 0, '24:10:00', '24:20:00')];
    return { fetchedAt: new Date().toISOString(), sourceUrl: 'https://example.com/GO-GTFS.zip', timezone: 'America/Toronto', stops: [{ stop_id: 'AD', stop_name: 'Allandale Waterfront GO' }, { stop_id: 'BA', stop_name: 'Barrie South GO' }],
        routes: [{ route_id: 'rail', route_type: 2 }], trips: trains.map(train => train.trip), stopTimes: trains.flatMap(train => train.calls),
        calendar: [{ service_id: 'daily', start_date: '20200101', end_date: '20991231', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1 }], calendarDates: [] };
}

describe('RegionalTransitConnections read-only grid', () => {
    let container: HTMLDivElement;
    let root: Root;
    let props: RegionalConnectionsProps;

    async function render(overrides: Partial<RegionalConnectionsProps> = {}) {
        props = { ...props, ...overrides };
        await act(async () => { root.render(<RegionalTransitConnections {...props} />); });
    }
    async function click(button: Element | null | undefined) {
        if (!button) throw new Error('Missing button');
        await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    }
    function button(label: string) { return [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label); }
    async function setDate(value: string) {
        const input = container.querySelector<HTMLInputElement>('input[type=date]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    beforeEach(() => {
        vi.resetAllMocks();
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div'); document.body.append(container); root = createRoot(container);
        props = { schedules: [entry()], readTeamId: 'source-team', dayTypeForDate: () => 'Weekday' };
        vi.mocked(fetchRegionalGoFeed).mockResolvedValue(feed());
        vi.mocked(getMasterSchedule).mockImplementation(async (_team, identity) => {
            const route = identity.replace('-Weekday', '');
            return { entry: entry(route), content: content(route) };
        });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    it('renders northbound Route 8A arrival connections when only later terminal recovery is recorded', async () => {
        const data = content();
        data.northTable.stopIds.Allandale = '9005';
        data.northTable.trips = data.northTable.trips.map(bus => ({ ...bus, recoveryTime: 5 }));
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry('8A', 10), content: data });
        await render();
        const cell = container.querySelector<HTMLButtonElement>('button[aria-label^="Route 8A North, GO departure 8:00 AM"]')!;
        expect(cell.textContent).toContain('7:50 AM');
        expect(cell.textContent).toContain('10 min');
        await click(cell);
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('10-minute scheduled gap');
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('9005');
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('am · v10');
    });

    it('shows the rejected bus trip and timing evidence in sources without blocking unrelated trains', async () => {
        const data = content();
        data.northTable.trips[1].arrivalTimes = { Allandale: '' };
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry(), content: data });
        await render();
        await click(container.querySelector('section[aria-labelledby=regional-to-go-title] .regional-go-cell'));
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('10-minute scheduled gap');
        const text = container.textContent;
        expect(text).toContain('First rejected bus trip: pm');
        expect(text).toContain('arrival: ""');
        expect(text).toContain('trip start/end minutes: 600/630');
        expect(text).toContain('station is intermediate');
    });

    it('keeps morning Route 8A connections with the exact v10 evening interline timing', async () => {
        const data = content();
        data.northTable.stopIds.Allandale = '9005';
        data.northTable.trips.push({ ...trip('8A-N-33', 1237, 1273), startTime: 1242, endTime: 1273, stopMinutes: undefined,
            stops: { Allandale: '8:37 PM' }, arrivalTimes: { Allandale: '8:37 PM' }, recoveryTimes: { Allandale: 5, South: 4 }, recoveryTime: 9 });
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry('8A', 10), content: data });
        await render();
        const cell = container.querySelector<HTMLButtonElement>('button[aria-label^="Route 8A North, GO departure 8:00 AM"]')!;
        expect(cell.textContent).toContain('7:50 AM');
        expect(cell.textContent).toContain('10 min');
        expect(container.querySelector('tbody .regional-go-unavailable')).toBeNull();
        await click(cell);
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('am · v10');
    });

    it('keeps Routes 7 and 12 visible when short trips do not reach Allandale', async () => {
        vi.mocked(getMasterSchedule).mockImplementation(async (_team, identity) => {
            const route = identity.replace('-Weekday', '');
            const data = content(route);
            data.northTable.stops = ['Origin', 'ShortEnd', 'Allandale', 'South', 'Destination'];
            data.northTable.stopIds.Allandale = route === '7' ? '9006' : '9013';
            data.northTable.trips.push({ ...trip(route === '7' ? '7-N-1' : '12-N-2', 0, 0), startTime: route === '7' ? 329 : 354, endTime: route === '7' ? 331 : 363,
                recoveryTime: route === '7' ? 2 : 1, stopMinutes: undefined, stops: { Origin: route === '7' ? '5:29 AM' : '5:54 AM', ShortEnd: route === '7' ? '5:31 AM' : '6:03 AM' } });
            if (route === '12') data.southTable = { ...data.northTable, stopIds: { Origin: '1', ShortEnd: '3', Allandale: 'not-mapped', South: '725', Destination: '2' } };
            return { entry: entry(route), content: data };
        });
        await render({ schedules: [entry('7'), entry('12')] });
        const labels = [...container.querySelectorAll('tbody th')].map(el => el.textContent);
        expect(labels).toContain('Route 7A');
        expect(labels).toContain('Route 12A');
        expect(labels).toContain('Route 12B');
        expect(container.textContent).not.toContain('First rejected bus trip: 7-N-1');
        expect(container.textContent).not.toContain('First rejected bus trip: 12-N-2');
        expect(container.textContent).toContain('Route 12B: The station appears by name in this direction, but no exact station stop code is mapped.');
        expect(container.querySelector('button[aria-label^="Route 12A, GO departure 8:00 AM"]')?.textContent).toContain('10 min');
    });

    it('shows Route 12B connections at curbside Stop 14 and discloses the street crossing', async () => {
        const data = content('12');
        data.northTable.stopIds.Allandale = '9013';
        data.southTable = { ...data.northTable, stopIds: { ...data.northTable.stopIds, Allandale: '14' } };
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry('12'), content: data });
        await render({ schedules: [entry('12')] });
        const cell = container.querySelector<HTMLButtonElement>('button[aria-label^="Route 12B, GO departure 8:00 AM"]')!;
        expect(cell.textContent).toContain('7:50 AM');
        expect(cell.textContent).toContain('10 min');
        await click(cell);
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('Stop 14 (Essa at Gowan) is across the street');
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('code 14');
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('Walking and boarding time are not deducted');
    });

    it('compares bus connections before and after a demo GO change', async () => {
        // Train 6606 leaves 8:00 → 8:08 (bus 7:50: 10 → 18 min, Comfortable → Long wait); train 6911 is cancelled (10 min connection lost).
        vi.mocked(buildDemoGoChange).mockImplementation(source => ({
            summary: ['Demo summary line'],
            feed: { ...source, trips: source.trips.filter(trip => trip.trip_id !== 'return-1'),
                stopTimes: source.stopTimes.filter(time => time.trip_id !== 'return-1').map(time => time.trip_id === 'outbound-1' && time.stop_id === 'AD' ? { ...time, departure_time: '08:08:00', arrival_time: '08:08:00' } : time) },
        }));
        await render();
        await click(button('Demo GO change'));
        expect(container.textContent).toContain('Demo summary line');
        const compare = [...container.querySelectorAll('.regional-go-compare')];
        expect(compare).toHaveLength(2);
        const worse = container.querySelector('td.regional-go-outcome-worse')!;
        expect(worse.textContent).toContain('18 min · +8');
        expect(worse.textContent).toContain('was 10 min');
        expect(worse.className).toContain('regional-go-long');
        const lost = container.querySelector('td.regional-go-outcome-lost')!;
        expect(lost.textContent).toContain('Lost');
        expect(compare[0].textContent).toContain('Moved +8');
        expect(compare[1].textContent).toContain('Cancelled');
        expect(compare[0].querySelector('.regional-go-compare-summary')?.textContent).toContain('1 worse');
        expect(compare[1].querySelector('.regional-go-compare-summary')?.textContent).toContain('1 lost');
        await click(worse.querySelector('button'));
        const dialog = document.querySelector('[role=dialog]')!;
        expect(dialog.textContent).toContain('The wait goes from 10 min (Comfortable) to 18 min (Long wait).');
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        await click(button('Before (Current GO)'));
        expect(container.querySelector('.regional-go-compare')).toBeNull();
        expect(container.textContent).toContain('Moves +8');
        await click(button('Exit demo'));
        expect(container.textContent).not.toContain('Demo summary line');
    });

    it('keeps every unique train column, gaps, no-connection and unavailable distinct, and stop timing details accessible', async () => {
        vi.mocked(getMasterSchedule).mockImplementation(async (_team, identity) => {
            if (identity === '7-Weekday') throw new Error('Permission denied');
            return { entry: entry(), content: content() };
        });
        await render({ schedules: [entry(), entry('7')] });
        expect(getMasterSchedule).toHaveBeenCalledWith('source-team', '8A-Weekday');
        expect(container.querySelectorAll('thead time')).toHaveLength(4);
        expect(container.querySelector('thead')?.textContent).not.toContain('6606');
        expect(container.querySelectorAll('thead')[1]?.textContent).not.toContain('overnight-id');
        expect(container.textContent).not.toContain('Train overnight-id');
        expect(container.textContent).toContain('10 min');
        expect(container.textContent).toContain('5 min · Tight');
        expect(container.textContent).toContain('No connection');
        expect(container.querySelector('tbody')?.textContent).not.toContain('Unavailable');
        expect(container.textContent).toContain('not confirmed absence of service');
        expect(container.textContent).toContain('Permission denied');
        expect(container.textContent).toContain('(+1 day)');
        expect(container.textContent).toContain('2020-01-01 to 2099-12-31');
        expect(container.querySelectorAll('tfoot')).toHaveLength(2);
        const headers = [...container.querySelectorAll('.regional-go-panel-head')];
        expect(headers[0].textContent).toContain('Allandale Waterfront GO');
        expect(headers[0].textContent).toContain('To GO');
        expect(headers[0].textContent).toContain('Bus arrival → GO departure');
        expect(headers[1].textContent).toContain('Allandale Waterfront GO');
        expect(headers[1].textContent).toContain('From GO');
        expect(headers[1].textContent).toContain('GO arrival → bus departure');
        const cell = container.querySelector<HTMLButtonElement>('button[aria-label^="Route 8A North, GO departure 8:00 AM"]')!;
        cell.focus();
        await click(cell);
        const dialog = document.querySelector('[role=dialog]')!;
        expect(dialog.textContent).toContain('10-minute scheduled gap');
        expect(dialog.textContent).toContain('9003');
        expect(dialog.textContent).toContain('outbound-1 · AD');
        expect(dialog.textContent).toContain('Walking and boarding time are not deducted');
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Close connection detail');
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Close connection detail');
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('[role=dialog]')).toBeNull();
        expect(document.activeElement).toBe(cell);
    });

    it('switches station and direction and applies the local No Service holiday without new master reads', async () => {
        await render({ dayTypeForDate: date => date === '2026-12-25' ? 'No Service' : 'Weekday' });
        await click(button('Barrie South'));
        expect(container.querySelector('.regional-go-source-note')?.textContent).toContain('Barrie South GO');
        expect(container.querySelector('thead time')?.textContent).toContain('8:10');
        await click(button('From GO'));
        expect(container.querySelectorAll('table')).toHaveLength(1);
        expect(container.querySelector('.regional-go-panel-head')?.textContent).toContain('From GO');
        const reads = vi.mocked(getMasterSchedule).mock.calls.length;
        await setDate('2026-12-25');
        expect(container.textContent).toContain('The local annual calendar marks this date as No Service');
        expect(getMasterSchedule).toHaveBeenCalledTimes(reads);
        expect(container.querySelectorAll('thead time')).toHaveLength(2);
        await setDate('');
        expect(container.textContent).toContain('Choose a valid service date');
        expect(container.querySelector('table')).toBeNull();
    });

    it('reports feed errors without fabricated grids and retries; print invokes the browser', async () => {
        vi.mocked(fetchRegionalGoFeed).mockRejectedValueOnce(new Error('GO source unavailable'));
        const print = vi.spyOn(window, 'print').mockImplementation(() => {});
        await render();
        expect(container.textContent).toContain('GO times unavailable');
        expect(container.querySelector('table')).toBeNull();
        expect(button('Print')?.getAttribute('disabled')).not.toBeNull();
        await click(button('Retry sources'));
        expect(fetchRegionalGoFeed).toHaveBeenLastCalledWith(expect.objectContaining({ forceRefresh: true }));
        expect(container.querySelectorAll('table')).toHaveLength(2);
        await click(button('Print'));
        expect(print).toHaveBeenCalledOnce();
    });

    it('filters service days by changing the date and reading the matching local masters', async () => {
        const entries = (['Weekday', 'Saturday', 'Sunday'] as const).map(dayType => ({ ...entry(), id: `8A-${dayType}`, dayType }));
        vi.mocked(getMasterSchedule).mockImplementation(async (_team, identity) => {
            const selected = entries.find(item => item.id === identity)!;
            return { entry: selected, content: { ...content(), metadata: { ...content().metadata, dayType: selected.dayType } } };
        });
        await render({ schedules: entries, dayTypeForDate: undefined });
        await setDate('2026-10-02');
        for (const [day, expectedDate] of [['Saturday', '2026-10-03'], ['Sunday', '2026-10-04'], ['Weekday', '2026-10-05']]) {
            await click(button(day));
            expect(container.querySelector<HTMLInputElement>('input[type=date]')?.value).toBe(expectedDate);
            expect(button(day)?.getAttribute('aria-pressed')).toBe('true');
            expect(getMasterSchedule).toHaveBeenLastCalledWith('source-team', `8A-${day}`);
            expect(container.querySelectorAll('table')).toHaveLength(2);
        }
    });

    it('keeps day presets within feed coverage when possible and respects holiday service overrides', async () => {
        const data = feed(); data.calendar[0].start_date = '20261001'; data.calendar[0].end_date = '20261031';
        vi.mocked(fetchRegionalGoFeed).mockResolvedValue(data);
        await render({ dayTypeForDate: date => date === '2026-10-12' ? 'No Service' : new Date(`${date}T12:00:00`).getDay() === 0 ? 'Sunday' : new Date(`${date}T12:00:00`).getDay() === 6 ? 'Saturday' : 'Weekday' });
        await setDate('2026-10-30'); await click(button('Sunday'));
        expect(container.querySelector<HTMLInputElement>('input[type=date]')?.value).toBe('2026-10-25');
        await setDate('2026-10-11'); await click(button('Weekday'));
        expect(container.querySelector<HTMLInputElement>('input[type=date]')?.value).toBe('2026-10-13');
        await setDate('2027-01-01'); await click(button('Saturday'));
        expect(container.querySelector<HTMLInputElement>('input[type=date]')?.value).toBe('2027-01-02');
        expect(container.querySelector('table')).toBeNull();
        expect(container.textContent).toContain('does not cover this service date');
    });

    it('hides wholly unassessed routes but preserves source warnings and train columns', async () => {
        vi.mocked(getMasterSchedule).mockRejectedValue(new Error('Permission denied'));
        await render({ schedules: [entry('12')] });
        const labels = [...container.querySelectorAll('tbody th')].map(el => el.textContent);
        expect(labels).toEqual([]);
        expect(container.querySelectorAll('thead time')).toHaveLength(4);
        expect(container.textContent).toContain('No 1–30 minute connections to show');
        expect(container.textContent).toContain('Route 12A: Permission denied');
        expect(container.textContent).toContain('Route 12B: Permission denied');
        expect(container.querySelector('.regional-go-panel-head')?.textContent).toContain('Allandale Waterfront GO');
        expect(container.querySelector('thead')?.textContent).not.toContain('outbound');
        expect([...container.querySelectorAll('tbody td')].every(el => el.textContent === 'No connection†')).toBe(true);
        expect(container.textContent).toContain('not confirmed absence of service');
        expect(container.querySelector('.regional-go-warning')?.textContent).toContain('Route 12 not assessed');
        expect(container.querySelector('.regional-go-cell')).toBeNull();
    });


    it('hides disconnected routes, keeps checked counts honest and identifies GO train trips', async () => {
        vi.mocked(getMasterSchedule).mockImplementation(async (_team, identity) => {
            const route = identity.replace('-Weekday', '');
            const data = content(route);
            if (route === '7') data.northTable.trips = [trip('no-match', 100, 110)];
            return { entry: entry(route), content: data };
        });
        await render({ schedules: [entry(), entry('7')] });
        expect([...container.querySelectorAll('tbody th')].map(el => el.textContent)).toEqual(['Route 8A North', 'Route 8A North']);
        expect(container.querySelector('tfoot td')?.textContent).toBe('1 / 2 checked');
        expect(container.querySelectorAll('thead time')).toHaveLength(4);
        expect(container.querySelector('h2')?.textContent).toBe('GO train connections');
        expect(container.querySelector('img[alt="GO Transit"]')?.getAttribute('src')).toBe('/brand/go-transit-logo.svg');
        expect(container.querySelector('.regional-go-train-count svg')).not.toBeNull();
    });

    it('keeps a connected route’s complementary rows and rechecks visibility for direction and station filters', async () => {
        const data = content('12');
        data.northTable.trips = [trip('to-go-only', 470, 480)];
        data.northTable.stopIds.South = 'unknown';
        data.southTable = { ...data.northTable, trips: [trip('no-match', 100, 110)] };
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry('12'), content: data });
        await render({ schedules: [entry('12')] });
        const labels = () => [...container.querySelectorAll('tbody th')].map(el => el.textContent);
        expect(labels()).toEqual(['Route 12A', 'Route 12B', 'Route 12A', 'Route 12B']);
        await click(button('From GO'));
        expect(labels()).toEqual([]);
        expect(container.textContent).toContain('No 1–30 minute connections to show');
        expect(container.querySelectorAll('thead time')).toHaveLength(2);
        expect(container.querySelector('tfoot td')?.textContent).toBe('0 / 2 checked');
        await click(button('To GO'));
        expect(labels()).toEqual(['Route 12A', 'Route 12B']);
        await click(button('Barrie South'));
        expect(labels()).toEqual([]);
    });

    it('keeps unassessed complementary directions and details when another direction connects', async () => {
        const data = content('12');
        data.southTable = { ...data.northTable, stopIds: { Origin: '1', Allandale: 'unknown', South: '725', Destination: '2' } };
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry('12'), content: data });
        await render({ schedules: [entry('12')] });
        expect(container.querySelectorAll('tbody th')).toHaveLength(4);
        expect(container.querySelectorAll('tbody td.regional-go-unavailable')).toHaveLength(4);
        expect(container.querySelector('tfoot td')?.textContent).toBe('1 / 1 checked + not assessed');
        await click(container.querySelector('td.regional-go-unavailable button'));
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('no exact station stop code is mapped');
    });

    it('opens a full-screen chart, preserves context and closes details before exiting with Escape', async () => {
        await render();
        await click(button('Full screen'));
        const overlay = document.querySelector<HTMLElement>('.regional-go-fullscreen')!;
        expect(overlay.getAttribute('aria-modal')).toBe('true');
        expect(document.body.style.overflow).toBe('hidden');
        expect(Number.parseFloat(overlay.querySelector('table')!.style.minWidth)).toBe(0);
        expect(overlay.querySelector('.regional-go-panel-head')?.textContent).toContain('Allandale Waterfront GO');
        expect([...overlay.querySelectorAll('tbody th')].every(el => !el.textContent?.includes('master v'))).toBe(true);
        await click(overlay.querySelector('.regional-go-cell'));
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('.regional-go-fullscreen')).not.toBeNull();
        expect(document.querySelector('.regional-go-modal')).toBeNull();
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('.regional-go-fullscreen')).toBeNull();
        expect(document.body.style.overflow).not.toBe('hidden');
        expect(document.activeElement?.textContent).toContain('Full screen');
    });

    it('uses actual read versions and reports changes from the metadata list', async () => {
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry('8A', 4), content: content() });
        await render();
        expect(container.textContent).toContain('changed from v1 to v4');
        expect(container.querySelector('.regional-go-route')?.textContent).not.toContain('master v');
        await click(container.querySelector('.regional-go-cell'));
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('· v4');
        expect(container.textContent).not.toContain('master v1');
    });

    it('ignores old-team results after the source team changes', async () => {
        let finishOld: (value: { entry: MasterScheduleEntry; content: MasterScheduleContent }) => void = () => {};
        vi.mocked(getMasterSchedule).mockImplementation(async team => team === 'old-team'
            ? new Promise(resolve => { finishOld = resolve; })
            : { entry: entry('8A', 8), content: content() });
        await render({ readTeamId: 'old-team' });
        expect(container.textContent).toContain('Loading Weekday bus times');
        await render({ readTeamId: 'new-team' });
        await click(container.querySelector('.regional-go-cell'));
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('· v8');
        await click(document.querySelector('button[aria-label="Close connection detail"]'));
        await act(async () => { finishOld({ entry: entry('8A', 2), content: content() }); });
        await click(container.querySelector('.regional-go-cell'));
        expect(document.querySelector('[role=dialog]')?.textContent).toContain('· v8');
        await click(document.querySelector('button[aria-label="Close connection detail"]'));
        expect(container.textContent).not.toContain('master v2');
    });

    it('discloses missing holiday overrides and does not mislabel an uncovered date as no service', async () => {
        await render({ dayTypeForDate: undefined });
        expect(container.textContent).toContain('holiday overrides unavailable');
        await setDate('2100-01-01');
        expect(container.textContent).toContain('does not cover this service date');
        expect(container.textContent).not.toContain('No GO train service is scheduled');
        expect(container.querySelector('table')).toBeNull();
    });

    it('keeps train columns when no published bus schedules exist rather than claiming verified gaps', async () => {
        await render({ schedules: [] });
        expect(getMasterSchedule).not.toHaveBeenCalled();
        expect(container.querySelectorAll('thead time')).toHaveLength(4);
        expect(container.textContent).toContain('No published Weekday master schedules are available');
        expect(container.querySelector('tfoot')).toBeNull();
    });

    it('rejects a mismatched published route identity instead of showing another route’s timing', async () => {
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry('7'), content: content('7') });
        await render();
        expect(container.textContent).toContain('Master schedule identity does not match its route and day type');
        expect(container.querySelector('tbody .regional-go-unavailable')).toBeNull();
        expect(container.textContent).toContain('No 1–30 minute connections to show');
        expect(container.querySelector('tbody .regional-go-comfortable')).toBeNull();
    });

    it('refreshes the parent list before reloading sources and never shows previous charts during list refresh', async () => {
        let finishList: () => void = () => {};
        const refreshList = vi.fn(() => new Promise<void>(resolve => { finishList = resolve; }));
        await render({ onRefreshSchedules: refreshList });
        expect(container.querySelectorAll('table')).toHaveLength(2);
        await click(button('Refresh'));
        expect(refreshList).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Refreshing schedules');
        expect(container.querySelector('table')).toBeNull();
        expect(fetchRegionalGoFeed).toHaveBeenCalledOnce();
        await render({ schedules: [entry(), entry('7')] });
        expect(container.querySelector('table')).toBeNull();
        await act(async () => finishList());
        expect(fetchRegionalGoFeed).toHaveBeenCalledTimes(2);
        expect(fetchRegionalGoFeed).toHaveBeenLastCalledWith(expect.objectContaining({ forceRefresh: true }));
        expect(getMasterSchedule).toHaveBeenCalledWith('source-team', '7-Weekday');
        expect(container.querySelectorAll('tbody .regional-go-route')).toHaveLength(4);
    });

    it('keeps old charts hidden after list refresh failure and allows an explicit retry', async () => {
        const refreshList = vi.fn().mockRejectedValueOnce(new Error('List permission denied')).mockResolvedValue(undefined);
        await render({ onRefreshSchedules: refreshList });
        await click(button('Refresh'));
        expect(container.textContent).toContain('Refresh failed');
        expect(container.textContent).toContain('List permission denied');
        expect(container.querySelector('table')).toBeNull();
        expect(fetchRegionalGoFeed).toHaveBeenCalledOnce();
        expect(button('Print')?.hasAttribute('disabled')).toBe(true);
        await click(button('Retry sources'));
        expect(refreshList).toHaveBeenCalledTimes(2);
        expect(fetchRegionalGoFeed).toHaveBeenCalledTimes(2);
        expect(container.querySelectorAll('table')).toHaveLength(2);
        expect(container.textContent).not.toContain('List permission denied');
    });

    it('does not refresh the new team after an old team’s list request completes', async () => {
        let finishList: () => void = () => {};
        const refreshList = vi.fn(() => new Promise<void>(resolve => { finishList = resolve; }));
        await render({ onRefreshSchedules: refreshList });
        await click(button('Refresh'));
        await render({ readTeamId: 'new-team', onRefreshSchedules: async () => {} });
        expect(container.querySelectorAll('table')).toHaveLength(2);
        expect(getMasterSchedule).toHaveBeenCalledWith('new-team', '8A-Weekday');
        await act(async () => finishList());
        expect(fetchRegionalGoFeed).toHaveBeenCalledOnce();
        expect(container.textContent).not.toContain('Refreshing the published master schedule list');
    });

    it('does not claim inbound riders at a bus origin or onward riders at its final stop', async () => {
        const terminalContent = content();
        terminalContent.northTable.stops = ['Allandale', 'South'];
        vi.mocked(getMasterSchedule).mockResolvedValue({ entry: entry(), content: terminalContent });
        await render();
        expect(container.querySelector('section[aria-labelledby=regional-to-go-title] tbody .regional-go-comfortable')).toBeNull();
        expect(container.querySelector('section[aria-labelledby=regional-to-go-title] tbody .regional-go-no-connection')).not.toBeNull();
        await click(button('Barrie South'));
        expect(container.querySelector('section[aria-labelledby=regional-from-go-title] tbody .regional-go-comfortable')).toBeNull();
        expect(container.querySelector('section[aria-labelledby=regional-from-go-title] tbody .regional-go-no-connection')).not.toBeNull();
    });
});


