import { describe, expect, it } from 'vitest';
import { compareRouteCoverageMetrics, deriveRouteCoverageMetrics, getRouteCoveragePoints } from '../utils/route-planner/routePlannerCoverage';
import type { RouteScenario } from '../utils/route-planner/routePlannerTypes';

function createScenario(overrides: Partial<RouteScenario> = {}): RouteScenario {
    return {
        id: 'coverage-scenario',
        name: 'Coverage Test',
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
        timingProfile: 'balanced',
        startTerminalHoldMinutes: 0,
        endTerminalHoldMinutes: 0,
        coverageWalkshedMeters: 400,
        warnings: [],
        departures: [],
        waypoints: [],
        geometry: { type: 'LineString', coordinates: [] },
        stops: [],
        coverage: {},
        status: 'draft',
        ...overrides,
    };
}

describe('routePlannerCoverage', () => {
    it('builds the starter strategic market layer from local repo sources', () => {
        const points = getRouteCoveragePoints();

        expect(points.length).toBeGreaterThan(5);
        expect(points.some((point) => point.category === 'hub')).toBe(true);
        expect(points.some((point) => point.category === 'school')).toBe(true);
    });

    it('counts strategic points served by scenario stops inside the walkshed', () => {
        const metrics = deriveRouteCoverageMetrics(createScenario({
            stops: [
                {
                    id: 'stop-1',
                    name: 'Georgian College',
                    kind: 'existing',
                    role: 'terminal',
                    sourceStopId: '330',
                    latitude: 44.4098,
                    longitude: -79.6634,
                    timeLabel: '06:00',
                },
            ],
        }));

        expect(metrics.source).toBe('strategic_markets_seed');
        expect(metrics.walkshedRadiusMeters).toBe(400);
        expect(metrics.servedMarketPoints).toBeGreaterThanOrEqual(1);
        expect(metrics.servedSchools).toBeGreaterThanOrEqual(1);
        expect(metrics.servedPointLabels).toContain('Georgian College');
    });

    it('compares baseline and option coverage totals', () => {
        const baseline = deriveRouteCoverageMetrics(createScenario({
            stops: [
                {
                    id: 'stop-1',
                    name: 'Georgian College',
                    kind: 'existing',
                    role: 'terminal',
                    sourceStopId: '330',
                    latitude: 44.4098,
                    longitude: -79.6634,
                    timeLabel: '06:00',
                },
            ],
        }));
        const option = deriveRouteCoverageMetrics(createScenario({
            stops: [
                {
                    id: 'stop-1',
                    name: 'Georgian College',
                    kind: 'existing',
                    role: 'terminal',
                    sourceStopId: '330',
                    latitude: 44.4098,
                    longitude: -79.6634,
                    timeLabel: '06:00',
                },
                {
                    id: 'stop-2',
                    name: 'Maple Ridge Secondary',
                    kind: 'custom',
                    role: 'terminal',
                    latitude: 44.3509,
                    longitude: -79.6086,
                    timeLabel: '06:20',
                },
            ],
        }));

        const delta = compareRouteCoverageMetrics(baseline, option);

        expect(delta.servedMarketPointsDelta).toBeGreaterThanOrEqual(1);
        expect(delta.servedSchoolsDelta).toBeGreaterThanOrEqual(1);
    });
});
