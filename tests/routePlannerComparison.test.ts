import { describe, expect, it } from 'vitest';
import {
    buildRouteScenarioImpactSummary,
    getExistingRouteBaselineScenario,
    isExistingRouteBaselineScenario,
} from '../utils/route-planner/routePlannerComparison';
import type { RouteProject, RouteScenario } from '../utils/route-planner/routePlannerTypes';

function createScenario(overrides: Partial<RouteScenario>): RouteScenario {
    return {
        id: 'scenario-1',
        name: 'Route 1 Tweak',
        scenarioType: 'existing-route-tweak',
        pattern: 'out-and-back',
        accent: 'emerald',
        notes: '',
        baseSource: { kind: 'existing_route', sourceId: '1', label: 'Route 1' },
        runtimeSourceMode: 'fallback_estimate',
        runtimeInputs: {},
        distanceKm: 10,
        runtimeMinutes: 20,
        cycleMinutes: 45,
        busesRequired: 2,
        serviceHours: 16,
        firstDeparture: '06:00',
        lastDeparture: '21:00',
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
        coverage: {
            servedMarketPoints: 4,
            totalMarketPoints: 12,
            servedSchools: 1,
            totalSchools: 5,
            servedHubs: 1,
            totalHubs: 3,
        },
        status: 'draft',
        ...overrides,
    };
}

describe('routePlannerComparison', () => {
    it('finds the GTFS baseline scenario for an existing-route tweak', () => {
        const baseline = createScenario({
            id: 'route-1-baseline',
            name: 'Route 1 Current GTFS',
            accent: 'indigo',
        });
        const working = createScenario({
            id: 'route-1-scenario',
            runtimeMinutes: 26,
        });
        const project: RouteProject = {
            id: 'project-1',
            name: 'Route 1 Study',
            preferredScenarioId: working.id,
            scenarios: [baseline, working],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        expect(isExistingRouteBaselineScenario(baseline)).toBe(true);
        expect(getExistingRouteBaselineScenario(project, working)?.id).toBe(baseline.id);
        expect(getExistingRouteBaselineScenario(project, baseline)).toBeNull();
    });

    it('builds a before-versus-after impact summary', () => {
        const baseline = createScenario({
            id: 'route-1-baseline',
            name: 'Route 1 Current GTFS',
            busesRequired: 1,
            distanceKm: 9.5,
            runtimeMinutes: 22,
            cycleMinutes: 49,
            serviceHours: 15.5,
            stops: [{ id: 'a', name: 'A', kind: 'existing', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00' }],
            coverage: {
                servedMarketPoints: 3,
                totalMarketPoints: 12,
                servedSchools: 1,
                totalSchools: 5,
                servedHubs: 1,
                totalHubs: 3,
            },
            warnings: ['Baseline warning'],
        });
        const working = createScenario({
            id: 'route-1-scenario',
            distanceKm: 11.1,
            runtimeMinutes: 28,
            cycleMinutes: 61,
            busesRequired: 2,
            serviceHours: 16.2,
            stops: [
                { id: 'a', name: 'A', kind: 'existing', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00' },
                { id: 'b', name: 'B', kind: 'existing', role: 'regular', latitude: 44.39, longitude: -79.68, timeLabel: '06:10' },
            ],
            coverage: {
                servedMarketPoints: 5,
                totalMarketPoints: 12,
                servedSchools: 2,
                totalSchools: 5,
                servedHubs: 1,
                totalHubs: 3,
            },
            warnings: ['Warning one', 'Warning two'],
        });

        const impact = buildRouteScenarioImpactSummary(baseline, working);

        expect(impact.runtimeDeltaMinutes).toBe(6);
        expect(impact.cycleDeltaMinutes).toBe(12);
        expect(impact.busesDelta).toBe(1);
        expect(impact.distanceDeltaKm).toBe(1.6);
        expect(impact.stopDelta).toBe(1);
        expect(impact.coverageDelta.servedMarketPointsDelta).toBe(2);
        expect(impact.warningDelta).toBe(1);
        expect(impact.serviceHoursDelta).toBe(0.7);
    });
});
