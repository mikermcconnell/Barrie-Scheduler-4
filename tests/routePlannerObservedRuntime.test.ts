import { describe, expect, it } from 'vitest';
import { applyObservedRuntimeToScenario, estimateObservedRuntimeForScenario } from '../utils/route-planner/routePlannerObservedRuntime';
import type { CorridorSpeedIndex } from '../utils/gtfs/corridorSpeed';
import type { RouteScenario } from '../utils/route-planner/routePlannerTypes';
import { deriveRouteScenario } from '../utils/route-planner/routePlannerPlanning';

function createScenario(): RouteScenario {
    return {
        id: 'scenario-1',
        name: 'Observed Proxy Test',
        scenarioType: 'route-concept',
        pattern: 'out-and-back',
        accent: 'indigo',
        notes: '',
        baseSource: { kind: 'blank', label: 'Blank Concept' },
        runtimeSourceMode: 'fallback_estimate',
        runtimeInputs: {},
        distanceKm: 0,
        runtimeMinutes: 0,
        cycleMinutes: 0,
        busesRequired: 0,
        serviceHours: 0,
        firstDeparture: '06:00',
        lastDeparture: '08:00',
        frequencyMinutes: 20,
        layoverMinutes: 5,
        warnings: [],
        departures: [],
        waypoints: [],
        geometry: { type: 'LineString', coordinates: [] },
        stops: [
            { id: 'stop-a', name: 'Stop A', kind: 'existing', sourceStopId: 'A', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00' },
            { id: 'stop-b', name: 'Stop B', kind: 'existing', sourceStopId: 'B', role: 'regular', latitude: 44.385, longitude: -79.68, timeLabel: '06:00' },
            { id: 'stop-c', name: 'Stop C', kind: 'custom', role: 'terminal', latitude: 44.39, longitude: -79.67, timeLabel: '06:00' },
        ],
        coverage: {},
        status: 'draft',
    };
}

function createIndex(): CorridorSpeedIndex {
    return {
        segments: [{
            id: 'North|A|B',
            fromStopId: 'A',
            toStopId: 'B',
            fromStopName: 'Stop A',
            toStopName: 'Stop B',
            directionId: 'North',
            routes: ['1'],
            geometry: [[44.38, -79.69], [44.385, -79.68]],
            lengthMeters: 1000,
        }],
        availableDirections: ['North'],
        statsBySegmentId: new Map([
            ['North|A|B', new Map([
                ['weekday', new Map([
                    ['full-day', {
                        segmentId: 'North|A|B',
                        directionId: 'North',
                        period: 'full-day',
                        dayType: 'weekday',
                        sampleCount: 12,
                        lowConfidence: false,
                        corridorLengthMeters: 1000,
                        scheduledRuntimeMin: 5,
                        observedRuntimeMin: 6,
                        runtimeDeltaMin: 1,
                        runtimeDeltaPct: 20,
                        scheduledSpeedKmh: 12,
                        observedSpeedKmh: 10,
                        routeBreakdown: [],
                    }],
                ])],
            ])],
        ]),
    };
}

describe('routePlannerObservedRuntime', () => {
    it('matches observed stop-to-stop runtime where Barrie stop pairs exist', () => {
        const summary = estimateObservedRuntimeForScenario(createScenario(), createIndex(), 'weekday', 'full-day');

        expect(summary.matchedSegmentCount).toBe(1);
        expect(summary.totalSegmentCount).toBe(2);
        expect(summary.totalRuntimeMinutes).toBeGreaterThan(6);
        expect(summary.segments[0]?.source).toBe('observed');
        expect(summary.segments[0]?.runtimeMinutes).toBe(6);
    });

    it('applies observed runtime inputs and preserves partial coverage metadata', () => {
        const scenario = createScenario();
        const summary = estimateObservedRuntimeForScenario(scenario, createIndex(), 'weekday', 'full-day');

        const derived = deriveRouteScenario(applyObservedRuntimeToScenario(scenario, summary));

        expect(derived.runtimeSourceMode).toBe('observed_proxy');
        expect(derived.runtimeInputs.observedMatchedSegments).toBe(1);
        expect(derived.runtimeInputs.observedTotalSegments).toBe(2);
        expect(derived.warnings).toContain('Observed proxy runtime covers 1 of 2 stop segments. Remaining segments use fallback estimates.');
    });
});
