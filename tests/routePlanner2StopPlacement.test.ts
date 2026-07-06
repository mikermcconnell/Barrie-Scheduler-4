import { describe, expect, it } from 'vitest';

import {
  canFlipRoutePlanner2StopSide,
  flipRoutePlanner2StopSide,
  getRoutePlanner2StopPlacementWarning,
  nudgeRoutePlanner2StopCoordinate,
  ROUTE_PLANNER_2_STOP_NUDGE_METERS,
} from '../utils/route-planner-2/routePlanner2StopPlacement';
import type { RoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2Types';

function scenarioFixture(): RoutePlanner2Scenario {
  return {
    id: 'scenario-1',
    name: 'Route concept',
    status: 'draft',
    routeShape: 'one-way',
    alignment: [],
    stops: [
      { id: 'stop-1', name: 'A', lat: 44.38, lng: -79.7, sequence: 1, role: 'regular', source: 'custom' },
      { id: 'stop-2', name: 'B', lat: 44.38009, lng: -79.6995, sequence: 2, role: 'regular', source: 'custom' },
      { id: 'stop-3', name: 'C', lat: 44.38, lng: -79.699, sequence: 3, role: 'regular', source: 'custom' },
    ],
    service: {
      firstTripTime: '06:00',
      lastTripTime: '22:00',
      frequencyMinutes: 30,
      startTerminalLayoverMinutes: 5,
      endTerminalLayoverMinutes: 5,
      intermediateStopDwellSeconds: 30,
    },
    notes: '',
    createdAt: '2026-07-06T12:00:00.000Z',
    updatedAt: '2026-07-06T12:00:00.000Z',
  };
}

describe('Route Planner 2 stop placement helpers', () => {
  it('nudges a stop by a small predictable distance', () => {
    const coordinate = { lat: 44.38, lng: -79.7 };
    const nudged = nudgeRoutePlanner2StopCoordinate(coordinate, 'north');

    expect(nudged.lat).toBeGreaterThan(coordinate.lat);
    expect((nudged.lat - coordinate.lat) * 111_320).toBeCloseTo(ROUTE_PLANNER_2_STOP_NUDGE_METERS, 5);
    expect(nudged.lng).toBeCloseTo(coordinate.lng, 8);
  });

  it('flips an interior stop to the opposite side of the inferred street line', () => {
    const scenario = scenarioFixture();
    const originalStop = scenario.stops[1]!;
    const flipped = flipRoutePlanner2StopSide(scenario, originalStop.id);

    expect(canFlipRoutePlanner2StopSide(scenario, originalStop.id)).toBe(true);
    expect(flipped).not.toBeNull();
    expect(flipped!.lat).toBeLessThan(44.38);
    expect(Math.abs(flipped!.lng - originalStop.lng)).toBeLessThan(0.00005);
  });

  it('does not flip a two-stop endpoint without a stable reference line', () => {
    const scenario = {
      ...scenarioFixture(),
      stops: scenarioFixture().stops.slice(0, 2),
    };

    expect(canFlipRoutePlanner2StopSide(scenario, 'stop-1')).toBe(false);
    expect(flipRoutePlanner2StopSide(scenario, 'stop-1')).toBeNull();
  });

  it('warns when a selected stop creates a suspicious routing detour', () => {
    const scenario = scenarioFixture();
    const warning = getRoutePlanner2StopPlacementWarning(scenario, 'stop-2', [{
      id: 'segment-stop-1-stop-2',
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      runtimeMinutes: 6,
      source: 'mapbox',
      confidence: 'medium',
      distanceKm: 0.5,
    }]);

    expect(warning?.message).toContain('wrong side of the street');
    expect(warning?.action).toContain('Flip side');
  });

  it('uses nudge-only warning copy when flip side is unavailable', () => {
    const scenario = {
      ...scenarioFixture(),
      stops: scenarioFixture().stops.slice(0, 2),
    };
    const warning = getRoutePlanner2StopPlacementWarning(scenario, 'stop-1', [{
      id: 'segment-stop-1-stop-2',
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      runtimeMinutes: 6,
      source: 'mapbox',
      confidence: 'medium',
      distanceKm: 0.5,
    }]);

    expect(warning?.message).toContain('wrong side of the street');
    expect(warning?.action).toContain('nudge');
    expect(warning?.action).not.toContain('Flip side');
  });
});
