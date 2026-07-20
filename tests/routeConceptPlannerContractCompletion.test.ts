import { describe, expect, it } from 'vitest';

import {
    createRouteConceptProject,
    createRouteConceptReversedReturn,
    deriveRouteConceptFeasibility,
    replaceRouteConceptPattern,
    updateRouteConceptService,
} from '../utils/route-concept-planner';

const NOW = '2026-07-16T12:00:00.000Z';

describe('Route Concept Planner completion contracts', () => {
    it('creates a reversed editable return with neutral IDs and no outbound runtime evidence', () => {
        const project = createRouteConceptProject({ structure: 'bidirectional', now: NOW });
        const alternative = project.alternatives[0]!;
        const outbound = alternative.patterns[0]!;
        alternative.patterns = [outbound];
        alternative.patternOrder = [outbound.id];
        outbound.source = { type: 'gtfs', routeId: '1' };
        outbound.stops = [
            { id: 'a', name: 'A', lat: 44.38, lng: -79.7, sequence: 1, role: 'start-terminal', source: 'gtfs' },
            { id: 'b', name: 'B', lat: 44.39, lng: -79.69, sequence: 2, role: 'end-terminal', source: 'gtfs' },
        ];
        outbound.alignment = [{ id: 'point-1', lat: 44.385, lng: -79.695, sequence: 1, afterStopId: 'a', beforeStopId: 'b' }];
        outbound.runtimeEvidence = [{ id: 'runtime-1', fromStopId: 'a', toStopId: 'b', runtimeMinutes: 8, source: 'gtfs', dayType: 'weekday', planningPeriod: 'am-peak' }];

        const next = createRouteConceptReversedReturn(project, alternative.id, outbound.id, NOW);
        const returned = next.alternatives[0]!.patterns.find((pattern) => pattern.role === 'inbound')!;

        expect(returned.stops.map((stop) => stop.name)).toEqual(['B', 'A']);
        expect(returned.stops.every((stop) => !['a', 'b'].includes(stop.id))).toBe(true);
        expect(returned.alignment[0]).toMatchObject({ afterStopId: returned.stops[0]!.id, beforeStopId: returned.stops[1]!.id });
        expect(returned.runtimeEvidence).toEqual([]);
        expect(returned.runtimeOverrides).toEqual({});
        expect(returned.source).toEqual({ type: 'blank' });
    });

    it('creates separately editable out-and-back patterns and sums each direction once', () => {
        const project = createRouteConceptProject({ structure: 'out-and-back', now: NOW });
        const alternative = project.alternatives[0]!;
        const outbound = alternative.patterns.find((pattern) => pattern.role === 'outbound')!;
        const returned = alternative.patterns.find((pattern) => pattern.role === 'inbound')!;
        outbound.stops = [
            { id: 'a', name: 'A', lat: 44.38, lng: -79.7, sequence: 1, role: 'start-terminal', source: 'custom' },
            { id: 'b', name: 'Turn', lat: 44.39, lng: -79.69, sequence: 2, role: 'turnaround', source: 'custom' },
        ];
        returned.stops = [
            { id: 'c', name: 'Turn', lat: 44.39, lng: -79.69, sequence: 1, role: 'turnaround', source: 'custom' },
            { id: 'd', name: 'A', lat: 44.38, lng: -79.7, sequence: 2, role: 'end-terminal', source: 'custom' },
        ];
        outbound.runtimeEvidence = [{ id: 'ab', fromStopId: 'a', toStopId: 'b', runtimeMinutes: 8, source: 'mapbox' }];
        returned.runtimeEvidence = [{ id: 'cd', fromStopId: 'c', toStopId: 'd', runtimeMinutes: 9, source: 'mapbox' }];

        const result = deriveRouteConceptFeasibility(alternative);
        expect(alternative.patterns.map((pattern) => pattern.name)).toEqual(['Outbound', 'Return']);
        expect(result.completeRouteRuntimeMinutes).toBe(17);
        expect(result.segments).toHaveLength(2);
    });

    it('retains the actual GTFS evidence day and period on resolved segments', () => {
        const project = createRouteConceptProject({ structure: 'loop', now: NOW });
        const alternative = project.alternatives[0]!;
        const pattern = alternative.patterns[0]!;
        pattern.stops = [
            { id: 'a', name: 'A', lat: 44.38, lng: -79.7, sequence: 1, role: 'start-terminal', source: 'gtfs' },
            { id: 'b', name: 'B', lat: 44.39, lng: -79.69, sequence: 2, role: 'regular', source: 'gtfs' },
        ];
        pattern.runtimeEvidence = [
            { id: 'ab', fromStopId: 'a', toStopId: 'b', runtimeMinutes: 8, source: 'gtfs', dayType: 'weekday', planningPeriod: 'am-peak' },
            { id: 'ba', fromStopId: 'b', toStopId: 'a', runtimeMinutes: 9, source: 'gtfs', dayType: 'weekday', planningPeriod: 'am-peak' },
        ];
        alternative.service.planningPeriod = 'am-peak';
        const result = deriveRouteConceptFeasibility(alternative);
        expect(result.segments[0]).toMatchObject({ source: 'gtfs', evidenceDayType: 'weekday', evidencePlanningPeriod: 'am-peak' });
    });

    it('resets review status when route or service inputs change', () => {
        const project = createRouteConceptProject({ now: NOW });
        const alternative = project.alternatives[0]!;
        alternative.status = 'review';
        const serviceChanged = updateRouteConceptService(project, alternative.id, { frequencyMinutes: 20 }, NOW);
        expect(serviceChanged.alternatives[0]!.status).toBe('draft');
        serviceChanged.alternatives[0]!.status = 'review';
        const routeChanged = replaceRouteConceptPattern(serviceChanged, alternative.id, { ...alternative.patterns[0]!, notes: 'changed' }, NOW);
        expect(routeChanged.alternatives[0]!.status).toBe('draft');
    });
});
