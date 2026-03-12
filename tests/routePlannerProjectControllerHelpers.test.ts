import { describe, expect, it } from 'vitest';
import { createDraftRouteProject } from '../utils/route-planner/routePlannerDrafts';
import {
    buildRoutePlannerSavePayload,
    filterRoutePlannerProjectsByTeam,
    resolveActiveRoutePlannerProject,
} from '../utils/route-planner/routePlannerProjectControllerHelpers';

describe('routePlannerProjectControllerHelpers', () => {
    it('filters saved projects to the active team', () => {
        const teamOne = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');
        const teamTwo = createDraftRouteProject('route-concept', 'blank', '2', 'team-2');

        const filtered = filterRoutePlannerProjectsByTeam([teamOne, teamTwo], 'team-1');

        expect(filtered).toEqual([teamOne]);
    });

    it('keeps the current local draft active when saved projects load', () => {
        const localDraft = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');
        const savedProject = {
            ...createDraftRouteProject('route-concept', 'existing-route', '2', 'team-1'),
            id: 'saved-project-1',
        };

        const resolved = resolveActiveRoutePlannerProject({
            loadedProjects: [savedProject],
            currentProject: localDraft,
            currentProjectIsLocalDraft: true,
            localDraftProject: localDraft,
        });

        expect(resolved?.id).toBe(localDraft.id);
    });

    it('creates duplicate-save payloads without reusing the original id', () => {
        const project = {
            ...createDraftRouteProject('route-concept', 'blank', '1', 'team-1'),
            id: 'saved-project-1',
        };

        const payload = buildRoutePlannerSavePayload(project, {
            teamId: 'team-1',
            preserveProjectId: false,
            nameOverride: `${project.name} (Copy)`,
        });

        expect(payload.id).toBeUndefined();
        expect(payload.name).toContain('(Copy)');
        expect(payload.teamId).toBe('team-1');
    });
});
