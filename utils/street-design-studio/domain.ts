export type Point = [number, number]; // local projected east/north metres
import { compileScenario } from './geometry';
import proj4 from 'proj4';
export type SourceQuality = 'synthetic' | 'imagery-estimated' | 'imported-reference' | 'measured/verified';
export type BandKind = 'travel' | 'parking' | 'cycle' | 'buffer' | 'sidewalk' | 'planting' | 'median';
export interface Band { id: string; side: 'left' | 'right'; kind: BandKind; width: { kind: 'constant'; metres: number }; innerBoundaryId: string; outerBoundaryId: string; replacesEntityId?: string; source: SourceQuality }
export interface AlignmentPoint { id: string; point: Point; radius?: number }
export interface Attached { id: string; type: 'crossing' | 'stop' | 'tree'; station: number; boundaryId?: string; width?: number; source: SourceQuality }
export interface Dimension { id: string; station: number; innerBoundaryId: string; outerBoundaryId: string; offset: number }
export interface Reference { id: string; type: 'Point' | 'LineString' | 'Polygon'; coordinates: Point | Point[] | Point[][]; source: SourceQuality; sourceId: string; confidence: string }
export interface Scenario { id: string; name: string; pinnedBaselineId?: string; alignment: AlignmentPoint[]; bands: Band[]; budgets: { left: number; right: number }; attachments: Attached[]; dimensions: Dimension[]; references: Reference[] }
export interface SourceRecord { id: string; label: string; attribution: string; display: 'allowed' | 'unknown' | 'denied'; trace: 'allowed' | 'unknown' | 'denied'; exportDerived: 'allowed' | 'unknown' | 'denied'; evidence: string }
export interface Project { schemaVersion: 1; id: string; name: string; revision: number; frame: { crs: string; origin: Point; referenceLonLat: Point }; sources: SourceRecord[]; existing: Scenario; baselines: { id: string; capturedAt: string; scenario: Scenario }[]; alternatives: Scenario[] }
export type Command =
  | { type: 'alignment'; scenarioId: string; points: AlignmentPoint[] }
  | { type: 'width'; scenarioId: string; bandId: string; metres: number }
  | { type: 'reallocate'; scenarioId: string; donorId: string; recipientId: string; metres: number }
  | { type: 'resizeEnvelope'; scenarioId: string; totalMetres: number }
  | { type: 'replaceParking'; scenarioId: string; bandId: string }
  | { type: 'addAttachment'; scenarioId: string; attachment: Attached }
  | { type: 'addReference'; scenarioId: string; reference: Reference }
  | { type: 'importReferences'; scenarioId: string; references: Reference[]; source: SourceRecord }
  | { type: 'addDimension'; scenarioId: string; dimension: Dimension };

export const clone = <T,>(value: T): T => structuredClone(value);
export const scenarioFor = (project: Project, id: string): Scenario | undefined => id === 'existing' ? project.existing : project.alternatives.find(item => item.id === id);
export function assertProject(value: unknown): asserts value is Project {
  if (!value || typeof value !== 'object' || (value as Project).schemaVersion !== 1) throw new Error('Unsupported or missing project schema version.');
  const project = value as Project;
  if (!project.id || !project.frame?.crs || !Array.isArray(project.existing?.bands) || !Array.isArray(project.alternatives) || !Array.isArray(project.baselines)) throw new Error('Malformed project document.');
  if (JSON.stringify(value).length > 10_000_000) throw new Error('Project exceeds 10 MB limit.');
  for (const scenario of [project.existing, ...project.alternatives, ...project.baselines.map(b => b.scenario)]) { validateScenario(scenario); compileScenario(scenario); }
}

