import { describe, expect, it } from 'vitest';
import { assignTodZoneMembership, filterByTodZone, isValidTodZoneDate, pointInTodPolygon, selectEffectiveTodZoneVersion, validateTodZoneDraft, validateTodZoneGeometry } from '../utils/todZones/todZoneGeometry';
import { exportTodZoneGeoJson, parseTodZoneGeoJson } from '../utils/todZones/todZoneGeoJson';
import { createTodZoneASeedDraft, ZONE_A_CONNECTION_STOP_IDS, ZONE_A_REFERENCE_STOP_IDS, ZONE_B_CONNECTION_STOP_IDS, ZONE_B_REFERENCE_STOP_IDS, ZONE_C_CONNECTION_STOP_IDS, ZONE_C_REFERENCE_STOP_IDS, ZONE_D_CONNECTION_STOP_IDS, ZONE_D_REFERENCE_STOP_IDS, ZONE_E_CONNECTION_STOP_IDS, ZONE_E_REFERENCE_STOP_IDS, ZONE_F_CONNECTION_STOP_IDS, ZONE_F_REFERENCE_STOP_IDS, ZONE_H_CONNECTION_STOP_IDS, ZONE_H_REFERENCE_STOP_IDS, ZONE_T_CONNECTION_STOP_IDS, ZONE_T_REFERENCE_STOP_IDS } from '../utils/todZones/todZoneSeed';
import { deserializeTodZonePolygonsFromFirestore, normalizeTodZoneDraftFromFirestore, serializeTodZonePolygonsForFirestore } from '../utils/todZones/todZoneService';
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
        expect(assignTodZoneMembership({ id: '58', lat: 43, lon: -79.5 }, definitions, polygon, [], [{ stopId: '58', zoneCodes: ['A'] }]))
            .toEqual({ zoneCodes: ['A'], source: 'connection', isConnectionStop: true, connectionZoneCodes: ['A'] });
    });

    it('selects the latest effective publication and filters multi-zone outcomes', () => {
        const version = (id: string, effectiveFrom: string, revision: number): TodZoneVersion => ({
            id, effectiveFrom, revision, schemaVersion: 1, definitions, polygons: [], connectionStops: [], overrides: [], source: 'test', reviewNote: 'test', stopSnapshot: [], publishedBy: 'owner', publishedAt: `${effectiveFrom}T12:00:00.000Z`,
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
        expect(seed.polygons.map(item => item.pocketName)).toEqual(['A North', 'A Ferris', 'A Lakeside', 'A Coulter', 'B Hospice', 'B Marion', 'B Wellington', 'B Amelia', 'C Hurst', 'D West North', 'D West Central North', 'D West Central South', 'D West South', 'D East', 'E East', 'E Gateway', 'F Bayview', 'F Huronia', 'F Hooper', 'F Madelaine', 'H Sundew', 'H Brown Bear', 'H Salem', 'H King', 'H Pearen', 'T Fenchurch']);
        expect(seed.effectiveFrom).toBe('2026-07-02');
        expect(seed.schemaVersion).toBe(4);
        expect(seed.definitions.map(zone => zone.color)).toEqual(['#117db6', '#f58645', '#dd1f33', '#8dc73f', '#9c3220', '#cb9f2c', '#7e489c', '#606161']);
        expect(ZONE_A_REFERENCE_STOP_IDS).toHaveLength(25);
        expect(ZONE_A_CONNECTION_STOP_IDS).toEqual(['58', '59', '60', '61', '76', '215', '216', '416', '440', '441', '447', '449', '453', '454', '628', '634', '913']);
        expect(seed.connectionStops.filter(stop => stop.zoneCodes.includes('A'))).toEqual(ZONE_A_CONNECTION_STOP_IDS.map(stopId => ({ stopId, zoneCodes: ['A'] })));
        expect(ZONE_B_REFERENCE_STOP_IDS).toEqual(['160', '404', '682', '683', '685', '686', '687', '689', '690', '948']);
        expect(ZONE_B_CONNECTION_STOP_IDS).toEqual(['10', '67', '68', '129', '135', '136', '255', '333', '583', '586', '612', '938', '959']);
        expect(seed.connectionStops.filter(stop => stop.zoneCodes.includes('B'))).toEqual(ZONE_B_CONNECTION_STOP_IDS.map(stopId => ({ stopId, zoneCodes: ['B'] })));
        expect(ZONE_C_REFERENCE_STOP_IDS).toHaveLength(20);
        expect(ZONE_C_CONNECTION_STOP_IDS).toHaveLength(20);
        expect(ZONE_D_REFERENCE_STOP_IDS).toHaveLength(47);
        expect(ZONE_D_CONNECTION_STOP_IDS).toHaveLength(18);
        expect(ZONE_E_REFERENCE_STOP_IDS).toHaveLength(8);
        expect(ZONE_E_CONNECTION_STOP_IDS).toEqual(['119', '596', '597', '725']);
        expect(ZONE_F_REFERENCE_STOP_IDS).toHaveLength(21);
        expect(ZONE_F_CONNECTION_STOP_IDS).toEqual(['512', '513', '725', '741', '752', '764', '775', '777']);
        expect(ZONE_H_REFERENCE_STOP_IDS).toHaveLength(15);
        expect(ZONE_H_CONNECTION_STOP_IDS).toHaveLength(8);
        expect(ZONE_T_REFERENCE_STOP_IDS).toEqual(['973', '974']);
        expect(ZONE_T_CONNECTION_STOP_IDS).toEqual(['725']);
        expect(seed.connectionStops.find(stop => stop.stopId === '704')?.zoneCodes).toEqual(['C', 'D']);
        expect(seed.connectionStops.find(stop => stop.stopId === '764')?.zoneCodes).toEqual(['C', 'F']);
        expect(seed.connectionStops.find(stop => stop.stopId === '725')?.zoneCodes).toEqual(['C', 'D', 'E', 'F', 'T']);
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
        expect(() => validateTodZoneDraft({
            ...seed,
            connectionStops: [{ stopId: '58', zoneCodes: ['Z'] }],
        })).toThrow('invalid or duplicated zone');
    });

    it('uses Firestore-safe coordinate maps and restores client coordinate tuples', () => {
        const polygons = [{ id: 'a', zoneCode: 'A', pocketName: 'North', coordinates: square }];
        const stored = serializeTodZonePolygonsForFirestore(polygons);
        expect(stored[0].coordinates[0]).toEqual({ lon: -80, lat: 44 });
        expect(Array.isArray(stored[0].coordinates[0])).toBe(false);
        expect(deserializeTodZonePolygonsFromFirestore(stored)).toEqual(polygons);
        expect(deserializeTodZonePolygonsFromFirestore(polygons)).toEqual(polygons);
    });

    it('migrates a legacy Zone A draft to the combined seed once', () => {
        const seed = createTodZoneASeedDraft();
        const migrated = normalizeTodZoneDraftFromFirestore({
            schemaVersion: 1,
            revision: 4,
            definitions: seed.definitions,
            polygons: seed.polygons.filter(polygon => polygon.zoneCode === 'A'),
            overrides: [],
            effectiveFrom: seed.effectiveFrom,
            source: 'Legacy Zone A draft',
            reviewNote: 'Planner review pending',
        });
        expect(migrated.schemaVersion).toBe(4);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'B')).toHaveLength(4);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'C')).toHaveLength(1);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'D')).toHaveLength(5);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'E')).toHaveLength(2);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'F')).toHaveLength(4);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'H')).toHaveLength(5);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'T')).toHaveLength(1);
        expect(migrated.connectionStops.filter(stop => stop.zoneCodes.includes('A'))).toHaveLength(17);
        expect(migrated.connectionStops.filter(stop => stop.zoneCodes.includes('B'))).toHaveLength(13);
        expect(migrated.source).toContain('Transit ON Demand Zones B-F, H, and temporary T source maps');
        expect(migrated.reviewNote).toContain('planner review required');

        const normalizedAgain = normalizeTodZoneDraftFromFirestore(migrated as unknown as Record<string, unknown>);
        expect(normalizedAgain.polygons).toHaveLength(migrated.polygons.length);
        expect(normalizedAgain.connectionStops).toHaveLength(migrated.connectionStops.length);
    });

    it('migrates a v2 A/B draft to the remaining zones and PDF colors', () => {
        const seed = createTodZoneASeedDraft();
        const migrated = normalizeTodZoneDraftFromFirestore({
            schemaVersion: 2,
            revision: 8,
            definitions: seed.definitions.map(zone => ({ ...zone, color: '#000000' })),
            polygons: seed.polygons.filter(polygon => ['A', 'B'].includes(polygon.zoneCode)),
            connectionStops: seed.connectionStops.filter(stop => stop.zoneCodes.every(code => ['A', 'B'].includes(code))),
            overrides: [],
            effectiveFrom: seed.effectiveFrom,
            source: 'Zone A/B draft',
            reviewNote: 'Planner review pending',
        });
        expect(migrated.schemaVersion).toBe(4);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'C')).toHaveLength(1);
        expect(migrated.polygons.filter(polygon => polygon.zoneCode === 'D')).toHaveLength(5);
        expect(migrated.polygons.filter(polygon => ['E', 'F', 'H', 'T'].includes(polygon.zoneCode))).toHaveLength(12);
        expect(migrated.definitions.map(zone => zone.color)).toEqual(['#117db6', '#f58645', '#dd1f33', '#8dc73f', '#9c3220', '#cb9f2c', '#7e489c', '#606161']);
        expect(migrated.overrides.map(override => override.stopId)).toEqual(['82', '83', '99', '100', '429', '811', '977', '978', '979', '986']);
    });

    it('migrates a v3 A-D draft by merging shared E/F/T connection memberships', () => {
        const seed = createTodZoneASeedDraft();
        const migrated = normalizeTodZoneDraftFromFirestore({
            schemaVersion: 3,
            revision: 12,
            definitions: seed.definitions.map(zone => ({ ...zone, color: '#000000' })),
            polygons: seed.polygons.filter(polygon => ['A', 'B', 'C', 'D'].includes(polygon.zoneCode)),
            connectionStops: seed.connectionStops
                .map(stop => ({ ...stop, zoneCodes: stop.zoneCodes.filter(code => ['A', 'B', 'C', 'D'].includes(code)) }))
                .filter(stop => stop.zoneCodes.length > 0),
            overrides: seed.overrides.filter(override => override.zoneCodes.includes('D')),
            effectiveFrom: '2025-09-21',
            source: 'Zone A-D draft',
            reviewNote: 'Planner review pending',
        });
        expect(migrated.schemaVersion).toBe(4);
        expect(migrated.effectiveFrom).toBe('2026-07-02');
        expect(migrated.connectionStops.find(stop => stop.stopId === '725')?.zoneCodes).toEqual(['C', 'D', 'E', 'F', 'T']);
        expect(migrated.connectionStops.filter(stop => stop.stopId === '725')).toHaveLength(1);
        expect(migrated.connectionStops.find(stop => stop.stopId === '764')?.zoneCodes).toEqual(['C', 'F']);
    });
});
