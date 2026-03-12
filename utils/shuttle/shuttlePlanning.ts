import { deriveRouteProject, deriveRouteScenario } from '../route-planner/routePlannerPlanning';
import {
    createRouteProjectFromShuttleProject,
    createRouteScenarioFromShuttleScenario,
    createShuttleProjectFromRouteProject,
    createShuttleScenarioFromRouteScenario,
} from '../route-planner/routePlannerTypes';
import type { ShuttleProject, ShuttleScenario } from './shuttleTypes';

function buildShuttleWarnings(
    scenario: ShuttleScenario,
    normalizedGeometry: GeoJSON.LineString,
    cycleMinutes: number,
    busesRequired: number,
    departures: string[]
): string[] {
    const warnings: string[] = [];

    if (normalizedGeometry.coordinates.length < 2) {
        warnings.push('Add at least two route points to define a shuttle alignment.');
    }

    if (scenario.stops.length < 2) {
        warnings.push('Add at least two stops before relying on the timetable preview.');
    }

    if (departures.length === 0) {
        warnings.push('Enter a valid service span to generate departures.');
    }

    if (scenario.layoverMinutes < 5) {
        warnings.push('Recovery is tight. Consider at least 5 minutes of layover for a review-ready concept.');
    }

    if (busesRequired > 2) {
        warnings.push(`Current headway requires ${busesRequired} buses. Confirm fleet availability before advancing.`);
    }

    if (scenario.pattern === 'out-and-back' && normalizedGeometry.coordinates.length < 4) {
        warnings.push('Out-and-back concepts work better with more shape detail on both outbound and return paths.');
    }

    if (scenario.frequencyMinutes < cycleMinutes && scenario.frequencyMinutes > 0) {
        warnings.push('Cycle time is longer than the headway. A single bus cannot hold this frequency.');
    }

    return warnings;
}

export function deriveShuttleScenario(scenario: ShuttleScenario): ShuttleScenario {
    const derivedRouteScenario = deriveRouteScenario(createRouteScenarioFromShuttleScenario(scenario));
    const shuttleScenario = createShuttleScenarioFromRouteScenario(derivedRouteScenario);
    const warnings = buildShuttleWarnings(
        {
            ...shuttleScenario,
            layoverMinutes: scenario.layoverMinutes,
            frequencyMinutes: scenario.frequencyMinutes,
        },
        shuttleScenario.geometry,
        shuttleScenario.cycleMinutes,
        shuttleScenario.busesRequired,
        shuttleScenario.departures
    );

    return {
        ...shuttleScenario,
        warnings,
        status: warnings.length === 0 ? 'ready_for_review' : 'draft',
    };
}

export function deriveShuttleProject(project: ShuttleProject): ShuttleProject {
    const derivedRouteProject = deriveRouteProject(createRouteProjectFromShuttleProject(project));
    const shuttleProject = createShuttleProjectFromRouteProject(derivedRouteProject);

    return {
        ...shuttleProject,
        scenarios: shuttleProject.scenarios.map((scenario) => deriveShuttleScenario(scenario)),
    };
}
