import type {
    TransferPairSummary,
    TransferPattern,
    TransferConnectionTargetCandidate,
    GoLinkedTransferSummary,
    TransferType,
} from './transitAppTypes';

export type TransferScopeFilter = 'all' | 'barrie' | 'regional';

interface TransferScopeRow {
    fromRoute?: string | null;
    toRoute?: string | null;
    fromStop?: string | null;
    toStop?: string | null;
    transferStopName?: string | null;
    transferStopId?: string | null;
    locationStopName?: string | null;
    locationStopId?: string | null;
}

export interface TransferScopeStats {
    transferEvents: number;
    goLinkedTransferEvents: number;
    uniqueRoutePairs: number;
    routeReferencesMatched: number;
    routeReferencesTotal: number;
    routeMatchRate: number;
}

/** Barrie Transit routes are local numbered routes + letter suffixes. GO = "BR" or 60-69 range. */
export function isBarrieRoute(route: string): boolean {
    const upper = route
        .trim()
        .toUpperCase()
        .replace(/^BARRIE\s+TRANSIT\s+/, '')
        .replace(/^ROUTE\s+/, '');
    if (upper === 'BR') return false;

    const routeMatch = upper.match(/^(\d{1,3})([A-Z])?$/);
    if (!routeMatch) return false;

    const num = Number(routeMatch[1]);
    if (num >= 60 && num <= 69) return false;
    return true;
}

export function looksBarrieStopName(stopName: string): boolean {
    const upper = stopName.trim().toUpperCase();
    if (!upper) return false;
    return upper.includes('BARRIE') || upper.includes('ALLANDALE');
}

export function isBarrieTransferStop(
    transferStopId: string | null | undefined,
    transferStopName: string | null | undefined,
    fromStop: string | null | undefined,
    toStop: string | null | undefined,
    fromRoute: string | null | undefined,
    toRoute: string | null | undefined
): boolean {
    if (transferStopId) return true;
    const routeSuggestsBarrie = isBarrieRoute(fromRoute || '') && isBarrieRoute(toRoute || '');

    const stopHints = [transferStopName, fromStop, toStop]
        .filter((value): value is string => Boolean(value && value.trim().length > 0));

    if (stopHints.length > 0) {
        return stopHints.some(looksBarrieStopName) || routeSuggestsBarrie;
    }

    // Backward-compatibility fallback for older saved rows with no stop metadata.
    return routeSuggestsBarrie;
}

export function matchesTransferScope(isBarrieStop: boolean, scope: TransferScopeFilter): boolean {
    if (scope === 'all') return true;
    if (scope === 'barrie') return isBarrieStop;
    return !isBarrieStop;
}

export function isTransferRowInScope(row: TransferScopeRow, scope: TransferScopeFilter): boolean {
    const transferStopId = row.transferStopId ?? row.locationStopId;
    const transferStopName = row.transferStopName ?? row.locationStopName;
    return matchesTransferScope(
        isBarrieTransferStop(
            transferStopId,
            transferStopName,
            row.fromStop,
            row.toStop,
            row.fromRoute,
            row.toRoute
        ),
        scope
    );
}

export function calculateTransferScopeStats(
    pairs: TransferPairSummary[],
    fallback?: {
        transferEvents: number;
        goLinkedTransferEvents: number;
        uniqueRoutePairs: number;
        routeReferencesMatched: number;
        routeReferencesTotal: number;
        routeMatchRate: number;
    }
): TransferScopeStats {
    const transferEvents = pairs.reduce((sum, pair) => sum + pair.totalCount, 0);

    if (pairs.length === 0 && fallback) {
        return { ...fallback };
    }

    const routePairs = new Set<string>();
    let goLinkedTransferEvents = 0;
    let routeReferencesMatched = 0;
    let routeReferencesTotal = 0;

    for (const pair of pairs) {
        routePairs.add(`${pair.fromRoute}|${pair.toRoute}`);
        if (isGoLinkedTransferType(pair.transferType)) {
            goLinkedTransferEvents += pair.totalCount;
        }
        routeReferencesTotal += pair.totalCount * 2;
        routeReferencesMatched += pair.totalCount * (
            (pair.fromRouteId ? 1 : 0) + (pair.toRouteId ? 1 : 0)
        );
    }

    return {
        transferEvents,
        goLinkedTransferEvents,
        uniqueRoutePairs: routePairs.size,
        routeReferencesMatched,
        routeReferencesTotal,
        routeMatchRate: routeReferencesTotal > 0
            ? Math.round((routeReferencesMatched / routeReferencesTotal) * 10000) / 10000
            : 0,
    };
}

export function isGoLinkedTransferType(transferType: TransferType): boolean {
    return transferType.includes('go');
}

export type ScopedTransferPair = TransferPairSummary;
export type ScopedTransferPattern = TransferPattern;
export type ScopedConnectionTarget = TransferConnectionTargetCandidate;
export type ScopedGoLinkedTransfer = GoLinkedTransferSummary;
