import type { ShuttleProject, ShuttleScenario, ShuttleStop } from '../shuttle/shuttleTypes';

export type RouteScenarioType = 'route-concept' | 'existing-route-tweak' | 'shuttle-concept';
export type RouteScenarioPattern = 'loop' | 'out-and-back';
export type RouteStopKind = 'existing' | 'custom';
export type RouteStopRole = 'terminal' | 'timed' | 'regular';
export type RouteScenarioAccent = 'indigo' | 'emerald' | 'amber' | 'cyan';
export type RouteScenarioStatus = 'draft' | 'ready_for_review';
export type RouteRuntimeSourceMode = 'observed_proxy' | 'manual_override' | 'fallback_estimate';
export type RouteBaseSourceKind = 'blank' | 'existing_route' | 'existing_branch' | 'shuttle_template';

export interface RouteBaseSource {
    kind: RouteBaseSourceKind;
    sourceId?: string;
    label: string;
}

export interface RouteStop {
    id: string;
    name: string;
    kind: RouteStopKind;
    sourceStopId?: string;
    role: RouteStopRole;
    latitude: number;
    longitude: number;
    timeLabel: string;
    plannedOffsetMinutes?: number | null;
}

export interface RouteCoverageMetrics {
    populationWithin400m?: number | null;
    jobsWithin400m?: number | null;
}

export interface RouteRuntimeInputs {
    manualRuntimeMinutes?: number | null;
    observedRuntimeMinutes?: number | null;
    observedSampleCount?: number | null;
    observedMatchedSegments?: number | null;
    observedTotalSegments?: number | null;
}

export interface RouteScenario {
    id: string;
    name: string;
    scenarioType: RouteScenarioType;
    pattern: RouteScenarioPattern;
    accent: RouteScenarioAccent;
    notes: string;
    baseSource: RouteBaseSource;
    runtimeSourceMode: RouteRuntimeSourceMode;
    runtimeInputs: RouteRuntimeInputs;
    distanceKm: number;
    runtimeMinutes: number;
    cycleMinutes: number;
    busesRequired: number;
    serviceHours: number;
    firstDeparture: string;
    lastDeparture: string;
    frequencyMinutes: number;
    layoverMinutes: number;
    warnings: string[];
    departures: string[];
    waypoints: [number, number][];
    geometry: GeoJSON.LineString;
    stops: RouteStop[];
    coverage: RouteCoverageMetrics;
    status: RouteScenarioStatus;
}

export interface RouteProject {
    id: string;
    name: string;
    description?: string;
    teamId?: string | null;
    preferredScenarioId?: string | null;
    scenarios: RouteScenario[];
    createdAt: Date;
    updatedAt: Date;
}

function convertStopKind(kind: ShuttleStop['kind']): RouteStopKind {
    return kind === 'barrie' ? 'existing' : 'custom';
}

function coordinatesEqual(
    first: readonly [number, number][],
    second: readonly [number, number][]
): boolean {
    if (first.length !== second.length) return false;

    return first.every((coordinate, index) => {
        const other = second[index];
        return coordinate[0] === other[0] && coordinate[1] === other[1];
    });
}

function buildRouteGeometryFromShuttleScenario(scenario: ShuttleScenario): GeoJSON.LineString {
    const geometryCoordinates = scenario.geometry.coordinates as [number, number][];
    const waypointCoordinates = scenario.waypoints;

    if (
        scenario.pattern === 'out-and-back'
        && waypointCoordinates.length >= 2
        && coordinatesEqual(geometryCoordinates, waypointCoordinates)
    ) {
        return {
            type: 'LineString',
            coordinates: [...waypointCoordinates, ...waypointCoordinates.slice(0, -1).reverse()],
        };
    }

    return {
        type: 'LineString',
        coordinates: [...geometryCoordinates],
    };
}

export function createRouteStopFromShuttleStop(stop: ShuttleStop): RouteStop {
    return {
        id: stop.id,
        name: stop.name,
        kind: convertStopKind(stop.kind),
        sourceStopId: stop.barrieStopId,
        role: stop.role,
        latitude: stop.latitude,
        longitude: stop.longitude,
        timeLabel: stop.timeLabel,
        plannedOffsetMinutes: null,
    };
}

