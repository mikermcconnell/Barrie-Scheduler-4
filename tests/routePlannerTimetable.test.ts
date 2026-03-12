import { describe, expect, it } from 'vitest';
import {
    buildRouteTimetableMarkdown,
    buildRouteTimetablePreview,
} from '../utils/route-planner/routePlannerTimetable';
import type { RouteScenario } from '../utils/route-planner/routePlannerTypes';

function createScenario(): RouteScenario {
    return {
        id: 'scenario-1',
        name: 'Timetable Test',
        scenarioType: 'route-concept',
        pattern: 'out-and-back',
        accent: 'indigo',
        notes: '',
        baseSource: { kind: 'blank', label: 'Blank Concept' },
        runtimeSourceMode: 'fallback_estimate',
        runtimeInputs: {},
        distanceKm: 8.2,
        runtimeMinutes: 24,
        cycleMinutes: 53,
        busesRequired: 2,
        serviceHours: 12,
        firstDeparture: '23:30',
        lastDeparture: '01:00',
        frequencyMinutes: 30,
        layoverMinutes: 5,
        timingProfile: 'balanced',
        startTerminalHoldMinutes: 0,
        endTerminalHoldMinutes: 0,
        coverageWalkshedMeters: 400,
        warnings: [],
        departures: ['23:30', '00:00', '00:30', '01:00'],
        waypoints: [],
        geometry: { type: 'LineString', coordinates: [] },
        stops: [
            { id: 'stop-1', name: 'Terminal A', kind: 'existing', sourceStopId: 'A', role: 'terminal', latitude: 44.38, longitude: -79.69, timeLabel: '23:30' },
            { id: 'stop-2', name: 'Midpoint', kind: 'existing', sourceStopId: 'B', role: 'timed', latitude: 44.39, longitude: -79.68, timeLabel: '23:42' },
            { id: 'stop-3', name: 'Terminal B', kind: 'custom', role: 'terminal', latitude: 44.4, longitude: -79.67, timeLabel: '23:54' },
        ],
        coverage: {},
        status: 'ready_for_review',
    };
}

describe('routePlannerTimetable', () => {
    it('builds a timetable preview across multiple departures', () => {
        const preview = buildRouteTimetablePreview(createScenario(), 3);

        expect(preview.departures).toEqual(['23:30', '00:00', '00:30']);
        expect(preview.rows[1]?.times).toEqual(['23:42', '00:12', '00:42']);
    });

    it('renders a markdown timetable table', () => {
        const markdown = buildRouteTimetableMarkdown(createScenario(), 2);

        expect(markdown).toContain('| Stop | Role | 23:30 | 00:00 |');
        expect(markdown).toContain('| Midpoint | timed | 23:42 | 00:12 |');
    });
});
