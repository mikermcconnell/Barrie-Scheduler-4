import { describe, expect, it } from 'vitest';
import { assignTodZoneMembership, filterByTodZone, isValidTodZoneDate, pointInTodPolygon, selectEffectiveTodZoneVersion, validateTodZoneDraft, validateTodZoneGeometry } from '../utils/todZones/todZoneGeometry';
import { exportTodZoneGeoJson, parseTodZoneGeoJson } from '../utils/todZones/todZoneGeoJson';
import { createTodZoneASeedDraft, ZONE_A_REFERENCE_STOP_IDS } from '../utils/todZones/todZoneSeed';
import { deserializeTodZonePolygonsFromFirestore, serializeTodZonePolygonsForFirestore } from '../utils/todZones/todZoneService';
import type { TodZoneVersion } from '../utils/todZones/todZoneTypes';

const square: [number, number][] = [[-80, 44], [-79, 44], [-79, 45], [-80, 45], [-80, 44]];
const definitions = [{ code: 'A', label: 'Zone A', color: '#000', kind: 'permanent' as const, active: true }];

describe('TOD zone geometry', () => {
    it('treats polygon boundaries as inside and supports stop overrides', () => {
        expect(pointInTodPolygon([-80, 44.5], square)).toBe(true);
        expect(pointInTodPolygon([-81, 44.5], square)).toBe(false);
        const polygon = [{ id: 'a', zoneCode: 'A', pocketName: 'A', coordinates: square }];
        const stop = { id: 'stop-10', lat: 44.5, lon: -79.5 };
        expect(assignTodZoneMembership(stop, definitions, polygon, []).zoneCodes).toEqual(['A']);
        expect(assignTodZoneMembership(stop, definitions, polygon, [{ stopId: '10', action: 'exclude', zoneCodes: ['A'], reason: 'Reviewed' }]).zoneCodes).toEqual([]);
        expect(assignTodZoneMembership({ id: '11', lat: 43, lon: -79.5 }, definitions, polygon, [{ stopId: '11', action: 'include', zoneCodes: ['A'], reason: 'Connection' }]).zoneCodes).toEqual(['A']);
    });

    it('selects the latest effective publication and filters multi-zone outcomes', () => {
        const version = (id: string, effectiveFrom: string, revision: number): TodZoneVersion => ({
            id, effectiveFrom, revision, schemaVersion: 1, definitions, polygons: [], overrides: [], source: 'test', reviewNote: 'test', stopSnapshot: [], publishedBy: 'owner', publishedAt: `${effectiveFrom}T12:00:00.000Z`,
        });
        expect(selectEffectiveTodZoneVersion([version('old', '2025-01-01', 1), version('new', '2025-09-21', 2)], ['2025-10-01'])?.id).toBe('new');
        expect(selectEffectiveTodZoneVersion([version('future', '2026-01-01', 3)], ['2025-10-01'])).toBeNull();
        expect(filterByTodZone(['A', 'B'], 'multi-zone')).toBe(true);
        expect(filterByTodZone([], 'unassigned')).toBe(true);
    });

    it('round-trips polygon GeoJSON and ships the reviewed Zone A seed metadata', () => {
        const exported = exportTodZoneGeoJson([{ id: 'a', zoneCode: 'A', pocketName: 'North', coordinates: square }]);
        expect(parseTodZoneGeoJson(exported, definitions)).toMatchObject([{ zoneCode: 'A', pocketName: 'North', coordinates: square }]);
        const seed = createTodZoneASeedDraft();
        expect(seed.polygons.map(item => item.pocketName)).toEqual(['A North', 'A Ferris', 'A Lakeside', 'A Coulter']);
        expect(seed.effectiveFrom).toBe('2025-09-21');
        expect(ZONE_A_REFERENCE_STOP_IDS).toHaveLength(25);
        expect(Math.max(...seed.polygons.map(item => item.coordinates.length))).toBeLessThanOrEqual(250);
    });

    it('rejects malformed geometry, unsupported holes, and empty imports', () => {
        const crossed: [number, number][] = [[-80, 44], [-79, 45], [-80, 45], [-79, 44], [-80, 44]];
        expect(() => validateTodZoneGeometry([{ id: 'crossed', zoneCode: 'A', pocketName: 'Crossed', coordinates: crossed }], definitions))
            .toThrow('crosses itself');
        expect(() => validateTodZoneGeometry([{ id: 'open', zoneCode: 'A', pocketName: 'Open', coordinates: square.slice(0, -1) }], definitions))
            .toThrow('closed boundary');
        expect(() => parseTodZoneGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [] }), definitions))
            .toThrow('does not contain any zone polygons');
        expect(() => parseTodZoneGeoJson(JSON.stringify({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: { zoneCode: 'A' }, geometry: { type: 'Polygon', coordinates: [square, square] } }],
        }), definitions)).toThrow('polygon holes');
    });

    it('validates publication metadata and stop overrides', () => {
        const seed = createTodZoneASeedDraft();
        expect(isValidTodZoneDate('2026-02-29')).toBe(false);
        expect(isValidTodZoneDate('2028-02-29')).toBe(true);
        expect(() => validateTodZoneDraft({ ...seed, effectiveFrom: '2026-02-29' })).toThrow('valid effective date');
        expect(() => validateTodZoneDraft({
            ...seed,
            overrides: [{ stopId: '202', action: 'include', zoneCodes: ['A'], reason: '' }],
        })).toThrow('override reason');
        expect(() => validateTodZoneDraft({
            ...seed,
            overrides: [{ stopId: '202', action: 'include', zoneCodes: ['Z'], reason: 'Test' }],
        })).toThrow('invalid or duplicated override zone');
    });

    it('uses Firestore-safe coordinate maps and restores client coordinate tuples', () => {
        const polygons = [{ id: 'a', zoneCode: 'A', pocketName: 'North', coordinates: square }];
        const stored = serializeTodZonePolygonsForFirestore(polygons);
        expect(stored[0].coordinates[0]).toEqual({ lon: -80, lat: 44 });
        expect(Array.isArray(stored[0].coordinates[0])).toBe(false);
        expect(deserializeTodZonePolygonsFromFirestore(stored)).toEqual(polygons);
        expect(deserializeTodZonePolygonsFromFirestore(polygons)).toEqual(polygons);
    });
});
