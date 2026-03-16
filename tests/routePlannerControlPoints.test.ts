import { describe, expect, it } from 'vitest';
import { ROUTE_CONTROL_POINT_LIMITS, simplifyRouteControlPoints } from '../utils/route-planner/routePlannerControlPoints';

function buildSyntheticRoute(pointCount: number): [number, number][] {
    return Array.from({ length: pointCount }, (_, index) => {
        const offset = index < pointCount / 2 ? index * 0.0006 : (pointCount - index) * 0.0004;
        return [-79.69 + (index * 0.0005), 44.38 + offset] as [number, number];
    });
}

describe('simplifyRouteControlPoints', () => {
    it('reduces dense geometry to planner-sized control points while preserving endpoints', () => {
        const coordinates = buildSyntheticRoute(60);

        const simplified = simplifyRouteControlPoints(coordinates);

        expect(simplified.length).toBeGreaterThanOrEqual(ROUTE_CONTROL_POINT_LIMITS.min);
        expect(simplified.length).toBeLessThanOrEqual(ROUTE_CONTROL_POINT_LIMITS.max);
        expect(simplified[0]).toEqual(coordinates[0]);
        expect(simplified[simplified.length - 1]).toEqual(coordinates[coordinates.length - 1]);
    });

    it('keeps short routes unchanged', () => {
        const coordinates = buildSyntheticRoute(8);

        expect(simplifyRouteControlPoints(coordinates)).toEqual(coordinates);
    });
});
