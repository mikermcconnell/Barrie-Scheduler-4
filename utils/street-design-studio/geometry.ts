import proj4 from 'proj4';
import type { Point, Project, Scenario, Band } from './domain';

export interface Sample { station: number; point: Point; tangent: Point; normal: Point }
export interface Surface { id: string; kind: Band['kind']; side: Band['side']; ring: Point[] }
export interface Scene { samples: Sample[]; length: number; boundaries: Record<string, Point[]>; surfaces: Surface[]; envelope: Point[]; objects: { id: string; type: 'crossing' | 'stop' | 'tree'; point: Point; ring?: Point[] }[]; markings: { id: string; ring: Point[] }[]; dimensions: { id: string; a: Point; b: Point; metres: number }[] }
const add = (a: Point, b: Point, scale = 1): Point => [a[0] + b[0] * scale, a[1] + b[1] * scale];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const length = (p: Point) => Math.hypot(...p);
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const normal = (t: Point): Point => [-t[1], t[0]];
const segmentHit = (a: Point, b: Point, c: Point, d: Point): boolean => { const ab = sub(b, a); const cd = sub(d, c); const den = cross(ab, cd); if (Math.abs(den) < 1e-9) return false; const t = cross(sub(c, a), cd) / den; const u = cross(sub(c, a), ab) / den; return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6; };

export function evaluateAlignment(s: Scenario): Sample[] {
  const controls = s.alignment;
  const samples: Sample[] = [];
  let station = 0;
  const push = (point: Point, tangent: Point) => { const previous = samples.at(-1); if (previous) station += length(sub(point, previous.point)); samples.push({ point, tangent, normal: normal(tangent), station }); };
  for (let i = 0; i < controls.length - 1; i++) {
    const start = controls[i].point, end = controls[i + 1].point;
    const vector = sub(end, start), segmentLength = length(vector), tangent: Point = [vector[0] / segmentLength, vector[1] / segmentLength];
    if (i === 0) push(start, tangent);
    const corner = controls[i + 1];
    if (corner.radius && i + 2 < controls.length) {
      const next = sub(controls[i + 2].point, end), nextLength = length(next), nextTangent: Point = [next[0] / nextLength, next[1] / nextLength];
      const turn = Math.atan2(cross(tangent, nextTangent), tangent[0] * nextTangent[0] + tangent[1] * nextTangent[1]);
      if (Math.abs(turn) < 0.01 || Math.abs(turn) > 2.2) throw new Error('Fillet requires a gentle non-straight corner.');
      if (corner.radius <= (turn > 0 ? s.budgets.left : s.budgets.right) + 0.01) throw new Error('Inside street offset reaches the curve centre; increase radius.');
      const inset = corner.radius * Math.tan(Math.abs(turn) / 2);
      if (inset >= segmentLength / 2 || inset >= nextLength / 2) throw new Error('Fillet radius does not fit adjacent segments.');
      const entry = add(end, tangent, -inset), exit = add(end, nextTangent, inset);
      push(entry, tangent);
      const sign = Math.sign(turn), center = add(entry, normal(tangent), sign * corner.radius);
      const startAngle = Math.atan2(entry[1] - center[1], entry[0] - center[0]);
      const maxRadius = corner.radius + Math.max(s.budgets.left, s.budgets.right);
      const maxStep = 2 * Math.acos(Math.max(-1, 1 - 0.01 / maxRadius));
      const count = Math.ceil(Math.abs(turn) / maxStep);
      for (let j = 1; j <= count; j++) { const angle = startAngle + turn * j / count; const point: Point = j === count ? exit : add(center, [Math.cos(angle), Math.sin(angle)], corner.radius); const t: Point = [-Math.sin(angle) * sign, Math.cos(angle) * sign]; push(point, t); }
    } else if (i === controls.length - 2 || !controls[i + 1].radius) push(end, tangent);
  }
  for (let i = 0; i < samples.length - 1; i++) for (let j = i + 2; j < samples.length - 1; j++) if (segmentHit(samples[i].point, samples[i + 1].point, samples[j].point, samples[j + 1].point)) throw new Error('Alignment self-crosses.');
  return samples;
}

export function atStation(samples: Sample[], station: number): Sample {
  if (station < 0 || station > samples.at(-1)!.station + 0.001) throw new Error('Station is outside alignment.');
  const index = Math.max(0, samples.findIndex(s => s.station >= station));
  if (index === 0) return samples[0];
  const a = samples[index - 1], b = samples[index]; const ratio = (station - a.station) / (b.station - a.station);
  const point = add(a.point, sub(b.point, a.point), ratio); const direction = sub(b.point, a.point); const size = length(direction); const tangent: Point = [direction[0] / size, direction[1] / size];
  return { point, tangent, normal: normal(tangent), station };
}

