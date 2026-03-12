import type { RouteProject } from './routePlannerTypes';
import type { DraftRoutePlannerMode } from './routePlannerDrafts';

interface StoredRouteProject {
    id: string;
    name: string;
    description?: string;
    teamId?: string | null;
    preferredScenarioId?: string | null;
    scenarios: RouteProject['scenarios'];
    createdAt: string;
    updatedAt: string;
}

function toStoredRouteProject(project: RouteProject): StoredRouteProject {
    return {
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
    };
}

export function getRoutePlannerDraftStorageKey(
    mode: DraftRoutePlannerMode,
    teamId?: string | null
): string {
    return `scheduler4:route-planner:draft:${mode}:${teamId ?? 'default'}`;
}

export function serializeRoutePlannerDraft(project: RouteProject): string {
    return JSON.stringify(toStoredRouteProject(project));
}

export function parseRoutePlannerDraft(raw: string): RouteProject | null {
    try {
        const parsed = JSON.parse(raw) as Partial<StoredRouteProject>;
        if (
            !parsed
            || typeof parsed.id !== 'string'
            || typeof parsed.name !== 'string'
            || !Array.isArray(parsed.scenarios)
            || typeof parsed.createdAt !== 'string'
            || typeof parsed.updatedAt !== 'string'
        ) {
            return null;
        }

        return {
            id: parsed.id,
            name: parsed.name,
            description: typeof parsed.description === 'string' ? parsed.description : undefined,
            teamId: typeof parsed.teamId === 'string' ? parsed.teamId : parsed.teamId ?? null,
            preferredScenarioId: typeof parsed.preferredScenarioId === 'string' ? parsed.preferredScenarioId : null,
            scenarios: parsed.scenarios,
            createdAt: new Date(parsed.createdAt),
            updatedAt: new Date(parsed.updatedAt),
        };
    } catch {
        return null;
    }
}

export function loadRoutePlannerDraft(
    mode: DraftRoutePlannerMode,
    teamId?: string | null
): RouteProject | null {
    if (typeof window === 'undefined') return null;

    const raw = window.localStorage.getItem(getRoutePlannerDraftStorageKey(mode, teamId));
    if (!raw) return null;
    return parseRoutePlannerDraft(raw);
}

export function saveRoutePlannerDraft(
    mode: DraftRoutePlannerMode,
    project: RouteProject,
    teamId?: string | null
): void {
    if (typeof window === 'undefined') return;

    window.localStorage.setItem(
        getRoutePlannerDraftStorageKey(mode, teamId),
        serializeRoutePlannerDraft(project)
    );
}
