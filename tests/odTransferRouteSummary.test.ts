import { describe, expect, it } from 'vitest';
import { buildStopRouteDirectionSummary, buildTransferRouteSummaryRows } from '../utils/od-matrix/odTransferRouteSummary';
import type { ODPairRouteMatch } from '../utils/od-matrix/odRouteEstimation';

const matches: ODPairRouteMatch[] = [
    {
        origin: 'Barrie',
        destination: 'Timmins',
        journeys: 30,
        routeId: '100+200',
        routeShortName: '100',
        routeLongName: 'Barrie Connector → Timmins Connector',
        intermediateStops: 8,
        confidence: 'high',
        candidateCount: 1,
        transfer: {
            viaStop: 'North Bay',
            leg1RouteId: '100',
            leg1RouteName: 'Barrie Connector',
            leg1Stops: 4,
            leg2RouteId: '200',
            leg2RouteName: 'Timmins Connector',
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
                    routeName: 'Timmins Connector',
                    boardStop: 'North Bay',
                    alightStop: 'Timmins',
                    intermediateStops: 4,
                },
            ],
        },
    },
    {
        origin: 'Toronto',
        destination: 'Hearst',
        journeys: 18,
        routeId: '300+400+500',
        routeShortName: '300',
        routeLongName: 'Toronto Connector → Cochrane Connector → Hearst Connector',
        intermediateStops: 12,
        confidence: 'medium',
        candidateCount: 2,
        transfer: {
            viaStop: 'Sudbury',
            leg1RouteId: '300',
            leg1RouteName: 'Toronto Connector',
            leg1Stops: 4,
            leg2RouteId: '400',
            leg2RouteName: 'Cochrane Connector',
            leg2Stops: 4,
            transferStops: ['Sudbury', 'North Bay'],
            legs: [
                {
                    routeId: '300',
                    routeName: 'Toronto Connector',
                    boardStop: 'Toronto',
                    alightStop: 'Sudbury',
                    intermediateStops: 4,
                },
                {
                    routeId: '400',
                    routeName: 'Cochrane Connector',
                    boardStop: 'Sudbury',
                    alightStop: 'North Bay',
                    intermediateStops: 4,
                },
                {
                    routeId: '500',
                    routeName: 'Hearst Connector',
                    boardStop: 'North Bay',
                    alightStop: 'Hearst',
                    intermediateStops: 4,
                },
            ],
        },
    },
    {
        origin: 'Wasaga Beach',
        destination: 'Timmins',
        journeys: 12,
        routeId: '100+200',
        routeShortName: '100',
        routeLongName: 'Wasaga Connector → Timmins Connector',
        intermediateStops: 7,
        confidence: 'high',
        candidateCount: 1,
        transfer: {
            viaStop: 'North Bay',
            leg1RouteId: '100',
            leg1RouteName: 'Barrie Connector',
            leg1Stops: 3,
            leg2RouteId: '200',
            leg2RouteName: 'Timmins Connector',
            leg2Stops: 4,
            transferStops: ['North Bay'],
            legs: [
                {
                    routeId: '100',
                    routeName: 'Barrie Connector',
                    boardStop: 'Wasaga Beach',
                    alightStop: 'North Bay',
                    intermediateStops: 3,
                },
                {
                    routeId: '200',
                    routeName: 'Timmins Connector',
                    boardStop: 'North Bay',
                    alightStop: 'Timmins',
                    intermediateStops: 4,
                },
            ],
        },
    },
];

describe('odTransferRouteSummary', () => {
    it('builds inbound and outbound route ridership lists for the selected stop', () => {
        const summary = buildStopRouteDirectionSummary(matches, 'North Bay');

        expect(summary.inboundRoutes).toHaveLength(2);
        expect(summary.inboundRoutes[0]).toMatchObject({
            direction: 'inbound',
            routeName: 'Barrie Connector',
            endpointStopName: 'Barrie',
            endpointBreakdown: [
                { stopName: 'Barrie', journeys: 30 },
                { stopName: 'Wasaga Beach', journeys: 12 },
            ],
            journeys: 42,
            pairCount: 2,
            samplePairs: ['Barrie → Timmins', 'Wasaga Beach → Timmins'],
            counterpartRoutes: ['Timmins Connector'],
        });

        expect(summary.outboundRoutes).toHaveLength(2);
        expect(summary.outboundRoutes[0]).toMatchObject({
            direction: 'outbound',
            routeName: 'Timmins Connector',
            endpointStopName: 'Timmins',
            endpointBreakdown: [
                { stopName: 'Timmins', journeys: 42 },
            ],
            journeys: 42,
            pairCount: 2,
            samplePairs: ['Barrie → Timmins', 'Wasaga Beach → Timmins'],
            counterpartRoutes: ['Barrie Connector'],
        });
    });

    it('uses the stop-local inbound and outbound legs for earlier transfer stops', () => {
        const summary = buildStopRouteDirectionSummary(matches, 'Sudbury');

        expect(summary.inboundRoutes).toHaveLength(1);
        expect(summary.inboundRoutes[0]).toMatchObject({
            routeName: 'Toronto Connector',
            journeys: 18,
            pairCount: 1,
        });

        expect(summary.outboundRoutes).toHaveLength(1);
        expect(summary.outboundRoutes[0]).toMatchObject({
            routeName: 'Cochrane Connector',
            journeys: 18,
            pairCount: 1,
        });
    });

    it('aggregates local route-to-route transfers at the selected stop', () => {
        const rows = buildTransferRouteSummaryRows(matches, 'North Bay');

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            inboundRoute: 'Barrie Connector',
            outboundRoute: 'Timmins Connector',
            routeTransfer: 'Barrie Connector → Timmins Connector',
            journeys: 42,
            pairCount: 2,
            samplePairs: ['Barrie → Timmins', 'Wasaga Beach → Timmins'],
        });
        expect(rows[0].routePaths).toContain('Barrie Connector → Timmins Connector');

        expect(rows[1]).toMatchObject({
            inboundRoute: 'Cochrane Connector',
            outboundRoute: 'Hearst Connector',
            routeTransfer: 'Cochrane Connector → Hearst Connector',
            journeys: 18,
            pairCount: 1,
            samplePairs: ['Toronto → Hearst'],
        });
        expect(rows[1].routePaths).toContain('Toronto Connector → Cochrane Connector → Hearst Connector');
    });

    it('uses the stop-local leg pair for earlier transfer stops in longer chains', () => {
        const rows = buildTransferRouteSummaryRows(matches, 'Sudbury');

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            inboundRoute: 'Toronto Connector',
            outboundRoute: 'Cochrane Connector',
            journeys: 18,
            pairCount: 1,
        });
    });

    it('returns no rows when no transfer uses the selected stop', () => {
        expect(buildTransferRouteSummaryRows(matches, 'Thunder Bay')).toEqual([]);
        expect(buildStopRouteDirectionSummary(matches, 'Thunder Bay')).toEqual({
            inboundRoutes: [],
            outboundRoutes: [],
        });
    });
});
