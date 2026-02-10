import { matchStopToHub, getPlatformForRoute, type HubConfig } from '../platformConfig';

export interface PlatformMatchResult {
    hubName: string;
    platformId: string;
    normalizedStopName: string;
}

export function normalizeStopNameForHubMatch(stopName: string): string {
    return stopName
        .replace(/\s*\(\d+\)\s*$/, '')  // Remove (1), (2) suffixes
        .replace(/\s+\d+\s*$/, '')       // Remove trailing " 1", " 2"
        .trim();
}

export function matchStopToPlatform(
    stopName: string,
    stopId: string | undefined,
    routeNumber: string,
    hubs: HubConfig[]
): PlatformMatchResult | null {
    const normalizedStopName = normalizeStopNameForHubMatch(stopName);
    const hub = matchStopToHub(normalizedStopName, stopId, hubs);
    if (!hub) return null;

    const platformAssignment = getPlatformForRoute(hub, routeNumber, stopId);
    if (!platformAssignment) return null;

    return {
        hubName: hub.name,
        platformId: platformAssignment.platformId,
        normalizedStopName
    };
}
