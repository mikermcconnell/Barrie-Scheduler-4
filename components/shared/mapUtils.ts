/** Convert [lat, lng] to GeoJSON [lng, lat] */
export const toGeoJSON = (latLng: [number, number]): [number, number] => [latLng[1], latLng[0]];

/** Convert array of [lat, lng] points to a GeoJSON LineString FeatureCollection */
export function toLineGeoJSON(points: [number, number][]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: points.map(toGeoJSON),
            },
        }],
    };
}
