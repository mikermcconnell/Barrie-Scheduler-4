import { createRoutePlanner2Scenario } from './routePlanner2ProjectFactory';
import type { RoutePlanner2Project, RoutePlanner2RoutePoint, RoutePlanner2Scenario, RoutePlanner2Stop } from './routePlanner2Types';

function markChanged(project: RoutePlanner2Project, now: string): RoutePlanner2Project {
    return {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-draft',
        updatedAt: now,
    };
}

function scenarioExists(project: RoutePlanner2Project, scenarioId: string): boolean {
    return project.scenarios.some((scenario) => scenario.id === scenarioId);
}

function createEntityId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createScenarioId(): string {
    return createEntityId('scenario');
}

function createCopyName(name: string): string {
    const trimmedName = name.trim();
    return `${trimmedName || 'Untitled'} copy`;
}

function baseDirectionName(name: string): string {
    return name.replace(/\s+(Out|Back)$/i, '').trim() || name;
}

function reverseStopRole(role: RoutePlanner2Stop['role']): RoutePlanner2Stop['role'] {
    if (role === 'start-terminal') return 'end-terminal';
    if (role === 'end-terminal' || role === 'turnaround') return 'start-terminal';
    return role;
}

function reverseStops(stops: RoutePlanner2Stop[]): RoutePlanner2Stop[] {
    return [...stops]
        .sort((a, b) => a.sequence - b.sequence)
        .reverse()
        .map((stop, index) => ({
            ...stop,
            sequence: index + 1,
            role: reverseStopRole(stop.role),
        }));
}

function reverseAlignment(alignment: RoutePlanner2RoutePoint[]): RoutePlanner2RoutePoint[] {
    const segmentGroups = new Map<string, RoutePlanner2RoutePoint[]>();
    const unsegmentedPoints: RoutePlanner2RoutePoint[] = [];

    alignment.forEach((point) => {
        if (!point.afterStopId || !point.beforeStopId) {
            unsegmentedPoints.push(point);
            return;
        }
        const key = `${point.afterStopId}::${point.beforeStopId}`;
        segmentGroups.set(key, [...(segmentGroups.get(key) ?? []), point]);
    });

    const reversedSegmentPoints = Array.from(segmentGroups.values()).flatMap((points) =>
        [...points]
            .sort((a, b) => (b.segmentSequence ?? b.sequence) - (a.segmentSequence ?? a.sequence))
            .map((point, index) => ({
                ...point,
                id: `${point.id}-back`,
                afterStopId: point.beforeStopId,
                beforeStopId: point.afterStopId,
                segmentSequence: index + 1,
            })),
    );

    return [...unsegmentedPoints, ...reversedSegmentPoints]
        .map((point, index) => ({ ...point, sequence: index + 1 }));
}

export function renameRoutePlanner2Project(
    project: RoutePlanner2Project,
    name: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === project.name) return project;

    return markChanged({ ...project, name: trimmedName }, now);
}

export function createRoutePlanner2ProjectCopy(
    project: RoutePlanner2Project,
    options: { id?: string; name?: string; now?: string } = {},
): RoutePlanner2Project {
    const now = options.now ?? new Date().toISOString();
    return {
        ...project,
        id: options.id ?? createEntityId('project'),
        name: options.name ?? createCopyName(project.name),
        status: 'local-draft',
        createdAt: now,
        updatedAt: now,
        scenarios: project.scenarios.map((scenario) => ({
            ...scenario,
            createdAt: now,
            updatedAt: now,
        })),
    };
}

export function addRoutePlanner2Scenario(
    project: RoutePlanner2Project,
    options: { id?: string; name?: string; now?: string } = {},
): RoutePlanner2Project {
    const now = options.now ?? new Date().toISOString();
    const scenario = createRoutePlanner2Scenario({
        id: options.id,
        name: options.name ?? `Option ${project.scenarios.length + 1}`,
        now,
    });

    return markChanged({
        ...project,
        selectedScenarioId: scenario.id,
        scenarios: [...project.scenarios, scenario],
    }, now);
}

