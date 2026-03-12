import {
    getStatsForPeriod,
    type CorridorSpeedIndex,
    type CorridorSpeedStats,
} from '../gtfs/corridorSpeed';
import type { DayType, TimePeriod } from '../gtfs/corridorHeadway';
import type { RouteScenario } from './routePlannerTypes';

const DEFAULT_FALLBACK_SPEED_KMH = 22;
const EARTH_RADIUS_KM = 6371;

function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

function haversineDistanceKm(
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

    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateFallbackRuntimeMinutes(
    start: { latitude: number; longitude: number },
    end: { latitude: number; longitude: number }
): number {
    const distanceKm = haversineDistanceKm(start.latitude, start.longitude, end.latitude, end.longitude);
    if (distanceKm <= 0) return 0;
    return Math.max(1, Math.round((distanceKm / DEFAULT_FALLBACK_SPEED_KMH) * 60));
}

export interface RouteObservedRuntimeSegment {
    key: string;
    fromStopName: string;
    toStopName: string;
    runtimeMinutes: number;
    source: 'observed' | 'fallback';
    sampleCount: number;
    lowConfidence: boolean;
    directionId?: string;
}

export interface RouteObservedRuntimeSummary {
    totalRuntimeMinutes: number;
    matchedSegmentCount: number;
    totalSegmentCount: number;
    minimumSampleCount: number;
    lowConfidenceSegmentCount: number;
    segments: RouteObservedRuntimeSegment[];
}

function buildSegmentLookup(
    index: CorridorSpeedIndex,
    dayType: DayType,
    period: TimePeriod
): Map<string, CorridorSpeedStats> {
    const statsBySegment = getStatsForPeriod(index, dayType, period);
    const lookup = new Map<string, CorridorSpeedStats>();

    for (const segment of index.segments) {
        const stats = statsBySegment.get(segment.id);
        if (!stats || stats.observedRuntimeMin === null) continue;

        const key = `${segment.fromStopId}|${segment.toStopId}`;
        const existing = lookup.get(key);
        if (!existing || stats.sampleCount > existing.sampleCount) {
            lookup.set(key, stats);
        }
    }

    return lookup;
}

export function estimateObservedRuntimeForScenario(
    scenario: RouteScenario,
    index: CorridorSpeedIndex,
    dayType: DayType,
    period: TimePeriod
): RouteObservedRuntimeSummary {
    const lookup = buildSegmentLookup(index, dayType, period);
    const segmentById = new Map(index.segments.map((segment) => [segment.id, segment]));
    const segments: RouteObservedRuntimeSegment[] = [];

    for (let indexValue = 1; indexValue < scenario.stops.length; indexValue += 1) {
        const previousStop = scenario.stops[indexValue - 1];
        const nextStop = scenario.stops[indexValue];
        const key = previousStop.sourceStopId && nextStop.sourceStopId
            ? `${previousStop.sourceStopId}|${nextStop.sourceStopId}`
            : `${previousStop.id}|${nextStop.id}`;
        const stats = previousStop.sourceStopId && nextStop.sourceStopId
            ? lookup.get(key) ?? null
            : null;
        const matchedSegment = stats ? segmentById.get(stats.segmentId) ?? null : null;

        if (stats && stats.observedRuntimeMin !== null) {
            segments.push({
                key,
                fromStopName: previousStop.name,
                toStopName: nextStop.name,
                runtimeMinutes: Math.round(stats.observedRuntimeMin),
                source: 'observed',
                sampleCount: stats.sampleCount,
                lowConfidence: stats.lowConfidence,
                directionId: matchedSegment?.directionId,
            });
            continue;
        }

        segments.push({
            key,
            fromStopName: previousStop.name,
            toStopName: nextStop.name,
            runtimeMinutes: estimateFallbackRuntimeMinutes(previousStop, nextStop),
            source: 'fallback',
            sampleCount: 0,
            lowConfidence: false,
        });
    }

    const observedSegments = segments.filter((segment) => segment.source === 'observed');
    const totalRuntimeMinutes = segments.reduce((sum, segment) => sum + segment.runtimeMinutes, 0);

    return {
        totalRuntimeMinutes,
        matchedSegmentCount: observedSegments.length,
        totalSegmentCount: segments.length,
        minimumSampleCount: observedSegments.length > 0
            ? Math.min(...observedSegments.map((segment) => segment.sampleCount))
            : 0,
        lowConfidenceSegmentCount: observedSegments.filter((segment) => segment.lowConfidence).length,
        segments,
    };
}

export function applyObservedRuntimeToScenario(
    scenario: RouteScenario,
    summary: RouteObservedRuntimeSummary | null
): RouteScenario {
    if (!summary || scenario.runtimeSourceMode === 'manual_override') return scenario;

    if (summary.matchedSegmentCount === 0) {
        return {
            ...scenario,
            runtimeSourceMode: 'fallback_estimate',
            runtimeInputs: {
                ...scenario.runtimeInputs,
                observedRuntimeMinutes: null,
                observedSampleCount: null,
                observedMatchedSegments: 0,
                observedTotalSegments: summary.totalSegmentCount,
            },
        };
    }

    return {
        ...scenario,
        runtimeSourceMode: 'observed_proxy',
        runtimeInputs: {
            ...scenario.runtimeInputs,
            observedRuntimeMinutes: summary.totalRuntimeMinutes,
            observedSampleCount: summary.minimumSampleCount,
            observedMatchedSegments: summary.matchedSegmentCount,
            observedTotalSegments: summary.totalSegmentCount,
        },
    };
}
