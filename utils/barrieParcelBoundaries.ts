export const BARRIE_PARCELS_QUERY_URL = 'https://gispublic.barrie.ca/arcgis/rest/services/Open_Data/ParcelPublishing/MapServer/2/query';
export const PARCEL_MIN_ZOOM = 16;

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

export interface ParcelBounds {
    west: number;
    south: number;
    east: number;
    north: number;
}

export type ParcelOutlines = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

export function padParcelBounds(bounds: ParcelBounds): ParcelBounds {
    const longitudePadding = (bounds.east - bounds.west) * 0.25;
    const latitudePadding = (bounds.north - bounds.south) * 0.25;
    return {
        west: bounds.west - longitudePadding,
        south: bounds.south - latitudePadding,
        east: bounds.east + longitudePadding,
        north: bounds.north + latitudePadding,
    };
}

export function parcelBoundsContain(outer: ParcelBounds, inner: ParcelBounds): boolean {
    return outer.west <= inner.west
        && outer.south <= inner.south
        && outer.east >= inner.east
        && outer.north >= inner.north;
}

export async function fetchBarrieParcelOutlines(bounds: ParcelBounds, signal?: AbortSignal): Promise<ParcelOutlines> {
    const features: ParcelOutlines['features'] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
            where: '1=1',
            geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: 'OBJECTID',
            returnGeometry: 'true',
            outSR: '4326',
            geometryPrecision: '6',
            orderByFields: 'OBJECTID',
            resultOffset: String(page * PAGE_SIZE),
            resultRecordCount: String(PAGE_SIZE),
            f: 'geojson',
        });
        const response = await fetch(`${BARRIE_PARCELS_QUERY_URL}?${params}`, { signal });
        if (!response.ok) throw new Error(`City parcel layer returned ${response.status}.`);

        const collection = await response.json() as Partial<ParcelOutlines>;
        if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
            throw new Error('City parcel layer returned an invalid response.');
        }

        for (const feature of collection.features) {
            if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;
            // The source has tax attributes; the map uses geometry only.
            features.push({ type: 'Feature', properties: {}, geometry: feature.geometry });
        }

        if (collection.features.length < PAGE_SIZE) return { type: 'FeatureCollection', features };
    }

    throw new Error('Too many parcels are visible. Zoom in and try again.');
}
