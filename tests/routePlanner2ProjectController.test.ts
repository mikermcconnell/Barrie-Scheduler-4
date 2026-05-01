import { describe, expect, it } from 'vitest';

import { createRoutePlanner2Project, createRoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import {
  addRoutePlanner2Scenario,
  deleteRoutePlanner2Scenario,
  duplicateRoutePlanner2Scenario,
  importRoutePlanner2Scenario,
  markRoutePlanner2PreferredScenario,
  renameRoutePlanner2Project,
  renameRoutePlanner2Scenario,
  selectRoutePlanner2Scenario,
} from '../utils/route-planner-2/routePlanner2ProjectController';

describe('Route Planner 2 project controller', () => {
  const now = '2026-04-29T12:00:00.000Z';

  it('renames projects and scenarios without changing IDs', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    project = renameRoutePlanner2Project(project, 'Downtown Concept', now);
    project = renameRoutePlanner2Scenario(project, 'scenario-1', 'Option A', now);

    expect(project.name).toBe('Downtown Concept');
    expect(project.scenarios[0]?.name).toBe('Option A');
    expect(project.status).toBe('local-draft');
  });

  it('adds, selects, duplicates, and marks one preferred scenario at project level', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    project = addRoutePlanner2Scenario(project, { id: 'scenario-2', now });
    expect(project.selectedScenarioId).toBe('scenario-2');
    expect(project.scenarios).toHaveLength(2);

    project = selectRoutePlanner2Scenario(project, 'scenario-1', now);
    expect(project.selectedScenarioId).toBe('scenario-1');

    project = markRoutePlanner2PreferredScenario(project, 'scenario-1', now);
    expect(project.preferredScenarioId).toBe('scenario-1');
    expect(project.scenarios[0]?.status).toBe('draft');

    project = duplicateRoutePlanner2Scenario(project, 'scenario-1', { id: 'scenario-3', now });
    expect(project.selectedScenarioId).toBe('scenario-3');
    expect(project.scenarios).toHaveLength(3);
    expect(project.scenarios[2]).toMatchObject({
      id: 'scenario-3',
      name: 'Clean Concept A copy',
      status: 'draft',
    });
    expect(project.preferredScenarioId).toBe('scenario-1');
  });

  it('imports a GTFS scenario and selects it', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-01T12:00:00.000Z' });
    const imported = createRoutePlanner2Scenario({ id: 'scenario-gtfs', name: 'Route 8A', now: '2026-05-01T12:01:00.000Z' });
    const result = importRoutePlanner2Scenario(project, { ...imported, source: { type: 'gtfs', routeId: '8A' } }, '2026-05-01T12:02:00.000Z');

    expect(result.scenarios).toHaveLength(2);
    expect(result.selectedScenarioId).toBe('scenario-gtfs');
    expect(result.status).toBe('local-draft');
    expect(result.scenarios[1]?.source?.type).toBe('gtfs');
  });

  it('returns the original project for unknown scenario IDs', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    expect(renameRoutePlanner2Scenario(project, 'missing', 'Nope', now)).toBe(project);
    expect(selectRoutePlanner2Scenario(project, 'missing', now)).toBe(project);
    expect(markRoutePlanner2PreferredScenario(project, 'missing', now)).toBe(project);
    expect(duplicateRoutePlanner2Scenario(project, 'missing', { id: 'scenario-2', now })).toBe(project);
    expect(deleteRoutePlanner2Scenario(project, 'missing', now)).toBe(project);
  });

  it('protects the last scenario and cleans up selection/preferred state on delete', () => {
    const single = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    expect(deleteRoutePlanner2Scenario(single, 'scenario-1', now)).toBe(single);

    let project = addRoutePlanner2Scenario(single, { id: 'scenario-2', now });
    project = markRoutePlanner2PreferredScenario(project, 'scenario-2', now);
    project = deleteRoutePlanner2Scenario(project, 'scenario-2', now);

    expect(project.scenarios).toHaveLength(1);
    expect(project.selectedScenarioId).toBe('scenario-1');
    expect(project.preferredScenarioId).toBeUndefined();
  });
});
