import { describe, expect, it } from 'vitest';
import { createDraftRouteProject, syncDraftRouteProjectSource } from '../utils/route-planner/routePlannerDrafts';
import {
    deleteRouteScenario,
    duplicateRouteScenario,
    markPreferredRouteScenario,
} from '../utils/route-planner/routePlannerProjectState';

describe('routePlannerProjectState', () => {
    it('duplicates a scenario and keeps the project compare-ready', () => {
        const project = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');

        const duplicated = duplicateRouteScenario(project, project.scenarios[0]!.id);

        expect(duplicated).not.toBeNull();
        expect(duplicated?.project.scenarios).toHaveLength(2);
        expect(duplicated?.project.scenarios[1]?.name).toContain('Option');
    });

    it('deletes a scenario and falls back to the next scenario', () => {
        const project = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');
        const duplicated = duplicateRouteScenario(project, project.scenarios[0]!.id)!;

        const deleted = deleteRouteScenario(duplicated.project, duplicated.duplicatedScenarioId);

        expect(deleted).not.toBeNull();
        expect(deleted?.project.scenarios).toHaveLength(1);
        expect(deleted?.nextSelectedScenarioId).toBe(project.scenarios[0]?.id ?? null);
    });

    it('marks a selected scenario as preferred', () => {
        const project = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');
        const duplicated = duplicateRouteScenario(project, project.scenarios[0]!.id)!;

        const preferred = markPreferredRouteScenario(duplicated.project, duplicated.duplicatedScenarioId);

        expect(preferred.preferredScenarioId).toBe(duplicated.duplicatedScenarioId);
    });

    it('syncs source changes across duplicated scenarios', () => {
        const project = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');
        const duplicated = duplicateRouteScenario(project, project.scenarios[0]!.id)!;

        const updated = syncDraftRouteProjectSource(duplicated.project, 'route-concept', 'existing-route', '400');

        expect(updated.scenarios.every((scenario) => scenario.baseSource.sourceId === '400')).toBe(true);
        expect(updated.scenarios.every((scenario) => scenario.baseSource.kind === 'existing_route')).toBe(true);
    });
});
