import { createRouteConceptAlternative, createRouteConceptId } from './routeConceptPlannerProjectFactory';
import type {
    ConceptStop,
    RouteConceptAlternative,
    RouteConceptPattern,
    RouteConceptProject,
    RouteConceptServiceAssumptions,
    RouteConceptStructure,
} from './routeConceptPlannerTypes';

function markChanged(project: RouteConceptProject, now: string): RouteConceptProject {
    return { ...project, status: 'local-draft', updatedAt: now };
}

function copyName(name: string): string {
    return name.endsWith(' Copy') ? `${name} 2` : `${name} Copy`;
}

function clonePattern(pattern: RouteConceptPattern, now: string): RouteConceptPattern {
    const stopIds = new Map(pattern.stops.map((stop) => [stop.id, createRouteConceptId('stop')]));
    const remapStop = (id: string): string => stopIds.get(id) ?? id;
    const remapSegmentKey = (key: string): string => {
        const separator = key.indexOf('->');
        if (separator < 0) return key;
        return `${remapStop(key.slice(0, separator))}->${remapStop(key.slice(separator + 2))}`;
    };
    return {
        ...pattern,
        id: createRouteConceptId('pattern'),
        alignment: pattern.alignment.map((point) => ({
            ...point,
            id: createRouteConceptId('point'),
            afterStopId: point.afterStopId ? remapStop(point.afterStopId) : undefined,
            beforeStopId: point.beforeStopId ? remapStop(point.beforeStopId) : undefined,
        })),
        stops: pattern.stops.map((stop) => ({ ...stop, id: remapStop(stop.id) })),
        segmentFingerprints: pattern.segmentFingerprints
            ? Object.fromEntries(Object.entries(pattern.segmentFingerprints).map(([key, value]) => [remapSegmentKey(key), value]))
            : undefined,
        runtimeEvidence: pattern.runtimeEvidence.map((evidence) => ({
            ...evidence,
            id: createRouteConceptId('runtime'),
            fromStopId: remapStop(evidence.fromStopId),
            toStopId: remapStop(evidence.toStopId),
        })),
        runtimeOverrides: Object.fromEntries(
            Object.entries(pattern.runtimeOverrides).map(([key, value]) => [remapSegmentKey(key), { ...value, updatedAt: now }]),
        ),
        createdAt: now,
        updatedAt: now,
    };
}

export function renameRouteConceptProject(project: RouteConceptProject, name: string, now = new Date().toISOString()): RouteConceptProject {
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) return project;
    return markChanged({ ...project, name: trimmed }, now);
}

export function addRouteConceptAlternative(
    project: RouteConceptProject,
    options: { id?: string; name?: string; structure?: RouteConceptStructure; now?: string } = {},
): RouteConceptProject {
    const now = options.now ?? new Date().toISOString();
    const alternative = createRouteConceptAlternative({
        id: options.id,
        name: options.name ?? `Option ${project.alternatives.length + 1}`,
        structure: options.structure,
        now,
    });
    return markChanged({
        ...project,
        selectedAlternativeId: alternative.id,
        alternativeOrder: [...project.alternativeOrder, alternative.id],
        alternatives: [...project.alternatives, alternative],
    }, now);
}

export function duplicateRouteConceptAlternative(
    project: RouteConceptProject,
    alternativeId: string,
    options: { id?: string; now?: string } = {},
): RouteConceptProject {
    const source = project.alternatives.find((alternative) => alternative.id === alternativeId);
    if (!source) return project;
    const now = options.now ?? new Date().toISOString();
    const patterns = source.patterns.map((pattern) => clonePattern(pattern, now));
    const copy: RouteConceptAlternative = {
        ...source,
        id: options.id ?? createRouteConceptId('alternative'),
        name: copyName(source.name),
        status: 'draft',
        patternOrder: patterns.map((pattern) => pattern.id),
        patterns,
        service: { ...source.service },
        createdAt: now,
        updatedAt: now,
    };
    return markChanged({
        ...project,
        selectedAlternativeId: copy.id,
        alternativeOrder: [...project.alternativeOrder, copy.id],
        alternatives: [...project.alternatives, copy],
    }, now);
}

export function deleteRouteConceptAlternative(project: RouteConceptProject, alternativeId: string, now = new Date().toISOString()): RouteConceptProject {
    if (project.alternatives.length <= 1 || !project.alternatives.some((alternative) => alternative.id === alternativeId)) return project;
    const alternatives = project.alternatives.filter((alternative) => alternative.id !== alternativeId);
    const alternativeOrder = project.alternativeOrder.filter((id) => id !== alternativeId);
    return markChanged({
        ...project,
        alternatives,
        alternativeOrder,
        selectedAlternativeId: project.selectedAlternativeId === alternativeId ? alternativeOrder[0]! : project.selectedAlternativeId,
        preferredAlternativeId: project.preferredAlternativeId === alternativeId ? undefined : project.preferredAlternativeId,
    }, now);
}

