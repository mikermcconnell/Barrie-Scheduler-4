import { describe, expect, it } from 'vitest';
import { canOpenSimulator, simulatorLimitedTabs, simulatorUrl } from '../utils/simulatorLink';

describe('simulator link', () => {
    it('puts the token and view in the fragment, never the query', () => {
        const url = simulatorUrl('abc.def-ghi', 'punctuality', 'https://sim.example');
        expect(url).toBe('https://sim.example/login.html#token=abc.def-ghi&view=punctuality');
        expect(new URL(url).search).toBe('');
    });

    it('leaves the view out for Buses', () => {
        expect(simulatorUrl('t', undefined, 'https://sim.example')).toBe('https://sim.example/login.html#token=t');
    });

    it('is offered only to the access levels the simulator accepts', () => {
        expect(canOpenSimulator('planner')).toBe(true);
        expect(canOpenSimulator('internal')).toBe(true);
        expect(canOpenSimulator('admin')).toBe(true);
        expect(canOpenSimulator('parking')).toBe(true);
        for (const level of ['none', 'production', 'external-planner', 'transit-app-only'] as const) {
            expect(canOpenSimulator(level)).toBe(false);
        }
    });

    it('is offered to the Ontario Northland team, whatever its level, but not to other external planners', () => {
        expect(canOpenSimulator('external-planner', 'VieLReKaKrIfaSh44kEj')).toBe(true);
        expect(canOpenSimulator('transit-app-only', 'VieLReKaKrIfaSh44kEj')).toBe(true);
        expect(simulatorLimitedTabs('external-planner', 'VieLReKaKrIfaSh44kEj')).toEqual(['Service Desk', 'Planning', 'Parking']);
        expect(canOpenSimulator('external-planner', 'gPwiDKGp890n5yOHhIzZ')).toBe(false);
        expect(simulatorLimitedTabs('planner', 'PHICwXGlvDen0RGt7fCG')).toBeUndefined();
        expect(simulatorLimitedTabs('parking', 'qx5rgBibRmPzvjbBdAMA')).toEqual(['Parking', 'Planning']);
    });
});
