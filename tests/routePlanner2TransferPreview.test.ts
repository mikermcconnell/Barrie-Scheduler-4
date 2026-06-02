import { describe, expect, it } from 'vitest';

import {
  addRoutePlanner2Stop,
  setRoutePlanner2SegmentRuntimeOverride,
  updateRoutePlanner2SegmentRuntimeEstimates,
} from '../utils/route-planner-2/routePlanner2Authoring';
import { updateRoutePlanner2Service } from '../utils/route-planner-2/routePlanner2Feasibility';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import { buildRoutePlanner2StopTransferPreview } from '../utils/route-planner-2/routePlanner2TransferPreview';

describe('Route Planner 2 stop transfer preview', () => {
  const now = '2026-05-28T12:00:00.000Z';

  function projectWithSourceAndTarget() {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'Shared', lat: 44.39, lng: -79.68, stopCode: '100', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, role: 'end-terminal', now });
    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'route-a', [
      {
        id: 'segment-a-2-a-3-full-day',
        fromStopId: 'a-2',
        toStopId: 'a-3',
        runtimeMinutes: 5,
        source: 'scheduled-proxy',
        confidence: 'high',
        evidencePeriod: 'full-day',
        matchedRoutes: ['12B'],
      },
      {
        id: 'segment-a-2-a-3-am-peak',
        fromStopId: 'a-2',
        toStopId: 'a-3',
        runtimeMinutes: 7,
        source: 'scheduled-proxy',
        confidence: 'high',
        evidencePeriod: 'am-peak',
        matchedRoutes: ['12B'],
      },
    ], now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'route-a', 'segment-a-2-a-3', 6, now);

    return {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [
            { id: 'b-1', name: 'Shared', lat: 44.39, lng: -79.68, sequence: 1, role: 'start-terminal' as const, source: 'custom' as const, stopCode: '100' },
            { id: 'b-2', name: 'B2', lat: 44.42, lng: -79.65, sequence: 2, role: 'end-terminal' as const, source: 'custom' as const },
          ],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };
  }

  it('summarizes carried scheduled evidence, manual overrides, connectors, and duplicate joins', () => {
    const preview = buildRoutePlanner2StopTransferPreview(projectWithSourceAndTarget(), {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      insertAfterStopId: 'b-1',
      mode: 'copy',
      now,
    });

    expect(preview).toMatchObject({
      transferredStopCount: 2,
      carriedRuntimeEstimateCount: 2,
      carriedScheduledSegmentCount: 1,
      carriedManualOverrideCount: 1,
      duplicateJoinCount: 1,
      matchedRoutes: ['12B'],
    });
    expect(preview?.connectorSegmentCount).toBeGreaterThan(0);
    expect(preview?.warnings.map((warning) => warning.id)).toContain('duplicate-join-stop');
  });


  it('accounts for moved runtime equally while ignoring dwell and connector recalculation', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = updateRoutePlanner2Service(project, 'route-a', { intermediateStopDwellSeconds: 60 }, now);
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-4', name: 'A4', lat: 44.41, lng: -79.66, role: 'end-terminal', now });
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'route-a', 'segment-a-1-a-2', 10, now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'route-a', 'segment-a-2-a-3', 6, now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'route-a', 'segment-a-3-a-4', 35, now);

    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          service: {
            ...project.scenarios[0]!.service,
            intermediateStopDwellSeconds: 60,
          },
          stops: [
            { id: 'b-1', name: 'B1', lat: 44.42, lng: -79.65, sequence: 1, role: 'start-terminal' as const, source: 'custom' as const },
            { id: 'b-2', name: 'B2', lat: 44.43, lng: -79.64, sequence: 2, role: 'end-terminal' as const, source: 'custom' as const },
          ],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: {
            'segment-b-1-b-2': { runtimeMinutes: 60, updatedAt: now },
          },
        },
      ],
    };

    const preview = buildRoutePlanner2StopTransferPreview(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      insertAfterStopId: 'b-1',
      mode: 'move',
      now,
    });

    expect(preview?.transferredRuntimeMinutes).toBe(6);
    expect(preview?.sourceAccountingRuntimeDeltaMinutes).toBe(-6);
    expect(preview?.targetAccountingRuntimeDeltaMinutes).toBe(6);
    expect(preview?.sourceAccountingRuntimeAfterMinutes).toBe((preview?.sourceRuntimeBeforeMinutes ?? 0) - 6);
    expect(preview?.targetAccountingRuntimeAfterMinutes).toBe((preview?.targetRuntimeBeforeMinutes ?? 0) + 6);
    expect(preview?.targetRuntimeDeltaMinutes).not.toBe(preview?.targetAccountingRuntimeDeltaMinutes);
    expect(preview?.scheduleImpact.source.runtime.delta).toBe(-6);
    expect(preview?.scheduleImpact.target.runtime.delta).toBe(6);
    expect(preview?.scheduleImpact.target.cycleTime.after).toBeGreaterThan(preview?.scheduleImpact.target.cycleTime.before ?? 0);
    expect(preview?.scheduleImpact.target.recoveryTime.delta).toBeLessThanOrEqual(0);
    expect(preview?.scheduleImpact.warnings.map((warning) => warning.id)).toContain('target-recovery-reduced');
  });

  it('copy mode adds moved runtime to target accounting and leaves source accounting unchanged', () => {
    const preview = buildRoutePlanner2StopTransferPreview(projectWithSourceAndTarget(), {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      insertAfterStopId: 'b-1',
      mode: 'copy',
      now,
    });

    expect(preview?.transferredRuntimeMinutes).toBe(6);
    expect(preview?.sourceAccountingRuntimeDeltaMinutes).toBe(0);
    expect(preview?.targetAccountingRuntimeDeltaMinutes).toBe(6);
    expect(preview?.sourceAccountingRuntimeAfterMinutes).toBe(preview?.sourceRuntimeBeforeMinutes);
    expect(preview?.scheduleImpact.source.runtime.delta).toBe(0);
    expect(preview?.scheduleImpact.target.runtime.delta).toBe(6);
  });

  it('warns that reversed transfers drop directional runtime evidence', () => {
    const preview = buildRoutePlanner2StopTransferPreview(projectWithSourceAndTarget(), {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      insertAfterStopId: 'b-1',
      mode: 'copy',
      reverseOrder: true,
      now,
    });

    expect(preview?.carriedRuntimeEstimateCount).toBe(0);
    expect(preview?.carriedScheduledSegmentCount).toBe(0);
    expect(preview?.droppedDirectionalRuntimeEstimateCount).toBe(2);
    expect(preview?.warnings.map((warning) => warning.id)).toContain('reversed-runtime-dropped');
  });
});
