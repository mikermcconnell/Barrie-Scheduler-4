import { describe, expect, it } from 'vitest';
import { buildRouteScenarioSeed, createDraftRouteProject, syncDraftRouteProjectSource } from '../utils/route-planner/routePlannerDrafts';
import { ROUTE_CONTROL_POINT_LIMITS } from '../utils/route-planner/routePlannerControlPoints';

describe('createDraftRouteProject', () => {
    it('creates an existing-route-tweak draft from a Barrie route template', () => {
        const project = createDraftRouteProject('existing-route-tweak', 'existing-route', '10', 'team-1');
        const baselineScenario = project.scenarios[0];
        const workingScenario = project.scenarios[1];

        expect(project.name).toBe('Route 10 Tweak Study');
        expect(project.scenarios).toHaveLength(2);
        expect(project.preferredScenarioId).toBe(workingScenario?.id);
        expect(baselineScenario?.name).toBe('Route 10 Current GTFS');
        expect(workingScenario?.scenarioType).toBe('existing-route-tweak');
        expect(workingScenario?.baseSource.kind).toBe('existing_route');
        expect(workingScenario?.pattern).toBe('loop');
        expect(workingScenario?.waypoints.length).toBeGreaterThan(1);
        expect(workingScenario?.geometry.coordinates.length).toBeGreaterThan(1);
        expect(workingScenario?.waypoints.length).toBeLessThan(workingScenario?.geometry.coordinates.length ?? 0);
        expect(workingScenario?.waypoints.length).toBeLessThanOrEqual(ROUTE_CONTROL_POINT_LIMITS.max);
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

    it('hydrates an empty existing-route draft that was created before template seeding existed', () => {
        const original = createDraftRouteProject('existing-route-tweak', 'existing-route', '2', 'team-1');
        const legacyEmptyDraft = {
            ...original,
            scenarios: [{
                ...original.scenarios[1],
                notes: 'Custom note should stay.',
                waypoints: [],
                geometry: { type: 'LineString' as const, coordinates: [] },
                stops: [],
            }],
        };

        const updated = syncDraftRouteProjectSource(legacyEmptyDraft, 'existing-route-tweak', 'existing-route', '2');

        expect(updated.scenarios).toHaveLength(2);
        expect(updated.scenarios[0]?.name).toBe('Route 2 Current GTFS');
        expect(updated.scenarios[1]?.waypoints.length).toBeGreaterThan(1);
        expect(updated.scenarios[1]?.geometry.coordinates.length).toBeGreaterThan(1);
        expect(updated.scenarios[1]?.notes).toBe('Custom note should stay.');
    });

    it('re-seeds geometry when switching from one existing route template to another', () => {
        const original = createDraftRouteProject('existing-route-tweak', 'existing-route', '11', 'team-1');
        const originalScenario = original.scenarios[1];

        const updated = syncDraftRouteProjectSource(original, 'existing-route-tweak', 'existing-route', '10');
        const updatedScenario = updated.scenarios[1];

        expect(originalScenario?.baseSource.sourceId).toBe('11');
        expect(updatedScenario?.baseSource.sourceId).toBe('10');
        expect(updatedScenario?.name).toBe('Route 10 Tweak');
        expect(updatedScenario?.waypoints.length).toBeGreaterThan(1);
        expect(updatedScenario?.geometry.coordinates.length).toBeGreaterThan(1);
        expect(updatedScenario?.geometry.coordinates).not.toEqual(originalScenario?.geometry.coordinates);
    });

    it('builds GTFS reset seeds with simplified control points and full geometry', () => {
        const seed = buildRouteScenarioSeed('existing-route', '10', 'loop');

        expect(seed.waypoints.length).toBeGreaterThan(1);
        expect(seed.geometry.coordinates.length).toBeGreaterThan(seed.waypoints.length);
        expect(seed.waypoints.length).toBeLessThanOrEqual(ROUTE_CONTROL_POINT_LIMITS.max);
    });
});
