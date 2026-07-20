import { describe, expect, it } from 'vitest';

import {
    fromRoutePlanner2RuntimeEstimate,
    toRoutePlanner2Scenario,
} from '../components/Analytics/route-concept-planner/RouteConceptMapBridge';
import { createRouteConceptAlternative } from '../utils/route-concept-planner';

describe('Route Concept Planner map bridge', () => {
    it('maps a neutral complete-route pattern without camper fields', () => {
        const alternative = createRouteConceptAlternative({ id: 'alternative-1', now: '2026-07-16T12:00:00.000Z' });
        const pattern = alternative.patterns[0]!;
        pattern.stops = [
            { id: 'a', name: 'Terminal A', lat: 44.38, lng: -79.69, sequence: 1, role: 'start-terminal', source: 'gtfs', stopCode: '100' },
            { id: 'b', name: 'Terminal B', lat: 44.4, lng: -79.67, sequence: 2, role: 'end-terminal', source: 'gtfs', stopCode: '200' },
        ];

        const scenario = toRoutePlanner2Scenario(pattern, alternative);

        expect(scenario.routeShape).toBe('one-way');
        expect(scenario.stops.map((stop) => stop.source)).toEqual(['barrie-stop', 'barrie-stop']);
        expect(JSON.stringify(scenario).toLowerCase()).not.toContain('camper');
        expect(scenario.service.frequencyMinutes).toBe(30);
    });

    it('converts Mapbox and scheduled map estimates to neutral runtime evidence', () => {
        expect(fromRoutePlanner2RuntimeEstimate({
            id: 'a->b',
            fromStopId: 'a',
            toStopId: 'b',
            runtimeMinutes: 8,
            source: 'mapbox',
            confidence: 'medium',
            pathFingerprint: 'path-1',
        })).toMatchObject({ source: 'mapbox', runtimeMinutes: 8, pathFingerprint: 'path-1' });

        expect(fromRoutePlanner2RuntimeEstimate({
            id: 'a->b',
            fromStopId: 'a',
            toStopId: 'b',
            runtimeMinutes: 7,
            source: 'scheduled-proxy',
            confidence: 'high',
            evidencePeriod: 'full-day',
        })).toMatchObject({ source: 'gtfs', planningPeriod: 'all-day', runtimeMinutes: 7 });
    });

    it('does not persist manual or missing estimates as automatic evidence', () => {
        expect(fromRoutePlanner2RuntimeEstimate({ id: 'a->b', fromStopId: 'a', toStopId: 'b', runtimeMinutes: 9, source: 'manual', confidence: 'medium' })).toBeNull();
        expect(fromRoutePlanner2RuntimeEstimate({ id: 'a->b', fromStopId: 'a', toStopId: 'b', runtimeMinutes: null, source: 'missing', confidence: 'missing' })).toBeNull();
    });
});
