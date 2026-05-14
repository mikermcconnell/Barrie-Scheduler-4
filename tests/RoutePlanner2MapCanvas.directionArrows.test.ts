import { describe, expect, it } from 'vitest';

import { buildRoutePlanner2DirectionArrowGeoJson } from '../components/Analytics/route-planner-2/RoutePlanner2MapCanvas';
import { addRoutePlanner2Stop, updateRoutePlanner2RouteShape } from '../utils/route-planner-2/routePlanner2Authoring';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('RoutePlanner2MapCanvas direction arrows', () => {
  const now = '2026-05-01T12:00:00.000Z';

  it('marks out-and-back shared segments with arrows in both directions', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Stop 3', lat: 44.4, lng: -79.66, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { turnaroundStopId: 'stop-3', now });

    const geoJson = buildRoutePlanner2DirectionArrowGeoJson(project.scenarios[0]!, []);
    const lanes = geoJson.features.map((feature) => feature.properties.lane);

    expect(geoJson.features).toHaveLength(4);
    expect(lanes).toEqual(['outbound', 'outbound', 'return', 'return']);
  });

  it('keeps two-way arrows on opposite visual lanes by normalizing shared geometry direction', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.39, lng: -79.68, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { turnaroundStopId: 'stop-2', now });

    const geoJson = buildRoutePlanner2DirectionArrowGeoJson(project.scenarios[0]!, []);
    const outbound = geoJson.features.find((feature) => feature.properties.lane === 'outbound');
    const inbound = geoJson.features.find((feature) => feature.properties.lane === 'return');

    expect(outbound?.properties.label).toBe('➜');
    expect(inbound?.properties.label).toBe('←');
    expect(outbound?.geometry.coordinates).toEqual(inbound?.geometry.coordinates);
  });

  it('adds clear arrow labels for map rendering', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.39, lng: -79.68, now });

    const geoJson = buildRoutePlanner2DirectionArrowGeoJson(project.scenarios[0]!, []);

    expect(geoJson.features[0]?.properties.label).toBe('➜');
    expect(geoJson.features[0]?.properties.lane).toBe('center');
  });

  it('keeps closed-loop arrows as one-way center arrows', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Stop 3', lat: 44.4, lng: -79.66, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'closed-loop', { now });

    const geoJson = buildRoutePlanner2DirectionArrowGeoJson(project.scenarios[0]!, []);

    expect(geoJson.features).toHaveLength(3);
    expect(geoJson.features.every((feature) => feature.properties.lane === 'center')).toBe(true);
  });
});
