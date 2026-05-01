import { describe, expect, it } from 'vitest';

import { addRoutePlanner2Stop, updateRoutePlanner2RouteShape } from '../utils/route-planner-2/routePlanner2Authoring';
import { deriveRoutePlanner2Feasibility } from '../utils/route-planner-2/routePlanner2Feasibility';
import { buildRoutePlanner2OperatorDirectionPlan } from '../utils/route-planner-2/routePlanner2OperatorExport';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 operator export', () => {
  const now = '2026-05-01T12:00:00.000Z';

  it('builds a clean fallback operator direction plan from the selected route shape', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Terminal', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Mall', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Hospital', lat: 44.4, lng: -79.66, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'closed-loop', { now });

    const scenario = project.scenarios[0]!;
    const feasibility = deriveRoutePlanner2Feasibility(scenario);
    const plan = await buildRoutePlanner2OperatorDirectionPlan(scenario, {
      projectName: project.name,
      feasibility,
      token: null,
      now: new Date('2026-05-01T12:00:00.000Z'),
    });

    expect(plan.routeName).toBe('Clean Concept A');
    expect(plan.routeShapeLabel).toBe('Closed loop');
    expect(plan.stopSequenceLabel).toBe('1 - 2 - 3 - 1');
    expect(plan.directionSourceLabel).toContain('Planning alignment fallback');
    expect(plan.segments.map((segment) => `${segment.fromStopName}->${segment.toStopName}`)).toEqual([
      '1. Terminal->2. Mall',
      '2. Mall->3. Hospital',
      '3. Hospital->1. Terminal',
    ]);
    expect(plan.segments[0]?.steps[0]?.instruction).toContain('Proceed from Terminal to Mall');
  });
});
