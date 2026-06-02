import { describe, expect, it } from 'vitest';

import {
  addRoutePlanner2Stop,
  reassignRoutePlanner2StopRange,
  setRoutePlanner2SegmentRuntimeOverride,
  updateRoutePlanner2SegmentRuntimeEstimates,
  validateRoutePlanner2Terminals,
} from '../utils/route-planner-2/routePlanner2Authoring';
import { updateRoutePlanner2Service } from '../utils/route-planner-2/routePlanner2Feasibility';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import { summarizeRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2Summary';
import { buildRoutePlanner2StopTransferPreview } from '../utils/route-planner-2/routePlanner2TransferPreview';
import type { RoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2Types';

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

  it('keeps source and target one-way endpoint terminals valid when moving an endpoint range', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-4', name: 'A4', lat: 44.41, lng: -79.66, role: 'end-terminal', now });

    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [
            { id: 'b-1', name: 'B1', lat: 44.42, lng: -79.65, sequence: 1, role: 'start-terminal' as const, source: 'custom' as const },
            { id: 'b-2', name: 'B2', lat: 44.43, lng: -79.64, sequence: 2, role: 'regular' as const, source: 'custom' as const },
          ],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };

    const updatedProject = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 3,
      toSequence: 4,
      insertAfterStopId: 'b-2',
      mode: 'move',
      now,
    });
    const updatedSource = updatedProject.scenarios.find((scenario) => scenario.id === 'route-a')!;
    const updatedTarget = updatedProject.scenarios.find((scenario) => scenario.id === 'route-b')!;
    const sourceStops = [...updatedSource.stops].sort((a, b) => a.sequence - b.sequence);
    const targetStops = [...updatedTarget.stops].sort((a, b) => a.sequence - b.sequence);

    expect(sourceStops.at(-1)?.name).toBe('A2');
    expect(sourceStops.at(-1)?.role).toBe('end-terminal');
    expect(targetStops.at(-1)?.name).toBe('A4');
    expect(targetStops.at(-1)?.role).toBe('end-terminal');
    expect(validateRoutePlanner2Terminals(updatedSource).filter((warning) => warning.severity === 'blocking')).toEqual([]);
    expect(validateRoutePlanner2Terminals(updatedTarget).filter((warning) => warning.severity === 'blocking')).toEqual([]);
  });

  it('lets Route 12 family metrics populate after an appended segment becomes the new back end terminal', () => {
    const routeFamily = {
      key: 'barrie-merged-12',
      name: 'Route 12',
      shortName: '12',
    };
    const route12Out: RoutePlanner2Scenario = {
      id: 'route-12-out',
      name: 'Route 12 Out',
      status: 'draft',
      routeShape: 'one-way',
      routeFamily: {
        ...routeFamily,
        memberShortName: '12A',
        directionRole: 'out',
        directionLabel: 'Out',
      },
      source: { type: 'gtfs', routeShortName: '12A', serviceId: 'weekday' },
      alignment: [],
      stops: [
        { id: 'out-1', name: 'Barrie South GO', lat: 44.34, lng: -79.63, sequence: 1, role: 'start-terminal', source: 'custom' },
        { id: 'out-2', name: 'Georgian Mall', lat: 44.41, lng: -79.71, sequence: 2, role: 'end-terminal', source: 'custom' },
      ],
      service: {
        firstTripTime: '06:00',
        lastTripTime: '22:00',
        frequencyMinutes: 35,
        targetBuses: 4,
        startTerminalLayoverMinutes: 0,
        endTerminalLayoverMinutes: 0,
        intermediateStopDwellSeconds: 0,
      },
      runtimeOverrides: {
        'segment-out-1-out-2': { runtimeMinutes: 60, updatedAt: now },
      },
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
    const route12Back: RoutePlanner2Scenario = {
      ...route12Out,
      id: 'route-12-back',
      name: 'Route 12 Back',
      routeFamily: {
        ...routeFamily,
        memberShortName: '12B',
        directionRole: 'back',
        directionLabel: 'Back',
      },
      source: { type: 'gtfs', routeShortName: '12B', serviceId: 'weekday' },
      stops: [
        { id: 'back-1', name: 'Georgian Mall', lat: 44.41, lng: -79.71, sequence: 1, role: 'start-terminal', source: 'custom' },
        { id: 'back-2', name: 'Yonge at Big Bay Point', lat: 44.36, lng: -79.64, sequence: 2, role: 'regular', source: 'custom' },
      ],
      runtimeOverrides: {
        'segment-back-1-back-2': { runtimeMinutes: 20, updatedAt: now },
      },
    };
    const sourceRoute: RoutePlanner2Scenario = {
      ...route12Out,
      id: 'route-8a',
      name: 'Route 8A',
      routeFamily: undefined,
      source: { type: 'gtfs', routeShortName: '8A', serviceId: 'weekday' },
      stops: [
        { id: 'a-1', name: 'Cox Mill Road', lat: 44.36, lng: -79.64, sequence: 1, role: 'start-terminal', source: 'custom' },
        { id: 'a-2', name: 'Country Lane', lat: 44.35, lng: -79.63, sequence: 2, role: 'regular', source: 'custom' },
        { id: 'a-3', name: 'Barrie South GO', lat: 44.34, lng: -79.63, sequence: 3, role: 'end-terminal', source: 'custom' },
      ],
      runtimeOverrides: {
        'segment-a-1-a-2': { runtimeMinutes: 4, updatedAt: now },
        'segment-a-2-a-3': { runtimeMinutes: 2, updatedAt: now },
      },
    };
    const project = {
      id: 'project-1',
      name: 'Route 12 family test',
      status: 'local-draft' as const,
      selectedScenarioId: 'route-12-back',
      scenarios: [sourceRoute, route12Out, route12Back],
      createdAt: now,
      updatedAt: now,
    };

    const updatedProject = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-8a',
      targetScenarioId: 'route-12-back',
      fromSequence: 2,
      toSequence: 3,
      insertAfterStopId: 'back-2',
      mode: 'move',
      now,
    });
    const familySummary = summarizeRoutePlanner2Project(updatedProject).routeFamilySummaries.find((summary) => summary.familyName === 'Route 12');

    expect(familySummary?.runtimeMinutes).not.toBeNull();
    expect(familySummary?.cycleTimeMinutes).not.toBeNull();
    expect(familySummary?.blockingWarningCount).toBe(0);
  });
});
