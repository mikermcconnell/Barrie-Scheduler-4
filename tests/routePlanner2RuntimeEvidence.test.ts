import { describe, expect, it } from 'vitest';

import {
  deriveRoutePlanner2EvidenceRuntimeEstimates,
  resolveRoutePlanner2RuntimeEvidenceSegment,
} from '../utils/route-planner-2/routePlanner2RuntimeEvidence';
import type { CorridorSpeedIndex, CorridorSpeedStats } from '../utils/gtfs/corridorSpeed';
import type { GtfsStopWithCoords } from '../utils/gtfs/gtfsStopLookup';
import type { RoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2Types';

describe('resolveRoutePlanner2RuntimeEvidenceSegment', () => {
  it('returns high-confidence observed proxy for a strong observed sample', () => {
    expect(resolveRoutePlanner2RuntimeEvidenceSegment({
      scheduledRuntimeMin: 10,
      observedRuntimeMin: 14.4,
      sampleCount: 10,
      lowConfidence: false,
    })).toEqual({
      runtimeMinutes: 14,
      source: 'observed-proxy',
      confidence: 'high',
    });
  });

  it('returns a medium-confidence observed/scheduled blend for partial observed samples', () => {
    expect(resolveRoutePlanner2RuntimeEvidenceSegment({
      scheduledRuntimeMin: 10,
      observedRuntimeMin: 16,
      sampleCount: 4,
      lowConfidence: false,
    })).toEqual({
      runtimeMinutes: 12,
      source: 'observed-scheduled-blend',
      confidence: 'medium',
    });
  });

  it('returns scheduled proxy when only scheduled runtime exists', () => {
    expect(resolveRoutePlanner2RuntimeEvidenceSegment({
      scheduledRuntimeMin: 10.4,
      observedRuntimeMin: null,
      sampleCount: 0,
      lowConfidence: false,
    })).toEqual({
      runtimeMinutes: 10,
      source: 'scheduled-proxy',
      confidence: 'medium',
    });
  });

  it('returns medium-confidence observed proxy when only weak observed runtime exists', () => {
    expect(resolveRoutePlanner2RuntimeEvidenceSegment({
      scheduledRuntimeMin: null,
      observedRuntimeMin: 13.4,
      sampleCount: 2,
      lowConfidence: true,
    })).toEqual({
      runtimeMinutes: 13,
      source: 'observed-proxy',
      confidence: 'medium',
    });
  });

  it('returns null when scheduled and observed runtimes are both missing', () => {
    expect(resolveRoutePlanner2RuntimeEvidenceSegment({
      scheduledRuntimeMin: null,
      observedRuntimeMin: null,
      sampleCount: 0,
      lowConfidence: false,
    })).toBeNull();
  });
});

describe('deriveRoutePlanner2EvidenceRuntimeEstimates', () => {
  const gtfsStops: GtfsStopWithCoords[] = [
    { stop_id: 'gtfs-a', stop_code: '100', stop_name: 'Stop A', lat: 44.38, lon: -79.7 },
    { stop_id: 'gtfs-b', stop_code: '200', stop_name: 'Stop B', lat: 44.39, lon: -79.69 },
  ];
  const now = '2026-05-01T13:00:00.000Z';

  const stats: CorridorSpeedStats = {
    segmentId: 'North|gtfs-a|gtfs-b',
    directionId: 'North',
    period: 'full-day',
    dayType: 'weekday',
    sampleCount: 4,
    lowConfidence: false,
    corridorLengthMeters: 1000,
    scheduledRuntimeMin: 10,
    observedRuntimeMin: 16,
    runtimeDeltaMin: 6,
    runtimeDeltaPct: 60,
    scheduledSpeedKmh: 6,
    observedSpeedKmh: 3.75,
    routeBreakdown: [{ route: '8A', sampleCount: 4, scheduledRuntimeMin: 10, observedRuntimeMin: 16, runtimeDeltaMin: 6, runtimeDeltaPct: 60, scheduledSpeedKmh: 6, observedSpeedKmh: 3.75 }],
  };

  const speedIndex: CorridorSpeedIndex = {
    segments: [{
      id: 'North|gtfs-a|gtfs-b',
      fromStopId: 'gtfs-a',
      toStopId: 'gtfs-b',
      fromStopName: 'Stop A',
      toStopName: 'Stop B',
      directionId: 'North',
      routes: ['8A'],
      geometry: [[44.38, -79.7], [44.39, -79.69]],
      lengthMeters: 1000,
    }],
    availableDirections: ['North'],
    statsBySegmentId: new Map([
      ['North|gtfs-a|gtfs-b', new Map([
        ['weekday', new Map([
          ['full-day', stats],
        ])],
      ])],
    ]),
  };

  const scenario: RoutePlanner2Scenario = {
    id: 'scenario-1',
    name: 'Evidence test',
    status: 'draft',
    routeShape: 'one-way',
    alignment: [],
    stops: [
      { id: 'rp-a', name: 'Stop A', lat: 44.38, lng: -79.7, sequence: 1, role: 'start-terminal', source: 'custom', stopCode: '100' },
      { id: 'rp-b', name: 'Stop B', lat: 44.39, lng: -79.69, sequence: 2, role: 'end-terminal', source: 'custom', stopCode: '200' },
    ],
    service: {
      firstTripTime: '06:00',
      lastTripTime: '22:00',
      frequencyMinutes: 30,
      startTerminalLayoverMinutes: 5,
      endTerminalLayoverMinutes: 5,
      intermediateStopDwellSeconds: 0,
    },
    notes: '',
    createdAt: '2026-05-01T12:00:00.000Z',
    updatedAt: '2026-05-01T12:00:00.000Z',
  };

  it('returns a segment estimate with path fingerprint and matched stop IDs', () => {
    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      scenario,
      speedIndex,
      'weekday',
      'full-day',
      { gtfsStops, now },
    );

    expect(estimates).toHaveLength(1);
    expect(estimates[0]).toMatchObject({
      id: 'segment-rp-a-rp-b',
      fromStopId: 'rp-a',
      toStopId: 'rp-b',
      runtimeMinutes: 12,
      source: 'observed-scheduled-blend',
      confidence: 'medium',
      sampleSize: 4,
      scheduledRuntimeMinutes: 10,
      observedRuntimeMinutes: 16,
      matchQuality: 'exact-code',
      matchedFromStopId: 'gtfs-a',
      matchedToStopId: 'gtfs-b',
      matchedRoutes: ['8A'],
      updatedAt: now,
    });
    expect(estimates[0]?.pathFingerprint).toBe('-79.7,44.38|-79.69,44.39');
  });

  it('returns no estimates when Route Planner stops do not match GTFS stops', () => {
    let diagnostic: unknown;
    const unmatchedScenario: RoutePlanner2Scenario = {
      ...scenario,
      stops: [
        { ...scenario.stops[0]!, lat: 45, lng: -80, stopCode: undefined },
        { ...scenario.stops[1]!, lat: 45.01, lng: -80.01, stopCode: undefined },
      ],
    };
    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      unmatchedScenario,
      speedIndex,
      'weekday',
      'full-day',
      { gtfsStops: [], now, onDiagnostic: (value) => { diagnostic = value; } },
    );

    expect(estimates).toEqual([]);
    expect(diagnostic).toMatchObject({
      scenarioId: 'scenario-1',
      preferredRoute: null,
      dayType: 'weekday',
      period: 'full-day',
      gtfsStopCount: 0,
      speedSegmentCount: 1,
      statsForSelectedPeriodCount: 1,
      segmentCount: 1,
      estimateCount: 0,
      segments: [{
        segmentId: 'segment-rp-a-rp-b',
        reason: 'from-stop-unmatched',
      }],
    });
  });

  it('uses GTFS shape overlap when custom stops follow a route shape but are not GTFS stops', () => {
    const shapeStats: CorridorSpeedStats = {
      ...stats,
      segmentId: 'North|gtfs-a|gtfs-b',
      scheduledRuntimeMin: 20,
      observedRuntimeMin: null,
      sampleCount: 0,
      routeBreakdown: [
        { route: '12', sampleCount: 0, scheduledRuntimeMin: 20, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
      ],
    };
    const shapeIndex: CorridorSpeedIndex = {
      segments: [{
        ...speedIndex.segments[0]!,
        id: 'North|gtfs-a|gtfs-b',
        fromStopId: 'gtfs-a',
        toStopId: 'gtfs-b',
        routes: ['12'],
        geometry: [[44.38, -79.7], [44.39, -79.69], [44.4, -79.68], [44.41, -79.67], [44.42, -79.66]],
        lengthMeters: 5500,
      }],
      availableDirections: ['North'],
      statsBySegmentId: new Map([
        ['North|gtfs-a|gtfs-b', new Map([['weekday', new Map([['full-day', shapeStats]])]])],
      ]),
    };
    const shapeScenario: RoutePlanner2Scenario = {
      ...scenario,
      source: { type: 'gtfs', routeShortName: '12' },
      stops: [
        { id: 'rp-shape-start', name: 'Custom start on route', lat: 44.395, lng: -79.685, sequence: 1, role: 'start-terminal', source: 'custom' },
        { id: 'rp-shape-end', name: 'Custom end on route', lat: 44.405, lng: -79.675, sequence: 2, role: 'end-terminal', source: 'custom' },
      ],
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      shapeScenario,
      shapeIndex,
      'weekday',
      'full-day',
      { gtfsStops, now, runtimeBasis: 'scheduled' },
    );

    expect(estimates).toHaveLength(1);
    expect(estimates[0]).toMatchObject({
      id: 'segment-rp-shape-start-rp-shape-end',
      source: 'scheduled-proxy',
      matchedRoutes: ['12'],
      evidenceMethod: 'shape-overlap',
      matchedGtfsPathStopIds: ['gtfs-a', 'gtfs-b'],
    });
    expect(estimates[0]?.runtimeMinutes).toBeGreaterThan(1);
    expect(estimates[0]?.runtimeMinutes).toBeLessThan(20);
  });

  it('returns no estimates when matched stops have no stats for the requested period', () => {
    let diagnostic: unknown;
    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      scenario,
      speedIndex,
      'weekday',
      'am-peak',
      { gtfsStops, now, onDiagnostic: (value) => { diagnostic = value; } },
    );

    expect(estimates).toEqual([]);
    expect(diagnostic).toMatchObject({
      dayType: 'weekday',
      period: 'am-peak',
      statsForSelectedPeriodCount: 0,
      estimateCount: 0,
      segments: [{
        segmentId: 'segment-rp-a-rp-b',
        reason: 'no-stats-for-selected-day-period',
        matchedSpeedSegmentId: 'North|gtfs-a|gtfs-b',
        matchedSegmentRoutes: ['8A'],
      }],
    });
  });

  it('falls back to route breakdown values when the matched corridor segment has no routes', () => {
    const speedIndexWithRouteBreakdownOnly: CorridorSpeedIndex = {
      ...speedIndex,
      segments: speedIndex.segments.map((segment) => ({ ...segment, routes: [] as string[] })),
      statsBySegmentId: new Map([
        ['North|gtfs-a|gtfs-b', new Map([
          ['weekday', new Map([
            ['full-day', {
              ...stats,
              routeBreakdown: [
                { route: '8A', sampleCount: 2, scheduledRuntimeMin: 10, observedRuntimeMin: 16, runtimeDeltaMin: 6, runtimeDeltaPct: 60, scheduledSpeedKmh: 6, observedSpeedKmh: 3.75 },
                { route: '8B', sampleCount: 2, scheduledRuntimeMin: 10, observedRuntimeMin: 16, runtimeDeltaMin: 6, runtimeDeltaPct: 60, scheduledSpeedKmh: 6, observedSpeedKmh: 3.75 },
              ],
            }],
          ])],
        ])],
      ]),
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      scenario,
      speedIndexWithRouteBreakdownOnly,
      'weekday',
      'full-day',
      { gtfsStops, now },
    );

    expect(estimates[0]?.matchedRoutes).toEqual(['8A', '8B']);
  });

  it('uses the selected time period and GTFS route when deriving scheduled runtime evidence', () => {
    const routeScopedScenario: RoutePlanner2Scenario = {
      ...scenario,
      source: {
        type: 'gtfs',
        routeShortName: '8B',
      },
    };
    const amPeakStats: CorridorSpeedStats = {
      ...stats,
      period: 'am-peak',
      scheduledRuntimeMin: 15,
      observedRuntimeMin: null,
      sampleCount: 0,
      routeBreakdown: [
        { route: '8A', sampleCount: 0, scheduledRuntimeMin: 11, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: 5.5, observedSpeedKmh: null },
        { route: '8B', sampleCount: 0, scheduledRuntimeMin: 19, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: 3.2, observedSpeedKmh: null },
      ],
    };
    const routeScopedIndex: CorridorSpeedIndex = {
      ...speedIndex,
      segments: [{
        ...speedIndex.segments[0]!,
        routes: ['8A', '8B'],
      }],
      statsBySegmentId: new Map([
        ['North|gtfs-a|gtfs-b', new Map([
          ['weekday', new Map([
            ['full-day', stats],
            ['am-peak', amPeakStats],
          ])],
        ])],
      ]),
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      routeScopedScenario,
      routeScopedIndex,
      'weekday',
      'am-peak',
      { gtfsStops, now, runtimeBasis: 'scheduled' },
    );

    expect(estimates).toHaveLength(1);
    expect(estimates[0]).toMatchObject({
      runtimeMinutes: 19,
      source: 'scheduled-proxy',
      confidence: 'high',
      scheduledRuntimeMinutes: 19,
      matchedRoutes: ['8B'],
      evidenceDayType: 'weekday',
      evidencePeriod: 'am-peak',
    });
    expect(estimates[0]?.observedRuntimeMinutes).toBeUndefined();
  });

  it('uses a scheduled GTFS corridor path when custom stops are not adjacent in GTFS', () => {
    const corridorGtfsStops: GtfsStopWithCoords[] = [
      ...gtfsStops,
      { stop_id: 'gtfs-c', stop_code: '300', stop_name: 'Stop C', lat: 44.4, lon: -79.68 },
    ];
    const corridorStats = (segmentId: string, runtimes: Record<string, number>): CorridorSpeedStats => {
      const runtimeValues = Object.values(runtimes);
      return {
        ...stats,
        segmentId,
        scheduledRuntimeMin: runtimeValues.reduce((sum, value) => sum + value, 0) / runtimeValues.length,
        observedRuntimeMin: null,
        sampleCount: 0,
        routeBreakdown: Object.entries(runtimes).map(([route, runtime]): CorridorSpeedStats['routeBreakdown'][number] => ({
          route,
          sampleCount: 0,
          scheduledRuntimeMin: runtime,
          observedRuntimeMin: null,
          runtimeDeltaMin: null,
          runtimeDeltaPct: null,
          scheduledSpeedKmh: null,
          observedSpeedKmh: null,
        })),
      };
    };
    const abStats = corridorStats('North|gtfs-a|gtfs-b', { '2A': 3, '8A': 5 });
    const bcStats = corridorStats('North|gtfs-b|gtfs-c', { '2A': 4, '8A': 6 });
    const corridorIndex: CorridorSpeedIndex = {
      segments: [
        {
          ...speedIndex.segments[0]!,
          id: 'North|gtfs-a|gtfs-b',
          fromStopId: 'gtfs-a',
          toStopId: 'gtfs-b',
          fromStopName: 'Stop A',
          toStopName: 'Stop B',
          routes: ['2A', '8A'],
          geometry: [[44.38, -79.7], [44.39, -79.69]],
          lengthMeters: 1400,
        },
        {
          ...speedIndex.segments[0]!,
          id: 'North|gtfs-b|gtfs-c',
          fromStopId: 'gtfs-b',
          toStopId: 'gtfs-c',
          fromStopName: 'Stop B',
          toStopName: 'Stop C',
          routes: ['2A', '8A'],
          geometry: [[44.39, -79.69], [44.4, -79.68]],
          lengthMeters: 1400,
        },
      ],
      availableDirections: ['North'],
      statsBySegmentId: new Map([
        ['North|gtfs-a|gtfs-b', new Map([['weekday', new Map([['full-day', abStats]])]])],
        ['North|gtfs-b|gtfs-c', new Map([['weekday', new Map([['full-day', bcStats]])]])],
      ]),
    };
    const corridorScenario: RoutePlanner2Scenario = {
      ...scenario,
      stops: [
        scenario.stops[0]!,
        { id: 'rp-c', name: 'Stop C', lat: 44.4, lng: -79.68, sequence: 2, role: 'end-terminal', source: 'custom', stopCode: '300' },
      ],
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      corridorScenario,
      corridorIndex,
      'weekday',
      'full-day',
      { gtfsStops: corridorGtfsStops, now, runtimeBasis: 'scheduled' },
    );

    expect(estimates).toHaveLength(1);
    expect(estimates[0]).toMatchObject({
      id: 'segment-rp-a-rp-c',
      runtimeMinutes: 9,
      source: 'scheduled-proxy',
      confidence: 'high',
      scheduledRuntimeMinutes: 9,
      matchedRoutes: ['2A', '8A'],
      runtimeRouteBreakdown: [
        { routeShortName: '2A', scheduledRuntimeMinutes: 7 },
        { routeShortName: '8A', scheduledRuntimeMinutes: 11 },
      ],
      evidenceMethod: 'corridor-path',
      matchedGtfsPathStopIds: ['gtfs-a', 'gtfs-b', 'gtfs-c'],
    });
  });

  it('limits corridor path runtime to selected GTFS routes', () => {
    const corridorGtfsStops: GtfsStopWithCoords[] = [
      ...gtfsStops,
      { stop_id: 'gtfs-c', stop_code: '300', stop_name: 'Stop C', lat: 44.4, lon: -79.68 },
    ];
    const abStats: CorridorSpeedStats = {
      ...stats,
      segmentId: 'North|gtfs-a|gtfs-b',
      scheduledRuntimeMin: 4,
      observedRuntimeMin: null,
      routeBreakdown: [
        { route: '2A', sampleCount: 0, scheduledRuntimeMin: 3, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
        { route: '8A', sampleCount: 0, scheduledRuntimeMin: 5, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
      ],
    };
    const bcStats: CorridorSpeedStats = {
      ...stats,
      segmentId: 'North|gtfs-b|gtfs-c',
      scheduledRuntimeMin: 5,
      observedRuntimeMin: null,
      routeBreakdown: [
        { route: '2A', sampleCount: 0, scheduledRuntimeMin: 4, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
        { route: '8A', sampleCount: 0, scheduledRuntimeMin: 6, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
      ],
    };
    const corridorIndex: CorridorSpeedIndex = {
      segments: [
        { ...speedIndex.segments[0]!, id: 'North|gtfs-a|gtfs-b', fromStopId: 'gtfs-a', toStopId: 'gtfs-b', routes: ['2A', '8A'], geometry: [[44.38, -79.7], [44.39, -79.69]], lengthMeters: 1400 },
        { ...speedIndex.segments[0]!, id: 'North|gtfs-b|gtfs-c', fromStopId: 'gtfs-b', toStopId: 'gtfs-c', routes: ['2A', '8A'], geometry: [[44.39, -79.69], [44.4, -79.68]], lengthMeters: 1400 },
      ],
      availableDirections: ['North'],
      statsBySegmentId: new Map([
        ['North|gtfs-a|gtfs-b', new Map([['weekday', new Map([['full-day', abStats]])]])],
        ['North|gtfs-b|gtfs-c', new Map([['weekday', new Map([['full-day', bcStats]])]])],
      ]),
    };
    const selectedRouteScenario: RoutePlanner2Scenario = {
      ...scenario,
      source: {
        type: 'gtfs',
        routeShortName: '8A',
      },
      runtimeRouteFilter: { mode: 'selected', routeShortNames: ['2A'] },
      stops: [
        scenario.stops[0]!,
        { id: 'rp-c', name: 'Stop C', lat: 44.4, lng: -79.68, sequence: 2, role: 'end-terminal', source: 'custom', stopCode: '300' },
      ],
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      selectedRouteScenario,
      corridorIndex,
      'weekday',
      'full-day',
      { gtfsStops: corridorGtfsStops, now, runtimeBasis: 'scheduled' },
    );

    expect(estimates[0]).toMatchObject({
      runtimeMinutes: 7,
      scheduledRuntimeMinutes: 7,
      matchedRoutes: ['2A'],
      runtimeRouteBreakdown: [
        { routeShortName: '2A', scheduledRuntimeMinutes: 7 },
      ],
      evidenceMethod: 'corridor-path',
    });
  });

  it('allows all matching GTFS routes when the all-matching filter is explicitly selected', () => {
    const corridorGtfsStops: GtfsStopWithCoords[] = [
      ...gtfsStops,
      { stop_id: 'gtfs-c', stop_code: '300', stop_name: 'Stop C', lat: 44.4, lon: -79.68 },
    ];
    const abStats: CorridorSpeedStats = {
      ...stats,
      segmentId: 'North|gtfs-a|gtfs-b',
      scheduledRuntimeMin: 4,
      observedRuntimeMin: null,
      routeBreakdown: [
        { route: '2A', sampleCount: 0, scheduledRuntimeMin: 3, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
        { route: '8A', sampleCount: 0, scheduledRuntimeMin: 5, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
      ],
    };
    const bcStats: CorridorSpeedStats = {
      ...stats,
      segmentId: 'North|gtfs-b|gtfs-c',
      scheduledRuntimeMin: 5,
      observedRuntimeMin: null,
      routeBreakdown: [
        { route: '2A', sampleCount: 0, scheduledRuntimeMin: 4, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
        { route: '8A', sampleCount: 0, scheduledRuntimeMin: 6, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
      ],
    };
    const corridorIndex: CorridorSpeedIndex = {
      segments: [
        { ...speedIndex.segments[0]!, id: 'North|gtfs-a|gtfs-b', fromStopId: 'gtfs-a', toStopId: 'gtfs-b', routes: ['2A', '8A'], geometry: [[44.38, -79.7], [44.39, -79.69]], lengthMeters: 1400 },
        { ...speedIndex.segments[0]!, id: 'North|gtfs-b|gtfs-c', fromStopId: 'gtfs-b', toStopId: 'gtfs-c', routes: ['2A', '8A'], geometry: [[44.39, -79.69], [44.4, -79.68]], lengthMeters: 1400 },
      ],
      availableDirections: ['North'],
      statsBySegmentId: new Map([
        ['North|gtfs-a|gtfs-b', new Map([['weekday', new Map([['full-day', abStats]])]])],
        ['North|gtfs-b|gtfs-c', new Map([['weekday', new Map([['full-day', bcStats]])]])],
      ]),
    };
    const allMatchingScenario: RoutePlanner2Scenario = {
      ...scenario,
      source: {
        type: 'gtfs',
        routeShortName: '8A',
      },
      runtimeRouteFilter: { mode: 'all-matching', routeShortNames: [] },
      stops: [
        scenario.stops[0]!,
        { id: 'rp-c', name: 'Stop C', lat: 44.4, lng: -79.68, sequence: 2, role: 'end-terminal', source: 'custom', stopCode: '300' },
      ],
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      allMatchingScenario,
      corridorIndex,
      'weekday',
      'full-day',
      { gtfsStops: corridorGtfsStops, now, runtimeBasis: 'scheduled' },
    );

    expect(estimates[0]).toMatchObject({
      runtimeMinutes: 9,
      matchedRoutes: ['2A', '8A'],
      runtimeRouteBreakdown: [
        { routeShortName: '2A', scheduledRuntimeMinutes: 7 },
        { routeShortName: '8A', scheduledRuntimeMinutes: 11 },
      ],
      evidenceMethod: 'corridor-path',
    });
  });

  it('tries multiple nearby GTFS stops before falling back to Mapbox', () => {
    const candidateGtfsStops: GtfsStopWithCoords[] = [
      gtfsStops[0]!,
      { stop_id: 'gtfs-unserved', stop_code: '301', stop_name: 'Unserved nearby stop', lat: 44.4, lon: -79.68 },
      { stop_id: 'gtfs-served', stop_code: '302', stop_name: 'Served corridor stop', lat: 44.401, lon: -79.68 },
    ];
    const candidateStats: CorridorSpeedStats = {
      ...stats,
      segmentId: 'North|gtfs-a|gtfs-served',
      scheduledRuntimeMin: 8,
      observedRuntimeMin: null,
      sampleCount: 0,
      routeBreakdown: [
        { route: '11', sampleCount: 0, scheduledRuntimeMin: 8, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
      ],
    };
    const candidateIndex: CorridorSpeedIndex = {
      segments: [{
        ...speedIndex.segments[0]!,
        id: 'North|gtfs-a|gtfs-served',
        fromStopId: 'gtfs-a',
        toStopId: 'gtfs-served',
        routes: ['11'],
        geometry: [[44.38, -79.7], [44.401, -79.68]],
        lengthMeters: 2900,
      }],
      availableDirections: ['North'],
      statsBySegmentId: new Map([
        ['North|gtfs-a|gtfs-served', new Map([['weekday', new Map([['full-day', candidateStats]])]])],
      ]),
    };
    const candidateScenario: RoutePlanner2Scenario = {
      ...scenario,
      stops: [
        scenario.stops[0]!,
        { id: 'rp-end', name: 'Custom end', lat: 44.4, lng: -79.68, sequence: 2, role: 'end-terminal', source: 'custom' },
      ],
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      candidateScenario,
      candidateIndex,
      'weekday',
      'full-day',
      { gtfsStops: candidateGtfsStops, now, runtimeBasis: 'scheduled' },
    );

    expect(estimates[0]).toMatchObject({
      runtimeMinutes: 8,
      source: 'scheduled-proxy',
      matchedRoutes: ['11'],
      matchedFromStopId: 'gtfs-a',
      matchedToStopId: 'gtfs-served',
      evidenceMethod: 'corridor-path',
    });
  });

  it('combines partial scheduled corridor evidence with the drawn-route estimate for uncovered distance', () => {
    const partialScenario: RoutePlanner2Scenario = {
      ...scenario,
      stops: [
        { id: 'rp-start', name: 'Custom start before Route 8', lat: 44.38, lng: -79.705, sequence: 1, role: 'start-terminal', source: 'custom' },
        scenario.stops[1]!,
      ],
      runtimeEstimates: [{
        id: 'segment-rp-start-rp-b',
        fromStopId: 'rp-start',
        toStopId: 'rp-b',
        runtimeMinutes: 14,
        source: 'mapbox',
        confidence: 'medium',
        pathFingerprint: '-79.705,44.38|-79.69,44.39',
      }],
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      partialScenario,
      speedIndex,
      'weekday',
      'full-day',
      { gtfsStops, now, runtimeBasis: 'scheduled' },
    );

    expect(estimates).toHaveLength(1);
    expect(estimates[0]).toMatchObject({
      id: 'segment-rp-start-rp-b',
      source: 'partial-scheduled-proxy',
      confidence: 'medium',
      scheduledRuntimeMinutes: 10,
      matchedRoutes: ['8A'],
      evidenceMethod: 'corridor-path',
      matchedGtfsPathStopIds: ['gtfs-a', 'gtfs-b'],
    });
    expect(estimates[0]?.runtimeMinutes).toBeGreaterThan(10);
    expect(estimates[0]?.scheduledCoverageRatio).toBeLessThan(0.9);
    expect(estimates[0]?.estimatedUncoveredDistanceKm).toBeGreaterThan(0);
  });

  it('rejects GTFS routes that connect the stops by leaving the drawn corridor', () => {
    const detourGtfsStops: GtfsStopWithCoords[] = [
      { stop_id: 'gtfs-a', stop_code: '100', stop_name: 'Stop A', lat: 44.38, lon: -79.7 },
      { stop_id: 'gtfs-b', stop_code: '200', stop_name: 'Stop B', lat: 44.39, lon: -79.69 },
      { stop_id: 'gtfs-detour', stop_code: '400', stop_name: 'Detour stop', lat: 44.43, lon: -79.75 },
    ];
    const makeStats = (segmentId: string, route: string, runtime: number): CorridorSpeedStats => ({
      ...stats,
      segmentId,
      scheduledRuntimeMin: runtime,
      observedRuntimeMin: null,
      sampleCount: 0,
      routeBreakdown: [
        { route, sampleCount: 0, scheduledRuntimeMin: runtime, observedRuntimeMin: null, runtimeDeltaMin: null, runtimeDeltaPct: null, scheduledSpeedKmh: null, observedSpeedKmh: null },
      ],
    });
    const directStats = makeStats('North|gtfs-a|gtfs-b', '12', 7);
    const detourFirstStats = makeStats('North|gtfs-a|gtfs-detour', '10', 14);
    const detourSecondStats = makeStats('North|gtfs-detour|gtfs-b', '10', 14);
    const detourIndex: CorridorSpeedIndex = {
      segments: [
        {
          ...speedIndex.segments[0]!,
          id: 'North|gtfs-a|gtfs-b',
          fromStopId: 'gtfs-a',
          toStopId: 'gtfs-b',
          routes: ['12'],
          geometry: [[44.38, -79.7], [44.39, -79.69]],
          lengthMeters: 1400,
        },
        {
          ...speedIndex.segments[0]!,
          id: 'North|gtfs-a|gtfs-detour',
          fromStopId: 'gtfs-a',
          toStopId: 'gtfs-detour',
          routes: ['10'],
          geometry: [[44.38, -79.7], [44.43, -79.75]],
          lengthMeters: 6800,
        },
        {
          ...speedIndex.segments[0]!,
          id: 'North|gtfs-detour|gtfs-b',
          fromStopId: 'gtfs-detour',
          toStopId: 'gtfs-b',
          routes: ['10'],
          geometry: [[44.43, -79.75], [44.39, -79.69]],
          lengthMeters: 6500,
        },
      ],
      availableDirections: ['North'],
      statsBySegmentId: new Map([
        ['North|gtfs-a|gtfs-b', new Map([['weekday', new Map([['full-day', directStats]])]])],
        ['North|gtfs-a|gtfs-detour', new Map([['weekday', new Map([['full-day', detourFirstStats]])]])],
        ['North|gtfs-detour|gtfs-b', new Map([['weekday', new Map([['full-day', detourSecondStats]])]])],
      ]),
    };

    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      scenario,
      detourIndex,
      'weekday',
      'full-day',
      { gtfsStops: detourGtfsStops, now, runtimeBasis: 'scheduled' },
    );

    expect(estimates[0]).toMatchObject({
      runtimeMinutes: 7,
      matchedRoutes: ['12'],
    });
    expect(estimates[0]?.matchedRoutes).not.toContain('10');
  });
});
