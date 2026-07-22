import { describe, expect, it } from 'vitest';
import type { RoutePlanner2GtfsImportPattern } from '../utils/route-planner-2/routePlanner2GtfsImport';
import {
    createDetourOverlayFromGtfsPattern,
    createDetourRouteSnapshotFromGtfsPattern,
    selectDetourWeekdayRoutes,
} from '../utils/detours/detourGtfsAdapter';

const pattern: RoutePlanner2GtfsImportPattern = {
    id: 'pattern-8b',
    routeId: 'route-8b',
    routeShortName: '8B',
    routeLongName: 'Crosstown',
    serviceId: 'weekday',
    dayTypeLabel: 'Weekday',
    directionId: 1,
    tripHeadsign: 'Southbound',
    tripCount: 20,
    stopCount: 2,
    shapePointCount: 2,
    stops: [
        { stopId: 'local-b', gtfsStopId: 'b', stopCode: '102', name: 'Second', lat: 44.4, lng: -79.6, sequence: 2 },
        { stopId: 'local-a', gtfsStopId: 'a', stopCode: '101', name: 'First', lat: 44.5, lng: -79.7, sequence: 1 },
    ],
    shapePoints: [
        { lat: 44.4, lng: -79.6, sequence: 2 },
        { lat: 44.5, lng: -79.7, sequence: 1 },
    ],
};

describe('detour GTFS adapter', () => {
    it('returns one fullest weekday pattern per route short name', () => {
        const routes = selectDetourWeekdayRoutes([
            { ...pattern, id: '8b-short', stopCount: 1, tripCount: 30, stops: pattern.stops.slice(0, 1) },
            pattern,
            { ...pattern, id: '8b-weekend', serviceId: 'saturday', dayTypeLabel: 'Saturday', stopCount: 5 },
            { ...pattern, id: '2b-weekday', routeId: 'route-2b', routeShortName: '2B', stopCount: 3 },
            { ...pattern, id: '7a-weekday', routeId: 'route-7a', routeShortName: '7A', stopCount: 4 },
        ]);

        expect(routes.map(route => route.routeShortName)).toEqual(['2B', '7A', '8B']);
        expect(routes.find(route => route.routeShortName === '8B')?.id).toBe('pattern-8b');
        expect(routes.every(route => route.dayTypeLabel === 'Weekday')).toBe(true);
    });

    it('snapshots ordered route geometry and stops without changing GTFS data', () => {
        const snapshot = createDetourRouteSnapshotFromGtfsPattern(pattern, new Date('2026-07-16T12:00:00Z'));
        expect(snapshot.directionLabel).toBe('Southbound');
        expect(snapshot.routeColor).toBe('#000000');
        expect(snapshot.isLoop).toBe(false);
        expect(snapshot.originalGeometry[0]).toEqual({ latitude: 44.5, longitude: -79.7 });
        expect(snapshot.stops.map(stop => stop.stopId)).toEqual(['a', 'b']);
        expect(snapshot.importedAt).toBe('2026-07-16T12:00:00.000Z');
    });

    it('creates an editable overlay that still requires planner review', () => {
        const overlay = createDetourOverlayFromGtfsPattern(pattern, {
            id: 'overlay-1',
            now: new Date('2026-07-16T12:00:00Z'),
        });
        expect(overlay.id).toBe('overlay-1');
        expect(overlay.detourGeometry.coordinates).toEqual([]);
        expect(overlay.detourWaypoints).toEqual([]);
        expect(overlay.closureWaypoints).toEqual([]);
        expect(overlay.closureStart).toBeNull();
        expect(overlay.stopImpacts).toHaveLength(2);
        expect(overlay.stopImpacts.every(impact => impact.status === 'open' && impact.reviewed)).toBe(true);
        expect(overlay.detourGeometry.manualRoutingAcknowledged).toBe(false);
        expect(overlay.busSuitabilityConfirmed).toBe(false);
    });
});