export function createSyntheticProject(): Project {
  const makeBands = (side: 'left' | 'right'): Band[] => {
    const widths: [BandKind, number][] = [['travel', 3.2], ['parking', 2.4], ['planting', 1], ['sidewalk', 2]];
    return widths.map(([kind, metres], index) => ({ id: `${side}-${kind}`, side, kind, width: { kind: 'constant', metres }, innerBoundaryId: `${side}-b${index}`, outerBoundaryId: `${side}-b${index + 1}`, source: 'synthetic' }));
  };
  const existing: Scenario = { id: 'existing', name: 'Existing draft', alignment: [{ id: 'a', point: [0, 0] }, { id: 'b', point: [160, 0] }], bands: [...makeBands('left'), ...makeBands('right')], budgets: { left: 8.6, right: 8.6 }, attachments: [{ id: 'crossing-1', type: 'crossing', station: 80, width: 3, source: 'synthetic' }, { id: 'stop-1', type: 'stop', station: 110, boundaryId: 'left-b2', source: 'synthetic' }, { id: 'tree-1', type: 'tree', station: 40, boundaryId: 'left-b3', source: 'synthetic' }], dimensions: [{ id: 'dimension-1', station: 25, innerBoundaryId: 'left-b1', outerBoundaryId: 'left-b2', offset: 2 }], references: [] };
  return { schemaVersion: 1, id: 'synthetic-street', name: 'Fictional 160 m corridor', revision: 0, frame: { crs: '+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs', origin: [604000, 4910000], referenceLonLat: [-79.69, 44.39] }, sources: [{ id: 'synthetic', label: 'Synthetic example', attribution: 'Synthetic example — not actual site conditions', display: 'allowed', trace: 'allowed', exportDerived: 'allowed', evidence: 'Application-created demonstration fixture' }], existing, baselines: [], alternatives: [] };
}

