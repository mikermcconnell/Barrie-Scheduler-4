import { describe, expect, it } from 'vitest';
import type { TransitAppDataSummary } from '../utils/transit-app/transitAppTypes';
import type { SavedNetworkConnectionRecommendation } from '../utils/network-connections/networkConnectionRecommendationStore';
import {
    buildSavedActionsCsv,
    buildSavedActionsMarkdown,
    summarizeObservedSignalForSavedRecommendation,
} from '../utils/network-connections/networkConnectionObservedSignals';

function buildTransitData(): TransitAppDataSummary {
    return {
        schemaVersion: 1,
        routeMetrics: { daily: [], summary: [] },
        tripDistribution: { hourly: [], daily: [] },
        locationDensity: {
            cells: [],
            bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
            totalPoints: 0,
        },
        transferPatterns: [],
        transferAnalysis: {
            schemaVersion: 1,
            totals: {
                tripChainsProcessed: 0,
                tripChainsDeduplicated: 0,
                transferEvents: 0,
                goLinkedTransferEvents: 0,
                uniqueRoutePairs: 0,
                uniqueTransferStops: 0,
            },
            normalization: {
                routeReferencesMatched: 0,
                routeReferencesTotal: 0,
                routeMatchRate: 0,
                stopReferencesMatched: 0,
                stopReferencesTotal: 0,
                stopMatchRate: 0,
            },
            volumeMatrix: [],
            topTransferPairs: [{
                fromRoute: ' 1 ',
                toRoute: '2',
                fromRouteId: '1',
                toRouteId: '2',
                transferStopName: 'Downtown Terminal',
                transferStopId: '100',
                transferStopCode: '100',
                transferType: 'barrie_to_barrie',
                totalCount: 180,
                avgWaitMinutes: 6,
                dominantTimeBands: ['am_peak', 'pm_peak'],
            }],
            goLinkedSummary: [],
            connectionTargets: [{
                fromRoute: '1',
                toRoute: ' 2 ',
                fromRouteId: '1',
                toRouteId: '2',
                locationStopName: 'Downtown Terminal',
                locationStopId: '100',
                locationStopCode: '100',
                timeBands: ['am_peak', 'pm_peak'],
                totalTransfers: 180,
                priorityTier: 'high',
                goLinked: false,
            }],
        },
        routeLegs: [],
        appUsage: [],
        metadata: {
            importedAt: new Date('2026-03-11T12:00:00Z').toISOString(),
            importedBy: 'test',
            dateRange: { start: '2026-01-01', end: '2026-01-31' },
            fileStats: {
                totalFiles: 0,
                dateRange: null,
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
            },
        },
    };
}

function buildSavedRecommendation(): SavedNetworkConnectionRecommendation {
    return {
        id: 'weekday|am_peak|pattern-a|retime-a',
        teamId: 'team-1',
        status: 'new',
        dayType: 'Weekday',
        timeBand: 'am_peak',
        hubId: 'hub-a',
        hubName: 'Downtown Terminal',
        hubStopNames: ['Downtown Terminal', 'Bayfield Street'],
        hubSeverity: 'weak',
        routeNumbers: ['1', '2'],
        patternId: 'pattern-a',
        patternLabel: '1 North -> 2 South',
        patternSeverity: 'weak',
        recommendationId: 'retime-a',
        recommendationType: 'retime',
        recommendationTitle: 'Small retime candidate',
        recommendationSummary: 'A minor schedule shift is likely worth testing here.',
        recommendationRationale: 'Misses cluster within a narrow window.',
        fromRouteNumber: '1',
        toRouteNumber: '2',
        opportunityId: 'opp-1',
        opportunityLabel: '8:00 AM to 8:06 AM',
        createdAt: new Date('2026-03-11T12:00:00Z'),
        updatedAt: new Date('2026-03-11T12:05:00Z'),
    };
}

describe('networkConnectionObservedSignals', () => {
    it('matches a saved recommendation to observed transfer demand', () => {
        const observed = summarizeObservedSignalForSavedRecommendation(buildSavedRecommendation(), buildTransitData());

        expect(observed.hasObservedMatch).toBe(true);
        expect(observed.totalObservedTransfers).toBe(180);
        expect(observed.priorityTier).toBe('high');
        expect(observed.demandLevel).toBe('strong');
        expect(observed.matchedStopName).toBe('Downtown Terminal');
    });

    it('builds export outputs with observed metrics', () => {
        const recommendation = buildSavedRecommendation();
        const observed = summarizeObservedSignalForSavedRecommendation(recommendation, buildTransitData());

        const csv = buildSavedActionsCsv([{ recommendation, observed }]);
        const markdown = buildSavedActionsMarkdown([{ recommendation, observed }]);

        expect(csv).toContain('observed_transfers');
        expect(csv).toContain('status');
        expect(csv).toContain('"180"');
        expect(markdown).toContain('Status: new');
        expect(markdown).toContain('180 transfers, high priority, strong demand');
        expect(markdown).toContain('Small retime candidate');
    });
});
