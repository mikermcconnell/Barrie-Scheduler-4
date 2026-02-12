import { describe, expect, it } from 'vitest';
import { aggregateTransitAppData } from '../utils/transit-app/transitAppAggregator';
import type { TransitAppFileStats, TransitAppParsedData, TransitAppTripLegRow } from '../utils/transit-app/transitAppTypes';

const baseStats: TransitAppFileStats = {
    totalFiles: 0,
    dateRange: { start: '2025-01-01', end: '2025-09-30' },
    filesByType: {
        lines: 0,
        trips: 0,
        locations: 0,
        go_trip_legs: 0,
        planned_go_trip_legs: 0,
        tapped_trip_view_legs: 0,
        users: 0,
    },
    rowsParsed: 0,
    rowsSkipped: 0,
};

function makeLeg(params: {
    userTripId: string;
    serviceName: string;
    route: string;
    startTime: string;
    endTime: string;
    startStop: string;
    endStop: string;
    startLat?: number;
    startLon?: number;
    endLat?: number;
    endLon?: number;
}): TransitAppTripLegRow {
    return {
        user_trip_id: params.userTripId,
        start_time: params.startTime,
        end_time: params.endTime,
        start_longitude: params.startLon ?? -79.69,
        start_latitude: params.startLat ?? 44.38,
        end_longitude: params.endLon ?? -79.69,
        end_latitude: params.endLat ?? 44.38,
        service_name: params.serviceName,
        route_short_name: params.route,
        mode: 'Transit',
        start_stop_name: params.startStop,
        end_stop_name: params.endStop,
    };
}

