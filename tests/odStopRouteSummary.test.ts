import { describe, expect, it } from 'vitest';
import { buildStopRouteSummaryRows, getRoutePathLabel, getViaStopsLabel } from '../utils/od-matrix/odStopRouteSummary';
import type { ODRouteEstimationResult } from '../utils/od-matrix/odRouteEstimation';

const routeEstimation: ODRouteEstimationResult = {
    matches: [
        {
            origin: 'Barrie',
            destination: 'Sudbury',
            journeys: 42,
            routeId: '100+200',
            routeShortName: '100',
            routeLongName: 'Barrie Connector → Sudbury Connector',
            intermediateStops: 8,
            confidence: 'high',
            candidateCount: 1,
            transfer: {
                viaStop: 'North Bay',
                leg1RouteId: '100',
                leg1RouteName: 'Barrie Connector',
                leg1Stops: 4,
                leg2RouteId: '200',
                leg2RouteName: 'Sudbury Connector',
                leg2Stops: 4,
                transferStops: ['North Bay'],
                legs: [
                    {
                        routeId: '100',
                        routeName: 'Barrie Connector',
                        boardStop: 'Barrie',
                        alightStop: 'North Bay',
                        intermediateStops: 4,
                    },
                    {
                        routeId: '200',
                        routeName: 'Sudbury Connector',
                        boardStop: 'North Bay',
                        alightStop: 'Sudbury',
                        intermediateStops: 4,
                    },
                ],
            },
        },
        {
            origin: 'Toronto',
            destination: 'Sudbury',
            journeys: 18,
            routeId: '88',
            routeShortName: '88',
            routeLongName: 'Toronto to Sudbury',
            intermediateStops: 5,
            confidence: 'medium',
            candidateCount: 2,
        },
        {
            origin: 'Timmins',
            destination: 'Sudbury',
            journeys: 7,
            routeId: null,
            routeShortName: null,
            routeLongName: null,
            intermediateStops: 0,
            confidence: 'none',
            candidateCount: 0,
        },
    ],
    routeDistribution: [],
    unmatchedPairs: [],
    stationMatchReport: [],
    totalMatched: 2,
    totalUnmatched: 1,
    unmatchedStationPairs: 0,
    unmatchedRoutePairs: 1,
    matchedJourneys: 60,
    totalJourneys: 67,
};

describe('odStopRouteSummary', () => {
    it('formats direct and transfer route labels', () => {
        expect(getRoutePathLabel(routeEstimation.matches[0])).toBe('Barrie Connector → Sudbury Connector');
        expect(getViaStopsLabel(routeEstimation.matches[0])).toBe('North Bay');
        expect(getRoutePathLabel(routeEstimation.matches[1])).toBe('88 - Toronto to Sudbury');
        expect(getViaStopsLabel(routeEstimation.matches[1])).toBe('');
    });

    it('builds stop-focused rows with route chains and shares', () => {
        const rows = buildStopRouteSummaryRows({
            isolatedStation: 'Sudbury',
            pairs: [
                { origin: 'Barrie', destination: 'Sudbury', journeys: 42 },
                { origin: 'Toronto', destination: 'Sudbury', journeys: 18 },
                { origin: 'Timmins', destination: 'Sudbury', journeys: 7 },
            ],
            minJourneys: 1,
            routeEstimation,
        });

        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            direction: 'Inbound',
            counterpart: 'Barrie',
            routePath: 'Barrie Connector → Sudbury Connector',
            viaStops: 'North Bay',
            journeys: 42,
            confidence: 'high',
        });
        expect(rows[1]).toMatchObject({
            counterpart: 'Toronto',
            routePath: '88 - Toronto to Sudbury',
            confidence: 'medium',
        });
        expect(rows[2]).toMatchObject({
            counterpart: 'Timmins',
            routePath: '',
            confidence: 'none',
        });
        expect(rows[0].stopShare).toBeCloseTo((42 / 67) * 100, 4);
    });

    it('marks rows as loading until route estimation arrives', () => {
        const rows = buildStopRouteSummaryRows({
            isolatedStation: 'Sudbury',
            pairs: [
                { origin: 'Barrie', destination: 'Sudbury', journeys: 42 },
            ],
            minJourneys: 1,
            routeEstimation: null,
            routeEstimationLoading: true,
        });

        expect(rows[0]).toMatchObject({
            routePath: '',
            viaStops: '',
            confidence: 'loading',
        });
    });

    it('applies the direction filter to stop-focused rows', () => {
        const rows = buildStopRouteSummaryRows({
            isolatedStation: 'Sudbury',
            pairs: [
                { origin: 'Barrie', destination: 'Sudbury', journeys: 42 },
                { origin: 'Sudbury', destination: 'Barrie', journeys: 12 },
            ],
            minJourneys: 1,
            directionFilter: 'outbound',
            routeEstimation,
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            direction: 'Outbound',
            counterpart: 'Barrie',
            journeys: 12,
        });
    });
});