export function selectRouteConceptAlternative(project: RouteConceptProject, alternativeId: string, now = new Date().toISOString()): RouteConceptProject {
    if (project.selectedAlternativeId === alternativeId || !project.alternatives.some((alternative) => alternative.id === alternativeId)) return project;
    return markChanged({ ...project, selectedAlternativeId: alternativeId }, now);
}

export function markRouteConceptPreferred(project: RouteConceptProject, alternativeId: string | undefined, now = new Date().toISOString()): RouteConceptProject {
    if (alternativeId != null && !project.alternatives.some((alternative) => alternative.id === alternativeId)) return project;
    if (project.preferredAlternativeId === alternativeId) return project;
    return markChanged({ ...project, preferredAlternativeId: alternativeId }, now);
}

export function updateRouteConceptService(
    project: RouteConceptProject,
    alternativeId: string,
    patch: Partial<RouteConceptServiceAssumptions>,
    now = new Date().toISOString(),
): RouteConceptProject {
    let changed = false;
    const alternatives = project.alternatives.map((alternative) => {
        if (alternative.id !== alternativeId) return alternative;
        changed = true;
        return { ...alternative, status: 'draft' as const, service: { ...alternative.service, ...patch }, updatedAt: now };
    });
    return changed ? markChanged({ ...project, alternatives }, now) : project;
}

export function replaceRouteConceptPattern(
    project: RouteConceptProject,
    alternativeId: string,
    pattern: RouteConceptPattern,
    now = new Date().toISOString(),
): RouteConceptProject {
    let changed = false;
    const alternatives = project.alternatives.map((alternative) => {
        if (alternative.id !== alternativeId || !alternative.patterns.some((item) => item.id === pattern.id)) return alternative;
        changed = true;
        return {
            ...alternative,
            status: 'draft' as const,
            patterns: alternative.patterns.map((item) => item.id === pattern.id ? { ...pattern, updatedAt: now } : item),
            updatedAt: now,
        };
    });
    return changed ? markChanged({ ...project, alternatives }, now) : project;
}

export function replaceRouteConceptStops(
    project: RouteConceptProject,
    alternativeId: string,
    patternId: string,
    stops: ConceptStop[],
    now = new Date().toISOString(),
): RouteConceptProject {
    const alternative = project.alternatives.find((item) => item.id === alternativeId);
    const pattern = alternative?.patterns.find((item) => item.id === patternId);
    if (!pattern) return project;
    return replaceRouteConceptPattern(project, alternativeId, { ...pattern, stops }, now);
}

/** Creates a neutral editable return from one imported outbound pattern. Runtime evidence is intentionally cleared. */
export function createRouteConceptReversedReturn(
    project: RouteConceptProject,
    alternativeId: string,
    sourcePatternId: string,
    now = new Date().toISOString(),
): RouteConceptProject {
    const alternative = project.alternatives.find((item) => item.id === alternativeId);
    const source = alternative?.patterns.find((item) => item.id === sourcePatternId);
    if (!alternative || alternative.structure !== 'bidirectional' || !source || source.role !== 'outbound') return project;
    if (alternative.patterns.some((item) => item.role === 'inbound')) return project;

    const stopIds = new Map(source.stops.map((stop) => [stop.id, createRouteConceptId('stop')]));
    const remap = (id: string | undefined): string | undefined => id ? (stopIds.get(id) ?? id) : undefined;
    const sourceStops = [...source.stops].sort((left, right) => left.sequence - right.sequence);
    const returnPattern: RouteConceptPattern = {
        ...source,
        id: createRouteConceptId('pattern'),
        name: 'Return',
        role: 'inbound',
        stops: [...sourceStops].reverse().map((stop, index, reversed) => ({
            ...stop,
            id: stopIds.get(stop.id)!,
            sequence: index + 1,
            role: index === 0 ? 'start-terminal' : index === reversed.length - 1 ? 'end-terminal' : 'regular',
            source: 'custom',
        })),
        alignment: [...source.alignment].reverse().map((point, index) => ({
            ...point,
            id: createRouteConceptId('point'),
            sequence: index + 1,
            afterStopId: remap(point.beforeStopId),
            beforeStopId: remap(point.afterStopId),
        })),
        segmentFingerprints: undefined,
        runtimeEvidence: [],
        runtimeOverrides: {},
        source: { type: 'blank' },
        notes: 'Editable return created from the outbound alignment. Automatic outbound runtime evidence was not copied.',
        createdAt: now,
        updatedAt: now,
    };
    const alternatives = project.alternatives.map((item) => item.id === alternativeId ? {
        ...item,
        status: 'draft' as const,
        patternOrder: [...item.patternOrder, returnPattern.id],
        patterns: [...item.patterns, returnPattern],
        updatedAt: now,
    } : item);
    return markChanged({ ...project, alternatives }, now);
}
