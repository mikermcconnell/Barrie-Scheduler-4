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

export type StopRouteDirection = 'inbound' | 'outbound';

export interface StopRouteDirectionSummaryRow {
    direction: StopRouteDirection;
    routeId: string;
    routeName: string;
    endpointStopName: string;
    endpointBreakdown: { stopName: string; journeys: number }[];
    journeys: number;
    pairCount: number;
    samplePairs: string[];
    counterpartRoutes: string[];
    routePaths: string[];
}

export interface StopRouteDirectionSummary {
    inboundRoutes: StopRouteDirectionSummaryRow[];
    outboundRoutes: StopRouteDirectionSummaryRow[];
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

interface RouteDirectionAccumulator {
    direction: StopRouteDirection;
    routeId: string;
    routeName: string;
    endpointJourneys: Map<string, number>;
    journeys: number;
    pairCount: number;
    samplePairs: string[];
    counterpartRoutes: Set<string>;
    routePaths: Set<string>;
}

function buildDirectionRows(summary: Map<string, RouteDirectionAccumulator>): StopRouteDirectionSummaryRow[] {
    return Array.from(summary.values())
        .map(entry => ({
            direction: entry.direction,
            routeId: entry.routeId,
            routeName: entry.routeName,
            endpointStopName: Array.from(entry.endpointJourneys.entries())
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '',
            endpointBreakdown: Array.from(entry.endpointJourneys.entries())
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([stopName, journeys]) => ({ stopName, journeys })),
            journeys: entry.journeys,
            pairCount: entry.pairCount,
            samplePairs: entry.samplePairs,
            counterpartRoutes: [...entry.counterpartRoutes].sort((a, b) => a.localeCompare(b)),
            routePaths: [...entry.routePaths].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => (
            b.journeys - a.journeys
            || a.routeName.localeCompare(b.routeName)
        ));
}

function addDirectionRow(
    summary: Map<string, RouteDirectionAccumulator>,
    direction: StopRouteDirection,
    leg: TransferLegSummary,
    counterpartRoute: string,
    endpointStopName: string,
    match: ODPairRouteMatch,
): void {
    const routeName = leg.routeName || leg.routeId || 'Unknown route';
    const routeId = leg.routeId || routeName;
    const routeKey = `${direction}|${normalizeKeyPart(routeId)}|${normalizeKeyPart(routeName)}`;
    const entry = summary.get(routeKey) ?? {
        direction,
        routeId,
        routeName,
        endpointJourneys: new Map<string, number>(),
        journeys: 0,
        pairCount: 0,
        samplePairs: [],
        counterpartRoutes: new Set<string>(),
        routePaths: new Set<string>(),
    };

    entry.journeys += match.journeys;
    entry.pairCount += 1;

    const samplePair = `${match.origin} → ${match.destination}`;
    if (!entry.samplePairs.some(pair => normalizeKeyPart(pair) === normalizeKeyPart(samplePair)) && entry.samplePairs.length < 3) {
        entry.samplePairs.push(samplePair);
    }

    if (counterpartRoute) {
        entry.counterpartRoutes.add(counterpartRoute);
    }

    if (endpointStopName) {
        entry.endpointJourneys.set(
            endpointStopName,
            (entry.endpointJourneys.get(endpointStopName) ?? 0) + match.journeys,
        );
    }

    const fullRoutePath = getFullRoutePath(match);
    if (fullRoutePath) {
        entry.routePaths.add(fullRoutePath);
    }

    summary.set(routeKey, entry);
}

export function buildStopRouteDirectionSummary(
    matches: ODPairRouteMatch[],
    selectedStop: string | null,
): StopRouteDirectionSummary {
    if (!selectedStop) {
        return {
            inboundRoutes: [],
            outboundRoutes: [],
        };
    }

    const selectedKey = normalizeKeyPart(selectedStop);
    const inboundSummary = new Map<string, RouteDirectionAccumulator>();
    const outboundSummary = new Map<string, RouteDirectionAccumulator>();

    for (const match of matches) {
        if (!match.transfer) continue;

        const transferStops = getTransferStops(match);
        const selectedStopIndex = transferStops.findIndex(stop => normalizeKeyPart(stop) === selectedKey);
        if (selectedStopIndex < 0) continue;

        const legs = getTransferLegs(match);
        const inboundLeg = legs[selectedStopIndex];
        const outboundLeg = legs[selectedStopIndex + 1];
        if (!inboundLeg || !outboundLeg) continue;

        const inboundCounterpart = outboundLeg.routeName || outboundLeg.routeId || 'Unknown route';
        const outboundCounterpart = inboundLeg.routeName || inboundLeg.routeId || 'Unknown route';

        addDirectionRow(inboundSummary, 'inbound', inboundLeg, inboundCounterpart, inboundLeg.boardStop, match);
        addDirectionRow(outboundSummary, 'outbound', outboundLeg, outboundCounterpart, outboundLeg.alightStop, match);
    }

    return {
        inboundRoutes: buildDirectionRows(inboundSummary),
        outboundRoutes: buildDirectionRows(outboundSummary),
    };
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
