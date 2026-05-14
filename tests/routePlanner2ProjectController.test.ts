import { describe, expect, it } from 'vitest';

import {
  createRoutePlanner2BackDirection,
} from '../utils/route-planner-2/routePlanner2ProjectController';
import {
  addRoutePlanner2LineWaypoint,
  addRoutePlanner2Stop,
  updateRoutePlanner2StopRole,
} from '../utils/route-planner-2/routePlanner2Authoring';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 project controller', () => {
  const now = '2026-05-14T12:00:00.000Z';

  it('creates a back direction by reversing the selected one-way out route', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'out-scenario', now });
    project = addRoutePlanner2Stop(project, 'out-scenario', { id: 'stop-1', name: 'Neighbourhood', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'out-scenario', { id: 'stop-2', name: 'Community Centre', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'out-scenario', { id: 'stop-3', name: 'Camp', lat: 44.4, lng: -79.67, now });
    project = updateRoutePlanner2StopRole(project, 'out-scenario', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'out-scenario', 'stop-3', 'end-terminal', now);
    project = addRoutePlanner2LineWaypoint(project, 'out-scenario', {
      id: 'bend-1',
      afterStopId: 'stop-2',
      beforeStopId: 'stop-3',
      lat: 44.395,
      lng: -79.675,
      now,
    });

    const updated = createRoutePlanner2BackDirection(project, 'out-scenario', {
      id: 'back-scenario',
      now,
    });
    const outScenario = updated.scenarios.find((scenario) => scenario.id === 'out-scenario');
    const backScenario = updated.scenarios.find((scenario) => scenario.id === 'back-scenario');

    expect(updated.selectedScenarioId).toBe('back-scenario');
    expect(outScenario?.name).toBe('Clean Concept A Out');
    expect(backScenario?.name).toBe('Clean Concept A Back');
    expect(backScenario?.routeShape).toBe('one-way');
    expect(backScenario?.stops.map((stop) => `${stop.sequence}:${stop.id}:${stop.role}`)).toEqual([
      '1:stop-3:start-terminal',
      '2:stop-2:regular',
      '3:stop-1:end-terminal',
    ]);
    expect(backScenario?.alignment).toEqual([
      expect.objectContaining({
        id: 'bend-1-back',
        afterStopId: 'stop-3',
        beforeStopId: 'stop-2',
        lat: 44.395,
        lng: -79.675,
      }),
    ]);
    expect(backScenario?.feasibility).toBeUndefined();
    expect(backScenario?.runtimeEstimates).toBeUndefined();
  });
});
