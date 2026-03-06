import type { ODPairRouteMatch } from './odRouteEstimation';

export interface TransferRouteSummaryRow {
    inboundRoute: string;
    outboundRoute: string;
    routeTransfer: string;
    journeys: number;
    pairCount: number;
    samplePairs: string[];
    routePaths: string[];
}

interface TransferLegSummary {
    routeId: string;
    routeName: string;
    boardStop: string;
    alightStop: string;
    intermediateStops: number;
}

function normalizeKeyPart(value: string): string {
    return value.trim().toLowerCase();
}

function getTransferStops(match: ODPairRouteMatch): string[] {
    if (!match.transfer) return [];
    if (match.transfer.transferStops?.length) return match.transfer.transferStops;
    return match.transfer.viaStop ? [match.transfer.viaStop] : [];
}

function getTransferLegs(match: ODPairRouteMatch): TransferLegSummary[] {
    if (!match.transfer) return [];
    if (match.transfer.legs?.length) {
        return match.transfer.legs.map(leg => ({
            routeId: leg.routeId,
            routeName: leg.routeName,
            boardStop: leg.boardStop,
            alightStop: leg.alightStop,
            intermediateStops: leg.intermediateStops,
        }));
    }

    return [
        {
            routeId: match.transfer.leg1RouteId,
            routeName: match.transfer.leg1RouteName,
            boardStop: match.origin,
            alightStop: match.transfer.viaStop,
            intermediateStops: match.transfer.leg1Stops,
        },
        {
            routeId: match.transfer.leg2RouteId,
            routeName: match.transfer.leg2RouteName,
            boardStop: match.transfer.viaStop,
            alightStop: match.destination,
            intermediateStops: match.transfer.leg2Stops,
        },
    ];
}

function getFullRoutePath(match: ODPairRouteMatch): string {
    if (!match.transfer) return '';
    const routeNames = match.transfer.legs?.length
        ? match.transfer.legs.map(leg => leg.routeName)
        : [match.transfer.leg1RouteName, match.transfer.leg2RouteName];
    return routeNames.filter(Boolean).join(' → ');
}

export function buildTransferRouteSummaryRows(
    matches: ODPairRouteMatch[],
    selectedStop: string | null,
): TransferRouteSummaryRow[] {
    if (!selectedStop) return [];

    const selectedKey = normalizeKeyPart(selectedStop);
    const summary = new Map<string, {
        inboundRoute: string;
        outboundRoute: string;
        journeys: number;
        pairCount: number;
        samplePairs: string[];
        routePaths: Set<string>;
    }>();

    for (const match of matches) {
        if (!match.transfer) continue;

        const transferStops = getTransferStops(match);
        const selectedStopIndex = transferStops.findIndex(stop => normalizeKeyPart(stop) === selectedKey);
        if (selectedStopIndex < 0) continue;

        const legs = getTransferLegs(match);
        const inboundLeg = legs[selectedStopIndex];
        const outboundLeg = legs[selectedStopIndex + 1];
        if (!inboundLeg || !outboundLeg) continue;

        const inboundRoute = inboundLeg.routeName || inboundLeg.routeId || 'Unknown route';
        const outboundRoute = outboundLeg.routeName || outboundLeg.routeId || 'Unknown route';
        const routeKey = `${normalizeKeyPart(inboundRoute)}|${normalizeKeyPart(outboundRoute)}`;
        const entry = summary.get(routeKey) ?? {
            inboundRoute,
            outboundRoute,
            journeys: 0,
            pairCount: 0,
            samplePairs: [],
            routePaths: new Set<string>(),
        };

        entry.journeys += match.journeys;
        entry.pairCount += 1;

        const samplePair = `${match.origin} → ${match.destination}`;
        if (!entry.samplePairs.some(pair => normalizeKeyPart(pair) === normalizeKeyPart(samplePair)) && entry.samplePairs.length < 3) {
            entry.samplePairs.push(samplePair);
        }

        const fullRoutePath = getFullRoutePath(match);
        if (fullRoutePath) entry.routePaths.add(fullRoutePath);

        summary.set(routeKey, entry);
    }

    return Array.from(summary.values())
        .map(entry => ({
            inboundRoute: entry.inboundRoute,
            outboundRoute: entry.outboundRoute,
            routeTransfer: `${entry.inboundRoute} → ${entry.outboundRoute}`,
            journeys: entry.journeys,
            pairCount: entry.pairCount,
            samplePairs: entry.samplePairs,
            routePaths: [...entry.routePaths].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => (
            b.journeys - a.journeys
            || a.routeTransfer.localeCompare(b.routeTransfer)
        ));
}
