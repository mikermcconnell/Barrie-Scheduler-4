import { describe, expect, it } from 'vitest';

import {
  createRoutePlanner2ProjectCopy,
  createRoutePlanner2BackDirection,
  duplicateRoutePlanner2Scenario,
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

  it('creates a new project copy for Save As without overwriting the original saved file', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    const copy = createRoutePlanner2ProjectCopy(project, {
      id: 'project-copy',
      now: '2026-05-14T13:00:00.000Z',
    });

    expect(copy.id).toBe('project-copy');
    expect(copy.name).toBe('Untitled Route Study copy');
    expect(copy.status).toBe('local-draft');
    expect(copy.createdAt).toBe('2026-05-14T13:00:00.000Z');
    expect(copy.updatedAt).toBe('2026-05-14T13:00:00.000Z');
    expect(project.id).toBe('project-1');
  });

  it('duplicates a route concept with fresh internal stop, bend, and runtime ids', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'source-scenario', now });
    project = addRoutePlanner2Stop(project, 'source-scenario', { id: 'stop-1', name: 'Start', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'source-scenario', { id: 'stop-2', name: 'End', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2LineWaypoint(project, 'source-scenario', {
      id: 'bend-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.385,
      lng: -79.685,
      now,
    });
    const sourceScenario = project.scenarios.find((scenario) => scenario.id === 'source-scenario')!;
    project = {
      ...project,
      scenarios: project.scenarios.map((scenario) => scenario.id === 'source-scenario'
        ? {
          ...scenario,
          routeFamily: {
            key: 'route-400',
            name: 'Route 400',
            shortName: '400',
            memberShortName: '400 Out',
            directionRole: 'out',
            directionLabel: 'Outbound',
          },
          runtimeEstimates: [{
            id: 'runtime-1',
            fromStopId: 'stop-1',
            toStopId: 'stop-2',
            runtimeMinutes: 8,
            source: 'mapbox',
            confidence: 'high',
          }],
          runtimeOverrides: {
            'runtime-1': {
              runtimeMinutes: 10,
              updatedAt: now,
            },
          },
          feasibility: {
            oneWayRuntimeMinutes: 8,
            segmentRuntimeMinutes: 8,
            dwellTimeMinutes: 0,
            intermediateStopCount: 0,
            cycleTimeMinutes: 18,
            busesRequired: 1,
            recoveryTimeMinutes: 2,
            recoveryPercent: 11,
            confidence: 'high',
            segmentSummaries: [{
              id: 'runtime-1',
              fromStopId: 'stop-1',
              toStopId: 'stop-2',
              runtimeMinutes: 8,
              source: 'mapbox',
              confidence: 'high',
            }],
            warnings: [{ id: 'warning-1', severity: 'info', message: 'Looks good' }],
          },
        }
        : scenario),
    };

    const updated = duplicateRoutePlanner2Scenario(project, 'source-scenario', {
      id: 'copy-scenario',
      now: '2026-05-14T13:00:00.000Z',
    });
    const copy = updated.scenarios.find((scenario) => scenario.id === 'copy-scenario')!;

    expect(copy.name).toBe(`${sourceScenario.name} copy`);
    expect(copy.routeFamily).toBeUndefined();
    expect(copy.stops).toHaveLength(2);
    expect(copy.stops.map((stop) => stop.id)).not.toEqual(['stop-1', 'stop-2']);
    expect(copy.alignment[0]?.id).not.toBe('bend-1');
    expect(copy.alignment[0]?.afterStopId).toBe(copy.stops[0]?.id);
    expect(copy.alignment[0]?.beforeStopId).toBe(copy.stops[1]?.id);
    expect(copy.runtimeEstimates?.[0]?.id).not.toBe('runtime-1');
    expect(copy.runtimeEstimates?.[0]?.fromStopId).toBe(copy.stops[0]?.id);
    expect(copy.runtimeEstimates?.[0]?.toStopId).toBe(copy.stops[1]?.id);
    expect(Object.keys(copy.runtimeOverrides ?? {})).toEqual([copy.runtimeEstimates?.[0]?.id]);
    expect(copy.feasibility?.segmentSummaries[0]?.fromStopId).toBe(copy.stops[0]?.id);
    expect(copy.feasibility?.warnings[0]?.id).not.toBe('warning-1');
  });
});
