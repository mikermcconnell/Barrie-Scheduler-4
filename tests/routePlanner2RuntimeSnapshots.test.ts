import { describe, expect, it } from 'vitest';

import { addRoutePlanner2Stop, updateRoutePlanner2SegmentRuntimeEstimates } from '../utils/route-planner-2/routePlanner2Authoring';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import {
  acceptRoutePlanner2RuntimeRefresh,
  buildRoutePlanner2RuntimeRefreshComparison,
  prepareRoutePlanner2ProjectRuntimeForSave,
  rejectRoutePlanner2RuntimeRefresh,
  setRoutePlanner2RuntimeLocked,
} from '../utils/route-planner-2/routePlanner2RuntimeSnapshots';
import { buildRoutePlanner2StopSegmentPaths } from '../utils/route-planner-2/routePlanner2Segments';
import type { RoutePlanner2Project, RoutePlanner2SegmentRuntime } from '../utils/route-planner-2/routePlanner2Types';

function projectWithRuntime(minutes = 7): { project: RoutePlanner2Project; estimate: RoutePlanner2SegmentRuntime } {
  let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-07-21T10:00:00.000Z' });
  project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Camp', lat: 44.38, lng: -79.70 });
  project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Arena', lat: 44.40, lng: -79.66 });
  const path = buildRoutePlanner2StopSegmentPaths(project.scenarios[0]!)[0]!;
  const estimate: RoutePlanner2SegmentRuntime = {
    id: path.id,
    fromStopId: path.fromStopId,
    toStopId: path.toStopId,
    runtimeMinutes: minutes,
    durationSeconds: minutes * 60,
    source: 'mapbox',
    confidence: 'medium',
    pathFingerprint: path.pathFingerprint,
    updatedAt: '2026-07-21T10:00:00.000Z',
  };
  project = updateRoutePlanner2SegmentRuntimeEstimates(project, 'scenario-1', [estimate]);
  return { project, estimate };
}

describe('Route Planner 2 accepted runtime snapshots', () => {
  it('stages a candidate without changing the accepted project', () => {
    const { project, estimate } = projectWithRuntime(7);
    const candidate = { ...estimate, runtimeMinutes: 9, durationSeconds: 510 };

    const comparison = buildRoutePlanner2RuntimeRefreshComparison(project.scenarios[0]!, [candidate], '2026-07-21T11:00:00.000Z');

    expect(comparison).toMatchObject({ previousTotalRuntimeMinutes: 7, candidateTotalRuntimeMinutes: 9, deltaMinutes: 2 });
    expect(project.scenarios[0]?.runtimeEstimates?.[0]?.runtimeMinutes).toBe(7);
  });

  it('accepts or rejects a refresh while preserving a bounded decision record', () => {
    const { project, estimate } = projectWithRuntime(7);
    const comparison = buildRoutePlanner2RuntimeRefreshComparison(
      project.scenarios[0]!,
      [{ ...estimate, runtimeMinutes: 9, durationSeconds: 510 }],
      '2026-07-21T11:00:00.000Z',
    );

    const rejected = rejectRoutePlanner2RuntimeRefresh(project, comparison, 'planner-1', '2026-07-21T11:05:00.000Z');
    expect(rejected.scenarios[0]?.runtimeEstimates?.[0]?.runtimeMinutes).toBe(7);
    expect(rejected.scenarios[0]?.runtimeSnapshots?.[0]?.decision).toBe('rejected');

    const accepted = acceptRoutePlanner2RuntimeRefresh(rejected, comparison, 'planner-1', '2026-07-21T11:10:00.000Z');
    expect(accepted.scenarios[0]?.runtimeEstimates?.[0]?.runtimeMinutes).toBe(9);
    expect(accepted.scenarios[0]?.runtimeAcceptedAt).toBe('2026-07-21T11:10:00.000Z');
    expect(accepted.scenarios[0]?.runtimeSnapshots?.map((snapshot) => snapshot.decision)).toEqual(['accepted', 'rejected']);
  });

  it('prevents a locked route from accepting a candidate', () => {
    const { project, estimate } = projectWithRuntime(7);
    const locked = setRoutePlanner2RuntimeLocked(project, 'scenario-1', true);
    const comparison = buildRoutePlanner2RuntimeRefreshComparison(locked.scenarios[0]!, [{ ...estimate, runtimeMinutes: 10 }]);

    expect(acceptRoutePlanner2RuntimeRefresh(locked, comparison)).toBe(locked);
  });

  it('establishes an accepted baseline on first save without changing segment rounding', () => {
    const { project } = projectWithRuntime(7);
    const prepared = prepareRoutePlanner2ProjectRuntimeForSave(project, 'planner-1', '2026-07-21T12:00:00.000Z');

    expect(prepared.scenarios[0]).toMatchObject({
      runtimeAcceptedAt: '2026-07-21T12:00:00.000Z',
      runtimeAcceptedBy: 'planner-1',
    });
    expect(prepared.scenarios[0]?.runtimeSnapshots?.[0]).toMatchObject({
      decision: 'accepted',
      segmentRuntimeMinutes: 7,
      provider: 'mapbox',
      profile: 'mapbox/driving',
    });
    expect(prepared.scenarios[0]?.runtimeEstimates?.[0]?.runtimeMinutes).toBe(7);
  });
});
