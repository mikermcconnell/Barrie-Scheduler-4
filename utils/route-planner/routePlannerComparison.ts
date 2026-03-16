import { compareRouteCoverageMetrics, type RouteCoverageDelta } from './routePlannerCoverage';
import type { RouteProject, RouteScenario } from './routePlannerTypes';

function roundToOneDecimal(value: number): number {
    return Math.round(value * 10) / 10;
}

export interface RouteScenarioImpactSummary {
    baseline: RouteScenario;
    comparison: RouteScenario;
    runtimeDeltaMinutes: number;
    cycleDeltaMinutes: number;
    busesDelta: number;
    distanceDeltaKm: number;
    stopDelta: number;
    warningDelta: number;
    serviceHoursDelta: number;
    frequencyDeltaMinutes: number;
    coverageDelta: RouteCoverageDelta;
}

export function isExistingRouteBaselineScenario(scenario: RouteScenario): boolean {
    return scenario.scenarioType === 'existing-route-tweak' && scenario.id.endsWith('-baseline');
}

export function getExistingRouteBaselineScenario(
    project: RouteProject,
    scenario: RouteScenario | null | undefined
): RouteScenario | null {
    if (!scenario || scenario.scenarioType !== 'existing-route-tweak') return null;

    return project.scenarios.find((candidate) =>
        candidate.id !== scenario.id
        && isExistingRouteBaselineScenario(candidate)
        && candidate.baseSource.kind === scenario.baseSource.kind
        && candidate.baseSource.sourceId === scenario.baseSource.sourceId
    ) ?? null;
}

export function buildRouteScenarioImpactSummary(
    baseline: RouteScenario,
    comparison: RouteScenario
): RouteScenarioImpactSummary {
    return {
        baseline,
        comparison,
        runtimeDeltaMinutes: comparison.runtimeMinutes - baseline.runtimeMinutes,
        cycleDeltaMinutes: comparison.cycleMinutes - baseline.cycleMinutes,
        busesDelta: comparison.busesRequired - baseline.busesRequired,
        distanceDeltaKm: roundToOneDecimal(comparison.distanceKm - baseline.distanceKm),
        stopDelta: comparison.stops.length - baseline.stops.length,
        warningDelta: comparison.warnings.length - baseline.warnings.length,
        serviceHoursDelta: roundToOneDecimal(comparison.serviceHours - baseline.serviceHours),
        frequencyDeltaMinutes: comparison.frequencyMinutes - baseline.frequencyMinutes,
        coverageDelta: compareRouteCoverageMetrics(baseline.coverage, comparison.coverage),
    };
}
