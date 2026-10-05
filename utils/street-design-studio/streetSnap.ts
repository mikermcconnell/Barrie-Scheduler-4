import type { Map as LibreMap } from 'maplibre-gl';
import type { Point } from './domain';

export interface RoadSnap { lonLat: Point; screen: Point; distancePx: number; layerId: string }

/** OpenFreeMap's line widths are cartographic symbols, not measured road edges. */
export function isRoadCentrelineLayer(id: string): boolean {
  return /(?:^|_)(?:road|street)(?:_|$)/i.test(id)
    && !/(?:casing|hatching|shield|name|arrow|area|pattern|path|pedestrian|rail)/i.test(id);
}

export function nearestPointOnLine(
  pointer: Point,
  coordinates: Point[],
  project: (lonLat: Point) => Point,
): { lonLat: Point; screen: Point; distancePx: number } | null {
  let best: { lonLat: Point; screen: Point; distancePx: number } | null = null;
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1], b = coordinates[i];
    if (![...a, ...b].every(Number.isFinite)) continue;
    const pa = project(a), pb = project(b);
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], denominator = dx * dx + dy * dy;
    if (denominator < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((pointer[0] - pa[0]) * dx + (pointer[1] - pa[1]) * dy) / denominator));
    const screen: Point = [pa[0] + t * dx, pa[1] + t * dy];
    const distancePx = Math.hypot(pointer[0] - screen[0], pointer[1] - screen[1]);
    if (!best || distancePx < best.distancePx) best = { lonLat: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], screen, distancePx };
  }
  return best;
}

export function findStreetSnap(map: LibreMap, pointer: Point, radiusPx = 12): RoadSnap | null {
  const layers = map.getStyle()?.layers?.map(layer => layer.id).filter(isRoadCentrelineLayer) ?? [];
  if (!layers.length) return null;
  const box: [Point, Point] = [[pointer[0] - radiusPx, pointer[1] - radiusPx], [pointer[0] + radiusPx, pointer[1] + radiusPx]];
  const features = map.queryRenderedFeatures(box, { layers });
  let best: RoadSnap | null = null;
  for (const feature of features) {
    if (feature.sourceLayer !== 'transportation') continue;
    const roadClass = String(feature.properties?.class ?? '');
    if (/path|pedestrian|rail|ferry|aerialway/i.test(roadClass)) continue;
    const geometry = feature.geometry;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const line of lines) {
      const candidate = nearestPointOnLine(pointer, line as Point[], lonLat => { const p = map.project(lonLat); return [p.x, p.y]; });
      if (!candidate || candidate.distancePx > radiusPx) continue;
      if (!best || candidate.distancePx < best.distancePx - 1e-6 || Math.abs(candidate.distancePx - best.distancePx) <= 1e-6 && feature.layer.id < best.layerId) best = { ...candidate, layerId: feature.layer.id };
    }
  }
  return best;
}