describe('aggregateTransitAppData transfer analysis', () => {
    it('builds UC3 transfer matrix dimensions and GO-linked summaries', () => {
        const parsed: TransitAppParsedData = {
            lines: [],
            trips: [],
            locations: [],
            goTripLegs: [
                // Duplicate of tapped itinerary, should dedupe within chain.
                makeLeg({
                    userTripId: 'trip-1',
                    serviceName: 'Barrie Transit',
                    route: '101',
                    startTime: '2025-01-08 08:00:00 UTC',
                    endTime: '2025-01-08 08:10:00 UTC',
                    startStop: 'Georgian College',
                    endStop: 'Downtown Hub',
                    endLat: 44.387753,
                    endLon: -79.690237,
                }),
                makeLeg({
                    userTripId: 'trip-1',
                    serviceName: 'Barrie Transit',
                    route: '400',
                    startTime: '2025-01-08 08:14:00 UTC',
                    endTime: '2025-01-08 08:32:00 UTC',
                    startStop: 'Downtown Hub',
                    endStop: 'Georgian Mall',
                }),
            ],
            plannedTripLegs: [],
            tappedTripLegs: [
                makeLeg({
                    userTripId: 'trip-1',
                    serviceName: 'Barrie Transit',
                    route: '101',
                    startTime: '2025-01-08 08:00:00 UTC',
                    endTime: '2025-01-08 08:10:00 UTC',
                    startStop: 'Georgian College',
                    endStop: 'Downtown Hub',
                    endLat: 44.387753,
                    endLon: -79.690237,
                }),
                makeLeg({
                    userTripId: 'trip-1',
                    serviceName: 'Barrie Transit',
                    route: '400',
                    startTime: '2025-01-08 08:14:00 UTC',
                    endTime: '2025-01-08 08:32:00 UTC',
                    startStop: 'Downtown Hub',
                    endStop: 'Georgian Mall',
                }),
                makeLeg({
                    userTripId: 'trip-2',
                    serviceName: 'Barrie Transit',
                    route: '8A',
                    startTime: '2025-01-08 16:45:00 UTC',
                    endTime: '2025-01-08 17:00:00 UTC',
                    startStop: 'Downtown Hub',
                    endStop: 'Barrie South GO Station',
                    endLat: 44.35185862,
                    endLon: -79.62838858,
                }),
                makeLeg({
                    userTripId: 'trip-2',
                    serviceName: 'GO Transit',
                    route: 'BR',
                    startTime: '2025-01-08 17:06:00 UTC',
                    endTime: '2025-01-08 18:05:00 UTC',
                    startStop: 'Barrie South GO Station',
                    endStop: 'Union Station Bus Terminal',
                }),
            ],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const transferAnalysis = summary.transferAnalysis;
        expect(transferAnalysis).toBeDefined();
        expect(transferAnalysis?.totals.transferEvents).toBe(2);
        expect(transferAnalysis?.totals.goLinkedTransferEvents).toBe(1);

        const barrieRow = transferAnalysis?.volumeMatrix.find(row => row.fromRoute === '101' && row.toRoute === '400');
        expect(barrieRow).toBeDefined();
        expect(barrieRow?.timeBand).toBe('am_peak');
        expect(barrieRow?.dayType).toBe('weekday');
        expect(barrieRow?.season).toBe('jan');
        expect(barrieRow?.transferType).toBe('barrie_to_barrie');
        expect(barrieRow?.fromRouteId).toBe('101');
        expect(barrieRow?.toRouteId).toBe('400');
        expect(barrieRow?.transferStopId).toBeTruthy();

        const goRow = transferAnalysis?.goLinkedSummary.find(row => row.fromRoute === '8A' && row.toRoute === 'BR');
        expect(goRow).toBeDefined();
        expect(goRow?.timeBand).toBe('pm_peak');
        expect(goRow?.transferType).toBe('barrie_to_go');

        const goTarget = transferAnalysis?.connectionTargets.find(target => target.fromRoute === '8A' && target.toRoute === 'BR');
        expect(goTarget).toBeDefined();
        expect(goTarget?.priorityTier).toBe('high');
        expect(goTarget?.goLinked).toBe(true);
        expect(goTarget?.fromTripAnchors?.[0]?.timeLabel).toBe('17:00');
        expect(goTarget?.toTripAnchors?.[0]?.timeLabel).toBe('17:06');

        expect(summary.transferPatterns.length).toBeGreaterThan(0);
        const legacyPattern = summary.transferPatterns.find(tp => tp.fromRoute === '8A' && tp.toRoute === 'BR');
        expect(legacyPattern?.fromTripAnchors?.[0]?.timeLabel).toBe('17:00');
        expect(legacyPattern?.toTripAnchors?.[0]?.timeLabel).toBe('17:06');
    });

    it('deduplicates repeated itinerary checks across duplicate chains', () => {
        const repeatedChain: TransitAppTripLegRow[] = [
            makeLeg({
                userTripId: 'chain-a',
                serviceName: 'Barrie Transit',
                route: '101',
                startTime: '2025-07-10 07:00:00 UTC',
                endTime: '2025-07-10 07:12:00 UTC',
                startStop: 'Georgian College',
                endStop: 'Downtown Hub',
            }),
            makeLeg({
                userTripId: 'chain-a',
                serviceName: 'Barrie Transit',
                route: '400',
                startTime: '2025-07-10 07:16:00 UTC',
                endTime: '2025-07-10 07:32:00 UTC',
                startStop: 'Downtown Hub',
                endStop: 'Georgian Mall',
            }),
        ];

        const duplicateChain: TransitAppTripLegRow[] = [
            makeLeg({
                userTripId: 'chain-b',
                serviceName: 'Barrie Transit',
                route: '101',
                startTime: '2025-07-10 07:00:00 UTC',
                endTime: '2025-07-10 07:12:00 UTC',
                startStop: 'Georgian College',
                endStop: 'Downtown Hub',
            }),
            makeLeg({
                userTripId: 'chain-b',
                serviceName: 'Barrie Transit',
                route: '400',
                startTime: '2025-07-10 07:16:00 UTC',
                endTime: '2025-07-10 07:32:00 UTC',
                startStop: 'Downtown Hub',
                endStop: 'Georgian Mall',
            }),
        ];

        const parsed: TransitAppParsedData = {
            lines: [],
            trips: [],
            locations: [],
            goTripLegs: [...repeatedChain, ...duplicateChain],
            plannedTripLegs: [],
            tappedTripLegs: [],
            users: [],
        };

        const summary = aggregateTransitAppData(parsed, baseStats, 'tester');
        const transferAnalysis = summary.transferAnalysis;
        expect(transferAnalysis).toBeDefined();
        expect(transferAnalysis?.totals.tripChainsProcessed).toBe(2);
        expect(transferAnalysis?.totals.tripChainsDeduplicated).toBe(1);
        expect(transferAnalysis?.totals.transferEvents).toBe(1);
    });
});
