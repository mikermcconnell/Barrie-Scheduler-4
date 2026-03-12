import { describe, expect, it } from 'vitest';
import {
    buildRouteScenarioHandoff,
    buildRouteStudyExport,
} from '../utils/route-planner/routePlannerOutputs';
import type { RouteObservedRuntimeSummary } from '../utils/route-planner/routePlannerObservedRuntime';
import type { RouteProject, RouteScenario } from '../utils/route-planner/routePlannerTypes';

function createScenario(): RouteScenario {
    return {
        id: 'scenario-1',
        name: 'Route 1 Option',
        scenarioType: 'existing-route-tweak',
        pattern: 'out-and-back',
        accent: 'indigo',
        notes: 'Use Dunlop instead of the existing local deviation.',
        baseSource: { kind: 'existing_route', sourceId: '1', label: 'Route 1 North' },
        runtimeSourceMode: 'observed_proxy',
        runtimeInputs: {
            observedRuntimeMinutes: 24,
            observedSampleCount: 12,
            observedMatchedSegments: 2,
            observedTotalSegments: 3,
        },
        distanceKm: 9.4,
        runtimeMinutes: 24,
        cycleMinutes: 59,
        busesRequired: 2,
        serviceHours: 14.5,
        firstDeparture: '06:00',
        lastDeparture: '20:00',
        frequencyMinutes: 30,
        layoverMinutes: 5,
        warnings: ['Observed proxy runtime covers 2 of 3 stop segments. Remaining segments use fallback estimates.'],
        departures: ['06:00', '06:30', '07:00'],
        waypoints: [],
        geometry: { type: 'LineString', coordinates: [] },
        stops: [
            { id: 'stop-a', name: 'Terminal A', kind: 'existing', sourceStopId: 'A', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '06:00' },
            { id: 'stop-b', name: 'Midpoint', kind: 'existing', sourceStopId: 'B', role: 'timed', latitude: 44.39, longitude: -79.68, timeLabel: '06:12' },
            { id: 'stop-c', name: 'Terminal C', kind: 'custom', role: 'terminal', latitude: 44.4, longitude: -79.67, timeLabel: '06:24' },
        ],
        coverage: {},
        status: 'draft',
    };
}

function createProject(): RouteProject {
    return {
        id: 'project-1',
        name: 'Northwest Route Study',
        description: 'Compare direct and local alignments.',
        preferredScenarioId: 'scenario-1',
        scenarios: [createScenario()],
        createdAt: new Date('2026-03-11T10:00:00Z'),
        updatedAt: new Date('2026-03-11T11:00:00Z'),
    };
}

function createObservedSummary(): RouteObservedRuntimeSummary {
    return {
        totalRuntimeMinutes: 24,
        matchedSegmentCount: 2,
        totalSegmentCount: 3,
        minimumSampleCount: 12,
        lowConfidenceSegmentCount: 0,
        segments: [],
    };
}

describe('routePlannerOutputs', () => {
    it('builds a study export with runtime source and scenario details', () => {
        const exportText = buildRouteStudyExport(
            createProject(),
            [createScenario()],
            new Map([['scenario-1', createObservedSummary()]]),
        );

        expect(exportText).toContain('# Northwest Route Study');
        expect(exportText).toContain('Runtime Source: Observed proxy (2/3 matched stop segments, minimum 12 samples)');
        expect(exportText).toContain('### Stops');
        expect(exportText).toContain('1. Terminal A');
    });

    it('builds a scheduling handoff for the preferred scenario', () => {
        const handoffText = buildRouteScenarioHandoff(
            createProject(),
            createScenario(),
            createObservedSummary(),
        );

        expect(handoffText).toContain('# Northwest Route Study - Scheduling Handoff');
        expect(handoffText).toContain('- Runtime: 24 min');
        expect(handoffText).toContain('## Planning Notes');
        expect(handoffText).toContain('Use Dunlop instead of the existing local deviation.');
    });
});
