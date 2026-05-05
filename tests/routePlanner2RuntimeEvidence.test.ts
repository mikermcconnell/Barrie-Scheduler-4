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
    const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
      scenario,
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
      scheduledRuntimeMinutes: 19,
      matchedRoutes: ['8B'],
      evidenceDayType: 'weekday',
      evidencePeriod: 'am-peak',
    });
    expect(estimates[0]?.observedRuntimeMinutes).toBeUndefined();
  });
});
