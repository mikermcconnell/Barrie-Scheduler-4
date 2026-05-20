import { describe, expect, it } from 'vitest';

import {
  buildRoadNameLineLabelGeoJson,
  buildRoadNameOverviewLabelGeoJson,
  formatRoutePlanner2MapStopLabel,
  formatRoutePlanner2RoadNameLabel,
} from '../components/Analytics/route-planner-2/RoutePlanner2MapCanvas';

describe('RoutePlanner2MapCanvas stop labels', () => {
  it('formats subtle map labels with travel time and kids count', () => {
    expect(formatRoutePlanner2MapStopLabel({
      stopId: 'stop-1',
      kidsAtStop: 2,
      travelTimeLabel: '6 min',
    })).toBe('6 min · 2 kids');
  });

  it('falls back to kids count when travel time is not estimated', () => {
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
