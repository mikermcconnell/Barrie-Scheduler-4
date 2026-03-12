import { useEffect, useState } from 'react';
import { createDraftRouteProject, syncDraftRouteProjectSource, type DraftRouteBaseSourceKind, type DraftRoutePlannerMode } from '../../utils/route-planner/routePlannerDrafts';
import type { RouteProject } from '../../utils/route-planner/routePlannerTypes';
import { loadRoutePlannerDraft, saveRoutePlannerDraft } from '../../utils/route-planner/routePlannerDraftStorage';

export interface RoutePlannerDraftController {
    project: RouteProject;
    updateProjectName: (value: string) => void;
    updateProjectDescription: (value: string) => void;
    updateScenarioNotes: (value: string) => void;
}

export function useRoutePlannerDraftController({
    mode,
    baseSource,
    routeId,
    teamId,
}: {
    mode: DraftRoutePlannerMode;
    baseSource: DraftRouteBaseSourceKind;
    routeId: string;
    teamId?: string | null;
}): RoutePlannerDraftController {
    const [project, setProject] = useState<RouteProject>(() =>
        loadRoutePlannerDraft(mode, teamId) ?? createDraftRouteProject(mode, baseSource, routeId, teamId)
    );

    useEffect(() => {
        setProject((current) => syncDraftRouteProjectSource(current, mode, baseSource, routeId));
    }, [baseSource, mode, routeId]);

    useEffect(() => {
        if (teamId === undefined) return;
        setProject((current) => ({ ...current, teamId: teamId ?? null }));
    }, [teamId]);

    useEffect(() => {
        saveRoutePlannerDraft(mode, project, teamId);
    }, [mode, project, teamId]);

    const updateProjectName = (value: string): void => {
        setProject((current) => ({ ...current, name: value, updatedAt: new Date() }));
    };

    const updateProjectDescription = (value: string): void => {
        setProject((current) => ({ ...current, description: value, updatedAt: new Date() }));
    };

    const updateScenarioNotes = (value: string): void => {
        setProject((current) => ({
            ...current,
            scenarios: current.scenarios.map((scenario, index) =>
                index === 0
                    ? { ...scenario, notes: value }
                    : scenario
            ),
            updatedAt: new Date(),
        }));
    };

    return {
        project,
        updateProjectName,
        updateProjectDescription,
        updateScenarioNotes,
    };
}
