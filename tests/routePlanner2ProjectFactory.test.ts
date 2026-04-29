import { describe, expect, it } from 'vitest';

import { createRoutePlanner2Project, createRoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 project factory', () => {
  const now = '2026-04-29T12:00:00.000Z';

  it('creates a local draft project with one selected blank scenario', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', now, scenarioId: 'scenario-1' });

    expect(project.name).toBe('Untitled Route Study');
    expect(project.status).toBe('local-draft');
    expect(project.selectedScenarioId).toBe('scenario-1');
    expect(project.preferredScenarioId).toBeUndefined();
    expect(project.scenarios).toHaveLength(1);
    expect(project.scenarios[0]).toMatchObject({
      id: 'scenario-1',
      name: 'Clean Concept A',
      status: 'draft',
      alignment: [],
      stops: [],
      notes: 'Blank route concept. Add an alignment and stops before running feasibility checks.',
      createdAt: now,
      updatedAt: now,
    });
    expect(project.scenarios[0]?.service).toEqual({
      firstTripTime: '06:00',
      lastTripTime: '22:00',
      frequencyMinutes: 30,
      startTerminalLayoverMinutes: 5,
      endTerminalLayoverMinutes: 5,
    });
  });

  it('creates a scenario without a preferred status', () => {
    const scenario = createRoutePlanner2Scenario({ id: 'scenario-2', name: 'Option B', now });

    expect(scenario.id).toBe('scenario-2');
    expect(scenario.name).toBe('Option B');
    expect(scenario.status).toBe('draft');
    expect(Object.prototype.hasOwnProperty.call(scenario, 'preferredScenarioId')).toBe(false);
  });
});
