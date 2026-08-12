import { describe, expect, it } from 'vitest';

import { buildDetourStopSheets, formatDetourStopSheetRoutes } from '../utils/detours/detourStopSheets';
import type { DetourNotice, DetourRouteOverlay } from '../utils/detours/detourTypes';

function overlay(id: string, routeShortName: string, directionLabel: string): DetourRouteOverlay {
  const now = new Date('2026-08-12T12:00:00.000Z');
  return {
    id,
    routeSnapshot: {
      importedAt: now.toISOString(),
      feedId: 'barrie',
      routeId: routeShortName,
      routeShortName,
      routeColor: '#07557F',
      directionLabel,
      isLoop: false,
      originalGeometry: [],
      stops: [],
    },
    closureStart: null,
    closureEnd: null,
    closureWaypoints: [],
    closureGeometry: { coordinates: [], source: 'gtfs', manualRoutingAcknowledged: true },
    detourWaypoints: [],
    detourGeometry: { coordinates: [], source: 'road-snapped', manualRoutingAcknowledged: true },
    labels: [],
    stopImpacts: [],
    busSuitabilityConfirmed: true,
    createdAt: now,
    updatedAt: now,
  };
}

function notice(overlays: DetourRouteOverlay[]): DetourNotice {
  const now = new Date('2026-08-12T12:00:00.000Z');
  return {
    id: 'notice-1', teamId: 'team-1', type: 'route-detour', status: 'draft', title: 'Blake Detour',
    reason: 'Closure', publicSummary: '', publicDetails: 'Use active or temporary stops.', affectedRouteTags: [],
    schedule: {
      timeZone: 'America/Toronto', startDate: '2026-08-12', startTime: '',
      end: { mode: 'fixed', date: '2026-08-14', time: '' }, recurrence: { mode: 'continuous' },
    },
    mapFrame: { center: { longitude: -79.68, latitude: 44.39 }, zoom: 14, bearing: 0, pitch: 0 },
    revision: 1, createdAt: now, createdBy: 'planner', updatedAt: now, updatedBy: 'planner', overlays, publications: [],
  };
}

describe('detour stop sheets', () => {
  it('groups shared closed stops and temporary stop codes while collecting their routes', () => {
    const southbound = overlay('overlay-8b', '8B', 'Southbound');
    const route100 = overlay('overlay-100', '100', 'Clockwise');
    const closedStop = {
      stopId: 'stop-959', stopCode: '959', name: 'Johnson at Indian Arrow Road',
      position: { longitude: -79.67, latitude: 44.4 }, sequence: 1,
    };
    southbound.stopImpacts = [
      { id: 'closed-8b', sourceStop: closedStop, status: 'closed', reviewed: true },
      { id: 'temp-8b', status: 'temporary', reviewed: true, temporaryStopCode: '1420', temporaryStopName: 'Codrington at Puget', temporaryStopPosition: { longitude: -79.68, latitude: 44.39 } },
    ];
    route100.stopImpacts = [
      { id: 'closed-100', sourceStop: closedStop, status: 'closed', reviewed: true },
      { id: 'temp-100', status: 'temporary', reviewed: true, temporaryStopCode: '1420', temporaryStopName: 'Codrington at Puget', temporaryStopPosition: { longitude: -79.68, latitude: 44.39 } },
    ];

    const sheets = buildDetourStopSheets(notice([southbound, route100]));

    expect(sheets).toHaveLength(2);
    expect(sheets.map(sheet => `${sheet.kind}:${sheet.stopCode}`)).toEqual(['closed:959', 'temporary:1420']);
    expect(sheets[0].routes).toHaveLength(2);
    expect(sheets[1].routes).toHaveLength(2);
    expect(formatDetourStopSheetRoutes(sheets[1].routes)).toBe('Routes 8B-SB & 100');
  });

  it('keeps uncoded temporary stops separate and excludes open or unreviewed impacts', () => {
    const first = overlay('overlay-1', '8A', 'Northbound');
    first.stopImpacts = [
      { id: 'temp-a', status: 'temporary', reviewed: true, temporaryStopName: 'First temporary stop', temporaryStopPosition: { longitude: -79.68, latitude: 44.39 } },
      { id: 'temp-b', status: 'temporary', reviewed: true, temporaryStopName: 'Second temporary stop', temporaryStopPosition: { longitude: -79.69, latitude: 44.4 } },
      { id: 'open', status: 'open', reviewed: true, sourceStop: { stopId: 'open', name: 'Open stop', position: { longitude: -79.7, latitude: 44.4 }, sequence: 2 } },
      { id: 'pending', status: 'closed', reviewed: false, sourceStop: { stopId: 'pending', name: 'Pending stop', position: { longitude: -79.7, latitude: 44.4 }, sequence: 3 } },
    ];

    expect(buildDetourStopSheets(notice([first])).map(sheet => sheet.stopName)).toEqual([
      'First temporary stop',
      'Second temporary stop',
    ]);
  });
});
