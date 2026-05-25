import {
    getDirectionalCountsForZone,
    type MergedTransitAppODPair,
} from './transitAppOdPairs';
import {
    pointToPolylineDistanceKm,
    type GtfsRouteShape,
} from '../gtfs/gtfsShapesLoader';

export interface ODZonePanelFlowSummary {
    name: string;
    lat: number;
    lon: number;
    outbound: number;
    inbound: number;
    total: number;
    distKm: number;
}

export interface ODZonePanelSummary {
    zoneName: string;
    zoneLat: number;
    zoneLon: number;
    totalTrips: number;
    uniqueConnections: number;
    avgDistKm: number;
    peakPeriod: string | null;
    flows: ODZonePanelFlowSummary[];
}

export interface ODCoordinatePair {
    originLat: number;
    originLon: number;
    destLat: number;
    destLon: number;
}

function coordKey(lat: number, lon: number): string {
    return `${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function peakPeriodForHour(hour: number): string {
    if (hour >= 6 && hour < 9) return 'AM Peak';
    if (hour >= 9 && hour < 15) return 'Midday';
    if (hour >= 15 && hour < 18) return 'PM Peak';
    if (hour >= 18 && hour < 22) return 'Evening';
    return 'Overnight';
}

export function buildODZonePanelData(
    pairs: MergedTransitAppODPair[],
    isolatedZone: string,
    resolveZoneName: (lat: number, lon: number) => string = (lat, lon) => `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
): ODZonePanelSummary | null {
    const [latStr, lonStr] = isolatedZone.split('_');
    const zoneLat = parseFloat(latStr);
    const zoneLon = parseFloat(lonStr);
    if (!Number.isFinite(zoneLat) || !Number.isFinite(zoneLon)) return null;

    const zoneName = resolveZoneName(zoneLat, zoneLon);
    let totalTrips = 0;
    const connectionSet = new Set<string>();
    let totalDistKm = 0;
    const hourlyTotals = new Array(24).fill(0);
    let hasPositiveHourlyData = false;
    const flowMap = new Map<string, ODZonePanelFlowSummary>();

    for (const pair of pairs) {
        const oKey = coordKey(pair.originLat, pair.originLon);
        const dKey = coordKey(pair.destLat, pair.destLon);
        const isOrigin = oKey === isolatedZone;
        const directionalCounts = getDirectionalCountsForZone(pair, isolatedZone);
        if (!directionalCounts) continue;

        const otherKey = isOrigin ? dKey : oKey;
        const otherLat = isOrigin ? pair.destLat : pair.originLat;
        const otherLon = isOrigin ? pair.destLon : pair.originLon;
        const flowTotal = directionalCounts.outbound + directionalCounts.inbound;
        if (flowTotal <= 0) continue;

        totalTrips += flowTotal;
        connectionSet.add(otherKey);

        const distKm = haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon);
        totalDistKm += distKm * flowTotal;

        if (pair.hourlyBins) {
            let pairHourlyTotal = 0;
            for (let h = 0; h < 24; h++) {
                const count = Number.isFinite(pair.hourlyBins[h]) ? pair.hourlyBins[h] : 0;
                pairHourlyTotal += count;
                hourlyTotals[h] += count;
            }
            if (pairHourlyTotal > 0) hasPositiveHourlyData = true;
        }

        const existing = flowMap.get(otherKey);
        if (existing) {
            existing.outbound += directionalCounts.outbound;
            existing.inbound += directionalCounts.inbound;
            existing.total += flowTotal;
        } else {
            flowMap.set(otherKey, {
                name: resolveZoneName(otherLat, otherLon),
                lat: otherLat,
                lon: otherLon,
                outbound: directionalCounts.outbound,
                inbound: directionalCounts.inbound,
                total: flowTotal,
                distKm,
            });
        }
    }

    const flows = Array.from(flowMap.values()).sort((a, b) => b.total - a.total);
    const avgDistKm = totalTrips > 0 ? totalDistKm / totalTrips : 0;
    const maxHourlyTotal = Math.max(...hourlyTotals);
    const peakPeriod = hasPositiveHourlyData && maxHourlyTotal > 0
        ? peakPeriodForHour(hourlyTotals.indexOf(maxHourlyTotal))
        : null;

    return {
        zoneName,
        zoneLat,
        zoneLon,
        totalTrips,
        uniqueConnections: connectionSet.size,
        avgDistKm,
        peakPeriod,
        flows,
    };
}

export function filterPairsByRouteCorridor<T extends ODCoordinatePair>(
    pairs: T[],
    routeShortName: string | null,
    shapes: GtfsRouteShape[],
    bufferKm = 1.0,
): T[] {
    if (!routeShortName) return pairs;

    const matchingShapes = shapes.filter(shape =>
        shape.routeShortName === routeShortName && shape.points.length > 0
    );
    if (matchingShapes.length === 0) return pairs;

    const minDistanceToRouteKm = (point: [number, number]): number => {
        let minDistance = Number.POSITIVE_INFINITY;
        for (const shape of matchingShapes) {
            const distance = pointToPolylineDistanceKm(point, shape.points);
            if (distance < minDistance) minDistance = distance;
        }
        return minDistance;
    };

    return pairs.filter(pair => {
        const originDistance = minDistanceToRouteKm([pair.originLat, pair.originLon]);
        const destDistance = minDistanceToRouteKm([pair.destLat, pair.destLon]);
        return originDistance <= bufferKm && destDistance <= bufferKm;
    });
}

export function getAvailableRouteNamesFromShapes(shapes: GtfsRouteShape[]): string[] {
    return Array.from(new Set(
        shapes
            .map(shape => shape.routeShortName)
            .filter(routeName => routeName.length > 0)
    )).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
