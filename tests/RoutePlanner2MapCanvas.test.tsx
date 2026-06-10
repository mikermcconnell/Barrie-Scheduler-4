import { describe, expect, it } from 'vitest';

import {
  buildRoadNameLineLabelGeoJson,
  buildRoadNameOverviewLabelGeoJson,
  buildLineGeoJson,
  buildRoutePlanner2SegmentLineGeoJson,
  buildRoutePlanner2ScenarioOverlayGeoJson,
  formatRoutePlanner2MapStopLabel,
  formatRoutePlanner2RoadNameLabel,
  getRoutePlanner2ScenarioColor,
} from '../components/Analytics/route-planner-2/RoutePlanner2MapCanvas';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import type { RoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2Types';

describe('RoutePlanner2MapCanvas stop labels', () => {
  it('includes address context in stop labels', () => {
    expect(formatRoutePlanner2MapStopLabel({
      stopId: 'stop-1',
      stopName: 'Johnson School',
      address: '37 Johnson Street, Barrie, ON L4M 5C3',
      kidsAtStop: 2,
      travelTimeLabel: '6 min',
      departureLabel: '8:21 AM',
    }, {
      includePlaceLabel: true,
    })).toBe('37 Johnson Street\nDep 8:21 AM · 6 min · 2 kids');
  });

  it('falls back to kids count when travel time is not estimated', () => {
    expect(formatRoutePlanner2MapStopLabel({
      stopId: 'stop-1',
      stopName: 'Johnson School',
      kidsAtStop: 1,
      travelTimeLabel: 'Not estimated',
    }, {
      includePlaceLabel: true,
    })).toBe('Johnson School\n1 kid');
  });

  it('keeps the previous metric-only label when no address or stop name is available', () => {
    expect(formatRoutePlanner2MapStopLabel({
      stopId: 'stop-1',
      kidsAtStop: 1,
      travelTimeLabel: 'Not estimated',
    })).toBe('1 kid');
  });
});

describe('RoutePlanner2MapCanvas road labels', () => {
  const segmentGeometries = [{
    id: 'segment-1',
    fromStopId: 'stop-1',
    toStopId: 'stop-2',
    coordinates: [[-79.7, 44.38], [-79.68, 44.39]] as [number, number][],
    roadLabels: [
      {
        name: 'Mapleview Drive',
        coordinates: [[-79.7, 44.38], [-79.69, 44.385]] as [number, number][],
      },
      {
        name: 'Yonge Street',
        coordinates: [[-79.69, 44.385], [-79.68, 44.39]] as [number, number][],
      },
      {
        name: 'Ardagh Road',
        coordinates: [[-79.68, 44.39], [-79.67, 44.395]] as [number, number][],
      },
      {
        name: 'Mapleview Drive',
        coordinates: [[-79.66, 44.40], [-79.655, 44.405]] as [number, number][],
      },
    ],
  }];

  it('abbreviates road names so more labels fit at full-route zoom', () => {
    expect(formatRoutePlanner2RoadNameLabel('Mapleview Drive')).toBe('Mapleview Dr');
    expect(formatRoutePlanner2RoadNameLabel('  Ardagh   Road  ')).toBe('Ardagh Rd');
  });

  it('builds one line-following and overview line label per unique road name', () => {
    const lineLabels = buildRoadNameLineLabelGeoJson(segmentGeometries);
    const overviewLabels = buildRoadNameOverviewLabelGeoJson(segmentGeometries);

    expect(lineLabels.features.map((feature) => feature.properties.label)).toEqual([
      'Mapleview Dr',
      'Yonge St',
      'Ardagh Rd',
    ]);
    expect(overviewLabels.features.map((feature) => feature.properties.label)).toEqual([
      'Mapleview Dr',
      'Yonge St',
      'Ardagh Rd',
    ]);
    expect(overviewLabels.features.every((feature) => feature.geometry.type === 'LineString')).toBe(true);
  });

  it('deduplicates road labels inside the current export page bounds', () => {
    const lineLabels = buildRoadNameLineLabelGeoJson(segmentGeometries, {
      minLng: -79.661,
      minLat: 44.399,
      maxLng: -79.654,
      maxLat: 44.406,
    });

    expect(lineLabels.features.map((feature) => feature.properties.label)).toEqual(['Mapleview Dr']);
    expect(lineLabels.features[0]?.geometry.coordinates).toEqual([[-79.66, 44.4], [-79.655, 44.405]]);
  });

  it('limits low-density road labels to the strongest readable labels', () => {
    const denseSegments = [{
      id: 'segment-dense',
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      coordinates: [[-79.7, 44.38], [-79.6, 44.45]] as [number, number][],
      roadLabels: Array.from({ length: 8 }, (_, index) => ({
        name: `Local Street ${index + 1}`,
        coordinates: [
          [-79.7 + (index * 0.01), 44.38],
          [-79.695 + (index * 0.01), 44.385],
        ] as [number, number][],
      })),
    }];

    const lineLabels = buildRoadNameLineLabelGeoJson(denseSegments, null, 'fewer');

    expect(lineLabels.features).toHaveLength(6);
    expect(lineLabels.features.map((feature) => feature.properties.label)).toEqual([
      'Local St 1',
      'Local St 2',
      'Local St 3',
      'Local St 4',
      'Local St 5',
      'Local St 6',
    ]);
  });
});

describe('RoutePlanner2MapCanvas route overlays', () => {
  it('builds one muted background route feature per non-selected route concept', () => {
    const base = createRoutePlanner2Project({
      id: 'project-1',
      scenarioId: 'selected-route',
      now: '2026-04-29T12:00:00.000Z',
    }).scenarios[0]!;
    const routeA: RoutePlanner2Scenario = {
      ...base,
      id: 'route-a',
      name: 'Route 2A',
      stops: [
        { id: 'a-1', name: 'A1', lat: 44.38, lng: -79.69, sequence: 1, role: 'start-terminal', source: 'custom' },
        { id: 'a-2', name: 'A2', lat: 44.39, lng: -79.68, sequence: 2, role: 'end-terminal', source: 'custom' },
      ],
    };
    const routeB: RoutePlanner2Scenario = {
      ...base,
      id: 'route-b',
      name: 'Route 8A',
      stops: [
        { id: 'b-1', name: 'B1', lat: 44.4, lng: -79.67, sequence: 1, role: 'start-terminal', source: 'custom' },
        { id: 'b-2', name: 'B2', lat: 44.41, lng: -79.66, sequence: 2, role: 'end-terminal', source: 'custom' },
      ],
    };
    const emptyRoute: RoutePlanner2Scenario = {
      ...base,
      id: 'empty-route',
      name: 'Empty route',
      stops: [],
    };

    const overlays = buildRoutePlanner2ScenarioOverlayGeoJson([routeA, routeB, emptyRoute]);

    expect(overlays.features).toHaveLength(2);
    expect(overlays.features.map((feature) => feature.properties.scenarioId)).toEqual(['route-a', 'route-b']);
    expect(overlays.features.map((feature) => feature.properties.color)).toEqual(['#006838', '#000000']);
    expect(overlays.features[0]?.geometry.coordinates).toEqual([[-79.69, 44.38], [-79.68, 44.39]]);
  });

  it('uses official route colors for GTFS route lines', () => {
    const base = createRoutePlanner2Project({
      id: 'project-1',
      scenarioId: 'selected-route',
      now: '2026-04-29T12:00:00.000Z',
    }).scenarios[0]!;
    const route12: RoutePlanner2Scenario = {
      ...base,
      name: 'Route 12B - South GO',
      source: { type: 'gtfs', routeShortName: '12B', routeColor: '#00AEEF' },
    };

    expect(getRoutePlanner2ScenarioColor(route12)).toBe('#F8A1BE');
    expect(buildLineGeoJson([[-79.69, 44.38], [-79.68, 44.39]], getRoutePlanner2ScenarioColor(route12)).features[0]?.properties.color).toBe('#F8A1BE');
  });

  it('renders snapped road segments as separate route-line features to avoid straight connector chords', () => {
    const geoJson = buildRoutePlanner2SegmentLineGeoJson([
      {
        id: 'a-to-b',
        fromStopId: 'a',
        toStopId: 'b',
        coordinates: [
          [-79.70, 44.38],
          [-79.69, 44.39],
        ],
      },
      {
        id: 'b-to-c',
        fromStopId: 'b',
        toStopId: 'c',
        coordinates: [
          [-79.65, 44.42],
          [-79.64, 44.43],
        ],
      },
    ], '#0891b2');

    expect(geoJson.features).toHaveLength(2);
    expect(geoJson.features[0]?.geometry.coordinates).toEqual([
      [-79.70, 44.38],
      [-79.69, 44.39],
    ]);
    expect(geoJson.features[1]?.geometry.coordinates).toEqual([
      [-79.65, 44.42],
      [-79.64, 44.43],
    ]);
  });
});
