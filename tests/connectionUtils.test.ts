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
        expect(met[0].gapMinutes).toBe(8);
        expect(met[0].meetsConnection).toBe(true);

        const missedWithinWindow = getConnectionsForStop('9003', 475, library, 'Weekday');
        expect(missedWithinWindow).toHaveLength(1);
        expect(missedWithinWindow[0].gapMinutes).toBe(-5);
        expect(missedWithinWindow[0].meetsConnection).toBe(false);
    });
});
