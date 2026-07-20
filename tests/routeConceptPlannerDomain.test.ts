import { describe, expect, it } from 'vitest';

import {
    addRouteConceptAlternative,
    createRouteConceptProject,
    deriveRouteConceptFeasibility,
    duplicateRouteConceptAlternative,
    formatRouteConceptServiceTime,
    markRouteConceptPreferred,
    normalizeRouteConceptServiceSpan,
    parseRouteConceptServiceTime,
    summarizeRouteConceptProject,
    updateRouteConceptService,
} from '../utils/route-concept-planner';
import type {
    ConceptStop,
    RouteConceptAlternative,
    RouteConceptPattern,
    RouteConceptPatternRole,
    RouteConceptSegmentRuntimeEvidence,
    RouteConceptStructure,
} from '../utils/route-concept-planner';

const now = '2026-07-16T12:00:00.000Z';

function stop(id: string, sequence: number, role: ConceptStop['role'] = 'regular'): ConceptStop {
    return { id, name: id, lat: 44.38 + (sequence / 100), lng: -79.7, sequence, role, source: 'custom' };
}

function evidence(
    patternId: string,
    fromStopId: string,
    toStopId: string,
    runtimeMinutes: number,
    source: RouteConceptSegmentRuntimeEvidence['source'] = 'gtfs',
    extra: Partial<RouteConceptSegmentRuntimeEvidence> = {},
): RouteConceptSegmentRuntimeEvidence {
    return {
        id: `${patternId}-${fromStopId}-${toStopId}-${source}`,
        fromStopId,
        toStopId,
        runtimeMinutes,
        source,
        ...extra,
    };
}

function pattern(id: string, role: RouteConceptPatternRole, stops: ConceptStop[], runtimes: RouteConceptSegmentRuntimeEvidence[]): RouteConceptPattern {
    const normalizedStops = stops.map((item, index) => ({
        ...item,
        role: index === 0
            ? 'start-terminal' as const
            : role === 'out-and-back' && index === stops.length - 1
                ? 'turnaround' as const
                : (role === 'outbound' || role === 'inbound') && index === stops.length - 1
                    ? 'end-terminal' as const
                    : item.role,
    }));
    return {
        id,
        name: id,
        role,
        alignment: [],
        stops: normalizedStops,
        runtimeEvidence: runtimes,
        runtimeOverrides: {},
        source: { type: 'blank' },
        notes: '',
        createdAt: now,
        updatedAt: now,
    };
}

function alternative(structure: RouteConceptStructure, patterns: RouteConceptPattern[]): RouteConceptAlternative {
    return {
        id: 'alternative-1',
        name: 'Option 1',
        status: 'draft',
        structure,
        patternOrder: patterns.map((item) => item.id),
        patterns,
        service: {
            firstDepartureMinutes: 360,
            lastDepartureMinutes: 720,
            frequencyMinutes: 30,
            startTerminalLayoverMinutes: 4,
            endTerminalLayoverMinutes: 4,
            intermediateStopDwellSeconds: 0,
            dayType: 'weekday',
            planningPeriod: 'am-peak',
        },
        notes: '',
        createdAt: now,
        updatedAt: now,
    };
}

