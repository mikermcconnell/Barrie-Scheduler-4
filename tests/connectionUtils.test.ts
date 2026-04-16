import { describe, expect, it } from 'vitest';
import { getConnectionsForStop } from '../utils/connections/connectionUtils';
import type { ConnectionLibrary } from '../utils/connections/connectionTypes';

const baseLibrary = (): ConnectionLibrary => ({
    targets: [],
    qualityWindowSettings: {
        excellentMin: 5,
        excellentMax: 10,
        goodMin: 2,
        goodMax: 15
    },
    changeLog: [],
    updatedAt: new Date().toISOString(),
    updatedBy: 'test'
});

describe('connectionUtils event-type logic', () => {
    it('uses target defaultEventType when time eventType is undefined', () => {
        const library = baseLibrary();
        library.targets = [{
            id: 't1',
            name: 'Train Departures',
            type: 'manual',
            stopCode: '9003',
            defaultEventType: 'departure',
            times: [{
                id: 'tm1',
                time: 480,
                daysActive: ['Weekday'],
                enabled: true
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }];

        const matches = getConnectionsForStop('9003', 470, library, 'Weekday');
        expect(matches).toHaveLength(1);
        expect(matches[0].eventType).toBe('departure');
        expect(matches[0].busAnchor).toBe('arrival');
        expect(matches[0].gapMinutes).toBe(10);
        expect(matches[0].meetsConnection).toBe(true);
    });

    it('treats arrival events as bus departing after train arrives', () => {
        const library = baseLibrary();
        library.targets = [{
            id: 't2',
            name: 'Train Arrivals',
            type: 'manual',
            stopCode: '9003',
            defaultEventType: 'arrival',
            times: [{
                id: 'tm2',
                time: 480,
                daysActive: ['Weekday'],
                enabled: true
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }];

        const met = getConnectionsForStop('9003', 488, library, 'Weekday');
        expect(met).toHaveLength(1);
        expect(met[0].eventType).toBe('arrival');
        expect(met[0].busAnchor).toBe('departure');
        expect(met[0].gapMinutes).toBe(8);
        expect(met[0].meetsConnection).toBe(true);

        const missedWithinWindow = getConnectionsForStop('9003', 475, library, 'Weekday');
        expect(missedWithinWindow).toHaveLength(1);
        expect(missedWithinWindow[0].gapMinutes).toBe(-5);
        expect(missedWithinWindow[0].meetsConnection).toBe(false);
    });

    it('uses the saved route connection type when deciding bus-side placement', () => {
        const library = baseLibrary();
        library.targets = [{
            id: 't3',
            name: 'Bell Departures',
            type: 'manual',
            stopCode: '9003',
            defaultEventType: 'departure',
            times: [{
                id: 'tm3',
                time: 480,
                daysActive: ['Weekday'],
                enabled: true
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }];

        const matches = getConnectionsForStop(
            '9003',
            { arrival: 470, departure: 482 },
            library,
            'Weekday',
            [{
                id: 'conn-1',
                targetId: 't3',
                connectionType: 'feed_arriving',
                bufferMinutes: 5,
                stopCode: '9003',
                stopName: 'Allandale Waterfront GO Station',
                priority: 1,
                enabled: true
            }]
        );

        expect(matches).toHaveLength(1);
        expect(matches[0].connectionId).toBe('conn-1');
        expect(matches[0].eventType).toBe('departure');
        expect(matches[0].busAnchor).toBe('departure');
        expect(matches[0].tripTime).toBe(482);
        expect(matches[0].gapMinutes).toBe(2);
        expect(matches[0].meetsConnection).toBe(true);
    });

    it('does not fall back to departure time for meet_departing route connections', () => {
        const library = baseLibrary();
        library.targets = [{
            id: 't4',
            name: 'Route 400 (North)',
            type: 'route',
            routeIdentity: '400-Weekday',
            stopCode: '9003',
            stopName: 'Allandale Waterfront GO',
            direction: 'North',
            icon: 'bus',
            defaultEventType: 'departure',
            times: [{
                id: 'tm4',
                time: 480,
                daysActive: ['Weekday'],
                enabled: true
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }];

        const matches = getConnectionsForStop(
            '9003',
            { arrival: null, departure: 472 },
            library,
            'Weekday',
            [{
                id: 'conn-2',
                targetId: 't4',
                connectionType: 'meet_departing',
                bufferMinutes: 5,
                stopCode: '9003',
                stopName: 'Allandale Waterfront GO',
                priority: 1,
                enabled: true
            }]
        );

        expect(matches).toHaveLength(0);
    });

    it('builds directional short labels for route connection icons', () => {
        const library = baseLibrary();
        library.targets = [
            {
                id: 'route-2',
                name: 'Route 2 (South)',
                type: 'route',
                routeIdentity: '2-Weekday',
                stopCode: '9003',
                stopName: 'Allandale Waterfront GO',
                direction: 'South',
                icon: 'bus',
                defaultEventType: 'departure',
                times: [{
                    id: 'rt-1',
                    time: 480,
                    daysActive: ['Weekday'],
                    enabled: true
                }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 'route-8a',
                name: 'Route 8A (North)',
                type: 'route',
                routeIdentity: '8A-Weekday',
                stopCode: '9003',
                stopName: 'Allandale Waterfront GO',
                direction: 'North',
                icon: 'bus',
                defaultEventType: 'departure',
                times: [{
                    id: 'rt-2',
                    time: 482,
                    daysActive: ['Weekday'],
                    enabled: true
                }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 'route-400',
                name: 'Route 400 (North)',
                type: 'route',
                routeIdentity: '400-Weekday',
                stopCode: '9003',
                stopName: 'Allandale Waterfront GO',
                direction: 'North',
                icon: 'bus',
                defaultEventType: 'departure',
                times: [{
                    id: 'rt-3',
                    time: 484,
                    daysActive: ['Weekday'],
                    enabled: true
                }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ];

        const matches = getConnectionsForStop('9003', 470, library, 'Weekday');
        expect(matches.map(match => match.targetShortLabel)).toEqual(['2B', '8A', '400N']);
    });
});
