import { describe, expect, it, vi } from 'vitest';

import { addRoutePlanner2LineWaypoint, addRoutePlanner2Stop } from '../utils/route-planner-2/routePlanner2Authoring';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import {
  buildRoutePlanner2FallbackRoadSnapResult,
  snapRoutePlanner2ScenarioToRoad,
  snapRoutePlanner2WaypointsToRoad,
} from '../utils/route-planner-2/routePlanner2RoadSnap';

describe('Route Planner 2 road snap', () => {
  it('falls back to straight coordinates when no Mapbox token is available', async () => {
    const waypoints: [number, number][] = [[-79.7, 44.38], [-79.68, 44.39]];

    const result = await snapRoutePlanner2WaypointsToRoad(waypoints, { token: null });

    expect(result).toMatchObject({ coordinates: waypoints, source: 'fallback' });
    expect(result.distanceMeters).toBeGreaterThan(0);
  });

  it('uses the Mapbox Directions response when a token is available', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          duration: 180,
          distance: 1200,
          geometry: {
            type: 'LineString',
            coordinates: [[-79.7, 44.38], [-79.69, 44.385], [-79.68, 44.39]],
          },
          legs: [{
            steps: [
              {
                name: 'Mapleview Drive',
                geometry: {
                  type: 'LineString',
                  coordinates: [[-79.7, 44.38], [-79.69, 44.385]],
                },
              },
              {
                name: 'Yonge Street',
                geometry: {
                  type: 'LineString',
                  coordinates: [[-79.69, 44.385], [-79.68, 44.39]],
                },
              },
            ],
          }],
        }],
      }),
    } as Response));

    const result = await snapRoutePlanner2WaypointsToRoad([[-79.7, 44.38], [-79.68, 44.39]], {
      token: 'test-token',
      fetchImpl,
    });

    expect(result.source).toBe('mapbox');
    expect(result.coordinates).toEqual([[-79.7, 44.38], [-79.69, 44.385], [-79.68, 44.39]]);
    expect(result.durationSeconds).toBe(180);
    expect(result.distanceMeters).toBe(1200);
    expect(result.roadLabels?.map((label) => label.name)).toEqual(['Mapleview Drive', 'Yonge Street']);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('api.mapbox.com/directions/v5/mapbox/driving'));
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('steps=true'));
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('access_token=test-token'));
  });

  it('returns segment runtime estimates for stop-to-stop paths with line waypoints', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-04-29T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Start', lat: 44.38, lng: -79.7 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'End', lat: 44.39, lng: -79.68 });
    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'waypoint-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.385,
      lng: -79.69,
    });

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          duration: 90,
          distance: 600,
          geometry: {
            type: 'LineString',
            coordinates: [[-79.7, 44.38], [-79.69, 44.385]],
          },
        }],
      }),
    } as Response));

    const result = await snapRoutePlanner2ScenarioToRoad(project.scenarios[0]!, {
      token: 'test-token',
      fetchImpl,
    });

    expect(result.segmentEstimates).toHaveLength(1);
    expect(result.segmentEstimates[0]).toMatchObject({
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      runtimeMinutes: 3,
      source: 'mapbox',
      confidence: 'medium',
      distanceKm: 1.2,
    });
    expect(result.segmentEstimates[0]?.pathFingerprint).toContain('-79.7,44.38|-79.69,44.385|-79.68,44.39');
  });

  it('returns fallback segment runtime estimates without Mapbox snapping', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-04-29T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Start', lat: 44.38, lng: -79.7 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Middle', lat: 44.39, lng: -79.68 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'End', lat: 44.4, lng: -79.66 });

    const result = buildRoutePlanner2FallbackRoadSnapResult(project.scenarios[0]!);

    expect(result.segmentEstimates).toHaveLength(2);
    expect(result.segmentEstimates[0]).toMatchObject({
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      source: 'fallback',
      confidence: 'low',
      fallbackReason: 'Mapbox travel time was unavailable; using distance and default speed.',
    });
    expect(result.segmentEstimates[0]?.runtimeMinutes).toBeGreaterThan(0);
    expect(result.segmentEstimates[0]?.distanceKm).toBeGreaterThan(0);
  });

  it('limits scenario road snapping concurrency and reports progress', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-04-29T12:00:00.000Z' });
    for (let index = 0; index < 6; index += 1) {
      project = addRoutePlanner2Stop(project, 'scenario-1', {
        id: `stop-${index + 1}`,
        name: `Stop ${index + 1}`,
        lat: 44.38 + index * 0.002,
        lng: -79.7 + index * 0.002,
      });
    }

    let activeRequests = 0;
    let maxActiveRequests = 0;
    const progress = vi.fn();
    const fetchImpl = vi.fn(async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;
      return {
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{
            duration: 120,
            distance: 900,
            geometry: {
              type: 'LineString',
              coordinates: [[-79.7, 44.38], [-79.69, 44.39]],
            },
          }],
        }),
      } as Response;
    });

    const result = await snapRoutePlanner2ScenarioToRoad(project.scenarios[0]!, {
      token: 'test-token-concurrency',
      fetchImpl,
      concurrency: 2,
      onProgress: progress,
    });

    expect(result.segmentEstimates).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(maxActiveRequests).toBeLessThanOrEqual(2);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      totalSegments: 5,
      completedSegments: 5,
    }));
  });
});
