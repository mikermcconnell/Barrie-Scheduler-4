import { describe, expect, it } from 'vitest';
import {
    buildRouteConceptGtfsImportOptions,
    convertRouteConceptGtfsSelections,
    type RouteConceptGtfsPatternCandidate,
} from '../utils/route-concept-planner/routeConceptPlannerGtfsAdapter';
import { estimateRouteConceptPatternRoadRuntimes } from '../utils/route-concept-planner/routeConceptPlannerEngineAdapter';

const NOW = '2026-07-16T12:00:00.000Z';

function candidate(overrides: Partial<RouteConceptGtfsPatternCandidate> = {}): RouteConceptGtfsPatternCandidate {
    return {
        id: 'route-1-weekday-outbound',
        routeId: 'route-1',
        routeShortName: '1',
        routeLongName: 'Route 1',
        serviceId: 'weekday-service',
        dayType: 'weekday',
        dayTypeLabel: 'Weekday',
        directionId: 0,
        tripHeadsign: 'Downtown',
        shapeId: 'shape-outbound',
        tripCount: 20,
        firstDepartureMinutes: 360,
        lastDepartureMinutes: 1500,
        medianHeadwayMinutes: 30,
        blockCount: 3,
        scheduledRuntimes: [{
            planningPeriod: 'all-day',
            sampleSize: 20,
            segmentRuntimeMinutes: [7, 8],
            totalRuntimeMinutes: 15,
        }],
        stops: [
            { id: 'gtfs-a-1', gtfsStopId: 'a', stopCode: '1001', name: 'Alpha', lat: 44.37, lng: -79.70, sequence: 1, departureMinutes: 360 },
            { id: 'gtfs-b-2', gtfsStopId: 'b', stopCode: '1002', name: 'Bravo', lat: 44.38, lng: -79.69, sequence: 2, arrivalMinutes: 367, departureMinutes: 367 },
            { id: 'gtfs-c-3', gtfsStopId: 'c', stopCode: '1003', name: 'Charlie', lat: 44.39, lng: -79.68, sequence: 3, arrivalMinutes: 375 },
        ],
        shapePoints: [
            { lat: 44.37, lng: -79.70, sequence: 1 },
            { lat: 44.375, lng: -79.695, sequence: 2 },
            { lat: 44.38, lng: -79.69, sequence: 3 },
            { lat: 44.385, lng: -79.685, sequence: 4 },
            { lat: 44.39, lng: -79.68, sequence: 5 },
        ],
        feedVersion: '2026-07-01',
        ...overrides,
    };
}

function inboundCandidate(): RouteConceptGtfsPatternCandidate {
    return candidate({
        id: 'route-1-weekday-inbound',
        directionId: 1,
        tripHeadsign: 'Park Place',
        shapeId: 'shape-inbound',
        firstDepartureMinutes: 390,
        lastDepartureMinutes: 1530,
        scheduledRuntimes: [{
            planningPeriod: 'all-day',
            sampleSize: 18,
            segmentRuntimeMinutes: [9, 6],
            totalRuntimeMinutes: 15,
        }],
        stops: [
            { id: 'gtfs-c-1', gtfsStopId: 'c', stopCode: '1003', name: 'Charlie', lat: 44.39, lng: -79.68, sequence: 1, departureMinutes: 390 },
            { id: 'gtfs-b-2', gtfsStopId: 'b', stopCode: '1002', name: 'Bravo', lat: 44.38, lng: -79.69, sequence: 2, arrivalMinutes: 399, departureMinutes: 399 },
            { id: 'gtfs-a-3', gtfsStopId: 'a', stopCode: '1001', name: 'Alpha', lat: 44.37, lng: -79.70, sequence: 3, arrivalMinutes: 405 },
        ],
        shapePoints: [
            { lat: 44.39, lng: -79.68, sequence: 1 },
            { lat: 44.385, lng: -79.685, sequence: 2 },
            { lat: 44.38, lng: -79.69, sequence: 3 },
            { lat: 44.375, lng: -79.695, sequence: 4 },
            { lat: 44.37, lng: -79.70, sequence: 5 },
        ],
    });
}

