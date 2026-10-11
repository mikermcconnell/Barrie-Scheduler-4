import type { TodCityStop } from './todZoneTypes';

export const BARRIE_TRANSIT_STOPS_QUERY_URL = 'https://gispublic.barrie.ca/arcgis/rest/services/Open_Data/FacilitiesStreets/MapServer/6/query';

interface ArcGisStopFeature {
    properties?: Record<string, unknown>;
    geometry?: { coordinates?: unknown };
}
function property(properties: Record<string, unknown>, ...names: string[]): unknown {
    for (const name of names) {
        if (properties[name] != null) return properties[name];
        const match = Object.keys(properties).find(key => key.toLowerCase() === name.toLowerCase());
        if (match) return properties[match];
    }
    return undefined;
}

export async function fetchBarrieTransitStops(signal?: AbortSignal): Promise<TodCityStop[]> {
    const params = new URLSearchParams({
        where: "STATUS = 'ACTIVE'",
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'geojson',
    });
    const response = await fetch(`${BARRIE_TRANSIT_STOPS_QUERY_URL}?${params}`, { signal });
    if (!response.ok) throw new Error(`City stop layer returned ${response.status}.`);
    const collection = await response.json() as { features?: ArcGisStopFeature[] };
    return (collection.features ?? []).flatMap(feature => {
        const props = feature.properties ?? {};
        const coords = feature.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return [];
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        const id = String(property(props, 'ID', 'STOP_ID', 'OBJECTID') ?? '').trim();
        if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
        return [{
            id,
            name: String(property(props, 'NAME', 'STOP_NAME', 'DESCRIPTION') ?? `Stop ${id}`).trim(),
            lat,
            lon,
            status: String(property(props, 'STATUS') ?? 'ACTIVE'),
        }];
    }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}
