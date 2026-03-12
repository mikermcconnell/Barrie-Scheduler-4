import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStarterShuttleProject } from '../utils/shuttle/shuttleSeedData';
import { deriveShuttleScenario } from '../utils/shuttle/shuttlePlanning';
import { snapShuttleWaypointsToRoad } from '../utils/shuttle/shuttleRoadSnapService';

describe('deriveShuttleScenario', () => {
    it('rebuilds out-and-back geometry from edited waypoints', () => {
        const starter = createStarterShuttleProject(null);
        const scenario = starter.scenarios.find((value) => value.id === 'go-relief');
        if (!scenario) throw new Error('Expected starter out-and-back scenario');

        const editedScenario = deriveShuttleScenario({
            ...scenario,
            geometry: {
                type: 'LineString',
                coordinates: scenario.waypoints,
            },
        });

        expect(editedScenario.geometry.coordinates).toEqual([
            ...scenario.waypoints,
            ...scenario.waypoints.slice(0, -1).reverse(),
        ]);
        expect(editedScenario.distanceKm).toBeGreaterThan(0);
    });

    it('supports overnight departures across midnight', () => {
        const starter = createStarterShuttleProject(null);
        const scenario = starter.scenarios[0];

        const derived = deriveShuttleScenario({
            ...scenario,
            firstDeparture: '23:30',
            lastDeparture: '01:00',
            frequencyMinutes: 30,
        });

        expect(derived.departures).toEqual(['23:30', '00:00', '00:30', '01:00']);
        expect(derived.serviceHours).toBe(2);
        expect(derived.warnings).not.toContain('Enter a valid service span to generate departures.');
    });

    it('flags invalid service spans when departures cannot be generated', () => {
        const starter = createStarterShuttleProject(null);
        const scenario = starter.scenarios[0];

        const derived = deriveShuttleScenario({
            ...scenario,
            firstDeparture: 'bad-input',
            lastDeparture: '09:00',
        });

        expect(derived.departures).toEqual([]);
        expect(derived.warnings).toContain('Enter a valid service span to generate departures.');
        expect(derived.status).toBe('draft');
    });
});

describe('snapShuttleWaypointsToRoad', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('falls back to mirrored out-and-back geometry when Mapbox is unavailable', async () => {
        vi.stubEnv('VITE_MAPBOX_TOKEN', '');
        const waypoints: [number, number][] = [
            [-79.687, 44.35],
            [-79.683, 44.355],
            [-79.679, 44.359],
            [-79.674, 44.364],
            [-79.671, 44.371],
        ];

        const result = await snapShuttleWaypointsToRoad(waypoints, 'out-and-back');

        expect(result.source).toBe('fallback');
        expect(result.coordinates).toEqual([
            ...waypoints,
            ...waypoints.slice(0, -1).reverse(),
        ]);
    });
});
