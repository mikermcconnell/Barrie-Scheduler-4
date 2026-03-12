import { deriveRouteProject, deriveRouteScenario } from './routePlannerPlanning';
import type { RouteProject, RouteScenario } from './routePlannerTypes';

const scenarioAccentOrder: RouteScenario['accent'][] = ['indigo', 'emerald', 'amber', 'cyan'];

function buildScenarioCopy(scenario: RouteScenario, existingCount: number): RouteScenario {
    const accentIndex = scenarioAccentOrder.indexOf(scenario.accent);
    const nextAccent = scenarioAccentOrder[(accentIndex + 1 + existingCount) % scenarioAccentOrder.length];
    const suffix = existingCount + 1;

    return deriveRouteScenario({
        ...scenario,
        id: `${scenario.id}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${scenario.name} Option ${suffix}`,
        accent: nextAccent,
        notes: scenario.notes
            ? `${scenario.notes} Duplicate for alternative testing.`
            : 'Duplicate for alternative testing.',
    });
}

export function updateRouteScenario(
    project: RouteProject,
    scenarioId: string,
    updater: (scenario: RouteScenario) => RouteScenario
): RouteProject {
    return deriveRouteProject({
        ...project,
        scenarios: project.scenarios.map((scenario) =>
            scenario.id === scenarioId
                ? deriveRouteScenario(updater(scenario))
                : scenario
        ),
        updatedAt: new Date(),
    });
}

export function duplicateRouteScenario(
    project: RouteProject,
    scenarioId: string
): { project: RouteProject; duplicatedScenarioId: string } | null {
    const sourceScenario = project.scenarios.find((scenario) => scenario.id === scenarioId);
    if (!sourceScenario) return null;

    const scenarioCopy = buildScenarioCopy(sourceScenario, project.scenarios.length);

    return {
        duplicatedScenarioId: scenarioCopy.id,
        project: deriveRouteProject({
            ...project,
            preferredScenarioId: project.preferredScenarioId ?? sourceScenario.id,
            scenarios: [...project.scenarios, scenarioCopy],
            updatedAt: new Date(),
        }),
    };
}

export function deleteRouteScenario(
    project: RouteProject,
    scenarioId: string
): { project: RouteProject; nextSelectedScenarioId: string | null } | null {
    if (project.scenarios.length <= 1) return null;

    const remainingScenarios = project.scenarios.filter((scenario) => scenario.id !== scenarioId);
    if (remainingScenarios.length === project.scenarios.length) return null;

    const nextSelectedScenarioId = remainingScenarios[0]?.id ?? null;
    const nextPreferredScenarioId = project.preferredScenarioId === scenarioId
        ? nextSelectedScenarioId
        : project.preferredScenarioId ?? nextSelectedScenarioId;

    return {
        nextSelectedScenarioId,
        project: deriveRouteProject({
            ...project,
            preferredScenarioId: nextPreferredScenarioId,
            scenarios: remainingScenarios,
            updatedAt: new Date(),
        }),
    };
}

export function markPreferredRouteScenario(project: RouteProject, scenarioId: string): RouteProject {
    if (!project.scenarios.some((scenario) => scenario.id === scenarioId)) return project;

    return deriveRouteProject({
        ...project,
        preferredScenarioId: scenarioId,
        updatedAt: new Date(),
    });
}
