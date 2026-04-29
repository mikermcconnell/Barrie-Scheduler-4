import { describe, expect, it } from 'vitest';

import { addRoutePlanner2Stop, updateRoutePlanner2StopRole } from '../utils/route-planner-2/routePlanner2Authoring';
import { deriveRoutePlanner2Feasibility, updateRoutePlanner2Service } from '../utils/route-planner-2/routePlanner2Feasibility';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 feasibility', () => {
  const now = '2026-04-29T12:00:00.000Z';

  function validTwoStopProject() {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Start', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'End', lat: 44.4, lng: -79.65, now });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'end-terminal', now);
    return project;
  }

  it('returns not-ready output when required stops and terminals are missing', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.confidence).toBe('not-ready');
    expect(result.oneWayRuntimeMinutes).toBeNull();
    expect(result.cycleTimeMinutes).toBeNull();
    expect(result.busesRequired).toBeNull();
    expect(result.warnings.map((warning) => warning.id)).toEqual(expect.arrayContaining([
      'no-stops',
      'missing-start-terminal',
      'missing-end-terminal',
      'fewer-than-two-stops',
    ]));
  });

  it('estimates fallback runtime, cycle time, and buses for a valid local concept', () => {
    const project = validTwoStopProject();
    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.confidence).toBe('low');
    expect(result.oneWayRuntimeMinutes).toBeGreaterThan(0);
    expect(result.cycleTimeMinutes).toBe((result.oneWayRuntimeMinutes! * 2) + 10);
    expect(result.busesRequired).toBe(Math.ceil(result.cycleTimeMinutes! / 30));
    expect(result.segmentSummaries).toHaveLength(1);
    expect(result.segmentSummaries[0]).toMatchObject({
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      source: 'fallback',
      confidence: 'low',
    });
    expect(result.warnings.map((warning) => warning.id)).toContain('fallback-runtime');
  });

  it('blocks invalid frequency and negative layovers', () => {
    let project = validTwoStopProject();
    project = updateRoutePlanner2Service(project, 'scenario-1', {
      frequencyMinutes: 0,
      startTerminalLayoverMinutes: -1,
    }, now);

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.confidence).toBe('not-ready');
    expect(result.warnings.map((warning) => warning.id)).toEqual(expect.arrayContaining([
      'invalid-frequency',
      'invalid-layover',
    ]));
  });

  it('updates service assumptions without touching unknown scenarios', () => {
    const project = validTwoStopProject();
    const updated = updateRoutePlanner2Service(project, 'scenario-1', { frequencyMinutes: 15 }, now);

    expect(updated.scenarios[0]?.service.frequencyMinutes).toBe(15);
    expect(updateRoutePlanner2Service(project, 'missing', { frequencyMinutes: 10 }, now)).toBe(project);
  });
});
