import { describe, expect, it } from 'vitest';
import {
    buildDayLibrary,
    defaultRuleForTarget,
    deriveRouteTargetTimes,
    findRouteStopForTarget,
    normalizeStopForMatch,
    parsePastedTimes,
    suggestConnections,
    toDayRouteIdentity,
    upsertTargetForDay,
} from '../utils/connections/guidedConnectionSetup';
import type { ConnectionLibrary, ConnectionTarget, RouteConnection } from '../utils/connections/connectionTypes';

const ROUTE_2_STOPS = [
    { code: '777', name: 'Park Place' },
    { code: '626', name: 'Sproule at Kraus' },
    { code: '1', name: 'Downtown Hub' },
];

const target = (overrides: Partial<ConnectionTarget>): ConnectionTarget => ({
    id: 't', name: 'Target', type: 'manual', stopCode: '', times: [], createdAt: '', updatedAt: '', ...overrides,
});

describe('matching saved services to this route', () => {
    it('treats hub platforms as one place', () => {
        expect(normalizeStopForMatch('Downtown Hub Platform 5')).toBe('downtown hub');
        expect(normalizeStopForMatch('Downtown Hub (2)')).toBe('downtown hub');
    });

    it('matches by stop code first, then by hub name', () => {
        expect(findRouteStopForTarget(target({ stopCode: '777' }), ROUTE_2_STOPS)?.name).toBe('Park Place');
        // Route 7 is saved at Downtown Hub code 2; Route 2 serves the Hub as code 1.
        expect(findRouteStopForTarget(target({ stopCode: '2', stopName: 'Downtown Hub' }), ROUTE_2_STOPS)?.code).toBe('1');
        expect(findRouteStopForTarget(target({ stopCode: '9006', stopName: 'Allandale Waterfront GO' }), ROUTE_2_STOPS)).toBeNull();
    });

    it('suggests services at this route\'s stops that are not set up yet, but not the route itself', () => {
        const library: ConnectionLibrary = {
            targets: [
                target({ id: 'r7', type: 'route', routeIdentity: '7-Weekday', stopCode: '2', stopName: 'Downtown Hub' }),
                target({ id: 'r12', type: 'route', routeIdentity: '12-Weekday', stopCode: '777', stopName: 'Park Place' }),
                target({ id: 'self', type: 'route', routeIdentity: '2-Weekday', stopCode: '777', stopName: 'Park Place' }),
                target({ id: 'go', stopCode: '9006', stopName: 'Allandale Waterfront GO' }),
            ],
            updatedAt: '', updatedBy: '',
        };
        const existing = [{ targetId: 'r12' } as RouteConnection];
        expect(suggestConnections(library, existing, ROUTE_2_STOPS, '2').map(item => [item.target.id, item.stop.code, item.reason]))
            .toEqual([['r7', '1', 'same-hub']]);
    });
});

describe('default rules', () => {
    it('uses the service type and direction', () => {
        expect(defaultRuleForTarget(target({ icon: 'train', defaultEventType: 'departure' })))
            .toEqual({ connectionType: 'meet_departing', bufferMinutes: 5, maxWaitMinutes: 15 });
        expect(defaultRuleForTarget(target({ type: 'route', defaultEventType: 'arrival' })))
            .toEqual({ connectionType: 'feed_arriving', bufferMinutes: 2, maxWaitMinutes: 8 });
        expect(defaultRuleForTarget(target({ name: 'LINX 3 to Orillia', source: 'linx-gtfs' })).bufferMinutes).toBe(3);
    });
});

describe('day-correct times', () => {
    it('maps a route identity to another day type', () => {
        expect(toDayRouteIdentity('8A-Weekday', 'Saturday')).toBe('8A-Saturday');
    });

    it('reads a route\'s times at a stop and keeps after-midnight trips late', () => {
        const times = deriveRouteTargetTimes({
            stopIds: {},
            trips: [
                { startTime: 400, stops: { 'Park Place': '6:45 AM' } },
                { startTime: 1450, stops: { 'Park Place': '12:20 AM' } },
                { startTime: 500, stops: { 'Park Place': '6:45 AM' } },
                { startTime: 600, stopMinutes: { 'Park Place': 610 }, stops: {} },
            ] as never,
        }, 'Park Place', 'Saturday');
        expect(times.map(time => time.time)).toEqual([405, 610, 1460]);
        expect(times[0].daysActive).toEqual(['Saturday']);
    });

    it('swaps in the day\'s route times and leaves other targets alone', () => {
        const library: ConnectionLibrary = {
            targets: [
                target({ id: 'r12', type: 'route', times: [{ id: 'w', time: 400, daysActive: ['Weekday'], enabled: true }] }),
                target({ id: 'go', times: [{ id: 'g', time: 500, daysActive: ['Saturday'], enabled: true }] }),
            ],
            updatedAt: '', updatedBy: '',
        };
        const day = buildDayLibrary(library, 'Saturday', { r12: [{ id: 's', time: 410, daysActive: ['Saturday'], enabled: true }] });
        expect(day.targets[0].times?.map(time => [time.time, time.daysActive])).toEqual([[400, ['Weekday']], [410, ['Saturday']]]);
        expect(day.targets[1]).toBe(library.targets[1]);
    });

    it('replaces only one day\'s times when the same service is added again', () => {
        const library: ConnectionLibrary = {
            targets: [target({ id: 'go', name: 'GO Allandale • To Train', times: [
                { id: 'a', time: 400, daysActive: ['Weekday'], enabled: true },
                { id: 'b', time: 410, daysActive: ['Weekday', 'Saturday'], enabled: true },
            ] })],
            updatedAt: '', updatedBy: '',
        };
        const { library: next, target: saved } = upsertTargetForDay(library, {
            name: 'GO Allandale • To Train', type: 'manual', stopCode: '9003',
            times: [{ id: 'c', time: 500, daysActive: ['Weekday'], enabled: true }],
        }, 'Saturday', 'u1');
        expect(next.targets).toHaveLength(1);
        expect(saved.id).toBe('go');
        expect(saved.times?.map(time => [time.time, time.daysActive])).toEqual([
            [400, ['Weekday']], [410, ['Weekday']], [500, ['Saturday']],
        ]);
    });
});

describe('pasted times', () => {
    it('reads common formats and removes duplicates', () => {
        expect(parsePastedTimes('Sat 7:15 AM, 9:15a. 1:15 p.m. 13:15 and 21:05')).toEqual([435, 555, 795, 1265]);
    });
});
