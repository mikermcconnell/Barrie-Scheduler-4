import { jsPDF } from 'jspdf';
import type { Point, Project, Scenario } from './domain';
import { compileScenario, localToLonLat, type Scene } from './geometry';

const palette: Record<string, string> = { travel: '#64717a', parking: '#879096', cycle: '#b5cec1', buffer: '#d5ded6', sidewalk: '#e9e5dc', planting: '#c5d5b9', median: '#c8c8bd' };
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const path = (points: Point[], xy: (p: Point) => Point) => points.map((point, i) => { const [x, y] = xy(point); return `${i ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`; }).join(' ') + ' Z';
export interface Sheet { svg: string; widthMm: number; heightMm: number; scale: number }
export function makeSheet(project: Project, scenario: Scenario, scale = 500): Sheet {
  const scene = compileScenario(scenario); const widthMm = 420, heightMm = 297, left = 24, top = 116, contentW = 372, contentH = 120;
  const points = scene.envelope, minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  const factor = 1000 / scale;
  if ((maxX - minX) * factor > contentW || (maxY - minY) * factor > contentH) throw new Error(`1:${scale} does not fit A3. Choose a smaller drawing scale.`);
  const xy = (p: Point): Point => [left + (p[0] - minX) * factor, top + (maxY - p[1]) * factor];
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297"><rect width="420" height="297" fill="#fff"/><text x="24" y="22" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#17252e">${escape(project.name)}</text><text x="24" y="33" font-family="Arial,sans-serif" font-size="4" fill="#44515a">${escape(scenario.name)} · revision ${project.revision} · 1:${scale} · Print at 100%</text>`];
  for (const surface of scene.surfaces) parts.push(`<path d="${path(surface.ring, xy)}" fill="${palette[surface.kind]}" stroke="#fff" stroke-width="0.18"/>`);
  for (const stripe of scene.markings) parts.push(`<path d="${path(stripe.ring, xy)}" fill="#fff"/>`);
  for (const band of scenario.bands.filter(b => b.kind === 'parking' || b.kind === 'cycle' && b.replacesEntityId)) { const line = scene.boundaries[band.outerBoundaryId]; parts.push(`<path d="${line.map((p, i) => { const [x, y] = xy(p); return `${i ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`; }).join(' ')}" fill="none" stroke="#26343c" stroke-width="0.7"/>`); }
  for (const object of scene.objects) {
    const [x, y] = xy(object.point);
    if (object.type === 'crossing' && object.ring) parts.push(`<path d="${path(object.ring, xy)}" fill="#fff" fill-opacity="0.45" stroke="#f9faf8" stroke-width="0.5"/>`);
    if (object.type === 'stop') parts.push(`<circle cx="${x}" cy="${y}" r="1.5" fill="#0f766e" stroke="#fff" stroke-width="0.5"/><text x="${x + 2}" y="${y - 2}" font-family="Arial,sans-serif" font-size="3">BUS STOP</text>`);
    if (object.type === 'tree') parts.push(`<circle cx="${x}" cy="${y}" r="2" fill="#8faa88" stroke="#466646" stroke-width="0.3"/>`);
  }
  for (const d of scene.dimensions) { const [ax, ay] = xy(d.a), [bx, by] = xy(d.b); parts.push(`<path d="M${ax} ${ay} L${bx} ${by}" fill="none" stroke="#243843" stroke-width="0.28"/><text x="${(ax + bx) / 2 + 1}" y="${(ay + by) / 2 - 3}" font-family="Arial,sans-serif" font-size="3" fill="#17252e">${d.metres.toFixed(2)} m</text>`); }
  const bar = 20 * factor;
  parts.push(`<path d="M24 249 H396" stroke="#c8d0d2" stroke-width="0.35"/><text x="24" y="258" font-family="Arial,sans-serif" font-size="3" font-weight="700" fill="#526168">SCALE &amp; SOURCE</text><path d="M24 268 h${bar} M24 266 v4 m${bar} -4 v4" stroke="#17252e" stroke-width="0.5" fill="none"/><text x="24" y="275" font-family="Arial,sans-serif" font-size="3">0</text><text x="${24 + bar}" y="275" font-family="Arial,sans-serif" font-size="3" text-anchor="end">20 m</text><path d="M390 36 v-12 l-2 4 m2 -4 l2 4" stroke="#17252e" fill="none"/><text x="390" y="21" font-family="Arial,sans-serif" font-size="3" text-anchor="middle">GRID N</text><text x="24" y="283" font-family="Arial,sans-serif" font-size="3">${escape(project.sources.map(s => s.attribution).join('; '))}</text><text x="24" y="289" font-family="Arial,sans-serif" font-size="3">Projected-grid concept dimensions. Source quality: ${escape(scenario.bands[0]?.source ?? 'unknown')}. CONCEPT DESIGN — NOT FOR CONSTRUCTION.</text></svg>`);
  return { svg: parts.join(''), widthMm, heightMm, scale };
}

export async function sheetPdf(sheet: Sheet): Promise<Blob> {
  await import('svg2pdf.js');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const doc = new DOMParser().parseFromString(sheet.svg, 'image/svg+xml');
  await pdf.svg(doc.documentElement as unknown as SVGElement, { x: 0, y: 0, width: sheet.widthMm, height: sheet.heightMm });
  return pdf.output('blob');
}

export function derivedGeoJson(project: Project, scenario: Scenario): object {
  const scene: Scene = compileScenario(scenario);
  return { type: 'FeatureCollection', features: [
    ...scene.surfaces.map(surface => ({ type: 'Feature', properties: { id: surface.id, kind: surface.kind, scenarioId: scenario.id, sourceQuality: scenario.bands.find(b => b.id === surface.id)?.source }, geometry: { type: 'Polygon', coordinates: [[...surface.ring, surface.ring[0]].map(point => localToLonLat(project, point))] } })),
    ...scene.markings.map(marking => ({ type: 'Feature', properties: { id: marking.id, kind: 'marking', scenarioId: scenario.id }, geometry: { type: 'Polygon', coordinates: [[...marking.ring, marking.ring[0]].map(point => localToLonLat(project, point))] } })),
    ...scenario.bands.filter(band => band.kind === 'parking' || band.kind === 'cycle' && band.replacesEntityId).map(band => ({ type: 'Feature', properties: { id: band.outerBoundaryId, kind: 'curb', scenarioId: scenario.id }, geometry: { type: 'LineString', coordinates: scene.boundaries[band.outerBoundaryId].map(point => localToLonLat(project, point)) } })),
    ...scene.objects.map(object => ({ type: 'Feature', properties: { id: object.id, kind: object.type, scenarioId: scenario.id }, geometry: { type: 'Point', coordinates: localToLonLat(project, object.point) } })),
    ...scenario.references.map(reference => ({ type: 'Feature', properties: { id: reference.id, kind: 'reference', scenarioId: scenario.id, sourceId: reference.sourceId, sourceQuality: reference.source }, geometry: reference.type === 'Point' ? { type: 'Point', coordinates: localToLonLat(project, reference.coordinates as Point) } : reference.type === 'LineString' ? { type: 'LineString', coordinates: (reference.coordinates as Point[]).map(point => localToLonLat(project, point)) } : { type: 'Polygon', coordinates: (reference.coordinates as Point[][]).map(ring => ring.map(point => localToLonLat(project, point))) } })),
  ] };
}
