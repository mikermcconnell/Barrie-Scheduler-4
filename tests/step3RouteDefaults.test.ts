import { describe, expect, it } from 'vitest';
import { getStep3RouteDefaults } from '../components/NewSchedule/utils/step3RouteDefaults';

describe('step3RouteDefaults', () => {
    it.each([
        ['2', { cycleMode: 'Strict', cycleTime: 90 }],
        ['2A', { cycleMode: 'Strict', cycleTime: 90 }],
        ['7', { cycleMode: 'Strict', cycleTime: 120 }],
        ['8A', { cycleMode: 'Strict', cycleTime: 150 }],
        ['8B', { cycleMode: 'Strict', cycleTime: 150 }],
        ['12', { cycleMode: 'Floating' }],
        ['12B', { cycleMode: 'Floating' }],
        ['10', { cycleMode: 'Strict', cycleTime: 60 }],
        ['11', { cycleMode: 'Strict', cycleTime: 60 }],
        ['100', { cycleMode: 'Floating' }],
        ['101', { cycleMode: 'Floating' }],
        ['100-101', { cycleMode: 'Floating' }],
        ['400', { cycleMode: 'Strict', cycleTime: 60 }],
    ])('returns the expected defaults for route %s', (routeNumber, expected) => {
        expect(getStep3RouteDefaults(routeNumber)).toEqual(expected);
    });

    it('returns null for routes without a configured default', () => {
        expect(getStep3RouteDefaults('1')).toBeNull();
        expect(getStep3RouteDefaults('8')).toBeNull();
        expect(getStep3RouteDefaults('')).toBeNull();
    });
});
