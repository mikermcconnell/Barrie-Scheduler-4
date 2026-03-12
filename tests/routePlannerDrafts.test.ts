import { describe, expect, it } from 'vitest';
import { createDraftRouteProject, syncDraftRouteProjectSource } from '../utils/route-planner/routePlannerDrafts';

describe('createDraftRouteProject', () => {
    it('creates an existing-route-tweak draft from a Barrie route template', () => {
        const project = createDraftRouteProject('existing-route-tweak', 'existing-route', '10', 'team-1');

        expect(project.name).toBe('Route 10 Tweak Study');
        expect(project.scenarios[0]?.scenarioType).toBe('existing-route-tweak');
        expect(project.scenarios[0]?.baseSource.kind).toBe('existing_route');
        expect(project.scenarios[0]?.pattern).toBe('loop');
    });

    it('creates a blank route concept draft', () => {
        const project = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');

        expect(project.name).toBe('Route Concept Study');
        expect(project.scenarios[0]?.scenarioType).toBe('route-concept');
        expect(project.scenarios[0]?.baseSource.kind).toBe('blank');
        expect(project.scenarios[0]?.pattern).toBe('out-and-back');
    });
});

describe('syncDraftRouteProjectSource', () => {
    it('updates the scenario source while preserving editable notes', () => {
        const original = createDraftRouteProject('route-concept', 'blank', '1', 'team-1');
        const withNotes = {
            ...original,
            scenarios: [{
                ...original.scenarios[0],
                notes: 'Planner note to keep.',
            }],
        };

        const updated = syncDraftRouteProjectSource(withNotes, 'route-concept', 'existing-route', '400');

        expect(updated.scenarios[0]?.baseSource.kind).toBe('existing_route');
        expect(updated.scenarios[0]?.baseSource.sourceId).toBe('400');
        expect(updated.scenarios[0]?.notes).toBe('Planner note to keep.');
    });
});
