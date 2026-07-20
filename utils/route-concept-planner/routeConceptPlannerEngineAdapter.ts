import {
    searchRoutePlanner2Addresses,
} from '../route-planner-2/routePlanner2AddressSearch';
import { snapRoutePlanner2ScenarioToRoad } from '../route-planner-2/routePlanner2RoadSnap';
import type { RoutePlanner2Scenario } from '../route-planner-2/routePlanner2Types';
import type {
    RouteConceptPattern,
    RouteConceptSegmentRuntimeEvidence,
} from './routeConceptPlannerTypes';

/** Neutral Mapbox/place boundary. Do not import Route Planner 2 helpers outside this adapter. */

export interface RouteConceptPlaceSuggestion {
    id: string;
    name: string;
    label: string;
    lat: number;
    lng: number;
}

export interface RouteConceptPlaceSearchOptions {
    token?: string | null;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    limit?: number;
    preferServerProxy?: boolean;
    onDiagnostic?: (diagnostic: RouteConceptPlaceSearchDiagnostic) => void;
}

export interface RouteConceptPlaceSearchDiagnostic {
    query: string;
    source: 'server' | 'client';
    status: number | null;
    tokenPresent: boolean;
    resultCount: number;
    topResultLabel?: string;
    error?: string;
}

export interface RouteConceptRoadGeometry {
    fromStopId: string;
    toStopId: string;
    coordinates: [number, number][];
    source: 'mapbox' | 'fallback';
}

export interface RouteConceptRoadEstimateResult {
    source: 'mapbox' | 'fallback';
    coordinates: [number, number][];
    segmentGeometries: RouteConceptRoadGeometry[];
    runtimeEvidence: RouteConceptSegmentRuntimeEvidence[];
}

export interface RouteConceptRoadEstimateOptions {
    token?: string | null;
    fetchImpl?: typeof fetch;
    concurrency?: number;
    signal?: AbortSignal;
    now?: string;
    onProgress?: (completedSegments: number, totalSegments: number) => void;
}

export async function searchRouteConceptPlaces(
    query: string,
    options: RouteConceptPlaceSearchOptions = {},
): Promise<RouteConceptPlaceSuggestion[]> {
    const suggestions = await searchRoutePlanner2Addresses(query, options);
    return suggestions.map((suggestion) => ({ ...suggestion }));
}

function asRoadSnapScenario(pattern: RouteConceptPattern): RoutePlanner2Scenario {
    const sortedStops = [...pattern.stops].sort((a, b) => a.sequence - b.sequence);
    return {
        id: pattern.id,
        name: pattern.name,
        status: 'draft',
        routeShape: pattern.role === 'loop'
            ? 'closed-loop'
            : pattern.role === 'out-and-back'
                ? 'out-and-back'
                : 'one-way',
        alignment: pattern.alignment.map((point) => ({ ...point })),
        stops: sortedStops.map((stop) => ({
            ...stop,
            source: stop.source === 'gtfs' ? 'barrie-stop' : 'custom',
        })),
        turnaroundStopId: pattern.role === 'out-and-back'
            ? sortedStops.find((stop) => stop.role === 'turnaround')?.id ?? sortedStops.at(-1)?.id
            : undefined,
        service: {
            firstTripTime: '06:00',
            lastTripTime: '22:00',
            frequencyMinutes: 30,
            startTerminalLayoverMinutes: 0,
            endTerminalLayoverMinutes: 0,
            intermediateStopDwellSeconds: 0,
        },
        runtimeSourceMode: 'mapbox',
        notes: pattern.notes,
        createdAt: pattern.createdAt,
        updatedAt: pattern.updatedAt,
    };
}

/** Snap a neutral pattern to roads and return current Mapbox/fallback segment evidence. */
export async function estimateRouteConceptPatternRoadRuntimes(
    pattern: RouteConceptPattern,
    options: RouteConceptRoadEstimateOptions = {},
): Promise<RouteConceptRoadEstimateResult> {
    const now = options.now ?? new Date().toISOString();
    const result = await snapRoutePlanner2ScenarioToRoad(asRoadSnapScenario(pattern), {
        token: options.token,
        fetchImpl: options.fetchImpl,
        concurrency: options.concurrency,
        signal: options.signal,
        onProgress: (progress) => options.onProgress?.(progress.completedSegments, progress.totalSegments),
    });

    return {
        source: result.source,
        coordinates: result.coordinates.map((coordinate) => [...coordinate] as [number, number]),
        segmentGeometries: result.segmentGeometries.map((geometry) => ({
            fromStopId: geometry.fromStopId,
            toStopId: geometry.toStopId,
            coordinates: geometry.coordinates.map((coordinate) => [...coordinate] as [number, number]),
            source: geometry.source,
        })),
        runtimeEvidence: result.segmentEstimates.flatMap((estimate): RouteConceptSegmentRuntimeEvidence[] => {
            if (estimate.runtimeMinutes == null || (estimate.source !== 'mapbox' && estimate.source !== 'fallback')) return [];
            return [{
                id: `${pattern.id}-road-${estimate.fromStopId}-${estimate.toStopId}`,
                fromStopId: estimate.fromStopId,
                toStopId: estimate.toStopId,
                runtimeMinutes: estimate.runtimeMinutes,
                source: estimate.source,
                pathFingerprint: estimate.pathFingerprint,
                distanceKm: estimate.distanceKm,
                updatedAt: estimate.updatedAt ?? now,
                fallbackReason: estimate.fallbackReason,
            }];
        }),
    };
}
