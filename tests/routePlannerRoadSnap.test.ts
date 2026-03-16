import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildRouteStopSignature,
    buildRouteStopWaypoints,
    snapRouteStopsToRoad,
    snapRouteWaypointsToRoad,
} from '../utils/route-planner/routePlannerRoadSnap';
import type { RouteStop } from '../utils/route-planner/routePlannerTypes';

const stops: RouteStop[] = [
    {
        id: 'stop-a',
        name: 'Stop A',
        kind: 'custom',
        role: 'terminal',
        latitude: 44.38,
        longitude: -79.69,
        timeLabel: '06:00',
        plannedOffsetMinutes: null,
    },
    {
        id: 'stop-b',
        name: 'Stop B',
        kind: 'custom',
        role: 'regular',
        latitude: 44.39,
        longitude: -79.68,
        timeLabel: '06:10',
        plannedOffsetMinutes: null,
    },
    {
        id: 'stop-c',
        name: 'Stop C',
        kind: 'custom',
        role: 'terminal',
        latitude: 44.4,
        longitude: -79.67,
        timeLabel: '06:20',
        plannedOffsetMinutes: null,
    },
];

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('routePlannerRoadSnap', () => {
    it('builds ordered stop waypoints in [lon, lat] format', () => {
        expect(buildRouteStopWaypoints(stops)).toEqual([
            [-79.69, 44.38],
            [-79.68, 44.39],
            [-79.67, 44.4],
        ]);
    });

    it('builds a stable stop signature for drag/reroute matching', () => {
        expect(buildRouteStopSignature(stops)).toBe(
            'stop-a:-79.69000,44.38000|stop-b:-79.68000,44.39000|stop-c:-79.67000,44.40000'
        );
    });

    it('stitches routed stop-to-stop segments instead of using a single oversized request', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (url.includes('-79.69,44.38;-79.68,44.39')) {
                return {
                    ok: true,
                    json: async () => ({
                        code: 'Ok',
                        routes: [{
                            geometry: {
                                type: 'LineString',
                                coordinates: [
                                    [-79.69, 44.38],
                                    [-79.685, 44.385],
                                    [-79.68, 44.39],
                                ],
                            },
                        }],
                    }),
                };
            }

            if (url.includes('-79.67,44.4;-79.69,44.38')) {
                return {
                    ok: true,
                    json: async () => ({
                        code: 'Ok',
                        routes: [{
                            geometry: {
                                type: 'LineString',
                                coordinates: [
                                    [-79.67, 44.4],
                                    [-79.675, 44.395],
                                    [-79.69, 44.38],
                                ],
                            },
                        }],
                    }),
                };
            }

            return {
                ok: true,
                json: async () => ({
                    code: 'Ok',
                    routes: [{
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [-79.68, 44.39],
                                [-79.675, 44.395],
                                [-79.67, 44.4],
                            ],
                        },
                    }],
                }),
            };
        });

        vi.stubGlobal('fetch', fetchMock);
        vi.stubEnv('VITE_MAPBOX_TOKEN', 'test-token');

        const result = await snapRouteStopsToRoad(stops, 'loop');

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result.source).toBe('mapbox');
        expect(result.coordinates).toEqual([
            [-79.69, 44.38],
            [-79.685, 44.385],
            [-79.68, 44.39],
            [-79.675, 44.395],
            [-79.67, 44.4],
            [-79.675, 44.395],
            [-79.69, 44.38],
        ]);
    });

    it('reroutes the full path when the edited route uses a simplified control-point set', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (url.includes('-79.69,44.38;-79.682,44.388')) {
                return {
                    ok: true,
                    json: async () => ({
                        code: 'Ok',
                        routes: [{
                            geometry: {
                                type: 'LineString',
                                coordinates: [
                                    [-79.69, 44.38],
                                    [-79.686, 44.384],
                                    [-79.682, 44.388],
                                ],
                            },
                        }],
                    }),
                };
            }

            if (url.includes('-79.671,44.401;-79.69,44.38')) {
                return {
                    ok: true,
                    json: async () => ({
                        code: 'Ok',
                        routes: [{
                            geometry: {
                                type: 'LineString',
                                coordinates: [
                                    [-79.671, 44.401],
                                    [-79.682, 44.393],
                                    [-79.69, 44.38],
                                ],
                            },
                        }],
                    }),
                };
            }

            return {
                ok: true,
                json: async () => ({
                    code: 'Ok',
                    routes: [{
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [-79.682, 44.388],
                                [-79.676, 44.394],
                                [-79.671, 44.401],
                            ],
                        },
                    }],
                }),
            };
        });

        vi.stubGlobal('fetch', fetchMock);
        vi.stubEnv('VITE_MAPBOX_TOKEN', 'test-token');

        const result = await snapRouteWaypointsToRoad(
            [
                [-79.69, 44.38],
                [-79.682, 44.388],
                [-79.671, 44.401],
            ],
            'loop',
            1
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result.source).toBe('mapbox');
        expect(result.coordinates).toEqual([
            [-79.69, 44.38],
            [-79.686, 44.384],
            [-79.682, 44.388],
            [-79.676, 44.394],
            [-79.671, 44.401],
            [-79.682, 44.393],
            [-79.69, 44.38],
        ]);
    });
});
