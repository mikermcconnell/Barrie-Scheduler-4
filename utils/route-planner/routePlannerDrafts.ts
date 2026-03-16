import { getRouteConfig, isLoop } from '../config/routeDirectionConfig';
import { loadGtfsRouteShapes } from '../gtfs/gtfsShapesLoader';
import { simplifyRouteControlPoints } from './routePlannerControlPoints';
import { deriveRouteProject } from './routePlannerPlanning';
import type { RouteBaseSource, RouteProject, RouteScenario, RouteScenarioPattern, RouteScenarioType } from './routePlannerTypes';

export type DraftRoutePlannerMode = 'existing-route-tweak' | 'route-concept';
export type DraftRouteBaseSourceKind = 'blank' | 'existing-route';

const EXISTING_ROUTE_BASELINE_SUFFIX = '-baseline';

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

function buildBaselineScenarioName(routeId: string): string {
    return `Route ${routeId} Current GTFS`;
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

function normalizeRouteVariant(value: string): string {
    return value
        .replace(/^route\s+/i, '')
        .trim()
        .split(/\s+/)[0]
        ?.toUpperCase() ?? '';
}

function coordinatesEqual(first: [number, number], second: [number, number]): boolean {
    return Math.abs(first[0] - second[0]) < 0.000001 && Math.abs(first[1] - second[1]) < 0.000001;
}

export function buildRouteScenarioSeed(
    baseSource: DraftRouteBaseSourceKind,
    routeId: string,
    pattern: RouteScenarioPattern
): Pick<RouteScenario, 'waypoints' | 'geometry' | 'stops'> {
    if (baseSource !== 'existing-route') {
        return {
            waypoints: [],
            geometry: {
                type: 'LineString',
                coordinates: [],
            },
            stops: [],
        };
    }

    const routeConfig = getRouteConfig(routeId);
    const routeShapes = loadGtfsRouteShapes();
    const preferredVariant = routeConfig?.segments[0]?.variant ?? routeId;
    const preferredKey = normalizeRouteVariant(preferredVariant);
    const fallbackKey = normalizeRouteVariant(routeId);

    const matchedShape = routeShapes.find((shape) => normalizeRouteVariant(shape.routeShortName) === preferredKey)
        ?? routeShapes.find((shape) => normalizeRouteVariant(shape.routeShortName) === fallbackKey)
        ?? routeShapes.find((shape) => normalizeRouteVariant(shape.routeShortName).startsWith(`${fallbackKey}A`))
        ?? routeShapes.find((shape) => normalizeRouteVariant(shape.routeShortName).startsWith(fallbackKey));

    if (!matchedShape || matchedShape.points.length < 2) {
        return {
            waypoints: [],
            geometry: {
                type: 'LineString',
                coordinates: [],
            },
            stops: [],
        };
    }

    const seededGeometry = matchedShape.points.map(([lat, lon]) => [lon, lat] as [number, number]);
    const geometryCoordinates = pattern === 'loop'
        && seededGeometry.length > 1
        && coordinatesEqual(seededGeometry[0], seededGeometry[seededGeometry.length - 1])
        ? seededGeometry.slice(0, -1)
        : seededGeometry;
    const waypoints = simplifyRouteControlPoints(geometryCoordinates);

    return {
        waypoints,
        geometry: {
            type: 'LineString',
            coordinates: geometryCoordinates,
        },
        stops: [],
    };
}

function createDraftScenario(
    mode: DraftRoutePlannerMode,
    baseSource: DraftRouteBaseSourceKind,
    routeId: string,
    variant: 'default' | 'baseline' | 'working' = 'default'
): RouteScenario {
    const pattern = inferPattern(baseSource, routeId);
    const seed = buildRouteScenarioSeed(baseSource, routeId, pattern);
    const isBaseline = variant === 'baseline';
    const scenarioIdSuffix = isBaseline ? 'baseline' : 'scenario';
    const scenarioName = isBaseline
        ? buildBaselineScenarioName(routeId)
        : buildScenarioName(mode, baseSource, routeId);
    const notes = isBaseline
        ? `Baseline GTFS alignment for Route ${routeId}. Use this as the before condition when comparing schedule impacts.`
        : baseSource === 'existing-route'
            ? mode === 'existing-route-tweak'
                ? `Working scenario seeded from Route ${routeId}. Edit this option to test roadway and stop changes against the GTFS baseline.`
                : `Starting template: Route ${routeId}.`
            : 'Start from a blank concept and define the corridor, stops, and service assumptions.';

    return {
        id: `${mode}-${baseSource}-${routeId}-${scenarioIdSuffix}`,
        name: scenarioName,
        scenarioType: buildScenarioType(mode),
        pattern,
        accent: isBaseline
            ? 'indigo'
            : mode === 'existing-route-tweak'
                ? 'emerald'
                : 'amber',
        notes,
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
        waypoints: seed.waypoints,
        geometry: seed.geometry,
        stops: seed.stops,
        coverage: {},
        status: 'draft',
    };
}

function createDraftScenarios(
    mode: DraftRoutePlannerMode,
    baseSource: DraftRouteBaseSourceKind,
    routeId: string
): RouteScenario[] {
    if (mode === 'existing-route-tweak' && baseSource === 'existing-route') {
        return [
            createDraftScenario(mode, baseSource, routeId, 'baseline'),
            createDraftScenario(mode, baseSource, routeId, 'working'),
        ];
    }

    return [createDraftScenario(mode, baseSource, routeId)];
}

function hasExistingRouteBaselineScenario(scenarios: RouteScenario[]): boolean {
    return scenarios.some((scenario) => scenario.id.endsWith(EXISTING_ROUTE_BASELINE_SUFFIX));
}

export function createDraftRouteProject(
    mode: DraftRoutePlannerMode,
    baseSource: DraftRouteBaseSourceKind,
    routeId: string,
    teamId?: string | null
): RouteProject {
    const stamp = new Date();
    const scenarios = createDraftScenarios(mode, baseSource, routeId);
    const preferredScenarioId = scenarios.find((scenario) => !scenario.id.endsWith(EXISTING_ROUTE_BASELINE_SUFFIX))?.id
        ?? scenarios[0]?.id
        ?? null;

    return deriveRouteProject({
        id: `${mode}-${baseSource}-${routeId}-project`,
        name: buildProjectName(mode, baseSource, routeId),
        description: buildProjectDescription(mode, baseSource, routeId),
        teamId: teamId ?? null,
        preferredScenarioId,
        scenarios,
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
    const nextScenarioTemplates = createDraftScenarios(mode, baseSource, routeId);
    let scenarios = project.scenarios.length > 0
        ? project.scenarios
        : nextScenarioTemplates;

    if (
        mode === 'existing-route-tweak'
        && baseSource === 'existing-route'
        && !hasExistingRouteBaselineScenario(scenarios)
        && nextScenarioTemplates[0]
    ) {
        scenarios = [nextScenarioTemplates[0], ...scenarios];
    }

    return deriveRouteProject({
        ...project,
        preferredScenarioId: project.preferredScenarioId && scenarios.some((scenario) => scenario.id === project.preferredScenarioId)
            ? project.preferredScenarioId
            : scenarios.find((scenario) => !scenario.id.endsWith(EXISTING_ROUTE_BASELINE_SUFFIX))?.id
                ?? scenarios[0]?.id
                ?? null,
        scenarios: scenarios.map((scenario, index) => {
            const templateScenario = nextScenarioTemplates[Math.min(index, nextScenarioTemplates.length - 1)] ?? nextScenarioTemplates[0];
            const sourceChanged = scenario.baseSource.kind !== templateScenario.baseSource.kind
                || scenario.baseSource.sourceId !== templateScenario.baseSource.sourceId;
            const shouldHydrateEmptyExistingRoute = templateScenario.baseSource.kind === 'existing_route'
                && scenario.waypoints.length === 0
                && scenario.geometry.coordinates.length < 2
                && scenario.stops.length === 0;
            const templateOverrides = sourceChanged || shouldHydrateEmptyExistingRoute
                ? {
                    waypoints: templateScenario.waypoints,
                    geometry: templateScenario.geometry,
                    stops: templateScenario.stops,
                }
                : {};
            const shouldUseTemplateLabel = sourceChanged || !scenario.name.trim();
            const shouldUseTemplateNotes = !scenario.notes.trim();
            const isBaselineScenario = scenario.id.endsWith(EXISTING_ROUTE_BASELINE_SUFFIX);

            return {
                ...scenario,
                ...templateOverrides,
                id: scenario.id,
                name: shouldUseTemplateLabel ? templateScenario.name : scenario.name,
                scenarioType: templateScenario.scenarioType,
                pattern: templateScenario.pattern,
                accent: isBaselineScenario ? templateScenario.accent : scenario.accent,
                baseSource: templateScenario.baseSource,
                notes: isBaselineScenario || shouldUseTemplateNotes ? templateScenario.notes : scenario.notes,
            };
        }),
        updatedAt: new Date(),
    });
}
