import { describe, expect, it } from 'vitest';
import { createLocalStarterProject } from '../utils/shuttle/shuttleSeedData';
import { deriveRouteProject, deriveRouteScenario, MIN_RELIABLE_ROUTE_RUNTIME_SAMPLES } from '../utils/route-planner/routePlannerPlanning';
import { createRouteProjectFromShuttleProject, type RouteScenario } from '../utils/route-planner/routePlannerTypes';

function createScenario(overrides: Partial<RouteScenario> = {}): RouteScenario {
    return {
        id: 'scenario-1',
        name: 'Route Option A',
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
        frequencyMinutes: 15,
        layoverMinutes: 5,
        timingProfile: 'balanced',
        startTerminalHoldMinutes: 0,
        endTerminalHoldMinutes: 0,
        coverageWalkshedMeters: 400,
        warnings: [],
        departures: [],
        waypoints: [
            [-79.69, 44.38],
            [-79.67, 44.39],
        ],
        geometry: {
            type: 'LineString',
            coordinates: [
                [-79.69, 44.38],
                [-79.67, 44.39],
            ],
        },
        stops: [
            { id: 'stop-1', name: 'Start', kind: 'existing', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00' },
            { id: 'stop-2', name: 'End', kind: 'existing', role: 'terminal', latitude: 44.39, longitude: -79.67, timeLabel: '06:00' },
        ],
        coverage: {},
        status: 'draft',
        ...overrides,
    };
}

describe('deriveRouteScenario', () => {
    it('uses observed proxy runtime when selected', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'observed_proxy',
            runtimeInputs: {
                observedRuntimeMinutes: 18,
                manualRuntimeMinutes: 25,
                observedSampleCount: MIN_RELIABLE_ROUTE_RUNTIME_SAMPLES,
            },
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.runtimeMinutes).toBe(18);
        expect(derived.warnings).not.toContain(expect.stringContaining('low confidence'));
    });

    it('adds a low-confidence warning for thin observed data', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'observed_proxy',
            runtimeInputs: {
                observedRuntimeMinutes: 17,
                observedSampleCount: 3,
                observedMatchedSegments: 2,
                observedTotalSegments: 2,
            },
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.runtimeMinutes).toBe(17);
        expect(derived.warnings).toContain('Observed proxy runtime has low confidence (3 samples). Confirm with manual review.');
    });

    it('warns when observed coverage only applies to part of the route', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'observed_proxy',
            runtimeInputs: {
                observedRuntimeMinutes: 17,
                observedSampleCount: MIN_RELIABLE_ROUTE_RUNTIME_SAMPLES,
                observedMatchedSegments: 1,
                observedTotalSegments: 3,
            },
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.warnings).toContain('Observed proxy runtime covers 1 of 3 stop segments. Remaining segments use fallback estimates.');
    });

    it('uses manual override runtime when selected', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'manual_override',
            runtimeInputs: {
                manualRuntimeMinutes: 21,
                observedRuntimeMinutes: 14,
            },
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.runtimeMinutes).toBe(21);
    });

    it('uses interior timing anchors to shape stop times', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'manual_override',
            runtimeInputs: {
                manualRuntimeMinutes: 20,
            },
            stops: [
                { id: 'stop-1', name: 'Start', kind: 'existing', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-2', name: 'Timed Stop', kind: 'existing', role: 'timed', latitude: 44.385, longitude: -79.685, timeLabel: '06:00', plannedOffsetMinutes: 8 },
                { id: 'stop-3', name: 'Intermediate', kind: 'existing', role: 'regular', latitude: 44.387, longitude: -79.68, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-4', name: 'End', kind: 'existing', role: 'terminal', latitude: 44.39, longitude: -79.67, timeLabel: '06:00', plannedOffsetMinutes: null },
            ],
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.stops.map((stop) => stop.timeLabel)).toEqual(['06:00', '06:08', '06:14', '06:20']);
    });

    it('applies terminal holds and timing profile to interpolated stop times', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'manual_override',
            runtimeInputs: {
                manualRuntimeMinutes: 20,
            },
            timingProfile: 'front_loaded',
            startTerminalHoldMinutes: 3,
            endTerminalHoldMinutes: 2,
            stops: [
                { id: 'stop-1', name: 'Start', kind: 'existing', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-2', name: 'Stop 2', kind: 'existing', role: 'regular', latitude: 44.385, longitude: -79.685, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-3', name: 'Stop 3', kind: 'existing', role: 'regular', latitude: 44.387, longitude: -79.68, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-4', name: 'End', kind: 'existing', role: 'terminal', latitude: 44.39, longitude: -79.67, timeLabel: '06:00', plannedOffsetMinutes: null },
            ],
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.stops.map((stop) => stop.timeLabel)).toEqual(['06:00', '06:09', '06:14', '06:20']);
    });

    it('warns when a timed interior stop has no timing anchor', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'manual_override',
            runtimeInputs: {
                manualRuntimeMinutes: 20,
            },
            stops: [
                { id: 'stop-1', name: 'Start', kind: 'existing', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-2', name: 'Timed Stop', kind: 'existing', role: 'timed', latitude: 44.385, longitude: -79.685, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-3', name: 'End', kind: 'existing', role: 'terminal', latitude: 44.39, longitude: -79.67, timeLabel: '06:00', plannedOffsetMinutes: null },
            ],
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.warnings).toContain('Timed stop "Timed Stop" is using interpolated timing. Add a timing anchor for schedule-ready handoff.');
    });

    it('warns when a regular stop has a manual timing anchor', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'manual_override',
            runtimeInputs: {
                manualRuntimeMinutes: 20,
            },
            stops: [
                { id: 'stop-1', name: 'Start', kind: 'existing', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-2', name: 'Anchored Regular Stop', kind: 'existing', role: 'regular', latitude: 44.385, longitude: -79.685, timeLabel: '06:00', plannedOffsetMinutes: 8 },
                { id: 'stop-3', name: 'End', kind: 'existing', role: 'terminal', latitude: 44.39, longitude: -79.67, timeLabel: '06:00', plannedOffsetMinutes: null },
            ],
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.warnings).toContain('Stop "Anchored Regular Stop" has a manual timing anchor but is marked regular. Consider marking it as a timed stop.');
    });

    it('warns when timing anchors are out of order', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'manual_override',
            runtimeInputs: {
                manualRuntimeMinutes: 20,
            },
            stops: [
                { id: 'stop-1', name: 'Start', kind: 'existing', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-2', name: 'Anchor One', kind: 'existing', role: 'timed', latitude: 44.385, longitude: -79.685, timeLabel: '06:00', plannedOffsetMinutes: 12 },
                { id: 'stop-3', name: 'Anchor Two', kind: 'existing', role: 'timed', latitude: 44.387, longitude: -79.68, timeLabel: '06:00', plannedOffsetMinutes: 10 },
                { id: 'stop-4', name: 'End', kind: 'existing', role: 'terminal', latitude: 44.39, longitude: -79.67, timeLabel: '06:00', plannedOffsetMinutes: null },
            ],
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.warnings).toContain('Timing anchor "Anchor Two" is not later than the previous anchor. Adjust anchor order for a valid timetable.');
    });

    it('warns when first and last stops are not terminal stops', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'manual_override',
            runtimeInputs: {
                manualRuntimeMinutes: 20,
            },
            stops: [
                { id: 'stop-1', name: 'Start', kind: 'existing', role: 'regular', latitude: 44.38, longitude: -79.69, timeLabel: '06:00', plannedOffsetMinutes: null },
                { id: 'stop-2', name: 'Midpoint', kind: 'existing', role: 'timed', latitude: 44.385, longitude: -79.685, timeLabel: '06:00', plannedOffsetMinutes: 8 },
                { id: 'stop-3', name: 'End', kind: 'existing', role: 'regular', latitude: 44.39, longitude: -79.67, timeLabel: '06:00', plannedOffsetMinutes: null },
            ],
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.warnings).toContain('First stop should be marked terminal for schedule-ready timing.');
        expect(derived.warnings).toContain('Last stop should be marked terminal for schedule-ready timing.');
    });

    it('preserves a manual ready-for-review status when there are no warnings', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'manual_override',
            runtimeInputs: {
                manualRuntimeMinutes: 20,
            },
            frequencyMinutes: 60,
            status: 'ready_for_review',
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.warnings).toHaveLength(0);
        expect(derived.status).toBe('ready_for_review');
    });

    it('forces status back to draft when warnings are present', () => {
        const scenario = createScenario({
            runtimeSourceMode: 'fallback_estimate',
            status: 'ready_for_review',
        });

        const derived = deriveRouteScenario(scenario);

        expect(derived.warnings.length).toBeGreaterThan(0);
        expect(derived.status).toBe('draft');
    });
});

describe('route planner shuttle adapter', () => {
    it('converts a shuttle project into a route planner project', () => {
        const shuttleProject = createLocalStarterProject('team-1');

        const routeProject = createRouteProjectFromShuttleProject(shuttleProject);
        const derivedProject = deriveRouteProject(routeProject);

        expect(derivedProject.scenarios).toHaveLength(shuttleProject.scenarios.length);
        expect(derivedProject.scenarios[0]?.scenarioType).toBe('shuttle-concept');
        expect(derivedProject.scenarios[0]?.baseSource.kind).toBe('shuttle_template');
        expect(derivedProject.preferredScenarioId).toBe(shuttleProject.preferredScenarioId);
    });
});
