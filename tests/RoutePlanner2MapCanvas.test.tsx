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
    ],
  }];

  it('abbreviates road names so more labels fit at full-route zoom', () => {
    expect(formatRoutePlanner2RoadNameLabel('Mapleview Drive')).toBe('Mapleview Dr');
    expect(formatRoutePlanner2RoadNameLabel('  Ardagh   Road  ')).toBe('Ardagh Rd');
  });

  it('builds both line-following and overview midpoint labels for every road name', () => {
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
    expect(overviewLabels.features.every((feature) => feature.geometry.type === 'Point')).toBe(true);
  });
});
