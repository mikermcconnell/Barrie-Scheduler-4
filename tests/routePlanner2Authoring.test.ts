import { describe, expect, it } from 'vitest';

import {
  addRoutePlanner2RoutePoint,
  addRoutePlanner2Stop,
  deleteRoutePlanner2Stop,
  moveRoutePlanner2Stop,
  renameRoutePlanner2Stop,
  updateRoutePlanner2StopRole,
  validateRoutePlanner2Terminals,
} from '../utils/route-planner-2/routePlanner2Authoring';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 authoring', () => {
  const now = '2026-04-29T12:00:00.000Z';

  it('adds ordered route points and stops to a scenario', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    project = addRoutePlanner2RoutePoint(project, 'scenario-1', { id: 'point-1', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2RoutePoint(project, 'scenario-1', { id: 'point-2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Terminal A', lat: 44.38, lng: -79.69, now });

    const scenario = project.scenarios[0];
    expect(scenario?.alignment.map((point) => point.sequence)).toEqual([1, 2]);
    expect(scenario?.stops[0]).toMatchObject({
      id: 'stop-1',
      name: 'Terminal A',
      sequence: 1,
      role: 'regular',
      source: 'custom',
    });
  });

  it('renames, marks roles, moves, and deletes stops while preserving order', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'First', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Second', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Third', lat: 44.4, lng: -79.67, now });

    project = renameRoutePlanner2Stop(project, 'scenario-1', 'stop-2', 'Middle', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-3', 'end-terminal', now);
    project = moveRoutePlanner2Stop(project, 'scenario-1', 'stop-3', 'up', now);

    expect(project.scenarios[0]?.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}`)).toEqual([
      '1:First:start-terminal',
      '2:Third:end-terminal',
      '3:Middle:regular',
    ]);

    project = deleteRoutePlanner2Stop(project, 'scenario-1', 'stop-3', now);
    expect(project.scenarios[0]?.stops.map((stop) => `${stop.sequence}:${stop.name}`)).toEqual([
      '1:First',
      '2:Middle',
    ]);
  });

  it('generates terminal warnings until the concept has valid terminal roles', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    let scenario = project.scenarios[0]!;

    expect(validateRoutePlanner2Terminals(scenario).map((warning) => warning.id)).toContain('no-stops');

    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'A', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'B', lat: 44.39, lng: -79.68, now });
    scenario = project.scenarios[0]!;
    expect(validateRoutePlanner2Terminals(scenario).map((warning) => warning.id)).toEqual([
      'missing-start-terminal',
      'missing-end-terminal',
    ]);

    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'end-terminal', now);
    scenario = project.scenarios[0]!;
    expect(validateRoutePlanner2Terminals(scenario)).toEqual([]);
  });

  it('returns the original project for unknown scenario IDs', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    expect(addRoutePlanner2Stop(project, 'missing', { id: 'stop-1', name: 'Nope', lat: 44, lng: -79, now })).toBe(project);
    expect(updateRoutePlanner2StopRole(project, 'missing', 'stop-1', 'timed', now)).toBe(project);
    expect(moveRoutePlanner2Stop(project, 'missing', 'stop-1', 'up', now)).toBe(project);
    expect(deleteRoutePlanner2Stop(project, 'missing', 'stop-1', now)).toBe(project);
  });
});
