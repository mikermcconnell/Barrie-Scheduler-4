import { getAllStopsWithCoords } from '../gtfs/gtfsStopLookup';
import type { RouteCoverageMetrics, RouteScenario } from './routePlannerTypes';
import {
    getRouteCoverageSeedPoints,
    type RouteCoverageSeedCategory,
    type RouteCoverageSeedPoint,
} from './routePlannerCoverageSeed';

export interface RouteCoveragePoint {
    id: string;
    name: string;
    category: RouteCoverageSeedCategory;
    latitude: number;
    longitude: number;
}

export interface RouteCoverageDelta {
    servedMarketPointsDelta: number;
    servedSchoolsDelta: number;
    servedHubsDelta: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

function haversineDistanceMeters(
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number
): number {
    const dLat = toRadians(latitudeB - latitudeA);
    const dLon = toRadians(longitudeB - longitudeA);
    const lat1 = toRadians(latitudeA);
    const lat2 = toRadians(latitudeB);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return EARTH_RADIUS_KM * 2000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function averageCoordinates(points: Array<{ lat: number; lon: number }>): { latitude: number; longitude: number } | null {
    if (points.length === 0) return null;

    const sums = points.reduce(
        (current, point) => ({
            latitude: current.latitude + point.lat,
            longitude: current.longitude + point.lon,
        }),
        { latitude: 0, longitude: 0 }
    );

    return {
        latitude: sums.latitude / points.length,
        longitude: sums.longitude / points.length,
    };
}

function resolveSeedPoint(seedPoint: RouteCoverageSeedPoint): RouteCoveragePoint | null {
    if (typeof seedPoint.latitude === 'number' && typeof seedPoint.longitude === 'number') {
        return {
            id: seedPoint.id,
            name: seedPoint.name,
            category: seedPoint.category,
            latitude: seedPoint.latitude,
            longitude: seedPoint.longitude,
        };
    }

    if (!seedPoint.stopCodes || seedPoint.stopCodes.length === 0) return null;

    const matchingStops = getAllStopsWithCoords().filter((stop) =>
        stop.stop_code && seedPoint.stopCodes?.includes(stop.stop_code)
    );
    const centroid = averageCoordinates(matchingStops);
    if (!centroid) return null;

    return {
        id: seedPoint.id,
        name: seedPoint.name,
        category: seedPoint.category,
        latitude: centroid.latitude,
        longitude: centroid.longitude,
    };
}

let cachedCoveragePoints: RouteCoveragePoint[] | null = null;

export function getRouteCoveragePoints(): RouteCoveragePoint[] {
    if (cachedCoveragePoints) return cachedCoveragePoints;

    cachedCoveragePoints = getRouteCoverageSeedPoints()
        .map((seedPoint) => resolveSeedPoint(seedPoint))
        .filter((seedPoint): seedPoint is RouteCoveragePoint => seedPoint !== null);

    return cachedCoveragePoints;
}

function clampWalkshedMeters(value: number | null | undefined): number {
    if (!Number.isFinite(value) || value === undefined || value === null) return 400;
    return Math.max(200, Math.min(1000, Math.round(value)));
}

export function deriveRouteCoverageMetrics(scenario: RouteScenario): RouteCoverageMetrics {
    const coveragePoints = getRouteCoveragePoints();
    const walkshedRadiusMeters = clampWalkshedMeters(scenario.coverageWalkshedMeters);

    if (coveragePoints.length === 0) {
        return {
            source: 'none',
            walkshedRadiusMeters,
            populationWithin400m: null,
            jobsWithin400m: null,
            servedMarketPoints: null,
            totalMarketPoints: 0,
            servedSchools: null,
            totalSchools: 0,
            servedHubs: null,
            totalHubs: 0,
            servedPointLabels: [],
        };
    }

    const servedPoints = coveragePoints.filter((point) =>
        scenario.stops.some((stop) =>
            haversineDistanceMeters(stop.latitude, stop.longitude, point.latitude, point.longitude) <= walkshedRadiusMeters
        )
    );

    const totalSchools = coveragePoints.filter((point) => point.category === 'school').length;
    const totalHubs = coveragePoints.filter((point) => point.category === 'hub').length;
    const servedSchools = servedPoints.filter((point) => point.category === 'school').length;
    const servedHubs = servedPoints.filter((point) => point.category === 'hub').length;

    return {
        source: 'strategic_markets_seed',
        walkshedRadiusMeters,
        populationWithin400m: null,
        jobsWithin400m: null,
        servedMarketPoints: servedPoints.length,
        totalMarketPoints: coveragePoints.length,
        servedSchools,
        totalSchools,
        servedHubs,
        totalHubs,
        servedPointLabels: servedPoints.map((point) => point.name),
    };
}

export function compareRouteCoverageMetrics(
    baseline: RouteCoverageMetrics | null | undefined,
    comparison: RouteCoverageMetrics | null | undefined
): RouteCoverageDelta {
    return {
        servedMarketPointsDelta: (comparison?.servedMarketPoints ?? 0) - (baseline?.servedMarketPoints ?? 0),
        servedSchoolsDelta: (comparison?.servedSchools ?? 0) - (baseline?.servedSchools ?? 0),
        servedHubsDelta: (comparison?.servedHubs ?? 0) - (baseline?.servedHubs ?? 0),
    };
}
