import { getRouteConfig, isLoop } from '../config/routeDirectionConfig';
import { deriveRouteProject } from './routePlannerPlanning';
import type { RouteBaseSource, RouteProject, RouteScenario, RouteScenarioPattern, RouteScenarioType } from './routePlannerTypes';

export type DraftRoutePlannerMode = 'existing-route-tweak' | 'route-concept';
export type DraftRouteBaseSourceKind = 'blank' | 'existing-route';

function buildBaseSource(baseSource: DraftRouteBaseSourceKind, routeId: string): RouteBaseSource {
    if (baseSource === 'existing-route') {
        return {
            kind: 'existing_route',
            sourceId: routeId,
            label: `Route ${routeId}`,
        };
    }

    return {
        kind: 'blank',
        label: 'Blank Concept',
    };
}

function inferPattern(baseSource: DraftRouteBaseSourceKind, routeId: string): RouteScenarioPattern {
    if (baseSource !== 'existing-route') return 'out-and-back';
    const config = getRouteConfig(routeId);
    return isLoop(config) ? 'loop' : 'out-and-back';
}

function buildScenarioName(mode: DraftRoutePlannerMode, baseSource: DraftRouteBaseSourceKind, routeId: string): string {
    if (mode === 'existing-route-tweak') return `Route ${routeId} Tweak`;
    if (baseSource === 'existing-route') return `Route ${routeId} Concept`;
    return 'New Route Concept';
}

function buildProjectName(mode: DraftRoutePlannerMode, baseSource: DraftRouteBaseSourceKind, routeId: string): string {
    if (mode === 'existing-route-tweak') return `Route ${routeId} Tweak Study`;
    if (baseSource === 'existing-route') return `Route ${routeId} Concept Study`;
    return 'Route Concept Study';
}

function buildProjectDescription(mode: DraftRoutePlannerMode, baseSource: DraftRouteBaseSourceKind, routeId: string): string {
    if (mode === 'existing-route-tweak') {
        return `Draft planning project for testing changes to Route ${routeId}.`;
    }
    if (baseSource === 'existing-route') {
        return `Draft planning project using Route ${routeId} as the starting template.`;
    }
    return 'Draft planning project for testing a new route concept.';
}

function buildScenarioType(mode: DraftRoutePlannerMode): RouteScenarioType {
    return mode === 'existing-route-tweak' ? 'existing-route-tweak' : 'route-concept';
}

function createDraftScenario(mode: DraftRoutePlannerMode, baseSource: DraftRouteBaseSourceKind, routeId: string): RouteScenario {
    const pattern = inferPattern(baseSource, routeId);
    return {
        id: `${mode}-${baseSource}-${routeId}-scenario`,
        name: buildScenarioName(mode, baseSource, routeId),
        scenarioType: buildScenarioType(mode),
        pattern,
        accent: mode === 'existing-route-tweak' ? 'emerald' : 'amber',
        notes: baseSource === 'existing-route'
            ? `Starting template: Route ${routeId}.`
            : 'Start from a blank concept and define the corridor, stops, and service assumptions.',
        baseSource: buildBaseSource(baseSource, routeId),
        runtimeSourceMode: 'fallback_estimate',
        runtimeInputs: {},
        distanceKm: 0,
        runtimeMinutes: 0,
        cycleMinutes: 0,
        busesRequired: 0,
        serviceHours: 0,
        firstDeparture: '06:00',
        lastDeparture: '22:00',
        frequencyMinutes: 20,
        layoverMinutes: 5,
        timingProfile: 'balanced',
        startTerminalHoldMinutes: 0,
        endTerminalHoldMinutes: 0,
        coverageWalkshedMeters: 400,
        warnings: [],
        departures: [],
        waypoints: [],
        geometry: {
            type: 'LineString',
            coordinates: [],
        },
        stops: [],
        coverage: {},
        status: 'draft',
    };
}

export function createDraftRouteProject(
    mode: DraftRoutePlannerMode,
    baseSource: DraftRouteBaseSourceKind,
    routeId: string,
    teamId?: string | null
): RouteProject {
    const stamp = new Date();
    return deriveRouteProject({
        id: `${mode}-${baseSource}-${routeId}-project`,
        name: buildProjectName(mode, baseSource, routeId),
        description: buildProjectDescription(mode, baseSource, routeId),
        teamId: teamId ?? null,
        preferredScenarioId: `${mode}-${baseSource}-${routeId}-scenario`,
        scenarios: [createDraftScenario(mode, baseSource, routeId)],
        createdAt: stamp,
        updatedAt: stamp,
    });
}

export function syncDraftRouteProjectSource(
    project: RouteProject,
    mode: DraftRoutePlannerMode,
    baseSource: DraftRouteBaseSourceKind,
    routeId: string
): RouteProject {
    const nextScenarioTemplate = createDraftScenario(mode, baseSource, routeId);
    const scenarios = project.scenarios.length > 0
        ? project.scenarios
        : [nextScenarioTemplate];

    return deriveRouteProject({
        ...project,
        preferredScenarioId: project.preferredScenarioId ?? scenarios[0]?.id ?? null,
        scenarios: scenarios.map((scenario, index) => ({
            ...scenario,
            id: scenario.id,
            name: index === 0 ? nextScenarioTemplate.name : scenario.name,
            scenarioType: nextScenarioTemplate.scenarioType,
            pattern: nextScenarioTemplate.pattern,
            accent: scenario.accent,
            baseSource: nextScenarioTemplate.baseSource,
            notes: scenario.notes || nextScenarioTemplate.notes,
        })),
        updatedAt: new Date(),
    });
}
