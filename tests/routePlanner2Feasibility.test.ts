import { describe, expect, it } from 'vitest';

import {
  addRoutePlanner2Stop,
  setRoutePlanner2SegmentRuntimeOverride,
  updateRoutePlanner2SegmentRuntimeEstimates,
  updateRoutePlanner2StopRole,
} from '../utils/route-planner-2/routePlanner2Authoring';
import { deriveRoutePlanner2Feasibility, updateRoutePlanner2Service } from '../utils/route-planner-2/routePlanner2Feasibility';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import { buildRoutePlanner2StopSegmentPaths } from '../utils/route-planner-2/routePlanner2Segments';

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
    expect(result.segmentRuntimeMinutes).toBe(result.oneWayRuntimeMinutes);
    expect(result.dwellTimeMinutes).toBe(0);
    expect(result.intermediateStopCount).toBe(0);
    expect(result.segmentSummaries[0]).toMatchObject({
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      source: 'fallback',
      confidence: 'low',
    });
    expect(result.warnings.map((warning) => warning.id)).toContain('fallback-runtime');
  });

  it('adds intermediate stop dwell allowance separately from terminal layover', () => {
    let project = validTwoStopProject();
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Middle', lat: 44.39, lng: -79.67, now });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'regular', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-3', 'end-terminal', now);
    project = updateRoutePlanner2Service(project, 'scenario-1', { intermediateStopDwellSeconds: 90 }, now);

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.intermediateStopCount).toBe(1);
    expect(result.dwellTimeMinutes).toBe(2);
    expect(result.oneWayRuntimeMinutes).toBe((result.segmentRuntimeMinutes ?? 0) + 2);
    expect(result.cycleTimeMinutes).toBe((result.oneWayRuntimeMinutes! * 2) + 10);
  });

  it('uses current Mapbox segment estimates before fallback assumptions', () => {
    let project = validTwoStopProject();
    const segmentPath = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!)[0]!;

    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [{
      id: segmentPath.id,
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      runtimeMinutes: 7,
      source: 'mapbox',
      confidence: 'medium',
      distanceKm: 3.4,
      durationSeconds: 420,
      pathFingerprint: segmentPath.pathFingerprint,
      updatedAt: now,
    }], now);

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.confidence).toBe('medium');
    expect(result.oneWayRuntimeMinutes).toBe(7);
    expect(result.segmentSummaries[0]).toMatchObject({
      runtimeMinutes: 7,
      source: 'mapbox',
      confidence: 'medium',
      distanceKm: 3.4,
    });
    expect(result.warnings.map((warning) => warning.id)).not.toContain('fallback-runtime');
  });

  it('uses manual segment overrides before Mapbox estimates', () => {
    let project = validTwoStopProject();
    const segmentPath = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!)[0]!;

    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [{
      id: segmentPath.id,
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      runtimeMinutes: 7,
      source: 'mapbox',
      confidence: 'medium',
      pathFingerprint: segmentPath.pathFingerprint,
      updatedAt: now,
    }], now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', segmentPath.id, 11, now);

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.oneWayRuntimeMinutes).toBe(11);
    expect(result.segmentSummaries[0]).toMatchObject({
      runtimeMinutes: 11,
      source: 'manual',
      confidence: 'medium',
    });
  });

  it('ignores stale Mapbox estimates when the segment path has changed', () => {
    let project = validTwoStopProject();

    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [{
      id: 'segment-stop-1-stop-2',
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      runtimeMinutes: 7,
      source: 'mapbox',
      confidence: 'medium',
      pathFingerprint: 'old-path',
      updatedAt: now,
    }], now);

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.segmentSummaries[0]?.source).toBe('fallback');
    expect(result.warnings.map((warning) => warning.id)).toContain('fallback-runtime');
  });

  it('blocks invalid frequency and negative layovers', () => {
    let project = validTwoStopProject();
    project = updateRoutePlanner2Service(project, 'scenario-1', {
      frequencyMinutes: 0,
      startTerminalLayoverMinutes: -1,
      intermediateStopDwellSeconds: -1,
    }, now);

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.confidence).toBe('not-ready');
    expect(result.warnings.map((warning) => warning.id)).toEqual(expect.arrayContaining([
      'invalid-frequency',
      'invalid-layover',
      'invalid-dwell',
    ]));
  });

  it('updates service assumptions without touching unknown scenarios', () => {
    const project = validTwoStopProject();
    const updated = updateRoutePlanner2Service(project, 'scenario-1', { frequencyMinutes: 15 }, now);

    expect(updated.scenarios[0]?.service.frequencyMinutes).toBe(15);
    expect(updateRoutePlanner2Service(project, 'missing', { frequencyMinutes: 10 }, now)).toBe(project);
  });
});
