import { describe, expect, it } from 'vitest';

import {
  addRoutePlanner2Stop,
  addRoutePlanner2LineWaypoint,
  deleteRoutePlanner2LineWaypoint,
  insertRoutePlanner2StopBetween,
  setRoutePlanner2SegmentRuntimeOverride,
  updateRoutePlanner2RuntimeSourceMode,
  updateRoutePlanner2SegmentRuntimeEstimates,
  updateRoutePlanner2RouteShape,
  updateRoutePlanner2StopRole,
} from '../utils/route-planner-2/routePlanner2Authoring';
import { deriveRoutePlanner2Feasibility, updateRoutePlanner2Service } from '../utils/route-planner-2/routePlanner2Feasibility';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import { buildRoutePlanner2StopSegmentPaths } from '../utils/route-planner-2/routePlanner2Segments';
import type { RoutePlanner2Project, RoutePlanner2SegmentRuntime } from '../utils/route-planner-2/routePlanner2Types';

describe('Route Planner 2 feasibility', () => {
  const now = '2026-04-29T12:00:00.000Z';

  function validTwoStopProject() {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = updateRoutePlanner2RuntimeSourceMode(project, 'scenario-1', 'gtfs', now);
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Start', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'End', lat: 44.4, lng: -79.65, now });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'end-terminal', now);
    return project;
  }

  function addCurrentEstimate(
    project: RoutePlanner2Project,
    patch: Pick<RoutePlanner2SegmentRuntime, 'runtimeMinutes' | 'source' | 'confidence'>
      & Partial<RoutePlanner2SegmentRuntime>,
    segmentIndex = 0,
  ): RoutePlanner2Project {
    const segmentPath = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!)[segmentIndex]!;
    return updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [{
      id: segmentPath.id,
      fromStopId: segmentPath.fromStopId,
      toStopId: segmentPath.toStopId,
      pathFingerprint: segmentPath.pathFingerprint,
      updatedAt: now,
      ...patch,
    }], now);
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
    expect(result.recoveryTimeMinutes).toBe((result.busesRequired! * 30) - result.cycleTimeMinutes!);
    expect(result.recoveryPercent).toBe(Math.round((result.recoveryTimeMinutes! / result.cycleTimeMinutes!) * 100));
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

  it('uses a target bus count to reflect an existing scheduled service', () => {
    let project = validTwoStopProject();
    project = addCurrentEstimate(project, {
      runtimeMinutes: 42,
      source: 'scheduled-proxy',
      confidence: 'high',
      scheduledRuntimeMinutes: 42,
    });
    project = updateRoutePlanner2Service(project, 'scenario-1', {
      frequencyMinutes: 30,
      targetBuses: 3,
      startTerminalLayoverMinutes: 0,
      endTerminalLayoverMinutes: 0,
    }, now);

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.oneWayRuntimeMinutes).toBe(42);
    expect(result.busesRequired).toBe(3);
    expect(result.cycleTimeMinutes).toBe(90);
    expect(result.recoveryTimeMinutes).toBe(6);
    expect(result.recoveryPercent).toBe(7);
  });

  it('estimates one-way runtime for two stops before terminals are marked', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.4, lng: -79.65, now });

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.confidence).toBe('not-ready');
    expect(result.oneWayRuntimeMinutes).toBeGreaterThan(0);
    expect(result.segmentRuntimeMinutes).toBe(result.oneWayRuntimeMinutes);
    expect(result.segmentSummaries).toHaveLength(1);
    expect(result.cycleTimeMinutes).toBeNull();
    expect(result.busesRequired).toBeNull();
    expect(result.recoveryTimeMinutes).toBeNull();
    expect(result.recoveryPercent).toBeNull();
    expect(result.warnings.map((warning) => warning.id)).toEqual(expect.arrayContaining([
      'missing-start-terminal',
      'missing-end-terminal',
      'fallback-runtime',
    ]));
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

  it('estimates closed loops as one complete loop back to Stop 1', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Stop 3', lat: 44.4, lng: -79.66, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'closed-loop', { now });

    const scenario = project.scenarios[0]!;
    const result = deriveRoutePlanner2Feasibility(scenario);

    expect(scenario.routeShape).toBe('closed-loop');
    expect(result.segmentSummaries.map((segment) => `${segment.fromStopId}->${segment.toStopId}`)).toEqual([
      'stop-1->stop-2',
      'stop-2->stop-3',
      'stop-3->stop-1',
    ]);
    expect(result.cycleTimeMinutes).toBe((result.busesRequired ?? 0) * scenario.service.frequencyMinutes);
    expect(result.recoveryTimeMinutes).toBe((result.cycleTimeMinutes ?? 0) - (result.oneWayRuntimeMinutes ?? 0));
    expect(result.recoveryPercent).toBe(Math.round(((result.recoveryTimeMinutes ?? 0) / (result.oneWayRuntimeMinutes ?? 1)) * 100));
    expect(result.warnings.map((warning) => warning.id)).not.toContain('missing-end-terminal');
    expect(result.recoveryTimeMinutes).toBeGreaterThan(3);
    expect(result.warnings.map((warning) => warning.id)).not.toContain('near-bus-threshold');
  });

  it('estimates out-and-back routes by returning from the turnaround stop in reverse order', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Stop 3', lat: 44.4, lng: -79.66, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-4', name: 'Stop 4', lat: 44.41, lng: -79.64, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { turnaroundStopId: 'stop-3', now });
    project = updateRoutePlanner2Service(project, 'scenario-1', { frequencyMinutes: 45 }, now);

    const scenario = project.scenarios[0]!;
    const result = deriveRoutePlanner2Feasibility(scenario);

    expect(scenario.routeShape).toBe('out-and-back');
    expect(scenario.turnaroundStopId).toBe('stop-3');
    expect(scenario.stops.find((stop) => stop.id === 'stop-3')?.role).toBe('turnaround');
    expect(result.segmentSummaries.map((segment) => `${segment.fromStopId}->${segment.toStopId}`)).toEqual([
      'stop-1->stop-2',
      'stop-2->stop-3',
      'stop-3->stop-2',
      'stop-2->stop-1',
    ]);
    expect(result.cycleTimeMinutes).toBe((result.busesRequired ?? 0) * scenario.service.frequencyMinutes);
    expect(result.recoveryTimeMinutes).toBe((result.cycleTimeMinutes ?? 0) - (result.oneWayRuntimeMinutes ?? 0));
    expect(result.recoveryPercent).toBe(Math.round(((result.recoveryTimeMinutes ?? 0) / (result.oneWayRuntimeMinutes ?? 1)) * 100));
    expect(result.warnings.map((warning) => warning.id)).not.toContain('missing-end-terminal');
    expect(result.recoveryTimeMinutes).toBeGreaterThan(3);
    expect(result.warnings.map((warning) => warning.id)).not.toContain('near-bus-threshold');
  });

  it('automatically uses the far end stop as the out-and-back turnaround', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Stop 3', lat: 44.4, lng: -79.66, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { now });

    const scenario = project.scenarios[0]!;
    const result = deriveRoutePlanner2Feasibility(scenario);

    expect(scenario.routeShape).toBe('out-and-back');
    expect(scenario.turnaroundStopId).toBe('stop-3');
    expect(scenario.stops.find((stop) => stop.id === 'stop-3')?.role).toBe('turnaround');
    expect(result.warnings.map((warning) => warning.id)).not.toContain('missing-turnaround-stop');
    expect(result.cycleTimeMinutes).not.toBeNull();
    expect(result.busesRequired).not.toBeNull();
    expect(result.segmentSummaries.map((segment) => `${segment.fromStopId}->${segment.toStopId}`)).toEqual([
      'stop-1->stop-2',
      'stop-2->stop-3',
      'stop-3->stop-2',
      'stop-2->stop-1',
    ]);
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

  it('counts scheduled proxy evidence in segment runtime totals', () => {
    let project = validTwoStopProject();
    project = addCurrentEstimate(project, {
      runtimeMinutes: 9,
      source: 'scheduled-proxy',
      confidence: 'medium',
      scheduledRuntimeMinutes: 9,
    });

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.segmentRuntimeMinutes).toBe(9);
    expect(result.oneWayRuntimeMinutes).toBe(9);
    expect(result.segmentSummaries[0]).toMatchObject({
      runtimeMinutes: 9,
      source: 'scheduled-proxy',
      confidence: 'medium',
    });
    expect(result.warnings.map((warning) => warning.id)).not.toContain('fallback-runtime');
  });


  it('selects the scheduled runtime estimate for the active GTFS time band', () => {
    const project = validTwoStopProject();
    const segmentPath = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!)[0]!;
    const scenario = {
      ...project.scenarios[0]!,
      service: {
        ...project.scenarios[0]!.service,
        dayType: 'weekday' as const,
        planningPeriod: 'am-peak' as const,
      },
      runtimeEstimates: [
        {
          id: `${segmentPath.id}-full-day`,
          fromStopId: segmentPath.fromStopId,
          toStopId: segmentPath.toStopId,
          runtimeMinutes: 42,
          source: 'scheduled-proxy' as const,
          confidence: 'high' as const,
          scheduledRuntimeMinutes: 42,
          evidenceDayType: 'weekday' as const,
          evidencePeriod: 'full-day' as const,
          updatedAt: now,
        },
        {
          id: `${segmentPath.id}-am-peak`,
          fromStopId: segmentPath.fromStopId,
          toStopId: segmentPath.toStopId,
          runtimeMinutes: 47,
          source: 'scheduled-proxy' as const,
          confidence: 'high' as const,
          scheduledRuntimeMinutes: 47,
          evidenceDayType: 'weekday' as const,
          evidencePeriod: 'am-peak' as const,
          updatedAt: now,
        },
      ],
    };

    const amPeak = deriveRoutePlanner2Feasibility(scenario);
    const fullDay = deriveRoutePlanner2Feasibility({
      ...scenario,
      service: { ...scenario.service, planningPeriod: 'all-day' as const },
    });

    expect(amPeak.segmentRuntimeMinutes).toBe(47);
    expect(amPeak.segmentSummaries[0]?.evidencePeriod).toBe('am-peak');
    expect(fullDay.segmentRuntimeMinutes).toBe(42);
    expect(fullDay.segmentSummaries[0]?.evidencePeriod).toBe('full-day');
  });

  it('uses Mapbox estimates instead of scheduled evidence when Mapbox-only runtime is selected', () => {
    const project = validTwoStopProject();
    const segmentPath = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!)[0]!;
    const scenario = {
      ...project.scenarios[0]!,
      runtimeSourceMode: 'mapbox' as const,
      runtimeEstimates: [
        {
          id: segmentPath.id,
          fromStopId: segmentPath.fromStopId,
          toStopId: segmentPath.toStopId,
          runtimeMinutes: 14,
          source: 'scheduled-proxy' as const,
          confidence: 'high' as const,
          scheduledRuntimeMinutes: 14,
          updatedAt: now,
        },
        {
          id: segmentPath.id,
          fromStopId: segmentPath.fromStopId,
          toStopId: segmentPath.toStopId,
          runtimeMinutes: 7,
          source: 'mapbox' as const,
          confidence: 'medium' as const,
          pathFingerprint: segmentPath.pathFingerprint,
          updatedAt: now,
        },
      ],
    };

    const result = deriveRoutePlanner2Feasibility(scenario);

    expect(result.segmentRuntimeMinutes).toBe(7);
    expect(result.segmentSummaries[0]).toMatchObject({
      runtimeMinutes: 7,
      source: 'mapbox',
      confidence: 'medium',
    });
  });

  it('clears GTFS runtime evidence when switching a route to Mapbox-only runtime', () => {
    let project = validTwoStopProject();
    const segmentPath = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!)[0]!;

    project = {
      ...project,
      scenarios: [{
        ...project.scenarios[0]!,
        runtimeEstimates: [
          {
            id: segmentPath.id,
            fromStopId: segmentPath.fromStopId,
            toStopId: segmentPath.toStopId,
            runtimeMinutes: 14,
            source: 'scheduled-proxy',
            confidence: 'high',
            scheduledRuntimeMinutes: 14,
            updatedAt: now,
          },
          {
            id: segmentPath.id,
            fromStopId: segmentPath.fromStopId,
            toStopId: segmentPath.toStopId,
            runtimeMinutes: 7,
            source: 'mapbox',
            confidence: 'medium',
            pathFingerprint: segmentPath.pathFingerprint,
            updatedAt: now,
          },
        ],
      }],
    };

    project = updateRoutePlanner2RuntimeSourceMode(project, 'scenario-1', 'mapbox', now);

    expect(project.scenarios[0]?.runtimeSourceMode).toBe('mapbox');
    expect(project.scenarios[0]?.runtimeEstimates?.map((estimate) => estimate.source)).toEqual(['mapbox']);
  });

  it('counts observed scheduled blend evidence in segment runtime totals', () => {
    let project = validTwoStopProject();
    project = addCurrentEstimate(project, {
      runtimeMinutes: 12,
      source: 'observed-scheduled-blend',
      confidence: 'medium',
      scheduledRuntimeMinutes: 11,
      observedRuntimeMinutes: 14,
      sampleSize: 4,
    });

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.segmentRuntimeMinutes).toBe(12);
    expect(result.oneWayRuntimeMinutes).toBe(12);
    expect(result.segmentSummaries[0]).toMatchObject({
      runtimeMinutes: 12,
      source: 'observed-scheduled-blend',
      confidence: 'medium',
    });
    expect(result.warnings.map((warning) => warning.id)).not.toContain('fallback-runtime');
  });

  it('counts only fallback segments in the fallback runtime warning', () => {
    let project = validTwoStopProject();
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Middle', lat: 44.39, lng: -79.67, now });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'regular', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-3', 'end-terminal', now);
    project = addCurrentEstimate(project, {
      runtimeMinutes: 8,
      source: 'scheduled-proxy',
      confidence: 'medium',
      scheduledRuntimeMinutes: 8,
    });

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);
    const fallbackWarning = result.warnings.find((warning) => warning.id === 'fallback-runtime');

    expect(result.segmentSummaries.map((segment) => segment.source)).toEqual(['scheduled-proxy', 'fallback']);
    expect(fallbackWarning?.message).toBe('Runtime uses fallback assumptions for 1 segment.');
  });

  it('reports medium confidence when evidence covers at least half of mixed evidence and fallback segments', () => {
    let project = validTwoStopProject();
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Middle', lat: 44.39, lng: -79.67, now });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'regular', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-3', 'end-terminal', now);
    project = addCurrentEstimate(project, {
      runtimeMinutes: 8,
      source: 'scheduled-proxy',
      confidence: 'medium',
      scheduledRuntimeMinutes: 8,
    });

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.segmentSummaries.map((segment) => segment.source)).toEqual(['scheduled-proxy', 'fallback']);
    expect(result.confidence).toBe('medium');
    expect(result.warnings.map((warning) => warning.id)).toContain('fallback-runtime');
  });

  it('reports high confidence when all segments are high-confidence observed proxy evidence', () => {
    let project = validTwoStopProject();
    project = addCurrentEstimate(project, {
      runtimeMinutes: 10,
      source: 'observed-proxy',
      confidence: 'high',
      observedRuntimeMinutes: 10,
      sampleSize: 12,
    });

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.confidence).toBe('high');
  });

  it('reports medium confidence when all segments use scheduled or blended evidence', () => {
    let project = validTwoStopProject();
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Middle', lat: 44.39, lng: -79.67, now });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'regular', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-3', 'end-terminal', now);
    project = addCurrentEstimate(project, {
      runtimeMinutes: 8,
      source: 'scheduled-proxy',
      confidence: 'medium',
      scheduledRuntimeMinutes: 8,
    }, 0);
    project = addCurrentEstimate(project, {
      runtimeMinutes: 6,
      source: 'observed-scheduled-blend',
      confidence: 'medium',
      scheduledRuntimeMinutes: 5,
      observedRuntimeMinutes: 8,
      sampleSize: 4,
    }, 1);

    const result = deriveRoutePlanner2Feasibility(project.scenarios[0]!);

    expect(result.confidence).toBe('medium');
    expect(result.segmentRuntimeMinutes).toBe(14);
    expect(result.warnings.map((warning) => warning.id)).not.toContain('fallback-runtime');
  });

  it('uses scheduled evidence without a path fingerprint when stops still match', () => {
    const project = validTwoStopProject();
    const scenario = project.scenarios[0]!;
    const withoutFingerprint = {
      ...project,
      scenarios: [{
        ...scenario,
        runtimeEstimates: [{
          id: 'segment-stop-1-stop-2',
          fromStopId: 'stop-1',
          toStopId: 'stop-2',
          runtimeMinutes: 9,
          source: 'scheduled-proxy' as const,
          confidence: 'medium' as const,
          updatedAt: now,
        }],
      }],
    };

    const result = deriveRoutePlanner2Feasibility(withoutFingerprint.scenarios[0]!);

    expect(result.segmentSummaries[0]?.source).toBe('scheduled-proxy');
    expect(result.segmentSummaries[0]?.runtimeMinutes).toBe(9);
    expect(result.warnings.map((warning) => warning.id)).not.toContain('fallback-runtime');
  });

  it('inserts an intermediate stop into an existing route segment without rebuilding the whole route', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.4, lng: -79.66, now });
    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'anchor-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.39,
      lng: -79.68,
      now,
    });
    project = insertRoutePlanner2StopBetween(project, 'scenario-1', {
      id: 'stop-inserted',
      name: 'Inserted stop',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      insertAfterWaypointId: 'anchor-1',
      lat: 44.395,
      lng: -79.67,
      now,
    });

    const scenario = project.scenarios[0]!;
    expect(scenario.stops.map((stop) => `${stop.sequence}:${stop.id}`)).toEqual([
      '1:stop-1',
      '2:stop-inserted',
      '3:stop-2',
    ]);
    expect(scenario.alignment.find((point) => point.id === 'anchor-1')).toMatchObject({
      afterStopId: 'stop-1',
      beforeStopId: 'stop-inserted',
    });
  });

  it('deletes route line anchors from the map authoring state', () => {
    let project = validTwoStopProject();
    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'anchor-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.39,
      lng: -79.68,
      now,
    });

    expect(project.scenarios[0]?.alignment).toHaveLength(1);

    project = deleteRoutePlanner2LineWaypoint(project, 'scenario-1', 'anchor-1', now);

    expect(project.scenarios[0]?.alignment).toHaveLength(0);
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
