import { createRouteConceptId } from './routeConceptPlannerProjectFactory';
import type {
    ConceptStop,
    RouteConceptPattern,
    RouteConceptPoint,
    RouteConceptSegmentRuntimeEvidence,
} from './routeConceptPlannerTypes';

function segmentKey(fromStopId: string, toStopId: string): string {
    return `${fromStopId}->${toStopId}`;
}

function sortedStops(stops: ConceptStop[]): ConceptStop[] {
    return [...stops].sort((a, b) => a.sequence - b.sequence);
}

function traversalSegmentKeys(pattern: Pick<RouteConceptPattern, 'role' | 'stops'>): Set<string> {
    const stops = sortedStops(pattern.stops);
    if (stops.length < 2) return new Set();
    const keys = stops.slice(0, -1).map((stop, index) => segmentKey(stop.id, stops[index + 1]!.id));
    if (pattern.role === 'loop') keys.push(segmentKey(stops.at(-1)!.id, stops[0]!.id));
    if (pattern.role === 'out-and-back') {
        keys.push(...stops.slice(1).reverse().map((stop, index, reverseStops) => {
            const next = reverseStops[index + 1] ?? stops[0]!;
            return segmentKey(stop.id, next.id);
        }));
    }
    return new Set(keys);
}

function normalizeTerminalRoles(pattern: RouteConceptPattern, stops: ConceptStop[]): ConceptStop[] {
    const ordered = stops.map((stop, index) => ({ ...stop, sequence: index + 1 }));
    if (ordered.length === 0) return ordered;
    return ordered.map((stop, index) => {
        if (index === 0) return { ...stop, role: 'start-terminal' as const };
        if (pattern.role === 'out-and-back' && index === ordered.length - 1) return { ...stop, role: 'turnaround' as const };
        if ((pattern.role === 'outbound' || pattern.role === 'inbound') && index === ordered.length - 1) {
            return { ...stop, role: 'end-terminal' as const };
        }
        if (stop.role === 'start-terminal' || stop.role === 'end-terminal' || stop.role === 'turnaround') {
            return { ...stop, role: 'regular' as const };
        }
        return stop;
    });
}

function changedKeys(before: Set<string>, after: Set<string>): Set<string> {
    const changed = new Set<string>();
    for (const key of before) if (!after.has(key)) changed.add(key);
    for (const key of after) if (!before.has(key)) changed.add(key);
    return changed;
}

function invalidateSegments(pattern: RouteConceptPattern, keys: Set<string>, now: string): RouteConceptPattern {
    if (keys.size === 0) return { ...pattern, updatedAt: now };
    return {
        ...pattern,
        segmentFingerprints: pattern.segmentFingerprints
            ? Object.fromEntries(Object.entries(pattern.segmentFingerprints).filter(([key]) => !keys.has(key)))
            : undefined,
        runtimeEvidence: pattern.runtimeEvidence.filter((item) => !keys.has(segmentKey(item.fromStopId, item.toStopId))),
        runtimeOverrides: Object.fromEntries(Object.entries(pattern.runtimeOverrides).map(([key, override]) => [
            key,
            keys.has(key) ? { ...override, confirmed: false, updatedAt: now } : override,
        ])),
        updatedAt: now,
    };
}

function updateStops(
    pattern: RouteConceptPattern,
    stops: ConceptStop[],
    now: string,
    additionallyAffected: Set<string> = new Set(),
): RouteConceptPattern {
    const before = traversalSegmentKeys(pattern);
    const nextPattern = { ...pattern, stops: normalizeTerminalRoles(pattern, stops), updatedAt: now };
    const affected = changedKeys(before, traversalSegmentKeys(nextPattern));
    for (const key of additionallyAffected) affected.add(key);
    return invalidateSegments(nextPattern, affected, now);
}

export function addRouteConceptStop(
    pattern: RouteConceptPattern,
    input: Omit<ConceptStop, 'id' | 'sequence' | 'role' | 'source'> & Partial<Pick<ConceptStop, 'id' | 'role' | 'source'>>,
    options: { index?: number; now?: string } = {},
): RouteConceptPattern {
    const now = options.now ?? new Date().toISOString();
    const stops = sortedStops(pattern.stops);
    const index = Math.max(0, Math.min(options.index ?? stops.length, stops.length));
    stops.splice(index, 0, {
        ...input,
        id: input.id ?? createRouteConceptId('stop'),
        sequence: index + 1,
        role: input.role ?? 'regular',
        source: input.source ?? 'custom',
    });
    return updateStops(pattern, stops, now);
}

export function moveRouteConceptStop(
    pattern: RouteConceptPattern,
    stopId: string,
    coordinate: { lat: number; lng: number },
    now = new Date().toISOString(),
): RouteConceptPattern {
    if (!pattern.stops.some((stop) => stop.id === stopId)) return pattern;
    const adjacent = new Set<string>();
    for (const key of traversalSegmentKeys(pattern)) {
        const [from, to] = key.split('->');
        if (from === stopId || to === stopId) adjacent.add(key);
    }
    const stops = pattern.stops.map((stop) => stop.id === stopId ? { ...stop, ...coordinate } : stop);
    return updateStops(pattern, stops, now, adjacent);
}

