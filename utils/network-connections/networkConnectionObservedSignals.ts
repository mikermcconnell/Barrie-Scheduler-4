import type {
    SavedNetworkConnectionRecommendation,
} from './networkConnectionRecommendationStore';
import type { NetworkConnectionPattern, NetworkConnectionTimeBand } from './networkConnectionTypes';
import type {
    TransferConnectionTargetCandidate,
    TransferPairSummary,
    TransferPriorityTier,
    TransferTimeBand,
    TransitAppDataSummary,
} from '../transit-app/transitAppTypes';

export type ObservedDemandLevel = 'none' | 'light' | 'moderate' | 'strong';

export interface NetworkConnectionObservedSignal {
    totalObservedTransfers: number;
    avgObservedWaitMinutes: number | null;
    matchedStopName: string | null;
    dominantTimeBands: TransferTimeBand[];
    priorityTier: TransferPriorityTier | 'none';
    demandLevel: ObservedDemandLevel;
    goLinked: boolean;
    hasObservedMatch: boolean;
}

interface ObservedSignalInput {
    fromRouteNumber: string;
    toRouteNumber: string;
    timeBand: NetworkConnectionTimeBand;
    hubName?: string | null;
    hubStopNames?: string[];
}

function canonical(value: string | null | undefined): string {
    return (value ?? '')
        .trim()
        .toUpperCase()
        .replace(/&/g, ' AND ')
        .replace(/[^A-Z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ');
}

function canonicalRoute(value: string | null | undefined): string {
    return canonical(value).replace(/\s+/g, '');
}

function matchesTimeBand(
    networkTimeBand: NetworkConnectionTimeBand,
    observedBands: TransferTimeBand[],
): boolean {
    if (networkTimeBand === 'full_day') return true;
    return observedBands.includes(networkTimeBand as TransferTimeBand);
}

function scoreStopMatch(stopName: string, hubNames: string[]): number {
    const candidate = canonical(stopName);
    if (!candidate) return 0;

    let best = 0;
    for (const hubName of hubNames) {
        const normalizedHub = canonical(hubName);
        if (!normalizedHub) continue;
        if (candidate === normalizedHub) return 2;
        if (candidate.includes(normalizedHub) || normalizedHub.includes(candidate)) {
            best = Math.max(best, 1);
        }
    }
    return best;
}

function findBestTransferPair(
    input: ObservedSignalInput,
    topTransferPairs: TransferPairSummary[],
): TransferPairSummary | null {
    const fromRoute = canonicalRoute(input.fromRouteNumber);
    const toRoute = canonicalRoute(input.toRouteNumber);
    const routeMatches = topTransferPairs.filter((pair) =>
        canonicalRoute(pair.fromRoute) === fromRoute && canonicalRoute(pair.toRoute) === toRoute,
    );
    if (routeMatches.length === 0) return null;

    const hubNames = [input.hubName ?? '', ...(input.hubStopNames ?? [])];

    return [...routeMatches].sort((left, right) => {
        const leftStopScore = scoreStopMatch(left.transferStopName, hubNames);
        const rightStopScore = scoreStopMatch(right.transferStopName, hubNames);
        if (leftStopScore !== rightStopScore) return rightStopScore - leftStopScore;

        const leftTimeScore = matchesTimeBand(input.timeBand, left.dominantTimeBands) ? 1 : 0;
        const rightTimeScore = matchesTimeBand(input.timeBand, right.dominantTimeBands) ? 1 : 0;
        if (leftTimeScore !== rightTimeScore) return rightTimeScore - leftTimeScore;

        return right.totalCount - left.totalCount;
    })[0] ?? null;
}

function findBestConnectionTarget(
    input: ObservedSignalInput,
    connectionTargets: TransferConnectionTargetCandidate[],
): TransferConnectionTargetCandidate | null {
    const fromRoute = canonicalRoute(input.fromRouteNumber);
    const toRoute = canonicalRoute(input.toRouteNumber);
    const routeMatches = connectionTargets.filter((target) =>
        canonicalRoute(target.fromRoute) === fromRoute && canonicalRoute(target.toRoute) === toRoute,
    );
    if (routeMatches.length === 0) return null;

    const hubNames = [input.hubName ?? '', ...(input.hubStopNames ?? [])];

    return [...routeMatches].sort((left, right) => {
        const leftStopScore = scoreStopMatch(left.locationStopName, hubNames);
        const rightStopScore = scoreStopMatch(right.locationStopName, hubNames);
        if (leftStopScore !== rightStopScore) return rightStopScore - leftStopScore;

        const leftTimeScore = matchesTimeBand(input.timeBand, left.timeBands) ? 1 : 0;
        const rightTimeScore = matchesTimeBand(input.timeBand, right.timeBands) ? 1 : 0;
        if (leftTimeScore !== rightTimeScore) return rightTimeScore - leftTimeScore;

        return right.totalTransfers - left.totalTransfers;
    })[0] ?? null;
}

function deriveDemandLevel(totalObservedTransfers: number): ObservedDemandLevel {
    if (totalObservedTransfers <= 0) return 'none';
    if (totalObservedTransfers >= 150) return 'strong';
    if (totalObservedTransfers >= 50) return 'moderate';
    return 'light';
}

export function summarizeObservedSignal(
    input: ObservedSignalInput,
    transitData: TransitAppDataSummary | null | undefined,
): NetworkConnectionObservedSignal {
    const transferAnalysis = transitData?.transferAnalysis;
    if (!transferAnalysis) {
        return {
            totalObservedTransfers: 0,
            avgObservedWaitMinutes: null,
            matchedStopName: null,
            dominantTimeBands: [],
            priorityTier: 'none',
            demandLevel: 'none',
            goLinked: false,
            hasObservedMatch: false,
        };
    }

    const pair = findBestTransferPair(input, transferAnalysis.topTransferPairs);
    const target = findBestConnectionTarget(input, transferAnalysis.connectionTargets);
    const totalObservedTransfers = Math.max(pair?.totalCount ?? 0, target?.totalTransfers ?? 0);
    const priorityTier = target?.priorityTier ?? 'none';

    return {
        totalObservedTransfers,
        avgObservedWaitMinutes: pair?.avgWaitMinutes ?? null,
        matchedStopName: pair?.transferStopName ?? target?.locationStopName ?? null,
        dominantTimeBands: pair?.dominantTimeBands ?? target?.timeBands ?? [],
        priorityTier,
        demandLevel: deriveDemandLevel(totalObservedTransfers),
        goLinked: Boolean(target?.goLinked || pair?.transferType.includes('go')),
        hasObservedMatch: Boolean(pair || target),
    };
}

export function summarizeObservedSignalForPattern(
    pattern: NetworkConnectionPattern,
    hubName: string,
    hubStopNames: string[],
    timeBand: NetworkConnectionTimeBand,
    transitData: TransitAppDataSummary | null | undefined,
): NetworkConnectionObservedSignal {
    return summarizeObservedSignal({
        fromRouteNumber: pattern.fromService.routeNumber,
        toRouteNumber: pattern.toService.routeNumber,
        timeBand,
        hubName,
        hubStopNames,
    }, transitData);
}

export function summarizeObservedSignalForSavedRecommendation(
    recommendation: SavedNetworkConnectionRecommendation,
    transitData: TransitAppDataSummary | null | undefined,
): NetworkConnectionObservedSignal {
    return summarizeObservedSignal({
        fromRouteNumber: recommendation.fromRouteNumber,
        toRouteNumber: recommendation.toRouteNumber,
        timeBand: recommendation.timeBand,
        hubName: recommendation.hubName,
        hubStopNames: recommendation.hubStopNames,
    }, transitData);
}

export interface ExportableSavedActionRow {
    recommendation: SavedNetworkConnectionRecommendation;
    observed: NetworkConnectionObservedSignal;
}

export function buildSavedActionsCsv(rows: ExportableSavedActionRow[]): string {
    const headers = [
        'hub_name',
        'day_type',
        'time_band',
        'status',
        'pattern',
        'recommendation_type',
        'recommendation_title',
        'recommendation_summary',
        'from_route',
        'to_route',
        'opportunity',
        'observed_transfers',
        'observed_avg_wait_minutes',
        'observed_priority',
        'observed_demand_level',
        'observed_stop',
        'go_linked',
        'saved_at',
    ];

    const lines = rows.map(({ recommendation, observed }) => ([
        recommendation.hubName,
        recommendation.dayType,
        recommendation.timeBand,
        recommendation.status,
        recommendation.patternLabel,
        recommendation.recommendationType,
        recommendation.recommendationTitle,
        recommendation.recommendationSummary,
        recommendation.fromRouteNumber,
        recommendation.toRouteNumber,
        recommendation.opportunityLabel ?? '',
        observed.totalObservedTransfers.toString(),
        observed.avgObservedWaitMinutes == null ? '' : observed.avgObservedWaitMinutes.toString(),
        observed.priorityTier,
        observed.demandLevel,
        observed.matchedStopName ?? '',
        observed.goLinked ? 'yes' : 'no',
        recommendation.updatedAt.toISOString(),
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')));

    return [headers.join(','), ...lines].join('\n');
}

export function buildSavedActionsMarkdown(rows: ExportableSavedActionRow[]): string {
    if (rows.length === 0) {
        return '# Network Connections Saved Actions\n\nNo saved actions.';
    }

    const body = rows.map(({ recommendation, observed }, index) => [
        `${index + 1}. ${recommendation.recommendationTitle}`,
        `Status: ${recommendation.status}`,
        `Hub: ${recommendation.hubName}`,
        `Pattern: ${recommendation.patternLabel}`,
        `Schedule view: ${recommendation.dayType} / ${recommendation.timeBand}`,
        `Recommendation: ${recommendation.recommendationSummary}`,
        `Observed demand: ${observed.hasObservedMatch ? `${observed.totalObservedTransfers} transfers, ${observed.priorityTier} priority, ${observed.demandLevel} demand` : 'No observed match'}`,
        `Observed stop: ${observed.matchedStopName ?? 'N/A'}`,
        `Pinned trip: ${recommendation.opportunityLabel ?? 'N/A'}`,
    ].join('\n')).join('\n\n');

    return `# Network Connections Saved Actions\n\n${body}\n`;
}
