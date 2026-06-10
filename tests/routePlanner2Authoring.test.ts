import { describe, expect, it } from 'vitest';

import {
  addRoutePlanner2LineWaypoint,
  addRoutePlanner2RoutePoint,
  addRoutePlanner2Stop,
  addRoutePlanner2Stops,
  clearRoutePlanner2SegmentRuntimeOverride,
  clearRoutePlanner2Stops,
  deleteRoutePlanner2Stop,
  moveRoutePlanner2Stop,
  moveRoutePlanner2LineWaypointInOrder,
  reassignRoutePlanner2StopRange,
  renameRoutePlanner2Stop,
  setRoutePlanner2SegmentRuntimeOverride,
  updateRoutePlanner2SegmentRuntimeEstimates,
  updateRoutePlanner2LineWaypointCoordinate,
  updateRoutePlanner2RouteShape,
  updateRoutePlanner2StopCoordinate,
  updateRoutePlanner2StopRole,
  validateRoutePlanner2Terminals,
} from '../utils/route-planner-2/routePlanner2Authoring';
import { buildRoutePlanner2StopSegmentPaths, buildRoutePlanner2StopVisitSequence } from '../utils/route-planner-2/routePlanner2Segments';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import type { RoutePlanner2SegmentRuntime } from '../utils/route-planner-2/routePlanner2Types';

