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
    deleteDetourGeometryAnchor,
    deleteDetourWaypoint,
    insertDetourControlPointOnLine,
    insertDetourGeometryAnchor,
    moveDetourGeometryAnchor,
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

    it('inserts clicked detour anchors in displayed line order', () => {
        const geometry = [point(0, 0), point(1, 0), point(2, 1), point(3, 1)];
        const controls = [geometry[0], geometry[3]];
        const first = insertDetourControlPointOnLine(controls, geometry, point(0.5, 0.1));
        expect(first).toMatchObject({ index: 1, coordinate: point(0.5, 0) });
        const second = insertDetourControlPointOnLine(first!.waypoints, geometry, point(2.5, 1.1));
        expect(second?.index).toBe(2);
        expect(second?.waypoints).toEqual([geometry[0], point(0.5, 0), point(2.5, 1), geometry[3]]);
        expect(insertDetourControlPointOnLine(controls, geometry, point(0.00001, 0))).toBeNull();
    });

    it('deforms neighboring closure geometry with a moved anchor instead of creating a one-point spike', () => {
        const geometry = [point(0, 0), point(1, 0), point(2, 1), point(3, 1)];
        const inserted = insertDetourGeometryAnchor([], geometry, point(1.5, 0.6));
        expect(inserted?.anchors[0]?.longitude).toBeCloseTo(1.55);
        expect(inserted?.anchors[0]?.latitude).toBeCloseTo(0.55);
        expect(inserted?.geometry).toHaveLength(5);
        expect(insertDetourGeometryAnchor([], geometry, point(0.00001, 0))).toBeNull();

        const moved = moveDetourGeometryAnchor(inserted!.anchors, inserted!.geometry, 0, point(1.5, 1.2));
        expect(moved?.anchors[0]).toEqual(point(1.5, 1.2));
        expect(moved?.geometry).toContainEqual(point(1.5, 1.2));
        expect(moved?.geometry[1]).not.toEqual(geometry[1]);
        expect(moved?.geometry[2]).not.toEqual(geometry[2]);
        expect(moved?.geometry[0]).toEqual(geometry[0]);
        expect(moved?.geometry.at(-1)).toEqual(geometry.at(-1));

        const deleted = deleteDetourGeometryAnchor(moved!.anchors, moved!.geometry, 0);
        expect(deleted?.anchors).toEqual([]);
        expect(deleted?.geometry).toHaveLength(geometry.length);
        expect(deleted?.geometry[0]).toEqual(geometry[0]);
        expect(deleted?.geometry.at(-1)).toEqual(geometry.at(-1));
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

    it('preserves Mapbox road names as unconfirmed detour-label inputs', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                code: 'Ok',
                routes: [{
                    geometry: { coordinates: [[-79.7002, 44.3802], [-79.695, 44.385], [-79.6898, 44.3898]] },
                    legs: [{ steps: [{ name: 'Blake St', geometry: { coordinates: [[-79.70, 44.38], [-79.69, 44.39]] } }] }],
                }],
            }),
        }) as unknown as typeof fetch;
        const result = await snapDetourWaypointsToRoad([point(-79.70, 44.38), point(-79.69, 44.39)], {
            token: 'street-label-test-token',
            fetchImpl,
        });
        expect(result.geometry[0]).toEqual(point(-79.70, 44.38));
        expect(result.geometry.at(-1)).toEqual(point(-79.69, 44.39));
        expect(result.roadLabels).toEqual([{ name: 'Blake St', geometry: [point(-79.70, 44.38), point(-79.69, 44.39)] }]);
    });
});