export function createRouteScenarioFromShuttleScenario(scenario: ShuttleScenario): RouteScenario {
    return {
        id: scenario.id,
        name: scenario.name,
        scenarioType: 'shuttle-concept',
        pattern: scenario.pattern,
        accent: scenario.accent,
        notes: scenario.notes,
        baseSource: {
            kind: 'shuttle_template',
            label: 'Shuttle Template',
        },
        runtimeSourceMode: 'manual_override',
        runtimeInputs: {
            manualRuntimeMinutes: scenario.runtimeMinutes,
        },
        distanceKm: scenario.distanceKm,
        runtimeMinutes: scenario.runtimeMinutes,
        cycleMinutes: scenario.cycleMinutes,
        busesRequired: scenario.busesRequired,
        serviceHours: scenario.serviceHours,
        firstDeparture: scenario.firstDeparture,
        lastDeparture: scenario.lastDeparture,
        frequencyMinutes: scenario.frequencyMinutes,
        layoverMinutes: scenario.layoverMinutes,
        warnings: [...scenario.warnings],
        departures: [...scenario.departures],
        waypoints: [...scenario.waypoints],
        geometry: buildRouteGeometryFromShuttleScenario(scenario),
        stops: scenario.stops.map((stop) => createRouteStopFromShuttleStop(stop)),
        coverage: {},
        status: scenario.status,
    };
}

export function createRouteProjectFromShuttleProject(project: ShuttleProject): RouteProject {
    return {
        id: project.id,
        name: project.name,
        description: project.description,
        teamId: project.teamId ?? null,
        preferredScenarioId: project.preferredScenarioId ?? null,
        scenarios: project.scenarios.map((scenario) => createRouteScenarioFromShuttleScenario(scenario)),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}

function convertStopKindToShuttle(kind: RouteStopKind): ShuttleStop['kind'] {
    return kind === 'existing' ? 'barrie' : 'custom';
}

export function createShuttleStopFromRouteStop(stop: RouteStop): ShuttleStop {
    return {
        id: stop.id,
        name: stop.name,
        kind: convertStopKindToShuttle(stop.kind),
        barrieStopId: stop.sourceStopId,
        role: stop.role,
        latitude: stop.latitude,
        longitude: stop.longitude,
        timeLabel: stop.timeLabel,
        plannedOffsetMinutes: stop.plannedOffsetMinutes ?? null,
    };
}

export function createShuttleScenarioFromRouteScenario(scenario: RouteScenario): ShuttleScenario {
    return {
        id: scenario.id,
        name: scenario.name,
        pattern: scenario.pattern,
        accent: scenario.accent,
        notes: scenario.notes,
        distanceKm: scenario.distanceKm,
        runtimeMinutes: scenario.runtimeMinutes,
        cycleMinutes: scenario.cycleMinutes,
        busesRequired: scenario.busesRequired,
        serviceHours: scenario.serviceHours,
        firstDeparture: scenario.firstDeparture,
        lastDeparture: scenario.lastDeparture,
        frequencyMinutes: scenario.frequencyMinutes,
        layoverMinutes: scenario.layoverMinutes,
        warnings: [...scenario.warnings],
        departures: [...scenario.departures],
        waypoints: [...scenario.waypoints],
        geometry: {
            type: 'LineString',
            coordinates: [...scenario.geometry.coordinates],
        },
        stops: scenario.stops.map((stop) => createShuttleStopFromRouteStop(stop)),
        status: scenario.status,
    };
}

export function createShuttleProjectFromRouteProject(project: RouteProject): ShuttleProject {
    return {
        id: project.id,
        name: project.name,
        description: project.description,
        teamId: project.teamId ?? null,
        preferredScenarioId: project.preferredScenarioId ?? null,
        scenarios: project.scenarios.map((scenario) => createShuttleScenarioFromRouteScenario(scenario)),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}
