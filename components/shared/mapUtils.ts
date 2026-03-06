/** Convert [lat, lng] to GeoJSON [lng, lat] */
export const toGeoJSON = (latLng: [number, number]): [number, number] => [latLng[1], latLng[0]];

/**
 * Decode a Google-encoded polyline string (precision 5) to [lat, lng] pairs.
 * Mapbox Directions API uses this encoding format.
 */
export function decodePolyline(encoded: string): [number, number][] {
    const points: [number, number][] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        for (const isLng of [false, true]) {
            let shift = 0;
            let result = 0;
            let byte: number;
            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (isLng) lng += delta;
            else lat += delta;
        }
        points.push([lat / 1e5, lng / 1e5]);
    }

    return points;
}

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

/**
 * Generate a quadratic bezier arc between two [lat, lng] points.
 * Returns array of [lat, lng] points along the curve.
 * Extracted from CoverageGapMap, ODFlowMapModule, ODPairMapModal,
 * ODRouteEstimationModule, TransitAppMap (5 duplicate copies).
 */
export function quadraticBezierArc(
    origin: [number, number],
    dest: [number, number],
    curveDirection: 1 | -1 = 1,
    segments: number = 16
): [number, number][] {
    const midLat = (origin[0] + dest[0]) / 2;
    const midLon = (origin[1] + dest[1]) / 2;
    const dLat = dest[0] - origin[0];
    const dLon = dest[1] - origin[1];
    const offsetLat = midLat + dLon * 0.2 * curveDirection;
    const offsetLon = midLon - dLat * 0.2 * curveDirection;

    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        const lat = u * u * origin[0] + 2 * u * t * offsetLat + t * t * dest[0];
        const lon = u * u * origin[1] + 2 * u * t * offsetLon + t * t * dest[1];
        points.push([lat, lon]);
    }
    return points;
}

/**
 * Generate arrowhead barb coordinates for the tip of an arc.
 * Returns array of polyline coordinate arrays for the barbs.
 * Input/output in [lat, lng] format.
 */
export function arrowheadPoints(
    arcPoints: [number, number][],
    sizeDeg: number = 0.004
): [number, number][][] {
    const n = arcPoints.length;
    if (n < 2) return [];
    const tip = arcPoints[n - 1];
    const prev = arcPoints[n - 2];
    const dx = tip[1] - prev[1];
    const dy = tip[0] - prev[0];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return [];
    const ux = dx / len;
    const uy = dy / len;

    const barb1: [number, number] = [
        tip[0] - uy * sizeDeg + ux * sizeDeg * 0.5,
        tip[1] - ux * sizeDeg - uy * sizeDeg * 0.5,
    ];
    const barb2: [number, number] = [
        tip[0] - uy * sizeDeg - ux * sizeDeg * 0.5,
        tip[1] - ux * sizeDeg + uy * sizeDeg * 0.5,
    ];

    return [[barb1, tip, barb2]];
}

/**
 * Convert an array of arcs (each an array of [lat, lng] points) to a
 * GeoJSON FeatureCollection of LineStrings with per-feature properties.
 */
export function toArcGeoJSON(
    arcs: { points: [number, number][]; properties?: Record<string, unknown> }[]
): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: arcs.map((arc) => ({
            type: 'Feature',
            properties: arc.properties ?? {},
            geometry: {
                type: 'LineString',
                coordinates: arc.points.map(toGeoJSON),
            },
        })),
    };
}

/**
 * Convert arrowhead barbs to GeoJSON FeatureCollection.
 * Each barb set becomes a LineString feature.
 */
export function toArrowheadGeoJSON(
    barbs: [number, number][][]
): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: barbs.map((barbLine) => ({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: barbLine.map(toGeoJSON),
            },
        })),
    };
}

/**
 * Ray-casting point-in-polygon test.
 * Extracted from StopActivityMap lasso selection.
 */
export function pointInPolygon(
    lat: number,
    lon: number,
    polygon: [number, number][]
): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = ((yi > lon) !== (yj > lon)) &&
            (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * 6-stop heat color interpolation (indigo → blue → cyan → yellow → orange → red).
 * Extracted from TransitAppMap. Input: normalized 0–1 value. Output: CSS rgb() string.
 */
export function heatColor(t: number): string {
    const clamped = Math.max(0, Math.min(1, t));
    const stops: Array<{ t: number; rgb: [number, number, number] }> = [
        { t: 0.00, rgb: [37, 52, 148] },
        { t: 0.25, rgb: [14, 116, 255] },
        { t: 0.50, rgb: [6, 182, 212] },
        { t: 0.70, rgb: [250, 204, 21] },
        { t: 0.85, rgb: [249, 115, 22] },
        { t: 1.00, rgb: [220, 38, 38] },
    ];
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (clamped >= a.t && clamped <= b.t) {
            const local = (clamped - a.t) / Math.max(0.0001, (b.t - a.t));
            const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * local);
            const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * local);
            const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * local);
            return `rgb(${r},${g},${bl})`;
        }
    }
    const last = stops[stops.length - 1].rgb;
    return `rgb(${last[0]},${last[1]},${last[2]})`;
}
