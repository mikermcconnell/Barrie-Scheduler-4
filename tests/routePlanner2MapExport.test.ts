import { describe, expect, it, vi } from 'vitest';

import { addRoutePlanner2Stop, updateRoutePlanner2StopRole } from '../utils/route-planner-2/routePlanner2Authoring';
import { buildRoutePlanner2MapExportPlan } from '../utils/route-planner-2/routePlanner2MapExport';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 map export', () => {
  const now = '2026-05-15T12:00:00.000Z';

  it('builds a map-first export plan with kids callouts and route road labels', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-1',
      name: 'Sadlon Arena',
      lat: 44.34,
      lng: -79.69,
      role: 'start-terminal',
      now,
    });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-2',
      name: 'Johnson pickup',
      lat: 44.41,
      lng: -79.66,
      now,
    });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'end-terminal', now);
    project = {
      ...project,
      scenarios: [{
        ...project.scenarios[0]!,
        stops: project.scenarios[0]!.stops.map((stop) =>
          stop.id === 'stop-2'
            ? { ...stop, address: '304 Johnson Street, Barrie, ON L4M 5C3', riderCount: 2, sourceRows: [4, 8] }
            : stop,
        ),
      }],
    };

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          legs: [{
            steps: [
              { name: 'Mapleview Drive', maneuver: { instruction: 'Head east on Mapleview Drive' }, distance: 500, duration: 60 },
              { name: 'Yonge Street', maneuver: { instruction: 'Turn left onto Yonge Street' }, distance: 1200, duration: 180 },
              { name: 'Yonge Street', maneuver: { instruction: 'Continue on Yonge Street' }, distance: 800, duration: 120 },
            ],
          }],
        }],
      }),
    })) as unknown as typeof fetch;

    const plan = await buildRoutePlanner2MapExportPlan(project.scenarios[0]!, {
      projectName: 'Camp Access - July 14 to July 18',
      routeLabel: 'Route 1 Morning',
      token: 'token-123',
      fetchImpl,
      now: new Date('2026-05-15T12:00:00.000Z'),
    });

    expect(plan.title).toBe('Camp Access - July 14 to July 18 - Route 1 Morning');
    expect(plan.stopCallouts.map((callout) => callout.label)).toContain('304 Johnson Street - 2 Kids');
    expect(plan.stopCallouts.find((callout) => callout.stopId === 'stop-1')?.badge).toBe('Start');
    expect(plan.stopCallouts.find((callout) => callout.stopId === 'stop-2')?.badge).toBe('End');
    expect(plan.roadLabels.map((label) => label.name)).toEqual(['Mapleview Drive', 'Yonge Street']);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
