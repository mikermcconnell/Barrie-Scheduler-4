import { describe, expect, it, vi } from 'vitest';
import {
    createPlannerStreetLabel,
    mergeDetourStreetSuggestions,
    pathCoordinateAtFraction,
    pathFractionAtCoordinate,
    snapStreetLabelToPath,
    streetLabelText,
} from '../utils/detours/detourStreetLabels';
import type { DetourStreetLabel } from '../utils/detours/detourTypes';

vi.stubGlobal('crypto', { randomUUID: () => 'street-id' });

const point = (longitude: number, latitude: number) => ({ longitude, latitude });

describe('detour street labels', () => {
    it('uses transit-safe wording for closed and replacement paths', () => {
        expect(streetLabelText({ path: 'closure', streetName: 'Shanty Bay Rd' })).toBe('NO SERVICE ON · SHANTY BAY RD');
        expect(streetLabelText({ path: 'detour', streetName: 'Blake St' })).toBe('DETOUR VIA · BLAKE ST');
    });

    it('creates confirmed planner labels at the path midpoint', () => {
        const label = createPlannerStreetLabel('closure', ' Shanty   Bay Rd ', [point(0, 0), point(2, 0)]);
        expect(label).toMatchObject({
            path: 'closure', streetName: 'Shanty Bay Rd', confirmed: true, visible: true,
            position: point(1, 0),
        });
    });

    it('deduplicates Mapbox suggestions without replacing confirmed planner work', () => {
        const current: DetourStreetLabel[] = [{
            id: 'accepted', path: 'detour', streetName: 'Blake St', position: point(0, 0),
            source: 'planner', confirmed: true, visible: true,
        }, {
            id: 'stale', path: 'detour', streetName: 'Old Rd', position: point(0, 0),
            source: 'mapbox', confirmed: false, visible: true,
        }];
        const merged = mergeDetourStreetSuggestions(current, [
            { name: 'Blake St', geometry: [point(0, 0), point(1, 0)] },
            { name: 'Johnson St', geometry: [point(1, 0), point(1, 2)] },
            { name: 'johnson st', geometry: [point(1, 0), point(1, 2)] },
        ]);
        expect(merged.map(label => label.streetName)).toEqual(['Blake St', 'Johnson St']);
        expect(merged[1]).toMatchObject({ source: 'mapbox', confirmed: false, position: point(1, 1) });
    });

    it('re-snaps a dragged label to its associated path', () => {
        const label: DetourStreetLabel = {
            id: 'label', path: 'closure', streetName: 'Shanty Bay Rd', position: point(0.8, 0.4),
            source: 'planner', confirmed: true, visible: true,
        };
        expect(snapStreetLabelToPath(label, [point(0, 0), point(2, 0)]).position).toEqual(point(0.8, 0));
    });

    it('positions labels by distance along a multi-segment path', () => {
        const geometry = [point(0, 0), point(1, 0), point(1, 3)];
        expect(pathCoordinateAtFraction(geometry, 0.5)).toEqual(point(1, 1));
        expect(pathFractionAtCoordinate(geometry, point(1, 1))).toBeCloseTo(0.5);
        expect(pathCoordinateAtFraction(geometry, 0.75)).toEqual(point(1, 2));
    });
});