export function renameRoutePlanner2Scenario(
    project: RoutePlanner2Project,
    scenarioId: string,
    name: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    const trimmedName = name.trim();
    if (!trimmedName || !scenarioExists(project, scenarioId)) return project;

    let changed = false;
    const scenarios = project.scenarios.map((scenario) => {
        if (scenario.id !== scenarioId || scenario.name === trimmedName) return scenario;
        changed = true;
        return { ...scenario, name: trimmedName, updatedAt: now };
    });

    return changed ? markChanged({ ...project, scenarios }, now) : project;
}

export function duplicateRoutePlanner2Scenario(
    project: RoutePlanner2Project,
    scenarioId: string,
    options: { id?: string; now?: string } = {},
): RoutePlanner2Project {
    const source = project.scenarios.find((scenario) => scenario.id === scenarioId);
    if (!source) return project;

    const now = options.now ?? new Date().toISOString();
    const stopIdMap = new Map(source.stops.map((stop) => [stop.id, createEntityId('stop')]));
    const runtimeIdMap = new Map((source.runtimeEstimates ?? []).map((segment) => [segment.id, createEntityId('segment-runtime')]));
    const remapStopId = (stopId: string): string => stopIdMap.get(stopId) ?? stopId;
    const remapOptionalStopId = (stopId?: string): string | undefined => stopId ? remapStopId(stopId) : undefined;
    const remapRuntimeId = (runtimeId: string): string => runtimeIdMap.get(runtimeId) ?? runtimeId;
    const copy: RoutePlanner2Scenario = {
        ...source,
        id: options.id ?? createScenarioId(),
        name: createCopyName(source.name),
        status: 'draft',
        routeFamily: undefined,
        createdAt: now,
        updatedAt: now,
        turnaroundStopId: remapOptionalStopId(source.turnaroundStopId),
        alignment: source.alignment.map((point) => ({
            ...point,
            id: createEntityId('route-point'),
            afterStopId: remapOptionalStopId(point.afterStopId),
            beforeStopId: remapOptionalStopId(point.beforeStopId),
        })),
        stops: source.stops.map((stop) => ({
            ...stop,
            id: remapStopId(stop.id),
            sourceRows: stop.sourceRows ? [...stop.sourceRows] : undefined,
        })),
        service: { ...source.service },
        runtimeRouteFilter: source.runtimeRouteFilter
            ? { ...source.runtimeRouteFilter, routeShortNames: [...source.runtimeRouteFilter.routeShortNames] }
            : undefined,
        runtimeEstimates: source.runtimeEstimates?.map((segment) => ({
            ...segment,
            id: remapRuntimeId(segment.id),
            fromStopId: remapStopId(segment.fromStopId),
            toStopId: remapStopId(segment.toStopId),
            matchedRoutes: segment.matchedRoutes ? [...segment.matchedRoutes] : undefined,
            matchedGtfsPathStopIds: segment.matchedGtfsPathStopIds ? [...segment.matchedGtfsPathStopIds] : undefined,
            runtimeRouteBreakdown: segment.runtimeRouteBreakdown?.map((route) => ({ ...route })),
            updatedAt: now,
        })),
        runtimeOverrides: source.runtimeOverrides
            ? Object.fromEntries(
                Object.entries(source.runtimeOverrides).map(([runtimeId, override]) => [
                    remapRuntimeId(runtimeId),
                    { ...override, updatedAt: now },
                ]),
            )
            : undefined,
        feasibility: source.feasibility
            ? {
                ...source.feasibility,
                segmentSummaries: source.feasibility.segmentSummaries.map((segment) => ({
                    ...segment,
                    id: remapRuntimeId(segment.id),
                    fromStopId: remapStopId(segment.fromStopId),
                    toStopId: remapStopId(segment.toStopId),
                    matchedRoutes: segment.matchedRoutes ? [...segment.matchedRoutes] : undefined,
                    matchedGtfsPathStopIds: segment.matchedGtfsPathStopIds ? [...segment.matchedGtfsPathStopIds] : undefined,
                    runtimeRouteBreakdown: segment.runtimeRouteBreakdown?.map((route) => ({ ...route })),
                    updatedAt: now,
                })),
                warnings: source.feasibility.warnings.map((warning) => ({
                    ...warning,
                    id: createEntityId('warning'),
                })),
            }
            : undefined,
    };

    return markChanged({
        ...project,
        selectedScenarioId: copy.id,
        scenarios: [...project.scenarios, copy],
    }, now);
}

