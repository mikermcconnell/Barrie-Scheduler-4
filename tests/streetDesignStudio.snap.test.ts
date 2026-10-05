import { describe, expect, it } from 'vitest';
import { isRoadCentrelineLayer, nearestPointOnLine } from '../utils/street-design-studio/streetSnap';

describe('Street basemap snapping', () => {
  it('uses only road centreline layers, not casings or labels', () => {
    expect(isRoadCentrelineLayer('road_minor')).toBe(true);
    expect(isRoadCentrelineLayer('bridge_street')).toBe(true);
    expect(isRoadCentrelineLayer('road_minor_casing')).toBe(false);
    expect(isRoadCentrelineLayer('highway-name-path')).toBe(false);
    expect(isRoadCentrelineLayer('road_path_pedestrian')).toBe(false);
  });
  it('projects to the nearest line segment with endpoint clamping', () => {
    const project = (p: [number, number]): [number, number] => [p[0] * 10, p[1] * 10];
    const snapped = nearestPointOnLine([47, 14], [[0, 1], [10, 1]], project)!;
    expect(snapped.lonLat[0]).toBeCloseTo(4.7, 9);
    expect(snapped.lonLat[1]).toBe(1);
    expect(snapped.screen).toEqual([47, 10]);
    expect(snapped.distancePx).toBe(4);
    expect(nearestPointOnLine([-20, 10], [[0, 1], [10, 1]], project)?.lonLat).toEqual([0, 1]);
  });
});