describe('Route Concept Planner complete-route feasibility', () => {
    it('calculates a complete bidirectional alternative and daily estimates', () => {
        const outbound = pattern('out', 'outbound', [stop('a', 1), stop('b', 2)], [evidence('out', 'a', 'b', 20)]);
        const inbound = pattern('in', 'inbound', [stop('b2', 1), stop('a2', 2)], [evidence('in', 'b2', 'a2', 22)]);
        const result = deriveRouteConceptFeasibility(alternative('bidirectional', [outbound, inbound]));

        expect(result.completeRouteRuntimeMinutes).toBe(42);
        expect(result.cycleRequirementMinutes).toBe(50);
        expect(result.minimumBusesRequired).toBe(2);
        expect(result.testedBuses).toBeNull();
        expect(result.scheduledCycleWindowMinutes).toBe(60);
        expect(result.recoveryTimeMinutes).toBe(10);
        expect(result.recoveryPercent).toBe(20);
        expect(result.daily).toEqual({
            serviceSpanMinutes: 360,
            departuresPerStartingTerminal: 13,
            totalDepartures: 26,
            revenueHours: 9.1,
            vehicleHours: 13,
        });
        expect(result.comparisonReady).toBe(true);
        expect(result.readiness).toBe('ready-for-review');
        expect(result.confidence).toBe('high');
    });

    it('keeps the tested bus count separate from the calculated minimum', () => {
        const outbound = pattern('out', 'outbound', [stop('a', 1), stop('b', 2)], [evidence('out', 'a', 'b', 28)]);
        const inbound = pattern('in', 'inbound', [stop('c', 1), stop('d', 2)], [evidence('in', 'c', 'd', 28)]);
        const concept = alternative('bidirectional', [outbound, inbound]);
        concept.service.testedBuses = 2;
        const result = deriveRouteConceptFeasibility(concept);

        expect(result.minimumBusesRequired).toBe(3);
        expect(result.testedBuses).toBe(2);
        expect(result.scheduledCycleWindowMinutes).toBe(60);
        expect(result.recoveryTimeMinutes).toBe(-4);
        expect(result.issues.map((issue) => issue.id)).toContain('negative-recovery');
        expect(result.comparisonReady).toBe(false);
    });

    it('requires both directions before a bidirectional route can be compared', () => {
        const outbound = pattern('out', 'outbound', [stop('a', 1), stop('b', 2)], [evidence('out', 'a', 'b', 20)]);
        const result = deriveRouteConceptFeasibility(alternative('bidirectional', [outbound]));

        expect(result.completeRouteRuntimeMinutes).toBeNull();
        expect(result.comparisonReady).toBe(false);
        expect(result.issues.map((issue) => issue.id)).toContain('pattern-inbound-missing');
    });

    it('blocks a complete route when terminal roles are invalid', () => {
        const outbound = pattern('out', 'outbound', [stop('a', 1), stop('b', 2)], [evidence('out', 'a', 'b', 20)]);
        const inbound = pattern('in', 'inbound', [stop('b2', 1), stop('a2', 2)], [evidence('in', 'b2', 'a2', 20)]);
        outbound.stops[0] = { ...outbound.stops[0]!, role: 'regular' };

        const result = deriveRouteConceptFeasibility(alternative('bidirectional', [outbound, inbound]));

        expect(result.readiness).toBe('not-ready');
        expect(result.issues.map((issue) => issue.id)).toContain('pattern-out-start-terminal');
    });

    it('includes the closing segment for a loop', () => {
        const loop = pattern('loop', 'loop', [stop('a', 1), stop('b', 2), stop('c', 3)], [
            evidence('loop', 'a', 'b', 5),
            evidence('loop', 'b', 'c', 6),
            evidence('loop', 'c', 'a', 7),
        ]);
        const result = deriveRouteConceptFeasibility(alternative('loop', [loop]));

        expect(result.segments.map((segment) => segment.id)).toEqual(['a->b', 'b->c', 'c->a']);
        expect(result.completeRouteRuntimeMinutes).toBe(18);
        expect(result.daily?.totalDepartures).toBe(13);
    });

    it('builds the reverse traversal for an out-and-back concept', () => {
        const outAndBack = pattern('return', 'out-and-back', [stop('a', 1), stop('b', 2), stop('c', 3, 'turnaround')], [
            evidence('return', 'a', 'b', 5),
            evidence('return', 'b', 'c', 6),
            evidence('return', 'c', 'b', 7),
            evidence('return', 'b', 'a', 8),
        ]);
        const result = deriveRouteConceptFeasibility(alternative('out-and-back', [outAndBack]));

        expect(result.segments.map((segment) => segment.id)).toEqual(['a->b', 'b->c', 'c->b', 'b->a']);
        expect(result.completeRouteRuntimeMinutes).toBe(26);
        expect(result.comparisonReady).toBe(true);
    });
});

