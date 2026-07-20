import { describe, expect, it } from 'vitest';

import {
    addRouteConceptAlignmentPoint,
    addRouteConceptStop,
    clearRouteConceptRuntimeOverride,
    createRouteConceptPattern,
    deleteRouteConceptStop,
    mergeRouteConceptRuntimeEvidence,
    moveRouteConceptAlignmentPoint,
    moveRouteConceptStop,
    reorderRouteConceptStop,
    setRouteConceptRuntimeOverride,
} from '../utils/route-concept-planner';
import type { RouteConceptPattern } from '../utils/route-concept-planner';

const now = '2026-07-16T12:00:00.000Z';

function threeStopPattern(): RouteConceptPattern {
    let pattern = createRouteConceptPattern({ id: 'out', role: 'outbound', now });
    pattern = addRouteConceptStop(pattern, { id: 'a', name: 'A', lat: 44.1, lng: -79.1 }, { now });
    pattern = addRouteConceptStop(pattern, { id: 'b', name: 'B', lat: 44.2, lng: -79.2 }, { now });
    pattern = addRouteConceptStop(pattern, { id: 'c', name: 'C', lat: 44.3, lng: -79.3 }, { now });
    pattern.segmentFingerprints = { 'a->b': 'ab', 'b->c': 'bc' };
    pattern.runtimeEvidence = [
        { id: 'ab', fromStopId: 'a', toStopId: 'b', runtimeMinutes: 5, source: 'gtfs', pathFingerprint: 'ab' },
        { id: 'bc', fromStopId: 'b', toStopId: 'c', runtimeMinutes: 6, source: 'mapbox', pathFingerprint: 'bc' },
    ];
    pattern.runtimeOverrides = {
        'a->b': { runtimeMinutes: 7, confirmed: true, pathFingerprint: 'ab', updatedAt: now },
        'b->c': { runtimeMinutes: 8, confirmed: true, pathFingerprint: 'bc', updatedAt: now },
    };
    return pattern;
}

describe('Route Concept Planner authoring invalidation', () => {
    it('moving a stop invalidates only adjacent automatic evidence and retains unconfirmed overrides', () => {
        const updated = moveRouteConceptStop(threeStopPattern(), 'a', { lat: 45, lng: -80 }, now);

        expect(updated.runtimeEvidence.map((item) => item.id)).toEqual(['bc']);
        expect(updated.segmentFingerprints).toEqual({ 'b->c': 'bc' });
        expect(updated.runtimeOverrides['a->b']).toMatchObject({ runtimeMinutes: 7, confirmed: false });
        expect(updated.runtimeOverrides['b->c']).toMatchObject({ runtimeMinutes: 8, confirmed: true });
    });

    it('adding a stop invalidates the replaced adjacency while preserving unrelated evidence', () => {
        const updated = addRouteConceptStop(
            threeStopPattern(),
            { id: 'x', name: 'X', lat: 44.15, lng: -79.15 },
            { index: 1, now },
        );

        expect(updated.stops.map((item) => item.id)).toEqual(['a', 'x', 'b', 'c']);
        expect(updated.runtimeEvidence.map((item) => item.id)).toEqual(['bc']);
        expect(updated.runtimeOverrides['a->b']?.confirmed).toBe(false);
        expect(updated.runtimeOverrides['b->c']?.confirmed).toBe(true);
        expect(updated.stops.map((item) => item.role)).toEqual(['start-terminal', 'regular', 'regular', 'end-terminal']);
    });

    it('deleting and reordering stops keep terminal roles valid', () => {
        let updated = deleteRouteConceptStop(threeStopPattern(), 'c', now);
        expect(updated.stops.map((item) => [item.id, item.role])).toEqual([
            ['a', 'start-terminal'],
            ['b', 'end-terminal'],
        ]);

        updated = reorderRouteConceptStop(updated, 'b', 0, now);
        expect(updated.stops.map((item) => [item.id, item.role])).toEqual([
            ['b', 'start-terminal'],
            ['a', 'end-terminal'],
        ]);
    });

    it('moving an alignment point invalidates only its stop-to-stop segment', () => {
        let pattern = addRouteConceptAlignmentPoint(
            threeStopPattern(),
            { id: 'bend', lat: 44.15, lng: -79.15, afterStopId: 'a', beforeStopId: 'b' },
            now,
        );
        // Restore evidence to prove the subsequent move has the same bounded invalidation.
        pattern = mergeRouteConceptRuntimeEvidence(pattern, [
            { id: 'ab-new', fromStopId: 'a', toStopId: 'b', runtimeMinutes: 5, source: 'mapbox' },
        ], now);
        pattern = moveRouteConceptAlignmentPoint(pattern, 'bend', { lat: 44.16, lng: -79.16 }, now);

        expect(pattern.runtimeEvidence.map((item) => item.id)).toEqual(['bc']);
        expect(pattern.runtimeOverrides['a->b']?.confirmed).toBe(false);
        expect(pattern.runtimeOverrides['b->c']?.confirmed).toBe(true);
    });
});

describe('Route Concept Planner runtime authoring', () => {
    it('sets, confirms, and clears planner overrides without removing automatic evidence', () => {
        let pattern = threeStopPattern();
        pattern = setRouteConceptRuntimeOverride(pattern, 'a->b', 9, { notes: 'Field check', now });
        expect(pattern.runtimeOverrides['a->b']).toEqual({
            runtimeMinutes: 9,
            confirmed: true,
            pathFingerprint: 'ab',
            notes: 'Field check',
            updatedAt: now,
        });
        expect(pattern.runtimeEvidence).toHaveLength(2);

        pattern = clearRouteConceptRuntimeOverride(pattern, 'a->b', now);
        expect(pattern.runtimeOverrides['a->b']).toBeUndefined();
        expect(pattern.runtimeEvidence).toHaveLength(2);
    });

    it('merges recalculated evidence by stable evidence ID', () => {
        const pattern = mergeRouteConceptRuntimeEvidence(threeStopPattern(), [
            { id: 'ab', fromStopId: 'a', toStopId: 'b', runtimeMinutes: 9, source: 'mapbox', pathFingerprint: 'ab-new' },
        ], now);
        expect(pattern.runtimeEvidence).toHaveLength(2);
        expect(pattern.runtimeEvidence.find((item) => item.id === 'ab')).toMatchObject({ runtimeMinutes: 9, source: 'mapbox' });
        expect(pattern.segmentFingerprints?.['a->b']).toBe('ab-new');
    });
});