export function createRoutePlanner2BackDirection(
    project: RoutePlanner2Project,
    scenarioId: string,
    options: { id?: string; now?: string } = {},
): RoutePlanner2Project {
    const source = project.scenarios.find((scenario) => scenario.id === scenarioId);
    if (!source || source.stops.length < 2) return project;

    const now = options.now ?? new Date().toISOString();
    const baseName = baseDirectionName(source.name);
    const outName = `${baseName} Out`;
    const backName = `${baseName} Back`;
    const backScenario: RoutePlanner2Scenario = {
        ...source,
        id: options.id ?? createScenarioId(),
        name: backName,
        status: 'draft',
        routeShape: 'one-way',
        stops: reverseStops(source.stops),
        alignment: reverseAlignment(source.alignment),
        turnaroundStopId: undefined,
        runtimeEstimates: undefined,
        runtimeOverrides: undefined,
        feasibility: undefined,
        notes: source.notes ? `${source.notes}\n\nBack direction generated from ${outName}.` : `Back direction generated from ${outName}.`,
        createdAt: now,
        updatedAt: now,
    };

    return markChanged({
        ...project,
        selectedScenarioId: backScenario.id,
        scenarios: [
            ...project.scenarios.map((scenario) =>
                scenario.id === source.id
                    ? { ...scenario, name: outName, routeShape: 'one-way' as const, updatedAt: now }
                    : scenario,
            ),
            backScenario,
        ],
    }, now);
}

export function deleteRoutePlanner2Scenario(
    project: RoutePlanner2Project,
    scenarioId: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (project.scenarios.length <= 1 || !scenarioExists(project, scenarioId)) return project;

    const scenarios = project.scenarios.filter((scenario) => scenario.id !== scenarioId);
    const selectedScenarioId = project.selectedScenarioId === scenarioId
        ? scenarios[0]?.id ?? project.selectedScenarioId
        : project.selectedScenarioId;
    const preferredScenarioId = project.preferredScenarioId === scenarioId
        ? undefined
        : project.preferredScenarioId;

    return markChanged({
        ...project,
        selectedScenarioId,
        preferredScenarioId,
        scenarios,
    }, now);
}

export function selectRoutePlanner2Scenario(
    project: RoutePlanner2Project,
    scenarioId: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (!scenarioExists(project, scenarioId) || project.selectedScenarioId === scenarioId) return project;

    return markChanged({ ...project, selectedScenarioId: scenarioId }, now);
}

export function markRoutePlanner2PreferredScenario(
    project: RoutePlanner2Project,
    scenarioId: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (!scenarioExists(project, scenarioId) || project.preferredScenarioId === scenarioId) return project;

    return markChanged({ ...project, preferredScenarioId: scenarioId }, now);
}

export function importRoutePlanner2Scenario(
    project: RoutePlanner2Project,
    scenario: RoutePlanner2Scenario,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    if (project.scenarios.some((existing) => existing.id === scenario.id)) return project;

    return markChanged({
        ...project,
        selectedScenarioId: scenario.id,
        scenarios: [...project.scenarios, { ...scenario, updatedAt: now }],
    }, now);
}
