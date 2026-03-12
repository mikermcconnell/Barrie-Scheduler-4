import type { RouteProject } from './routePlannerTypes';

export function filterRoutePlannerProjectsByTeam(
    projects: RouteProject[],
    teamId?: string | null
): RouteProject[] {
    if (teamId === undefined) return projects;
    const normalizedTeamId = teamId ?? null;
    return projects.filter((project) => (project.teamId ?? null) === normalizedTeamId);
}

export function resolveActiveRoutePlannerProject({
    loadedProjects,
    preferredProjectId,
    currentProject,
    currentProjectIsLocalDraft,
    localDraftProject,
}: {
    loadedProjects: RouteProject[];
    preferredProjectId?: string;
    currentProject: RouteProject;
    currentProjectIsLocalDraft: boolean;
    localDraftProject: RouteProject | null;
}): RouteProject | null {
    if (preferredProjectId) {
        return loadedProjects.find((project) => project.id === preferredProjectId) ?? null;
    }

    const savedCurrentProject = loadedProjects.find((project) => project.id === currentProject.id);
    if (savedCurrentProject) return savedCurrentProject;

    if (currentProjectIsLocalDraft) return currentProject;
    if (loadedProjects.length > 0) return loadedProjects[0] ?? null;
    return localDraftProject;
}

export function buildRoutePlannerSavePayload(
    project: RouteProject,
    {
        teamId,
        preserveProjectId,
        nameOverride,
    }: {
        teamId?: string | null;
        preserveProjectId: boolean;
        nameOverride?: string;
    }
): Omit<RouteProject, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } {
    return {
        id: preserveProjectId ? project.id : undefined,
        name: nameOverride ?? project.name,
        description: project.description,
        teamId: project.teamId ?? teamId ?? null,
        preferredScenarioId: project.preferredScenarioId ?? project.scenarios[0]?.id ?? null,
        scenarios: project.scenarios,
    };
}