describe('Route Planner 2 authoring', () => {
  const now = '2026-04-29T12:00:00.000Z';
  const segmentId = 'segment-stop-1-stop-2';

  function runtimeEstimate(patch: Partial<RoutePlanner2SegmentRuntime>): RoutePlanner2SegmentRuntime {
    return {
      id: segmentId,
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      runtimeMinutes: 8,
      source: 'mapbox',
      confidence: 'medium',
      pathFingerprint: 'path-a',
      updatedAt: now,
      ...patch,
    };
  }

  function projectWithRuntimeEstimate(estimate: RoutePlanner2SegmentRuntime) {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    return updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [estimate], now);
  }

  it('adds ordered route points and stops to a scenario', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    project = addRoutePlanner2RoutePoint(project, 'scenario-1', { id: 'point-1', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2RoutePoint(project, 'scenario-1', { id: 'point-2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Terminal A', lat: 44.38, lng: -79.69, now });

    const scenario = project.scenarios[0];
    expect(scenario?.alignment.map((point) => point.sequence)).toEqual([1, 2]);
    expect(scenario?.stops[0]).toMatchObject({
      id: 'stop-1',
      name: 'Terminal A',
      sequence: 1,
      role: 'regular',
      source: 'custom',
    });
  });

  it('bulk adds imported address stops in the provided order', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    project = addRoutePlanner2Stops(project, 'scenario-1', {
      now,
      stops: [
        { id: 'import-1', name: 'North Address', lat: 44.43, lng: -79.76, role: 'start-terminal', notes: 'Imported from address file.', address: '10 North Street, Barrie, ON L4M 1A1', riderCount: 3, sourceRows: [2, 5, 9] },
        { id: 'import-2', name: 'East Address', lat: 44.42, lng: -79.7, notes: 'Imported from address file.' },
      ],
    });

    expect(project.scenarios[0]?.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}:${stop.source}`)).toEqual([
      '1:North Address:start-terminal:custom',
      '2:East Address:regular:custom',
    ]);
    expect(project.scenarios[0]?.stops[0]?.notes).toContain('Imported from address file');
    expect(project.scenarios[0]?.stops[0]).toMatchObject({
      address: '10 North Street, Barrie, ON L4M 1A1',
      riderCount: 3,
      sourceRows: [2, 5, 9],
    });
  });

  it('adds a single address stop after the requested existing stop', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'First', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Second', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'address-stop',
      name: 'Inserted address',
      address: '100 Mapleview Drive East, Barrie, ON',
      lat: 44.37,
      lng: -79.67,
      insertAfterStopId: 'stop-1',
      now,
    });

    expect(project.scenarios[0]?.stops.map((stop) => `${stop.sequence}:${stop.id}:${stop.name}`)).toEqual([
      '1:stop-1:First',
      '2:address-stop:Inserted address',
      '3:stop-2:Second',
    ]);
    expect(project.scenarios[0]?.stops.find((stop) => stop.id === 'address-stop')?.address).toBe('100 Mapleview Drive East, Barrie, ON');
  });

  it('adds a single address stop at the beginning of the route', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'First', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Second', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'address-stop',
      name: 'Inserted address',
      address: '100 Mapleview Drive East, Barrie, ON',
      lat: 44.37,
      lng: -79.67,
      insertAtBeginning: true,
      now,
    });

    expect(project.scenarios[0]?.stops.map((stop) => `${stop.sequence}:${stop.id}:${stop.name}`)).toEqual([
      '1:address-stop:Inserted address',
      '2:stop-1:First',
      '3:stop-2:Second',
    ]);
  });

  it('renames, marks roles, moves, and deletes stops while preserving order', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'First', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Second', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Third', lat: 44.4, lng: -79.67, now });

    project = renameRoutePlanner2Stop(project, 'scenario-1', 'stop-2', 'Middle', now);
    project = updateRoutePlanner2StopCoordinate(project, 'scenario-1', 'stop-2', { lat: 44.4123, lng: -79.6123 }, now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-3', 'end-terminal', now);
    project = moveRoutePlanner2Stop(project, 'scenario-1', 'stop-3', 'up', now);

    expect(project.scenarios[0]?.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}`)).toEqual([
      '1:First:start-terminal',
      '2:Third:end-terminal',
      '3:Middle:regular',
    ]);
    expect(project.scenarios[0]?.stops.find((stop) => stop.id === 'stop-2')).toMatchObject({
      lat: 44.4123,
      lng: -79.6123,
    });

    project = deleteRoutePlanner2Stop(project, 'scenario-1', 'stop-3', now);
    expect(project.scenarios[0]?.stops.map((stop) => `${stop.sequence}:${stop.name}`)).toEqual([
      '1:First',
      '2:Middle',
    ]);
  });

  it('copies a contiguous stop range into another route at the requested position', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, role: 'end-terminal', now });
    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [
            { id: 'b-1', name: 'B1', lat: 44.41, lng: -79.66, sequence: 1, role: 'start-terminal', source: 'custom' },
            { id: 'b-2', name: 'B2', lat: 44.42, lng: -79.65, sequence: 2, role: 'end-terminal', source: 'custom' },
          ],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };

    project = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      insertAfterStopId: 'b-1',
      mode: 'copy',
      now,
    });

    const source = project.scenarios.find((scenario) => scenario.id === 'route-a')!;
    const target = project.scenarios.find((scenario) => scenario.id === 'route-b')!;

    expect(source.stops.map((stop) => stop.name)).toEqual(['A1', 'A2', 'A3']);
    expect(target.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}`)).toEqual([
      '1:B1:start-terminal',
      '2:A2:regular',
      '3:A3:regular',
      '4:B2:end-terminal',
    ]);
    expect(new Set(target.stops.map((stop) => stop.id)).size).toBe(4);
  });

  it('extends one-way target terminal roles when appending a transferred segment', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, role: 'end-terminal', now });
    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [
            { id: 'b-1', name: 'B1', lat: 44.41, lng: -79.66, sequence: 1, role: 'start-terminal' as const, source: 'custom' as const },
            { id: 'b-2', name: 'B2', lat: 44.42, lng: -79.65, sequence: 2, role: 'end-terminal' as const, source: 'custom' as const },
          ],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };

    project = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      insertAfterStopId: 'b-2',
      mode: 'copy',
      now,
    });

    const target = project.scenarios.find((scenario) => scenario.id === 'route-b')!;
    expect(target.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}`)).toEqual([
      '1:B1:start-terminal',
      '2:B2:regular',
      '3:A2:regular',
      '4:A3:end-terminal',
    ]);
    expect(buildRoutePlanner2StopVisitSequence(target).map((stop) => stop.name)).toEqual(['B1', 'B2', 'A2', 'A3']);
  });

  it('extends the target end terminal when inserting after an explicit end terminal with trailing stops', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, role: 'end-terminal', now });
    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [
            { id: 'b-1', name: 'B1', lat: 44.41, lng: -79.66, sequence: 1, role: 'start-terminal' as const, source: 'custom' as const },
            { id: 'b-2', name: 'B2', lat: 44.42, lng: -79.65, sequence: 2, role: 'end-terminal' as const, source: 'custom' as const },
            { id: 'b-3', name: 'Trailing stop', lat: 44.43, lng: -79.64, sequence: 3, role: 'regular' as const, source: 'custom' as const },
          ],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };

    project = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      insertAfterStopId: 'b-2',
      mode: 'copy',
      now,
    });

    const target = project.scenarios.find((scenario) => scenario.id === 'route-b')!;
    expect(target.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}`)).toEqual([
      '1:B1:start-terminal',
      '2:B2:regular',
      '3:A2:regular',
      '4:A3:end-terminal',
      '5:Trailing stop:regular',
    ]);
    expect(buildRoutePlanner2StopVisitSequence(target).map((stop) => stop.name)).toEqual(['B1', 'B2', 'A2', 'A3']);
  });

  it('moves a contiguous stop range to another route and clears stale runtime evidence', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-4', name: 'A4', lat: 44.41, lng: -79.66, role: 'end-terminal', now });
    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'route-a', [{
      id: 'segment-a-2-a-3',
      fromStopId: 'a-2',
      toStopId: 'a-3',
      runtimeMinutes: 5,
      source: 'scheduled-proxy',
      confidence: 'high',
    }], now);
    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };

    project = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      mode: 'move',
      now,
    });

    const source = project.scenarios.find((scenario) => scenario.id === 'route-a')!;
    const target = project.scenarios.find((scenario) => scenario.id === 'route-b')!;

    expect(source.stops.map((stop) => `${stop.sequence}:${stop.name}`)).toEqual(['1:A1', '2:A4']);
    expect(source.runtimeEstimates).toBeUndefined();
    expect(target.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}`)).toEqual([
      '1:A2:start-terminal',
      '2:A3:end-terminal',
    ]);
    expect(target.runtimeEstimates).toHaveLength(1);
    expect(target.runtimeEstimates?.[0]).toMatchObject({
      fromStopId: target.stops[0]?.id,
      toStopId: target.stops[1]?.id,
      runtimeMinutes: 5,
      source: 'scheduled-proxy',
      confidence: 'high',
    });
    expect(target.runtimeEstimates?.[0]?.id).toBe(`segment-${target.stops[0]?.id}-${target.stops[1]?.id}`);
  });

  it('moves the selected segment line geometry with the stop range', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-4', name: 'A4', lat: 44.41, lng: -79.66, role: 'end-terminal', now });
    project = addRoutePlanner2LineWaypoint(project, 'route-a', {
      id: 'bend-a-2-a-3',
      afterStopId: 'a-2',
      beforeStopId: 'a-3',
      lat: 44.395,
      lng: -79.675,
      now,
    });
    project = addRoutePlanner2LineWaypoint(project, 'route-a', {
      id: 'bend-a-3-a-4',
      afterStopId: 'a-3',
      beforeStopId: 'a-4',
      lat: 44.405,
      lng: -79.665,
      now,
    });
    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };

    project = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      mode: 'move',
      now,
    });

    const source = project.scenarios.find((scenario) => scenario.id === 'route-a')!;
    const target = project.scenarios.find((scenario) => scenario.id === 'route-b')!;
    const movedWaypoint = target.alignment[0];

    expect(source.alignment).toEqual([]);
    expect(target.alignment).toHaveLength(1);
    expect(movedWaypoint).toMatchObject({
      lat: 44.395,
      lng: -79.675,
      afterStopId: target.stops[0]?.id,
      beforeStopId: target.stops[1]?.id,
      segmentSequence: 1,
    });
    expect(movedWaypoint?.id).not.toBe('bend-a-2-a-3');
  });

  it('can reverse a reassigned stop range and clears directional runtime evidence', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-3', name: 'A3', lat: 44.4, lng: -79.67, role: 'end-terminal', now });
    project = addRoutePlanner2LineWaypoint(project, 'route-a', {
      id: 'bend-a-2-a-3',
      afterStopId: 'a-2',
      beforeStopId: 'a-3',
      lat: 44.395,
      lng: -79.675,
      now,
    });
    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'route-a', [{
      id: 'segment-a-2-a-3',
      fromStopId: 'a-2',
      toStopId: 'a-3',
      runtimeMinutes: 5,
      source: 'scheduled-proxy',
      confidence: 'high',
    }], now);
    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };

    project = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      mode: 'copy',
      reverseOrder: true,
      now,
    });

    const target = project.scenarios.find((scenario) => scenario.id === 'route-b')!;
    const movedWaypoint = target.alignment[0];

    expect(target.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}`)).toEqual([
      '1:A3:start-terminal',
      '2:A2:end-terminal',
    ]);
    expect(target.runtimeEstimates).toBeUndefined();
    expect(movedWaypoint).toMatchObject({
      afterStopId: target.stops[0]?.id,
      beforeStopId: target.stops[1]?.id,
      segmentSequence: 1,
    });
  });

  it('preserves period-specific runtimes and manual overrides when moving a stop range', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-a', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, role: 'start-terminal', now });
    project = addRoutePlanner2Stop(project, 'route-a', { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, now });
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
      },
      {
        id: 'segment-a-2-a-3-am-peak',
        fromStopId: 'a-2',
        toStopId: 'a-3',
        runtimeMinutes: 7,
        source: 'scheduled-proxy',
        confidence: 'high',
        evidencePeriod: 'am-peak',
      },
    ], now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'route-a', 'segment-a-2-a-3', 6, now);
    project = {
      ...project,
      scenarios: [
        project.scenarios[0]!,
        {
          ...project.scenarios[0]!,
          id: 'route-b',
          name: 'Route B',
          stops: [],
          alignment: [],
          runtimeEstimates: undefined,
          runtimeOverrides: undefined,
        },
      ],
    };

    project = reassignRoutePlanner2StopRange(project, {
      sourceScenarioId: 'route-a',
      targetScenarioId: 'route-b',
      fromSequence: 2,
      toSequence: 3,
      mode: 'move',
      now,
    });

    const source = project.scenarios.find((scenario) => scenario.id === 'route-a')!;
    const target = project.scenarios.find((scenario) => scenario.id === 'route-b')!;
    const targetSegmentId = `segment-${target.stops[0]?.id}-${target.stops[1]?.id}`;

    expect(source.runtimeEstimates).toBeUndefined();
    expect(source.runtimeOverrides).toBeUndefined();
    expect(target.runtimeEstimates?.map((estimate) => `${estimate.id}:${estimate.evidencePeriod}:${estimate.runtimeMinutes}`)).toEqual([
      `${targetSegmentId}-full-day:full-day:5`,
      `${targetSegmentId}-am-peak:am-peak:7`,
    ]);
    expect(target.runtimeOverrides?.[targetSegmentId]).toMatchObject({
      runtimeMinutes: 6,
      updatedAt: now,
    });
  });

  it('creates, orders, and moves multiple route line waypoints between stops', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'First', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Second', lat: 44.39, lng: -79.68, now });

    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'waypoint-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.385,
      lng: -79.7,
      now,
    });
    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'waypoint-2',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      insertAfterWaypointId: 'waypoint-1',
      lat: 44.386,
      lng: -79.701,
      now,
    });
    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'waypoint-0',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      insertBeforeWaypointId: 'waypoint-1',
      lat: 44.384,
      lng: -79.699,
      now,
    });
    project = updateRoutePlanner2LineWaypointCoordinate(project, 'scenario-1', 'waypoint-1', {
      lat: 44.388,
      lng: -79.702,
    }, now);

    expect(project.scenarios[0]?.alignment.map((point) => `${point.segmentSequence}:${point.id}`)).toEqual([
      '1:waypoint-0',
      '2:waypoint-1',
      '3:waypoint-2',
    ]);
    expect(project.scenarios[0]?.alignment.find((point) => point.id === 'waypoint-1')).toMatchObject({
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.388,
      lng: -79.702,
      sequence: 2,
      segmentSequence: 2,
    });
  });

  it('moves route line bends through the stop order', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'First', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Second', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Third', lat: 44.4, lng: -79.67, now });
    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'bend-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.385,
      lng: -79.685,
      now,
    });

    project = moveRoutePlanner2LineWaypointInOrder(project, 'scenario-1', 'bend-1', 'down', now);

    expect(project.scenarios[0]?.alignment.find((point) => point.id === 'bend-1')).toMatchObject({
      afterStopId: 'stop-2',
      beforeStopId: 'stop-3',
      segmentSequence: 1,
    });
  });

  it('keeps route line waypoints direction-specific unless the reverse segment has its own anchor', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Terminal', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Turnaround', lat: 44.39, lng: -79.68, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { turnaroundStopId: 'stop-2', now });

    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'outbound-bend',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.385,
      lng: -79.7,
      now,
    });

    let paths = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!);
    const outboundPath = paths.find((path) => path.fromStopId === 'stop-1' && path.toStopId === 'stop-2')!;
    const returnPath = paths.find((path) => path.fromStopId === 'stop-2' && path.toStopId === 'stop-1')!;

    expect(outboundPath.coordinates).toContainEqual([-79.7, 44.385]);
    expect(returnPath.coordinates).toEqual([
      [-79.68, 44.39],
      [-79.69, 44.38],
    ]);

    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'return-bend',
      afterStopId: 'stop-2',
      beforeStopId: 'stop-1',
      lat: 44.386,
      lng: -79.701,
      now,
    });

    paths = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!);
    expect(paths.find((path) => path.fromStopId === 'stop-2' && path.toStopId === 'stop-1')?.coordinates)
      .toContainEqual([-79.701, 44.386]);
  });

  it('generates terminal warnings until the concept has valid terminal roles', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    let scenario = project.scenarios[0]!;

    expect(validateRoutePlanner2Terminals(scenario).map((warning) => warning.id)).toContain('no-stops');

    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'A', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'B', lat: 44.39, lng: -79.68, now });
    scenario = project.scenarios[0]!;
    expect(validateRoutePlanner2Terminals(scenario).map((warning) => warning.id)).toEqual([
      'missing-start-terminal',
      'missing-end-terminal',
    ]);

    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'end-terminal', now);
    scenario = project.scenarios[0]!;
    expect(validateRoutePlanner2Terminals(scenario)).toEqual([]);
  });

  it('bounds a one-way route by its explicit start and end terminals', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-0', name: 'Before start', lat: 44.37, lng: -79.71, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Start', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Middle', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'End', lat: 44.4, lng: -79.66, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-4', name: 'After end', lat: 44.41, lng: -79.64, now });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-3', 'end-terminal', now);

    const scenario = project.scenarios[0]!;

    expect(buildRoutePlanner2StopVisitSequence(scenario).map((stop) => stop.id)).toEqual([
      'stop-1',
      'stop-2',
      'stop-3',
    ]);
    expect(validateRoutePlanner2Terminals(scenario).map((warning) => warning.id)).toEqual([
      'start-terminal-not-first',
      'end-terminal-not-final',
    ]);
  });

  it('treats bus turnaround as the explicit reversal point for out-and-back routes', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'A', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'B', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'C', lat: 44.4, lng: -79.67, now });

    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-3', 'turnaround', now);
    const scenario = project.scenarios[0]!;

    expect(scenario.routeShape).toBe('out-and-back');
    expect(scenario.turnaroundStopId).toBe('stop-3');
    expect(scenario.stops.map((stop) => `${stop.sequence}:${stop.name}:${stop.role}`)).toEqual([
      '1:A:regular',
      '2:B:regular',
      '3:C:turnaround',
    ]);
    expect(validateRoutePlanner2Terminals(scenario).map((warning) => warning.id)).toContain('missing-start-terminal');

    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    expect(validateRoutePlanner2Terminals(project.scenarios[0]!).map((warning) => warning.id)).not.toContain('missing-turnaround-stop');
  });

  it('keeps newly appended stops visible after choosing out-and-back', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'A', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'B', lat: 44.39, lng: -79.68, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { now });

    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'C', lat: 44.4, lng: -79.67, now });
    const scenario = project.scenarios[0]!;

    expect(scenario.turnaroundStopId).toBe('stop-3');
    expect(scenario.stops.map((stop) => `${stop.id}:${stop.role}`)).toEqual([
      'stop-1:start-terminal',
      'stop-2:regular',
      'stop-3:turnaround',
    ]);
    expect(buildRoutePlanner2StopVisitSequence(scenario).map((stop) => stop.id)).toEqual([
      'stop-1',
      'stop-2',
      'stop-3',
      'stop-2',
      'stop-1',
    ]);
  });

  it('clears all stops, bends, runtime data, and turnaround state from a scenario', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'A', lat: 44.38, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'B', lat: 44.39, lng: -79.68, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { now });
    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'bend-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.385,
      lng: -79.685,
      now,
    });
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-1-stop-2', 8, now);

    project = clearRoutePlanner2Stops(project, 'scenario-1', now);

    expect(project.scenarios[0]).toMatchObject({
      stops: [],
      alignment: [],
      routeShape: 'one-way',
      turnaroundStopId: undefined,
      runtimeEstimates: undefined,
      runtimeOverrides: undefined,
      feasibility: undefined,
    });
  });

  it('sets and clears manual segment runtime overrides', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    project = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-1-stop-2', 7.4, now);

    expect(project.scenarios[0]?.runtimeOverrides?.['segment-stop-1-stop-2']).toMatchObject({
      runtimeMinutes: 7,
      updatedAt: now,
    });

    const unchanged = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-1-stop-2', 0, now);
    expect(unchanged).toBe(project);

    project = clearRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-1-stop-2', now);
    expect(project.scenarios[0]?.runtimeOverrides).toBeUndefined();
  });

  it('lets runtime evidence replace Mapbox estimates', () => {
    let project = projectWithRuntimeEstimate(runtimeEstimate({
      runtimeMinutes: 8,
      source: 'mapbox',
      confidence: 'medium',
    }));

    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [runtimeEstimate({
      runtimeMinutes: 6,
      source: 'scheduled-proxy',
      confidence: 'medium',
    })], now);

    expect(project.scenarios[0]?.runtimeEstimates).toHaveLength(1);
    expect(project.scenarios[0]?.runtimeEstimates?.[0]).toMatchObject({
      runtimeMinutes: 6,
      source: 'scheduled-proxy',
    });
  });

  it('does not let Mapbox replace evidence for the same path fingerprint', () => {
    let project = projectWithRuntimeEstimate(runtimeEstimate({
      runtimeMinutes: 6,
      source: 'scheduled-proxy',
      confidence: 'medium',
      pathFingerprint: 'path-a',
    }));

    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [runtimeEstimate({
      runtimeMinutes: 8,
      source: 'mapbox',
      confidence: 'medium',
      pathFingerprint: 'path-a',
    })], now);

    expect(project.scenarios[0]?.runtimeEstimates?.[0]).toMatchObject({
      runtimeMinutes: 6,
      source: 'scheduled-proxy',
      pathFingerprint: 'path-a',
    });
  });

  it('does not let fallback replace Mapbox or evidence estimates', () => {
    let mapboxProject = projectWithRuntimeEstimate(runtimeEstimate({
      runtimeMinutes: 8,
      source: 'mapbox',
      confidence: 'medium',
    }));
    let evidenceProject = projectWithRuntimeEstimate(runtimeEstimate({
      runtimeMinutes: 6,
      source: 'observed-proxy',
      confidence: 'high',
    }));

    const fallbackEstimate = runtimeEstimate({
      runtimeMinutes: 12,
      source: 'fallback',
      confidence: 'low',
      fallbackReason: 'distance-estimate',
    });
    mapboxProject = updateRoutePlanner2SegmentRuntimeEstimates(mapboxProject, 'scenario-1', [fallbackEstimate], now);
    evidenceProject = updateRoutePlanner2SegmentRuntimeEstimates(evidenceProject, 'scenario-1', [fallbackEstimate], now);

    expect(mapboxProject.scenarios[0]?.runtimeEstimates?.[0]).toMatchObject({
      runtimeMinutes: 8,
      source: 'mapbox',
    });
    expect(evidenceProject.scenarios[0]?.runtimeEstimates?.[0]).toMatchObject({
      runtimeMinutes: 6,
      source: 'observed-proxy',
    });
  });

  it('lets new path fingerprints replace old evidence with recalculated evidence', () => {
    let project = projectWithRuntimeEstimate(runtimeEstimate({
      runtimeMinutes: 9,
      source: 'observed-proxy',
      confidence: 'high',
      pathFingerprint: 'old-path',
    }));

    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [runtimeEstimate({
      runtimeMinutes: 7,
      source: 'scheduled-proxy',
      confidence: 'medium',
      pathFingerprint: 'new-path',
    })], now);

    expect(project.scenarios[0]?.runtimeEstimates?.[0]).toMatchObject({
      runtimeMinutes: 7,
      source: 'scheduled-proxy',
      pathFingerprint: 'new-path',
    });
  });

  it('refreshes runtime evidence when only evidence metadata changes', () => {
    let project = projectWithRuntimeEstimate(runtimeEstimate({
      runtimeMinutes: 7,
      source: 'observed-scheduled-blend',
      confidence: 'medium',
      sampleSize: 4,
      scheduledRuntimeMinutes: 8,
      observedRuntimeMinutes: 6,
      matchQuality: 'name',
      matchedFromStopId: 'gtfs-old-from',
      matchedToStopId: 'gtfs-old-to',
      matchedRoutes: ['1A'],
    }));

    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [runtimeEstimate({
      runtimeMinutes: 7,
      source: 'observed-scheduled-blend',
      confidence: 'medium',
      sampleSize: 5,
      scheduledRuntimeMinutes: 8,
      observedRuntimeMinutes: 6,
      matchQuality: 'exact-code',
      matchedFromStopId: 'gtfs-new-from',
      matchedToStopId: 'gtfs-new-to',
      matchedRoutes: ['1A', '1B'],
    })], now);

    expect(project.scenarios[0]?.runtimeEstimates?.[0]).toMatchObject({
      runtimeMinutes: 7,
      source: 'observed-scheduled-blend',
      confidence: 'medium',
      sampleSize: 5,
      scheduledRuntimeMinutes: 8,
      observedRuntimeMinutes: 6,
      matchQuality: 'exact-code',
      matchedFromStopId: 'gtfs-new-from',
      matchedToStopId: 'gtfs-new-to',
      matchedRoutes: ['1A', '1B'],
    });
  });

  it('can clear stale automatic runtime evidence for selected segments before applying a new time period', () => {
    let project = projectWithRuntimeEstimate(runtimeEstimate({
      runtimeMinutes: 6,
      source: 'scheduled-proxy',
      confidence: 'medium',
      evidenceDayType: 'weekday',
      evidencePeriod: 'am-peak',
    }));

    project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [], now, {
      replaceForSegmentIds: [segmentId],
      replaceSources: ['scheduled-proxy', 'observed-scheduled-blend', 'observed-proxy'],
    });

    expect(project.scenarios[0]?.runtimeEstimates).toBeUndefined();
  });

  it('returns the original project for unknown scenario IDs', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    expect(addRoutePlanner2Stop(project, 'missing', { id: 'stop-1', name: 'Nope', lat: 44, lng: -79, now })).toBe(project);
    expect(updateRoutePlanner2StopRole(project, 'missing', 'stop-1', 'timed', now)).toBe(project);
    expect(updateRoutePlanner2StopCoordinate(project, 'missing', 'stop-1', { lat: 44.1, lng: -79.1 }, now)).toBe(project);
    expect(updateRoutePlanner2StopCoordinate(project, 'scenario-1', 'stop-1', { lat: Number.NaN, lng: -79.1 }, now)).toBe(project);
    expect(addRoutePlanner2LineWaypoint(project, 'missing', { afterStopId: 'stop-1', beforeStopId: 'stop-2', lat: 44.1, lng: -79.1, now })).toBe(project);
    expect(updateRoutePlanner2LineWaypointCoordinate(project, 'missing', 'waypoint-1', { lat: 44.1, lng: -79.1 }, now)).toBe(project);
    expect(setRoutePlanner2SegmentRuntimeOverride(project, 'missing', 'segment-stop-1-stop-2', 7, now)).toBe(project);
    expect(clearRoutePlanner2SegmentRuntimeOverride(project, 'missing', 'segment-stop-1-stop-2', now)).toBe(project);
    expect(moveRoutePlanner2Stop(project, 'missing', 'stop-1', 'up', now)).toBe(project);
    expect(deleteRoutePlanner2Stop(project, 'missing', 'stop-1', now)).toBe(project);
  });
});