describe('Route Concept Planner GTFS adapter', () => {
    it('groups selected directions into a bidirectional alternative with current scheduled evidence', () => {
        const [alternative] = convertRouteConceptGtfsSelections(
            [inboundCandidate(), candidate()],
            { now: NOW },
        );

        expect(alternative).toMatchObject({
            name: 'Route 1 — Weekday',
            structure: 'bidirectional',
            service: {
                firstDepartureMinutes: 360,
                lastDepartureMinutes: 1530,
                dayType: 'weekday',
                planningPeriod: 'all-day',
            },
        });
        expect(alternative?.patterns.map((pattern) => pattern.role)).toEqual(['outbound', 'inbound']);

        for (const pattern of alternative?.patterns ?? []) {
            expect(pattern.source).toMatchObject({
                type: 'gtfs',
                serviceId: 'weekday-service',
                feedVersion: '2026-07-01',
                importedAt: NOW,
            });
            expect(pattern.runtimeEvidence).toHaveLength(2);
            for (const evidence of pattern.runtimeEvidence) {
                const key = `${evidence.fromStopId}->${evidence.toStopId}`;
                expect(evidence).toMatchObject({
                    source: 'gtfs',
                    dayType: 'weekday',
                    planningPeriod: 'all-day',
                    updatedAt: NOW,
                });
                expect(evidence.pathFingerprint).toBe(pattern.segmentFingerprints?.[key]);
                expect(evidence.pathFingerprint).not.toBe('');
            }
        }
    });

    it('converts one closed GTFS pattern to one complete loop without doubling the endpoint', () => {
        const loop = candidate({
            id: 'route-10-loop',
            routeId: 'route-10',
            routeShortName: '10',
            tripHeadsign: 'Clockwise Loop',
            shapeId: 'shape-loop',
            scheduledRuntimes: [{
                planningPeriod: 'all-day',
                sampleSize: 16,
                segmentRuntimeMinutes: [5, 6, 7],
                totalRuntimeMinutes: 18,
            }],
            stops: [
                { id: 'loop-a-1', gtfsStopId: 'a', name: 'Terminal', lat: 44.37, lng: -79.70, sequence: 1 },
                { id: 'loop-b-2', gtfsStopId: 'b', name: 'North', lat: 44.39, lng: -79.69, sequence: 2 },
                { id: 'loop-c-3', gtfsStopId: 'c', name: 'East', lat: 44.38, lng: -79.67, sequence: 3 },
                { id: 'loop-a-4', gtfsStopId: 'a', name: 'Terminal', lat: 44.37, lng: -79.70, sequence: 4 },
            ],
            shapePoints: [
                { lat: 44.37, lng: -79.70, sequence: 1 },
                { lat: 44.39, lng: -79.69, sequence: 2 },
                { lat: 44.38, lng: -79.67, sequence: 3 },
                { lat: 44.37, lng: -79.70, sequence: 4 },
            ],
        });

        const [alternative] = convertRouteConceptGtfsSelections([loop], { now: NOW });
        const pattern = alternative?.patterns[0];

        expect(alternative?.structure).toBe('loop');
        expect(pattern?.role).toBe('loop');
        expect(pattern?.stops).toHaveLength(3);
        expect(pattern?.runtimeEvidence).toHaveLength(3);
        const closingEvidence = pattern?.runtimeEvidence.find((evidence) => (
            evidence.fromStopId === pattern.stops[2]?.id
            && evidence.toStopId === pattern.stops[0]?.id
        ));
        expect(closingEvidence?.runtimeMinutes).toBe(7);
        expect(closingEvidence?.pathFingerprint).toBe(
            pattern?.segmentFingerprints?.[`${pattern.stops[2]?.id}->${pattern.stops[0]?.id}`],
        );
    });

    it('keeps a one-direction linear selection incomplete instead of inventing a return', () => {
        const [alternative] = convertRouteConceptGtfsSelections([candidate()], { now: NOW });

        expect(alternative?.structure).toBe('bidirectional');
        expect(alternative?.patterns.map((pattern) => pattern.role)).toEqual(['outbound']);
        expect(alternative?.patterns.some((pattern) => pattern.role === 'inbound')).toBe(false);
    });

    it('groups Barrie 2A and 2B as one complete Route 2 alternative', () => {
        const route2a = candidate({
            id: 'route-2a-out',
            routeId: '2A',
            routeShortName: '2A',
            directionId: 0,
            routeFamily: {
                key: 'barrie-merged-2',
                name: 'Route 2',
                shortName: '2',
                memberShortName: '2A',
                directionRole: 'out',
                directionLabel: 'Out',
            },
        });
        const route2b = inboundCandidate();
        route2b.id = 'route-2b-back';
        route2b.routeId = '2B';
        route2b.routeShortName = '2B';
        route2b.routeFamily = {
            key: 'barrie-merged-2',
            name: 'Route 2',
            shortName: '2',
            memberShortName: '2B',
            directionRole: 'back',
            directionLabel: 'Back',
        };

        const alternatives = convertRouteConceptGtfsSelections([route2a, route2b], { now: NOW });

        expect(alternatives).toHaveLength(1);
        expect(alternatives[0]?.name).toBe('Route 2 — Weekday');
        expect(alternatives[0]?.patterns.map((pattern) => pattern.source?.routeShortName)).toEqual(['2A', '2B']);
    });

    it('shows one route option and collapses duplicate service IDs with the same alignment', () => {
        const outbound = candidate();
        const inbound = inboundCandidate();
        const duplicateOutbound = candidate({
            id: 'route-1-special-service-outbound',
            serviceId: 'uuid-special-service',
            dayTypeLabel: 'uuid-special-service',
            tripCount: 30,
        });
        const duplicateInbound = inboundCandidate();
        duplicateInbound.id = 'route-1-special-service-inbound';
        duplicateInbound.serviceId = 'uuid-special-service';
        duplicateInbound.dayTypeLabel = 'uuid-special-service';
        duplicateInbound.tripCount = 30;

        const options = buildRouteConceptGtfsImportOptions(
            [duplicateOutbound, duplicateInbound, outbound, inbound],
            'weekday',
        );

        expect(options).toHaveLength(1);
        expect(options[0]).toMatchObject({
            routeLabel: 'Route 1',
            complete: true,
        });
        expect(options[0]?.directions).toHaveLength(2);
        expect(options[0]?.directions.map((direction) => direction.variants.length)).toEqual([1, 1]);
        expect(options[0]?.directions.map((direction) => direction.recommendedPatternId)).toEqual([
            outbound.id,
            inbound.id,
        ]);
    });

    it('keeps genuinely different stop alignments available for optional review', () => {
        const alternate = candidate({
            id: 'route-1-outbound-via-hospital',
            tripCount: 12,
            stops: [
                { id: 'gtfs-a-1', gtfsStopId: 'a', name: 'Alpha', lat: 44.37, lng: -79.70, sequence: 1 },
                { id: 'gtfs-h-2', gtfsStopId: 'hospital', name: 'Hospital', lat: 44.38, lng: -79.67, sequence: 2 },
                { id: 'gtfs-c-3', gtfsStopId: 'c', name: 'Charlie', lat: 44.39, lng: -79.68, sequence: 3 },
            ],
        });

        const [option] = buildRouteConceptGtfsImportOptions([candidate(), alternate, inboundCandidate()], 'weekday');
        const outbound = option?.directions.find((direction) => direction.role === 'outbound');

        expect(outbound?.variants).toHaveLength(2);
        expect(outbound?.recommendedPatternId).toBe('route-1-weekday-outbound');
    });

    it('allows several route groups and never introduces Camp or rider-manifest fields', () => {
        const route3 = candidate({
            id: 'route-3-out',
            routeId: 'route-3',
            routeShortName: '3',
        });
        const alternatives = convertRouteConceptGtfsSelections(
            [candidate(), inboundCandidate(), route3],
            { now: NOW },
        );

        expect(alternatives).toHaveLength(2);
        const serialized = JSON.stringify(alternatives).toLowerCase();
        expect(serialized).not.toContain('camper');
        expect(serialized).not.toContain('ridercount');
        expect(serialized).not.toContain('sourcerows');
        expect(serialized).not.toContain('address');
    });

    it('exposes road-time fallback evidence through the neutral engine adapter', async () => {
        const [alternative] = convertRouteConceptGtfsSelections([candidate()], { now: NOW });
        const pattern = alternative!.patterns[0]!;

        const result = await estimateRouteConceptPatternRoadRuntimes(pattern, {
            token: null,
            now: NOW,
        });

        expect(result.source).toBe('fallback');
        expect(result.segmentGeometries).toHaveLength(2);
        expect(result.runtimeEvidence).toHaveLength(2);
        expect(result.runtimeEvidence.every((evidence) => evidence.source === 'fallback')).toBe(true);
        result.runtimeEvidence.forEach((evidence) => {
            expect(evidence.pathFingerprint).toBe(
                pattern.segmentFingerprints?.[`${evidence.fromStopId}->${evidence.toStopId}`],
            );
        });
    });
});
