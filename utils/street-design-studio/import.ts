import type { Point, Project, Reference, SourceRecord } from './domain';
import { lonLatToLocal } from './geometry';

export function parseReferenceGeoJson(project: Project, text: string, sourceLabel: string): { references: Reference[]; source: SourceRecord } {
  if (text.length > 10_000_000) throw new Error('GeoJSON exceeds 10 MB.');
  const input: unknown = JSON.parse(text);
  if (!input || typeof input !== 'object' || (input as { type?: string }).type !== 'FeatureCollection') throw new Error('Expected a WGS84 GeoJSON FeatureCollection.');
  const features = (input as { features?: unknown[] }).features;
  if (!Array.isArray(features) || features.length > 5000) throw new Error('GeoJSON feature count exceeds the 5,000 feature limit.');
  let count = 0;
  const point = (candidate: unknown): Point => { if (!Array.isArray(candidate) || candidate.length !== 2 || !candidate.every(Number.isFinite)) throw new Error('Coordinates must be finite [longitude, latitude] pairs.'); const [lon, lat] = candidate as Point; if (lon < -180 || lon > 180 || lat < -80 || lat > 84) throw new Error('Coordinate is outside supported WGS84/UTM range.'); if (++count > 100_000) throw new Error('GeoJSON exceeds 100,000 coordinate pairs.'); return lonLatToLocal(project, [lon, lat]); };
  const sourceId = `import-${project.revision + 1}`;
  const references = features.map((raw, index): Reference => { const feature = raw as { type?: string; geometry?: { type?: string; coordinates?: unknown } }; if (feature?.type !== 'Feature' || !feature.geometry) throw new Error(`Feature ${index} is malformed.`); const geometry = feature.geometry; let coordinates: Reference['coordinates']; if (geometry.type === 'Point') coordinates = point(geometry.coordinates); else if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) coordinates = geometry.coordinates.map(point); else if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) coordinates = geometry.coordinates.map(ring => { if (!Array.isArray(ring) || ring.length < 4) throw new Error(`Feature ${index} has an invalid ring.`); const local = ring.map(point); if (JSON.stringify(local[0]) !== JSON.stringify(local.at(-1))) throw new Error(`Feature ${index} has an open ring.`); return local; }); else throw new Error(`Feature ${index} uses unsupported geometry ${geometry.type ?? 'unknown'}.`); return { id: `${sourceId}-${index}`, type: geometry.type as Reference['type'], coordinates, source: 'imported-reference', sourceId, confidence: 'unverified import' }; });
  return { references, source: { id: sourceId, label: sourceLabel, attribution: sourceLabel, display: 'allowed', trace: 'unknown', exportDerived: 'unknown', evidence: 'Imported file; rights and accuracy not verified' } };
}
