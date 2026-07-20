import { deriveRouteConceptFeasibility } from './routeConceptPlannerFeasibility';
import type { RouteConceptAlternative, RouteConceptAlternativeSummary, RouteConceptProject, RouteConceptProjectSummary } from './routeConceptPlannerTypes';

export function summarizeRouteConceptAlternative(
    alternative: RouteConceptAlternative,
    isPreferred = false,
): RouteConceptAlternativeSummary {
    const feasibility = deriveRouteConceptFeasibility(alternative);
    return {
        alternativeId: alternative.id,
        alternativeName: alternative.name,
        isPreferred,
        readiness: feasibility.readiness,
        comparisonReady: feasibility.comparisonReady,
        completeRouteRuntimeMinutes: feasibility.completeRouteRuntimeMinutes,
        minimumBusesRequired: feasibility.minimumBusesRequired,
        testedBuses: feasibility.testedBuses,
        recoveryTimeMinutes: feasibility.recoveryTimeMinutes,
        recoveryPercent: feasibility.recoveryPercent,
        dailyRevenueHours: feasibility.daily?.revenueHours ?? null,
        dailyVehicleHours: feasibility.daily?.vehicleHours ?? null,
        confidence: feasibility.confidence,
        blockingIssueCount: feasibility.issues.filter((issue) => issue.severity === 'blocking').length,
        warningCount: feasibility.issues.filter((issue) => issue.severity === 'warning').length,
    };
}
export function summarizeRouteConceptProject(project: RouteConceptProject): RouteConceptProjectSummary {
    const byId = new Map(project.alternatives.map((alternative) => [alternative.id, alternative]));
    const ordered = project.alternativeOrder
        .map((id) => byId.get(id))
        .filter((alternative): alternative is RouteConceptAlternative => alternative != null);
    const alternatives = ordered.map((alternative) => summarizeRouteConceptAlternative(
        alternative,
        alternative.id === project.preferredAlternativeId,
    ));
    return {
        totalAlternatives: alternatives.length,
        comparisonReadyCount: alternatives.filter((alternative) => alternative.comparisonReady).length,
        selectedAlternative: alternatives.find((alternative) => alternative.alternativeId === project.selectedAlternativeId) ?? null,
        preferredAlternative: alternatives.find((alternative) => alternative.alternativeId === project.preferredAlternativeId) ?? null,
        alternatives,
    };
}