export function reorderRouteConceptStop(
    pattern: RouteConceptPattern,
    stopId: string,
    targetIndex: number,
    now = new Date().toISOString(),
): RouteConceptPattern {
    const stops = sortedStops(pattern.stops);
    const sourceIndex = stops.findIndex((stop) => stop.id === stopId);
    if (sourceIndex < 0) return pattern;
    const [moved] = stops.splice(sourceIndex, 1);
    stops.splice(Math.max(0, Math.min(targetIndex, stops.length)), 0, moved!);
    return updateStops(pattern, stops, now);
}

export function deleteRouteConceptStop(pattern: RouteConceptPattern, stopId: string, now = new Date().toISOString()): RouteConceptPattern {
    if (!pattern.stops.some((stop) => stop.id === stopId)) return pattern;
    return updateStops(pattern, pattern.stops.filter((stop) => stop.id !== stopId), now);
}

function alignmentSegmentKey(point: Pick<RouteConceptPoint, 'afterStopId' | 'beforeStopId'>): string | null {
    return point.afterStopId && point.beforeStopId ? segmentKey(point.afterStopId, point.beforeStopId) : null;
}

export function addRouteConceptAlignmentPoint(
    pattern: RouteConceptPattern,
    input: Omit<RouteConceptPoint, 'id' | 'sequence'> & Partial<Pick<RouteConceptPoint, 'id'>>,
    now = new Date().toISOString(),
): RouteConceptPattern {
    const point: RouteConceptPoint = { ...input, id: input.id ?? createRouteConceptId('point'), sequence: pattern.alignment.length + 1 };
    const next = { ...pattern, alignment: [...pattern.alignment, point], updatedAt: now };
    const key = alignmentSegmentKey(point);
    return key ? invalidateSegments(next, new Set([key]), now) : next;
}

export function moveRouteConceptAlignmentPoint(
    pattern: RouteConceptPattern,
    pointId: string,
    coordinate: { lat: number; lng: number },
    now = new Date().toISOString(),
): RouteConceptPattern {
    const point = pattern.alignment.find((item) => item.id === pointId);
    if (!point) return pattern;
    const next = { ...pattern, alignment: pattern.alignment.map((item) => item.id === pointId ? { ...item, ...coordinate } : item), updatedAt: now };
    const key = alignmentSegmentKey(point);
    return key ? invalidateSegments(next, new Set([key]), now) : next;
}

export function deleteRouteConceptAlignmentPoint(pattern: RouteConceptPattern, pointId: string, now = new Date().toISOString()): RouteConceptPattern {
    const point = pattern.alignment.find((item) => item.id === pointId);
    if (!point) return pattern;
    const alignment = pattern.alignment.filter((item) => item.id !== pointId).map((item, index) => ({ ...item, sequence: index + 1 }));
    const next = { ...pattern, alignment, updatedAt: now };
    const key = alignmentSegmentKey(point);
    return key ? invalidateSegments(next, new Set([key]), now) : next;
}

export function setRouteConceptRuntimeOverride(
    pattern: RouteConceptPattern,
    segmentId: string,
    runtimeMinutes: number,
    options: { notes?: string; confirmed?: boolean; now?: string } = {},
): RouteConceptPattern {
    const now = options.now ?? new Date().toISOString();
    return {
        ...pattern,
        runtimeOverrides: {
            ...pattern.runtimeOverrides,
            [segmentId]: {
                runtimeMinutes,
                confirmed: options.confirmed ?? true,
                pathFingerprint: pattern.segmentFingerprints?.[segmentId],
                notes: options.notes,
                updatedAt: now,
            },
        },
        updatedAt: now,
    };
}

export function clearRouteConceptRuntimeOverride(pattern: RouteConceptPattern, segmentId: string, now = new Date().toISOString()): RouteConceptPattern {
    if (!(segmentId in pattern.runtimeOverrides)) return pattern;
    const runtimeOverrides = { ...pattern.runtimeOverrides };
    delete runtimeOverrides[segmentId];
    return { ...pattern, runtimeOverrides, updatedAt: now };
}

export function mergeRouteConceptRuntimeEvidence(
    pattern: RouteConceptPattern,
    evidence: RouteConceptSegmentRuntimeEvidence[],
    now = new Date().toISOString(),
): RouteConceptPattern {
    const incomingIds = new Set(evidence.map((item) => item.id));
    const nextFingerprints = { ...(pattern.segmentFingerprints ?? {}) };
    evidence.forEach((item) => {
        const key = segmentKey(item.fromStopId, item.toStopId);
        if (item.pathFingerprint) nextFingerprints[key] = item.pathFingerprint;
    });
    return {
        ...pattern,
        segmentFingerprints: Object.keys(nextFingerprints).length > 0 ? nextFingerprints : undefined,
        runtimeEvidence: [...pattern.runtimeEvidence.filter((item) => !incomingIds.has(item.id)), ...evidence],
        updatedAt: now,
    };
}
