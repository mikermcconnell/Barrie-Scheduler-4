import { describe, expect, it } from 'vitest';

import { addRoutePlanner2Stop, setRoutePlanner2SegmentRuntimeOverride, updateRoutePlanner2RouteShape } from '../utils/route-planner-2/routePlanner2Authoring';
import { deriveRoutePlanner2Feasibility, updateRoutePlanner2Service } from '../utils/route-planner-2/routePlanner2Feasibility';
import { buildRoutePlanner2StopCardDetails, buildRoutePlanner2StopVisitRuntimeDetails } from '../utils/route-planner-2/routePlanner2StopTimes';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 stop card details', () => {
  const now = '2026-05-15T12:00:00.000Z';

  it('shows kids by stop, running kids total, travel times, and arrival times from first trip time', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-1',
      name: 'Sadlon Arena',
      lat: 44.34,
      lng: -79.69,
      riderCount: 0,
      now,
    });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-2',
      name: '304 Johnson Street',
      lat: 44.41,
      lng: -79.66,
      riderCount: 2,
      now,
    });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-3',
      name: 'Barrie Sports Complex',
      lat: 44.44,
      lng: -79.73,
      riderCount: 1,
      now,
    });
    project = updateRoutePlanner2Service(project, 'scenario-1', {
      firstTripTime: '08:15',
      intermediateStopDwellSeconds: 60,
    }, now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-1-stop-2', 7, now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-2-stop-3', 9, now);

    const scenario = project.scenarios[0]!;
    const details = buildRoutePlanner2StopCardDetails(scenario, deriveRoutePlanner2Feasibility(scenario));

    expect(details.map((detail) => ({
      stopId: detail.stopId,
      kidsAtStop: detail.kidsAtStop,
      runningKidsTotal: detail.runningKidsTotal,
      travelTimeLabel: detail.travelTimeLabel,
      arrivalLabel: detail.arrivalLabel,
    }))).toEqual([
      { stopId: 'stop-1', kidsAtStop: 0, runningKidsTotal: 0, travelTimeLabel: '0 min', arrivalLabel: '8:15 AM' },
      { stopId: 'stop-2', kidsAtStop: 2, runningKidsTotal: 2, travelTimeLabel: '7 min', arrivalLabel: '8:22 AM' },
      { stopId: 'stop-3', kidsAtStop: 1, runningKidsTotal: 3, travelTimeLabel: '16 min', arrivalLabel: '8:32 AM' },
    ]);
  });

  it('falls back to source rows and numeric rider strings for kid counts', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-1',
      name: 'Imported address',
      lat: 44.34,
      lng: -79.69,
      sourceRows: [4, 8],
      now,
    });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-2',
      name: 'Saved count as string',
      lat: 44.41,
      lng: -79.66,
      riderCount: '3' as unknown as number,
      now,
    });

    const scenario = project.scenarios[0]!;
    const details = buildRoutePlanner2StopCardDetails(scenario, deriveRoutePlanner2Feasibility(scenario));

    expect(details.map((detail) => ({
      kidsAtStop: detail.kidsAtStop,
      runningKidsTotal: detail.runningKidsTotal,
    }))).toEqual([
      { kidsAtStop: 2, runningKidsTotal: 2 },
      { kidsAtStop: 3, runningKidsTotal: 5 },
    ]);
  });

  it('keeps travel labels available when the first trip time is missing', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Start', lat: 44.34, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'End', lat: 44.41, lng: -79.66, now });
    project = updateRoutePlanner2Service(project, 'scenario-1', { firstTripTime: '' }, now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-1-stop-2', 6, now);

    const scenario = project.scenarios[0]!;
    const details = buildRoutePlanner2StopCardDetails(scenario, deriveRoutePlanner2Feasibility(scenario));

    expect(details.map((detail) => detail.arrivalLabel)).toEqual(['Not set', 'Not set']);
    expect(details.map((detail) => detail.travelTimeLabel)).toEqual(['0 min', '6 min']);
  });

  it('builds stop-order runtime rows with previous-segment and running-time metrics per visit', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Start', lat: 44.34, lng: -79.69, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Turnaround', lat: 44.41, lng: -79.66, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { turnaroundStopId: 'stop-2' });
    project = updateRoutePlanner2Service(project, 'scenario-1', { firstTripTime: '08:00' }, now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-1-stop-2', 6, now);
    project = setRoutePlanner2SegmentRuntimeOverride(project, 'scenario-1', 'segment-stop-2-stop-1', 7, now);

    const scenario = project.scenarios[0]!;
    const details = buildRoutePlanner2StopVisitRuntimeDetails(scenario, deriveRoutePlanner2Feasibility(scenario));

    expect(details.map((detail) => ({
      key: detail.key,
      stopId: detail.stopId,
      segmentRuntimeLabel: detail.segmentRuntimeLabel,
      runningRuntimeLabel: detail.runningRuntimeLabel,
      arrivalLabel: detail.arrivalLabel,
      source: detail.source,
    }))).toEqual([
      { key: 'stop-stop-1-0', stopId: 'stop-1', segmentRuntimeLabel: 'Start', runningRuntimeLabel: '0 min', arrivalLabel: '8:00 AM', source: undefined },
      { key: 'stop-stop-2-1', stopId: 'stop-2', segmentRuntimeLabel: '6 min', runningRuntimeLabel: '6 min', arrivalLabel: '8:06 AM', source: 'manual' },
      { key: 'stop-stop-1-2', stopId: 'stop-1', segmentRuntimeLabel: '7 min', runningRuntimeLabel: '13 min', arrivalLabel: '8:13 AM', source: 'manual' },
    ]);
  });
});