describe('Route Concept Planner runtime evidence', () => {
    it('uses manual, matching GTFS, Mapbox, then fallback in that order', () => {
        const routePattern = pattern('loop', 'loop', [stop('a', 1), stop('b', 2)], [
            evidence('loop', 'a', 'b', 12, 'fallback'),
            evidence('loop', 'a', 'b', 9, 'mapbox'),
            evidence('loop', 'a', 'b', 7, 'gtfs', { dayType: 'weekday', planningPeriod: 'all-day' }),
            evidence('loop', 'a', 'b', 6, 'gtfs', { dayType: 'weekday', planningPeriod: 'am-peak' }),
            evidence('loop', 'b', 'a', 8, 'fallback'),
        ]);
        routePattern.runtimeOverrides['a->b'] = { runtimeMinutes: 5, confirmed: true, updatedAt: now };
        const result = deriveRouteConceptFeasibility(alternative('loop', [routePattern]));

        expect(result.segments[0]).toMatchObject({ id: 'a->b', runtimeMinutes: 5, source: 'manual' });
        expect(result.segments[1]).toMatchObject({ id: 'b->a', runtimeMinutes: 8, source: 'fallback' });
    });

    it('ignores stale automatic evidence and blocks stale manual overrides until reconfirmed', () => {
        const routePattern = pattern('loop', 'loop', [stop('a', 1), stop('b', 2)], [
            evidence('loop', 'a', 'b', 7, 'gtfs', { pathFingerprint: 'old' }),
            evidence('loop', 'a', 'b', 9, 'mapbox', { pathFingerprint: 'current' }),
            evidence('loop', 'b', 'a', 8, 'gtfs', { pathFingerprint: 'current-back' }),
        ]);
        routePattern.segmentFingerprints = { 'a->b': 'current', 'b->a': 'current-back' };
        routePattern.runtimeOverrides['a->b'] = { runtimeMinutes: 5, confirmed: true, pathFingerprint: 'old', updatedAt: now };
        const result = deriveRouteConceptFeasibility(alternative('loop', [routePattern]));

        expect(result.segments[0]).toMatchObject({ source: 'manual', requiresManualConfirmation: true });
        expect(result.issues.map((issue) => issue.id)).toContain('confirm-runtime-loop-a->b');
        expect(result.comparisonReady).toBe(false);
    });

    it('rounds each segment before summing', () => {
        const loop = pattern('loop', 'loop', [stop('a', 1), stop('b', 2), stop('c', 3)], [
            evidence('loop', 'a', 'b', 1.4),
            evidence('loop', 'b', 'c', 1.4),
            evidence('loop', 'c', 'a', 1.4),
        ]);
        expect(deriveRouteConceptFeasibility(alternative('loop', [loop])).completeRouteRuntimeMinutes).toBe(3);
    });
});

describe('Route Concept Planner factory and comparison summary', () => {
    it('creates only neutral route-planning data', () => {
        const project = createRouteConceptProject({ id: 'project-1', alternativeId: 'option-1', now });
        const serialized = JSON.stringify(project).toLowerCase();
        expect(serialized).not.toContain('camper');
        expect(serialized).not.toContain('rider');
        expect(serialized).not.toContain('manifest');
        expect(project.alternatives[0]?.patterns.map((item) => item.role)).toEqual(['outbound', 'inbound']);
        expect(project.revision).toBe(0);
    });

    it('adds, duplicates, prefers, and summarizes alternatives without sharing nested data', () => {
        let project = createRouteConceptProject({ id: 'project-1', alternativeId: 'option-1', now, structure: 'loop' });
        const original = project.alternatives[0]!;
        original.patterns[0]!.stops = [stop('a', 1, 'start-terminal'), stop('b', 2)];
        original.patterns[0]!.runtimeEvidence = [evidence('loop', 'a', 'b', 10), evidence('loop', 'b', 'a', 10)];
        project = duplicateRouteConceptAlternative(project, 'option-1', { id: 'option-copy', now });
        project = markRouteConceptPreferred(project, 'option-copy', now);
        project = addRouteConceptAlternative(project, { id: 'option-3', structure: 'out-and-back', now });

        const copy = project.alternatives.find((item) => item.id === 'option-copy')!;
        expect(copy.patterns[0]?.id).not.toBe(original.patterns[0]?.id);
        expect(copy.patterns[0]?.stops[0]?.id).not.toBe('a');
        expect(summarizeRouteConceptProject(project)).toMatchObject({
            totalAlternatives: 3,
            comparisonReadyCount: 2,
            preferredAlternative: { alternativeId: 'option-copy', isPreferred: true },
        });
    });

    it('updates tested buses without replacing the calculated minimum contract', () => {
        const project = createRouteConceptProject({ id: 'project-1', alternativeId: 'option-1', now });
        const updated = updateRouteConceptService(project, 'option-1', { testedBuses: 4 }, now);
        expect(updated.alternatives[0]?.service.testedBuses).toBe(4);
        expect(updated.status).toBe('local-draft');
    });
});

describe('Route Concept Planner service-day time', () => {
    it('parses and displays GTFS times after midnight without wrapping their order', () => {
        expect(parseRouteConceptServiceTime('24:30')).toBe(1470);
        expect(parseRouteConceptServiceTime('01:30 + 1 day')).toBe(1530);
        expect(formatRouteConceptServiceTime(1470)).toEqual({ minutes: 1470, nextDay: true, label: '00:30 (+1 day)' });
        expect(normalizeRouteConceptServiceSpan(1380, 90)).toEqual({
            firstDepartureMinutes: 1380,
            lastDepartureMinutes: 1530,
            serviceSpanMinutes: 150,
        });
    });
});
