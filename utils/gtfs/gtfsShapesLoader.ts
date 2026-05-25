/**
 * GTFS Shapes Loader
 *
 * Parses local GTFS shapes.txt, trips.txt, and routes.txt to produce
 * one polyline per route for map overlay display.
 */

import shapesRaw from '../../gtfs/shapes.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import routesRaw from '../../gtfs/routes.txt?raw';

export interface GtfsRouteShape {
    routeId: string;
    shapeId?: string;
    routeShortName: string;
    routeColor: string; // hex without #
    points: [number, number][]; // [lat, lon][]
}

let cachedShapes: GtfsRouteShape[] | null = null;
let cachedShapeVariants: GtfsRouteShape[] | null = null;

function parseCsvRow(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }
        if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }

    values.push(current.trim());
    return values;
}

function buildGtfsRouteShapes(includeAllVariants: boolean): GtfsRouteShape[] {
    // Parse routes.txt → Map<routeId, { shortName, color }>
    const routeLines = routesRaw.trim().split(/\r?\n/);
    const routeHeader = parseCsvRow(routeLines[0]);
    const rIdIdx = routeHeader.indexOf('route_id');
    const rNameIdx = routeHeader.indexOf('route_short_name');
    const rColorIdx = routeHeader.indexOf('route_color');

    const routeMap = new Map<string, { shortName: string; color: string }>();
    for (let i = 1; i < routeLines.length; i++) {
        const cols = parseCsvRow(routeLines[i]);
        if (cols.length <= rIdIdx) continue;
        routeMap.set(cols[rIdIdx], {
            shortName: cols[rNameIdx] || cols[rIdIdx],
            color: cols[rColorIdx] || '888888',
        });
    }

    // Parse trips.txt → Map<routeId, shapeId[]>.
    // The default loader keeps one shape per route for legacy overlays.
    // Coverage analysis can request every shape variant so direction/branch
    // variants are not silently ignored.
    const tripLines = tripsRaw.trim().split(/\r?\n/);
    const tripHeader = parseCsvRow(tripLines[0]);
    const tRouteIdx = tripHeader.indexOf('route_id');
    const tShapeIdx = tripHeader.indexOf('shape_id');

    const routeToShapes = new Map<string, string[]>();
    for (let i = 1; i < tripLines.length; i++) {
        const cols = parseCsvRow(tripLines[i]);
        if (cols.length <= tShapeIdx) continue;
        const routeId = cols[tRouteIdx];
        const shapeId = cols[tShapeIdx];
        if (!routeId || !shapeId) continue;

        const existing = routeToShapes.get(routeId);
        if (!existing) {
            routeToShapes.set(routeId, [shapeId]);
            continue;
        }
        if (includeAllVariants && !existing.includes(shapeId)) {
            existing.push(shapeId);
        }
    }

    // Parse shapes.txt → Map<shapeId, sorted points>
    const shapeLines = shapesRaw.trim().split(/\r?\n/);
    const shapeHeader = parseCsvRow(shapeLines[0]);
    const sIdIdx = shapeHeader.indexOf('shape_id');
    const sLatIdx = shapeHeader.indexOf('shape_pt_lat');
    const sLonIdx = shapeHeader.indexOf('shape_pt_lon');
    const sSeqIdx = shapeHeader.indexOf('shape_pt_sequence');

    const shapePoints = new Map<string, { lat: number; lon: number; seq: number }[]>();
    for (let i = 1; i < shapeLines.length; i++) {
        const cols = parseCsvRow(shapeLines[i]);
        if (cols.length <= sSeqIdx) continue;
        const id = cols[sIdIdx];
        const pt = {
            lat: parseFloat(cols[sLatIdx]),
            lon: parseFloat(cols[sLonIdx]),
            seq: parseInt(cols[sSeqIdx], 10),
        };
        if (isNaN(pt.lat) || isNaN(pt.lon)) continue;
        const arr = shapePoints.get(id);
        if (arr) arr.push(pt);
        else shapePoints.set(id, [pt]);
    }

    // Build route shapes
    const results: GtfsRouteShape[] = [];
    for (const [routeId, shapeIds] of routeToShapes) {
        const route = routeMap.get(routeId);
        if (!route) continue;

        for (const shapeId of shapeIds) {
            const pts = shapePoints.get(shapeId);
            if (!pts || pts.length === 0) continue;

            pts.sort((a, b) => a.seq - b.seq);
            results.push({
                routeId,
                shapeId,
                routeShortName: route.shortName,
                routeColor: route.color,
                points: pts.map(p => [p.lat, p.lon]),
            });
        }
    }

    // Sort by route short name for consistent display
    results.sort((a, b) =>
        a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true })
        || a.routeId.localeCompare(b.routeId)
        || (a.shapeId || '').localeCompare(b.shapeId || '')
    );

    return results;
}

export function loadGtfsRouteShapes(): GtfsRouteShape[] {
    if (cachedShapes) return cachedShapes;

    const results = buildGtfsRouteShapes(false);
    cachedShapes = results;
    return results;
}

export function loadGtfsRouteShapeVariants(): GtfsRouteShape[] {
    if (cachedShapeVariants) return cachedShapeVariants;

    const results = buildGtfsRouteShapes(true);
    cachedShapeVariants = results;
    return results;
}

/**
 * Compute minimum distance (km) from a point to a polyline.
 * Checks perpendicular distance to each segment, falling back to endpoint distance.
 */
export function pointToPolylineDistanceKm(
    point: [number, number],
    polyline: [number, number][]
): number {
    const R = 6371;
    const toRad = (d: number) => d * Math.PI / 180;

    function haversineDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    let minDist = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
        const [aLat, aLon] = polyline[i];
        const [bLat, bLon] = polyline[i + 1];

        // Project point onto segment using flat-earth approximation for t parameter
        const dxAB = bLon - aLon;
        const dyAB = bLat - aLat;
        const dxAP = point[1] - aLon;
        const dyAP = point[0] - aLat;
        const lenSq = dxAB * dxAB + dyAB * dyAB;

        let closestLat: number, closestLon: number;
        if (lenSq === 0) {
            closestLat = aLat;
            closestLon = aLon;
        } else {
            const t = Math.max(0, Math.min(1, (dxAP * dxAB + dyAP * dyAB) / lenSq));
            closestLat = aLat + t * dyAB;
            closestLon = aLon + t * dxAB;
        }

        const d = haversineDist(point[0], point[1], closestLat, closestLon);
        if (d < minDist) minDist = d;
    }

    // Also check last point
    if (polyline.length === 1) {
        minDist = haversineDist(point[0], point[1], polyline[0][0], polyline[0][1]);
    }

    return minDist;
}
