import type { ODPairRecord } from './odMatrixTypes';
import type { MatchConfidence, ODPairRouteMatch, ODRouteEstimationResult } from './odRouteEstimation';

export interface StopRouteSummaryRow {
    rank: number;
    direction: 'Outbound' | 'Inbound';
    counterpart: string;
    journeys: number;
    stopShare: number;
    routePath: string;
    viaStops: string;
    confidence: MatchConfidence | 'loading' | 'unavailable';
}

function normalizeKeyPart(value: string): string {
    return value.trim().toLowerCase();
}

function buildPairKey(origin: string, destination: string): string {
    return `${normalizeKeyPart(origin)}|${normalizeKeyPart(destination)}`;
}

export function getRoutePathLabel(match: ODPairRouteMatch | null | undefined): string {
    if (!match || match.confidence === 'none') return '';

    if (match.transfer) {
        const legNames = match.transfer.legs?.length
            ? match.transfer.legs.map(leg => leg.routeName)
            : [match.transfer.leg1RouteName, match.transfer.leg2RouteName];
        return legNames.join(' → ');
    }

    if (
        match.routeShortName
        && match.routeLongName
        && normalizeKeyPart(match.routeShortName) !== normalizeKeyPart(match.routeLongName)
    ) {
        return `${match.routeShortName} - ${match.routeLongName}`;
    }

    return match.routeLongName || match.routeShortName || '';
}

export function getViaStopsLabel(match: ODPairRouteMatch | null | undefined): string {
    if (!match?.transfer) return '';
    if (match.transfer.transferStops?.length) return match.transfer.transferStops.join(' → ');
    return match.transfer.viaStop || '';
}

export function buildStopRouteSummaryRows(args: {
    isolatedStation: string | null;
    pairs: ODPairRecord[];
    minJourneys: number;
    routeEstimation?: ODRouteEstimationResult | null;
    routeEstimationLoading?: boolean;
}): StopRouteSummaryRow[] {
    const {
        isolatedStation,
        pairs,
        minJourneys,
        routeEstimation,
        routeEstimationLoading = false,
    } = args;

    if (!isolatedStation) return [];

    const routeLookup = new Map<string, ODPairRouteMatch>();
    routeEstimation?.matches.forEach(match => {
        routeLookup.set(buildPairKey(match.origin, match.destination), match);
    });

    const matchingPairs = pairs
        .filter(pair => (
            pair.journeys >= minJourneys
            && (pair.origin === isolatedStation || pair.destination === isolatedStation)
        ))
        .sort((a, b) => b.journeys - a.journeys);

    const stopTrips = matchingPairs.reduce((sum, pair) => sum + pair.journeys, 0);

    return matchingPairs.map((pair, index) => {
        const outbound = pair.origin === isolatedStation;
        const match = routeLookup.get(buildPairKey(pair.origin, pair.destination));
        const routePath = getRoutePathLabel(match);

        let confidence: StopRouteSummaryRow['confidence'] = 'unavailable';
        if (routeEstimationLoading) confidence = 'loading';
        else if (match) confidence = match.confidence;

        return {
            rank: index + 1,
            direction: outbound ? 'Outbound' : 'Inbound',
            counterpart: outbound ? pair.destination : pair.origin,
            journeys: pair.journeys,
            stopShare: stopTrips > 0 ? (pair.journeys / stopTrips) * 100 : 0,
            routePath,
            viaStops: getViaStopsLabel(match),
            confidence,
        };
    });
}
