import { describe, expect, it, vi } from 'vitest';

import {
    buildDetourLineGeoJson,
    findNearestRouteAnchor,
    splitDetourRoute,
    suggestBypassedStopIds,
} from '../utils/detours/detourGeometry';
import {
    addDetourControlPoint,
    addDetourWaypoint,
    deleteDetourControlPoint,
    deleteDetourWaypoint,
    moveDetourControlPoint,
    moveDetourMapItem,
    moveDetourWaypoint,
    snapDetourWaypointsToRoad,
} from '../utils/detours/detourAuthoring';

const point = (longitude: number, latitude: number) => ({ longitude, latitude });

describe('detour geometry', () => {
    const line = [point(-79.70, 44.38), point(-79.69, 44.38), point(-79.68, 44.38), point(-79.67, 44.38)];

    it('projects closure anchors onto the original line', () => {
        const anchor = findNearestRouteAnchor(line, point(-79.685, 44.381));
        expect(anchor).toMatchObject({ segmentIndex: 1, fraction: 0.5 });
        expect(anchor?.coordinate.longitude).toBeCloseTo(-79.685);
        expect(anchor?.coordinate.latitude).toBeCloseTo(44.38);
    });

    it('splits a linear route at partial-segment anchors', () => {
        const split = splitDetourRoute(line,
            { segmentIndex: 0, fraction: 0.5, coordinate: point(-79.695, 44.38) },
            { segmentIndex: 2, fraction: 0.5, coordinate: point(-79.675, 44.38) },
        );
        expect(split?.bypassed.map(({ longitude }) => longitude)).toEqual([-79.695, -79.69, -79.68, -79.675]);
        expect(split?.before.at(-1)).toEqual(point(-79.695, 44.38));
        expect(split?.after[0]).toEqual(point(-79.675, 44.38));
        expect(split?.wrapsLoop).toBe(false);
    });

    it('preserves service order when a loop closure wraps across the shape seam', () => {
        const loop = [point(0, 0), point(1, 0), point(1, 1), point(0, 1), point(0, 0)];
        const split = splitDetourRoute(loop,
            { segmentIndex: 3, fraction: 0.5, coordinate: point(0, 0.5) },
            { segmentIndex: 0, fraction: 0.5, coordinate: point(0.5, 0) },
            true,
        );
        expect(split?.wrapsLoop).toBe(true);
        expect(split?.bypassed).toEqual([point(0, 0.5), point(0, 0), point(0.5, 0)]);
        expect(split?.before[0]).toEqual(point(0.5, 0));
        expect(split?.before.at(-1)).toEqual(point(0, 0.5));
    });

    it('suggests nearby bypassed stops but leaves distant stops out', () => {
        expect(suggestBypassedStopIds([
            { id: 'closed', position: point(-79.69, 44.3801) },
            { id: 'open', position: point(-79.69, 44.39) },
        ], line, 50)).toEqual(['closed']);
    });

    it('builds Mapbox-ready GeoJSON without mutating domain coordinates', () => {
        expect(buildDetourLineGeoJson(line, { color: '#123456' })).toEqual({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: line.map(({ longitude, latitude }) => [longitude, latitude]) },
                properties: { color: '#123456' },
            }],
        });
    });
});

describe('detour authoring', () => {
    const waypoints = [
        { id: 'a', ...point(-79.70, 44.38) },
        { id: 'c', ...point(-79.68, 44.38) },
    ];

    it('edits waypoint arrays immutably and keeps no-op references stable', () => {
        const added = addDetourWaypoint(waypoints, { id: 'b', ...point(-79.69, 44.38) }, 'a');
        expect(added.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
        expect(added).not.toBe(waypoints);

        const moved = moveDetourWaypoint(added, 'b', point(-79.691, 44.381));
        expect(moved[1]).toMatchObject(point(-79.691, 44.381));
        expect(moveDetourWaypoint(moved, 'missing', point(0, 0))).toBe(moved);
        expect(deleteDetourWaypoint(moved, 'b').map(({ id }) => id)).toEqual(['a', 'c']);
        expect(deleteDetourWaypoint(moved, 'missing')).toBe(moved);
    });

    it('edits coordinate-only control points separately from snapped geometry', () => {
        const controls = [point(-79.70, 44.38), point(-79.68, 44.38)];
        const added = addDetourControlPoint(controls, point(-79.69, 44.39), 0);
        expect(added).toEqual([controls[0], point(-79.69, 44.39), controls[1]]);
        const moved = moveDetourControlPoint(added, 1, point(-79.691, 44.391));
        expect(moved[1]).toEqual(point(-79.691, 44.391));
        expect(moveDetourControlPoint(moved, 9, point(0, 0))).toBe(moved);
        expect(deleteDetourControlPoint(moved, 1)).toEqual(controls);
    });

    it('moves temporary stops without mutating the original item', () => {
        const items = [{ id: 'temp', name: 'Temporary', position: point(-79.69, 44.38) }];
        const moved = moveDetourMapItem(items, 'temp', point(-79.68, 44.39));
        expect(moved[0]?.position).toEqual(point(-79.68, 44.39));
        expect(items[0]?.position).toEqual(point(-79.69, 44.38));
    });

    it('returns a planner-visible manual warning when Mapbox snapping falls back', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
        const result = await snapDetourWaypointsToRoad([point(-79.70, 44.38), point(-79.69, 44.39)], {
            token: 'test-token',
            fetchImpl,
        });
        expect(result.source).toBe('manual');
        expect(result.requiresAcknowledgement).toBe(true);
        expect(result.warning).toContain('bus suitability');
        expect(result.geometry).toEqual([point(-79.70, 44.38), point(-79.69, 44.39)]);
    });
});
