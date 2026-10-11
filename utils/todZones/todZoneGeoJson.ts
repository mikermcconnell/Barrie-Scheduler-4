import { validateTodZoneGeometry } from './todZoneGeometry';
import type { TodZoneDefinition, TodZonePolygon } from './todZoneTypes';

interface GeoJsonFeature {
    type?: unknown;
    properties?: Record<string, unknown> | null;
    geometry?: { type?: unknown; coordinates?: unknown } | null;
}

function isPosition(value: unknown): value is [number, number] {
    return Array.isArray(value) && value.length >= 2
        && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function parseRing(value: unknown): [number, number][] | null {
    if (!Array.isArray(value) || !value.every(isPosition)) return null;
    const ring = value.map(position => [Number(position[0]), Number(position[1])] as [number, number]);
    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    return ring;
}

export function parseTodZoneGeoJson(text: string, definitions: TodZoneDefinition[]): TodZonePolygon[] {
    const parsed = JSON.parse(text) as { type?: unknown; features?: unknown };
    if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
        throw new Error('Import a GeoJSON FeatureCollection containing Polygon or MultiPolygon features.');
    }
    const polygons: TodZonePolygon[] = [];
    (parsed.features as GeoJsonFeature[]).forEach((feature, featureIndex) => {
        const properties = feature.properties ?? {};
        const code = String(properties.zoneCode ?? properties.zone ?? properties.code ?? '').trim().toUpperCase();
        if (!code) throw new Error(`Feature ${featureIndex + 1} is missing a zoneCode property.`);
        const pocketName = String(properties.pocketName ?? properties.name ?? `Zone ${code} area`).trim();
        const geometry = feature.geometry;
        if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates) && geometry.coordinates.length !== 1) {
            throw new Error(`Feature ${featureIndex + 1} contains polygon holes, which are not supported.`);
        }
        if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)
            && geometry.coordinates.some(polygon => Array.isArray(polygon) && polygon.length !== 1)) {
            throw new Error(`Feature ${featureIndex + 1} contains polygon holes, which are not supported.`);
        }
        const rings: unknown[] = geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)
            ? [geometry.coordinates[0]]
            : geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)
                ? geometry.coordinates.map(polygon => Array.isArray(polygon) ? polygon[0] : null)
                : [];
        if (rings.length === 0) throw new Error(`Feature ${featureIndex + 1} is not a Polygon or MultiPolygon.`);
        rings.forEach((ringValue, ringIndex) => {
            const coordinates = parseRing(ringValue);
            if (!coordinates) throw new Error(`Feature ${featureIndex + 1} has invalid coordinates.`);
            const sourceId = String(properties.id ?? `import-${Date.now()}-${featureIndex}`).trim();
            polygons.push({
                id: rings.length > 1 ? `${sourceId}-${ringIndex + 1}` : sourceId,
                zoneCode: code,
                pocketName: rings.length > 1 ? `${pocketName} ${ringIndex + 1}` : pocketName,
                coordinates,
            });
        });
    });
    if (polygons.length === 0) throw new Error('The GeoJSON file does not contain any zone polygons.');
    validateTodZoneGeometry(polygons, definitions);
    return polygons;
}

export function exportTodZoneGeoJson(polygons: TodZonePolygon[]): string {
    return JSON.stringify({
        type: 'FeatureCollection',
        features: polygons.map(polygon => ({
            type: 'Feature',
            properties: {
                id: polygon.id,
                zoneCode: polygon.zoneCode,
                pocketName: polygon.pocketName,
            },
            geometry: { type: 'Polygon', coordinates: [polygon.coordinates] },
        })),
    }, null, 2);
}