export function compileScenario(s: Scenario): Scene {
  const samples = evaluateAlignment(s); const boundaries: Record<string, Point[]> = {}; const surfaces: Surface[] = [];
  const maxOffset = Math.max(s.budgets.left, s.budgets.right);
  for (let i = 1; i < samples.length - 1; i++) { const prev = samples[i - 1].tangent, next = samples[i + 1].tangent; const angle = Math.abs(Math.atan2(cross(prev, next), prev[0] * next[0] + prev[1] * next[1])); if (angle > 0.5 && samples[i].station - samples[i - 1].station < maxOffset * 0.3) throw new Error('Offset too tight for the street envelope.'); }
  for (const side of ['left', 'right'] as const) {
    const bands = s.bands.filter(b => b.side === side), sign = side === 'left' ? 1 : -1;
    let offset = 0;
    for (const band of bands) {
      if (!boundaries[band.innerBoundaryId]) boundaries[band.innerBoundaryId] = samples.map(sample => add(sample.point, sample.normal, sign * offset));
      offset += band.width.metres;
      if (!boundaries[band.outerBoundaryId]) boundaries[band.outerBoundaryId] = samples.map(sample => add(sample.point, sample.normal, sign * offset));
      const inner = boundaries[band.innerBoundaryId], outer = boundaries[band.outerBoundaryId];
      surfaces.push({ id: band.id, kind: band.kind, side, ring: [...inner, ...[...outer].reverse()] });
    }
  }
  const left = boundaries[s.bands.filter(b => b.side === 'left').at(-1)!.outerBoundaryId];
  const right = boundaries[s.bands.filter(b => b.side === 'right').at(-1)!.outerBoundaryId];
  const objects = s.attachments.map(a => { const sample = atStation(samples, a.station); const boundaryOffset = a.boundaryId ? boundaryOffsetFor(s, a.boundaryId) : 0; const point = add(sample.point, sample.normal, boundaryOffset); const width = a.width ?? 3; return { id: a.id, type: a.type, point, ring: a.type === 'crossing' ? [add(add(sample.point, sample.tangent, -width / 2), sample.normal, -s.budgets.right), add(add(sample.point, sample.tangent, width / 2), sample.normal, -s.budgets.right), add(add(sample.point, sample.tangent, width / 2), sample.normal, s.budgets.left), add(add(sample.point, sample.tangent, -width / 2), sample.normal, s.budgets.left)] as Point[] : undefined }; });
  const markings: Scene['markings'] = [];
  for (const a of s.attachments.filter(item => item.type === 'crossing')) { const sample = atStation(samples, a.station); const width = a.width ?? 3; for (let offset = -s.budgets.right + 0.35, i = 0; offset + 0.45 < s.budgets.left - 0.35; offset += 0.9, i++) { const base = add(sample.point, sample.normal, offset); markings.push({ id: `${a.id}-stripe-${i}`, ring: [add(base, sample.tangent, -width / 2), add(base, sample.tangent, width / 2), add(add(base, sample.tangent, width / 2), sample.normal, 0.45), add(add(base, sample.tangent, -width / 2), sample.normal, 0.45)] }); } }
  const dimensions = s.dimensions.map(d => { const sample = atStation(samples, d.station); const a = add(sample.point, sample.normal, boundaryOffsetFor(s, d.innerBoundaryId)); const b = add(sample.point, sample.normal, boundaryOffsetFor(s, d.outerBoundaryId)); return { id: d.id, a, b, metres: length(sub(b, a)) }; });
  return { samples, length: samples.at(-1)!.station, boundaries, surfaces, envelope: [...left, ...[...right].reverse()], objects, markings, dimensions };
}

export function boundaryOffsetFor(s: Scenario, id: string): number { for (const side of ['left', 'right'] as const) { let offset = 0; for (const b of s.bands.filter(b => b.side === side)) { if (b.innerBoundaryId === id) return offset * (side === 'left' ? 1 : -1); offset += b.width.metres; if (b.outerBoundaryId === id) return offset * (side === 'left' ? 1 : -1); } } throw new Error(`Boundary ${id} not found.`); }
export function localToLonLat(project: Project, point: Point): Point { return proj4(project.frame.crs, 'EPSG:4326', add(project.frame.origin, point)) as Point; }
export function lonLatToLocal(project: Project, point: Point): Point { return sub(proj4('EPSG:4326', project.frame.crs, point) as Point, project.frame.origin); }
