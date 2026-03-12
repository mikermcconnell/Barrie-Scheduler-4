import type { ShuttleProject } from './shuttleTypes';

export const LOCAL_STARTER_SHUTTLE_PROJECT_ID = 'local-starter-project';

const now = () => new Date();

export function createStarterShuttleProject(teamId?: string | null): Omit<ShuttleProject, 'id' | 'createdAt' | 'updatedAt'> {
    return {
        name: 'Waterfront Shuttle Concepts',
        description: 'Starter shuttle planning project for event and GO connection testing.',
        teamId: teamId ?? null,
        preferredScenarioId: 'waterfront-loop',
        scenarios: [
            {
                id: 'waterfront-loop',
                name: 'Waterfront Event Loop',
                pattern: 'loop',
                accent: 'indigo',
                notes: 'Loop concept linking Allandale Waterfront GO, Centennial Beach, Downtown, and Lakeshore parking.',
                distanceKm: 8.4,
                runtimeMinutes: 24,
                cycleMinutes: 30,
                busesRequired: 2,
                serviceHours: 14,
                firstDeparture: '06:30',
                lastDeparture: '23:30',
                frequencyMinutes: 15,
                layoverMinutes: 6,
                warnings: ['Recovery is tight if event traffic delays Lakeshore Drive by more than 4 minutes.'],
                departures: ['06:30', '06:45', '07:00', '07:15', '07:30', '07:45'],
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [-79.674, 44.371],
                        [-79.681, 44.374],
                        [-79.689, 44.379],
                        [-79.693, 44.387],
                        [-79.686, 44.391],
                        [-79.675, 44.385],
                        [-79.671, 44.378],
                        [-79.674, 44.371],
                    ],
                },
                waypoints: [
                    [-79.674, 44.371],
                    [-79.681, 44.374],
                    [-79.689, 44.379],
                    [-79.693, 44.387],
                    [-79.686, 44.391],
                    [-79.675, 44.385],
                    [-79.671, 44.378],
                ],
                stops: [
                    { id: 'wf-1', name: 'Allandale Waterfront GO', kind: 'barrie', role: 'terminal', latitude: 44.371, longitude: -79.674, timeLabel: '06:30' },
                    { id: 'wf-2', name: 'Centennial Beach', kind: 'custom', role: 'timed', latitude: 44.374, longitude: -79.681, timeLabel: '06:36' },
                    { id: 'wf-3', name: 'Downtown Terminal', kind: 'barrie', role: 'timed', latitude: 44.379, longitude: -79.689, timeLabel: '06:42' },
                    { id: 'wf-4', name: 'Lakeshore Park & Ride', kind: 'custom', role: 'regular', latitude: 44.387, longitude: -79.693, timeLabel: '06:47' },
                    { id: 'wf-5', name: 'Meridian Place', kind: 'custom', role: 'regular', latitude: 44.391, longitude: -79.686, timeLabel: '06:51' },
                ],
                status: 'draft',
            },
            {
                id: 'go-relief',
                name: 'South GO Relief Shuttle',
                pattern: 'out-and-back',
                accent: 'emerald',
                notes: 'Out-and-back concept linking Park Place, Mapleview stops, and Allandale Waterfront GO during rail disruptions.',
                distanceKm: 11.2,
                runtimeMinutes: 19,
                cycleMinutes: 44,
                busesRequired: 2,
                serviceHours: 12.5,
                firstDeparture: '05:45',
                lastDeparture: '21:45',
                frequencyMinutes: 20,
                layoverMinutes: 6,
                warnings: ['Mapleview congestion may require a third bus during PM peak if runtime exceeds 22 minutes.'],
                departures: ['05:45', '06:05', '06:25', '06:45', '07:05', '07:25'],
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [-79.687, 44.35],
                        [-79.683, 44.355],
                        [-79.679, 44.359],
                        [-79.674, 44.364],
                        [-79.671, 44.371],
                        [-79.674, 44.364],
                        [-79.679, 44.359],
                        [-79.683, 44.355],
                        [-79.687, 44.35],
                    ],
                },
                waypoints: [
                    [-79.687, 44.35],
                    [-79.683, 44.355],
                    [-79.679, 44.359],
                    [-79.674, 44.364],
                    [-79.671, 44.371],
                ],
                stops: [
                    { id: 'gr-1', name: 'Park Place Terminal', kind: 'custom', role: 'terminal', latitude: 44.35, longitude: -79.687, timeLabel: '05:45' },
                    { id: 'gr-2', name: 'Mapleview at Bayview', kind: 'barrie', role: 'timed', latitude: 44.355, longitude: -79.683, timeLabel: '05:51' },
                    { id: 'gr-3', name: 'Mapleview at Yonge', kind: 'barrie', role: 'regular', latitude: 44.359, longitude: -79.679, timeLabel: '05:56' },
                    { id: 'gr-4', name: 'Allandale Waterfront GO', kind: 'barrie', role: 'terminal', latitude: 44.371, longitude: -79.671, timeLabel: '06:04' },
                ],
                status: 'draft',
            },
        ],
    };
}

export function createLocalStarterProject(teamId?: string | null): ShuttleProject {
    const stamp = now();
    return {
        id: LOCAL_STARTER_SHUTTLE_PROJECT_ID,
        ...createStarterShuttleProject(teamId),
        createdAt: stamp,
        updatedAt: stamp,
    };
}