export function createProjectAtLocation(name: string, lon: number, lat: number, id: string): Project {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -80 || lat > 84 || !name.trim() || name.length > 120) throw new Error('Enter a name and supported longitude/latitude.');
  const zone = Math.floor((lon + 180) / 6) + 1;
  const crs = `+proj=utm +zone=${zone} ${lat < 0 ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
  const origin = proj4('EPSG:4326', crs, [lon, lat]) as Point;
  const project = createSyntheticProject();
  project.id = id; project.name = name.trim(); project.frame = { crs, origin, referenceLonLat: [lon, lat] };
  project.existing.alignment = [{ id: 'start', point: [0, 0] }, { id: 'end', point: [40, 0] }];
  project.existing.attachments = []; project.existing.dimensions = []; project.sources = [{ id: 'planner-assumption', label: 'Planner-entered concept', attribution: 'Planner-entered concept; source and accuracy unverified', display: 'allowed', trace: 'allowed', exportDerived: 'allowed', evidence: 'User-created design, not surveyed conditions' }];
  project.existing.bands.forEach(band => { band.source = 'synthetic'; });
  return project;
}

export function validateScenario(s: Scenario): void {
  if (!s || !Array.isArray(s.alignment) || s.alignment.length < 2 || s.alignment.length > 20) throw new Error('Alignment needs 2–20 control points.');
  for (const p of s.alignment) if (!p.id || p.point.length !== 2 || !p.point.every(Number.isFinite) || (p.radius !== undefined && (!Number.isFinite(p.radius) || p.radius <= 0))) throw new Error('Invalid alignment point or radius.');
  for (let i = 1; i < s.alignment.length; i++) if (Math.hypot(s.alignment[i].point[0] - s.alignment[i - 1].point[0], s.alignment[i].point[1] - s.alignment[i - 1].point[1]) < 0.01) throw new Error('Duplicate alignment points.');
  const distance = s.alignment.slice(1).reduce((total, p, i) => total + Math.hypot(p.point[0] - s.alignment[i].point[0], p.point[1] - s.alignment[i].point[1]), 0);
  if (distance > 2000) throw new Error('Corridor exceeds the 2 km limit.');
  const ids = new Set<string>();
  for (const side of ['left', 'right'] as const) {
    const bands = s.bands.filter(b => b.side === side);
    if (!bands.length || bands.length > 16) throw new Error(`${side} side needs 1–16 bands.`);
    let sum = 0;
    bands.forEach((b, i) => { if (ids.has(b.id)) throw new Error('Duplicate band ID.'); ids.add(b.id); if (!Number.isFinite(b.width.metres) || b.width.metres <= 0.1) throw new Error('Band width must be greater than 0.10 m.'); if (i && b.innerBoundaryId !== bands[i - 1].outerBoundaryId) throw new Error('Bands must share boundaries.'); sum += b.width.metres; });
    if (Math.abs(sum - s.budgets[side]) > 1e-6) throw new Error(`${side} width budget conflict: allocate a donor or explicitly change the envelope.`);
  }
  const boundaryIds = new Set(s.bands.flatMap(b => [b.innerBoundaryId, b.outerBoundaryId]));
  for (const a of s.attachments) if (!Number.isFinite(a.station) || a.station < 0 || a.station > distance + 0.001 || (a.boundaryId && !boundaryIds.has(a.boundaryId))) throw new Error(`Attachment ${a.id} would be orphaned or out of range.`);
  for (const d of s.dimensions) if (!boundaryIds.has(d.innerBoundaryId) || !boundaryIds.has(d.outerBoundaryId) || !Number.isFinite(d.station) || d.station < 0 || d.station > distance) throw new Error(`Dimension ${d.id} has an invalid anchor.`);
  if (!Array.isArray(s.references) || s.references.length > 5000) throw new Error('Reference feature limit exceeded.');
  const checkPoint = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 5000);
  for (const ref of s.references) {
    if (!ref.id || !ref.sourceId || !['Point', 'LineString', 'Polygon'].includes(ref.type)) throw new Error('Malformed reference feature.');
    if (ref.type === 'Point' && !checkPoint(ref.coordinates)) throw new Error('Invalid reference point.');
    if (ref.type === 'LineString' && (!Array.isArray(ref.coordinates) || ref.coordinates.length < 2 || !ref.coordinates.every(checkPoint))) throw new Error('Invalid reference line.');
    if (ref.type === 'Polygon' && (!Array.isArray(ref.coordinates) || ref.coordinates.length < 1 || !ref.coordinates.every(ring => Array.isArray(ring) && ring.length >= 4 && ring.every(checkPoint) && JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1))))) throw new Error('Invalid reference polygon.');
  }
}

export function executeCommand(project: Project, command: Command): Project {
  if (!scenarioFor(project, command.scenarioId)) throw new Error('Scenario does not exist.');
  const next = clone(project);
  const s = scenarioFor(next, command.scenarioId)!;
  switch (command.type) {
    case 'alignment': s.alignment = clone(command.points); break;
    case 'width': { const band = s.bands.find(b => b.id === command.bandId); if (!band) throw new Error('Band not found.'); band.width.metres = command.metres; break; }
    case 'reallocate': { const donor = s.bands.find(b => b.id === command.donorId); const recipient = s.bands.find(b => b.id === command.recipientId); if (!donor || !recipient || donor.side !== recipient.side) throw new Error('Choose bands on the same side.'); donor.width.metres -= command.metres; recipient.width.metres += command.metres; break; }
    case 'resizeEnvelope': { if (!Number.isFinite(command.totalMetres) || command.totalMetres < 3 || command.totalMetres > 60) throw new Error('Enter a concept envelope width between 3 and 60 m.'); const current = s.budgets.left + s.budgets.right; const factor = command.totalMetres / current; for (const band of s.bands) band.width.metres *= factor; s.budgets.left *= factor; s.budgets.right *= factor; break; }
    case 'replaceParking': { const index = s.bands.findIndex(b => b.id === command.bandId && b.kind === 'parking'); if (index < 0) throw new Error('Choose a parking band.'); const old = s.bands[index]; s.bands.splice(index, 1, { ...old, id: `${old.id}-buffer`, kind: 'buffer', width: { kind: 'constant', metres: 0.6 }, outerBoundaryId: `${old.id}-split`, replacesEntityId: old.id }, { ...old, id: `${old.id}-cycle`, kind: 'cycle', width: { kind: 'constant', metres: old.width.metres - 0.6 }, innerBoundaryId: `${old.id}-split`, replacesEntityId: old.id }); break; }
    case 'addAttachment': s.attachments.push(clone(command.attachment)); break;
    case 'addReference': s.references.push(clone(command.reference)); break;
    case 'importReferences': s.references.push(...clone(command.references)); next.sources.push(clone(command.source)); break;
    case 'addDimension': s.dimensions.push(clone(command.dimension)); break;
  }
  validateScenario(s);
  compileScenario(s);
  next.revision++;
  return next;
}

export function freezeBaseline(project: Project, id: string, capturedAt: string): Project {
  const next = clone(project); next.baselines.push({ id, capturedAt, scenario: clone(next.existing) }); next.revision++; return next;
}
export function createAlternative(project: Project, id: string): Project {
  const baseline = project.baselines.at(-1); if (!baseline) throw new Error('Freeze existing conditions first.');
  const next = clone(project); next.alternatives.push({ ...clone(baseline.scenario), id, name: `Alternative ${next.alternatives.length + 1}`, pinnedBaselineId: baseline.id }); next.revision++; return next;
}
