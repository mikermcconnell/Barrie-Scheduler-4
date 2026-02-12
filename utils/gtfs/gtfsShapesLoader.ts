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
    routeShortName: string;
    routeColor: string; // hex without #
    points: [number, number][]; // [lat, lon][]
}

let cachedShapes: GtfsRouteShape[] | null = null;

export function loadGtfsRouteShapes(): GtfsRouteShape[] {
    if (cachedShapes) return cachedShapes;

    // Parse routes.txt → Map<routeId, { shortName, color }>
    const routeLines = routesRaw.trim().split('\n');
    const routeHeader = routeLines[0].split(',');
    const rIdIdx = routeHeader.indexOf('route_id');
    const rNameIdx = routeHeader.indexOf('route_short_name');
    const rColorIdx = routeHeader.indexOf('route_color');

    const routeMap = new Map<string, { shortName: string; color: string }>();
    for (let i = 1; i < routeLines.length; i++) {
        const cols = routeLines[i].split(',');
        if (cols.length <= rIdIdx) continue;
        routeMap.set(cols[rIdIdx], {
            shortName: cols[rNameIdx] || cols[rIdIdx],
            color: cols[rColorIdx] || '888888',
        });
    }

    // Parse trips.txt → Map<routeId, shapeId> (pick first shape per route)
    const tripLines = tripsRaw.trim().split('\n');
    const tripHeader = tripLines[0].split(',');
    const tRouteIdx = tripHeader.indexOf('route_id');
    const tShapeIdx = tripHeader.indexOf('shape_id');

    const routeToShape = new Map<string, string>();
    for (let i = 1; i < tripLines.length; i++) {
        const cols = tripLines[i].split(',');
        if (cols.length <= tShapeIdx) continue;
        const routeId = cols[tRouteIdx];
        if (!routeToShape.has(routeId) && cols[tShapeIdx]) {
            routeToShape.set(routeId, cols[tShapeIdx]);
        }
    }

    // Parse shapes.txt → Map<shapeId, sorted points>
    const shapeLines = shapesRaw.trim().split('\n');
    const shapeHeader = shapeLines[0].split(',');
    const sIdIdx = shapeHeader.indexOf('shape_id');
    const sLatIdx = shapeHeader.indexOf('shape_pt_lat');
    const sLonIdx = shapeHeader.indexOf('shape_pt_lon');
    const sSeqIdx = shapeHeader.indexOf('shape_pt_sequence');

    const shapePoints = new Map<string, { lat: number; lon: number; seq: number }[]>();
    for (let i = 1; i < shapeLines.length; i++) {
        const cols = shapeLines[i].split(',');
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

    // Build one shape per route
    const results: GtfsRouteShape[] = [];
    for (const [routeId, shapeId] of routeToShape) {
        const route = routeMap.get(routeId);
        if (!route) continue;
        const pts = shapePoints.get(shapeId);
        if (!pts || pts.length === 0) continue;

        pts.sort((a, b) => a.seq - b.seq);
        results.push({
            routeId,
            routeShortName: route.shortName,
            routeColor: route.color,
            points: pts.map(p => [p.lat, p.lon]),
        });
    }

    // Sort by route short name for consistent display
    results.sort((a, b) => a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true }));

    cachedShapes = results;
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
