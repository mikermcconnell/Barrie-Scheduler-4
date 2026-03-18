import { describe, expect, it } from 'vitest';
import { buildRouteScenarioSeed, createDraftRouteProject, syncDraftRouteProjectSource } from '../utils/route-planner/routePlannerDrafts';
import { ROUTE_CONTROL_POINT_LIMITS } from '../utils/route-planner/routePlannerControlPoints';
import type { RoutePlannerMasterServiceSeed } from '../utils/route-planner/routePlannerMasterSchedule';
import type { RouteStop } from '../utils/route-planner/routePlannerTypes';

const masterServiceSeed: RoutePlannerMasterServiceSeed = {
    routeNumber: '10',
    dayType: 'Weekday',
    updatedAt: new Date('2026-03-16T12:00:00Z'),
    firstDeparture: '05:45',
    lastDeparture: '23:10',
    frequencyMinutes: 15,
    layoverMinutes: 7,
    seededStops: [
        {
            id: 'master-9006-1',
            name: 'Barrie Allandale Transit Terminal',
            kind: 'existing',
            sourceStopId: '9006',
            role: 'terminal',
            latitude: 44.3742472026524,
            longitude: -79.689689905126,
            timeLabel: '05:45',
            plannedOffsetMinutes: null,
        },
        {
            id: 'master-330-2',
            name: 'Georgian College',
            kind: 'existing',
            sourceStopId: '330',
            role: 'timed',
            latitude: 44.4120865709833,
            longitude: -79.6691320639331,
            timeLabel: '06:05',
            plannedOffsetMinutes: 20,
        },
        {
            id: 'master-9006-3',
            name: 'Barrie Allandale Transit Terminal',
            kind: 'existing',
            sourceStopId: '9006',
            role: 'terminal',
            latitude: 44.3742472026524,
            longitude: -79.689689905126,
            timeLabel: '05:45',
            plannedOffsetMinutes: null,
        },
    ],
};

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

    it('seeds existing-route service definition values from the latest master schedule', () => {
        const project = createDraftRouteProject('existing-route-tweak', 'existing-route', '10', 'team-1', masterServiceSeed);

        expect(project.scenarios[0]?.firstDeparture).toBe('05:45');
        expect(project.scenarios[0]?.lastDeparture).toBe('23:10');
        expect(project.scenarios[0]?.frequencyMinutes).toBe(15);
        expect(project.scenarios[0]?.layoverMinutes).toBe(7);
        expect(project.scenarios[0]?.stops).toHaveLength(masterServiceSeed.seededStops.length);
        expect(project.scenarios[0]?.stops.map((stop) => stop.sourceStopId)).toEqual(
            masterServiceSeed.seededStops.map((stop) => stop.sourceStopId)
        );
        expect(project.scenarios[0]?.stops.map((stop) => stop.role)).toEqual(
            masterServiceSeed.seededStops.map((stop) => stop.role)
        );
        expect(project.scenarios[1]?.firstDeparture).toBe('05:45');
        expect(project.scenarios[1]?.lastDeparture).toBe('23:10');
        expect(project.scenarios[1]?.frequencyMinutes).toBe(15);
        expect(project.scenarios[1]?.layoverMinutes).toBe(7);
        expect(project.scenarios[1]?.stops).toHaveLength(masterServiceSeed.seededStops.length);
        expect(project.scenarios[1]?.stops.map((stop) => stop.sourceStopId)).toEqual(
            masterServiceSeed.seededStops.map((stop) => stop.sourceStopId)
        );
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
                waypoints: [] as [number, number][],
                geometry: { type: 'LineString' as const, coordinates: [] as [number, number][] },
                stops: [] as RouteStop[],
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

    it('hydrates placeholder service definition values but preserves edited working values', () => {
        const original = createDraftRouteProject('existing-route-tweak', 'existing-route', '10', 'team-1');
        const customWorkingScenario = {
            ...original.scenarios[1],
            firstDeparture: '06:30',
            lastDeparture: '21:15',
            frequencyMinutes: 18,
        };

        const updated = syncDraftRouteProjectSource(
            {
                ...original,
                scenarios: [original.scenarios[0], customWorkingScenario],
            },
            'existing-route-tweak',
            'existing-route',
            '10',
            masterServiceSeed,
        );

        expect(updated.scenarios[0]?.firstDeparture).toBe('05:45');
        expect(updated.scenarios[0]?.lastDeparture).toBe('23:10');
        expect(updated.scenarios[0]?.frequencyMinutes).toBe(15);
        expect(updated.scenarios[0]?.layoverMinutes).toBe(7);
        expect(updated.scenarios[0]?.stops).toHaveLength(masterServiceSeed.seededStops.length);
        expect(updated.scenarios[0]?.stops.map((stop) => stop.sourceStopId)).toEqual(
            masterServiceSeed.seededStops.map((stop) => stop.sourceStopId)
        );
        expect(updated.scenarios[1]?.firstDeparture).toBe('06:30');
        expect(updated.scenarios[1]?.lastDeparture).toBe('21:15');
        expect(updated.scenarios[1]?.frequencyMinutes).toBe(18);
        expect(updated.scenarios[1]?.stops).toHaveLength(masterServiceSeed.seededStops.length);
        expect(updated.scenarios[1]?.stops.map((stop) => stop.sourceStopId)).toEqual(
            masterServiceSeed.seededStops.map((stop) => stop.sourceStopId)
        );
    });

    it('builds GTFS reset seeds with simplified control points and full geometry', () => {
        const seed = buildRouteScenarioSeed('existing-route', '10', 'loop');

        expect(seed.waypoints.length).toBeGreaterThan(1);
        expect(seed.geometry.coordinates.length).toBeGreaterThan(seed.waypoints.length);
        expect(seed.waypoints.length).toBeLessThanOrEqual(ROUTE_CONTROL_POINT_LIMITS.max);
    });
});
