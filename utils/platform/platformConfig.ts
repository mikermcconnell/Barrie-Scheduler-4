/**
 * Platform Configuration
 *
 * Hub and platform definitions for Barrie Transit.
 * Based on official platform maps (November 2025).
 * Uses STOP CODES for precise matching instead of fuzzy name matching.
 */

export interface PlatformAssignment {
    platformId: string;      // "P1", "P2", "Stop330", etc.
    routes: string[];        // Routes that use this platform
    capacity?: number;       // Optional: max buses at once (default: 1)
}

export interface HubConfig {
    name: string;
    stopCodes: string[];         // Stop codes for this hub (e.g., ["777", "778"])
    stopNamePatterns: string[];  // Fallback: patterns to match stop names (lowercase)
    platforms: PlatformAssignment[];
}

/**
 * Route family mapping - variants that are the same bus
 * e.g., 2, 2A, 2B are all the "2" family
 */
export const ROUTE_FAMILIES: Record<string, string[]> = {
    '2': ['2', '2A', '2B'],
    '7': ['7', '7A', '7B'],
    '8': ['8', '8A', '8B'],
    '12': ['12', '12A', '12B'],
};

/**
 * All hub configurations with platform assignments.
 * Based on official Barrie Transit Platform Maps (November 2025).
 */
export const HUBS: HubConfig[] = [
    {
        name: "Park Place",
        stopCodes: ["777"],
        stopNamePatterns: ["park place"],
        platforms: [
            { platformId: "P1", routes: ["12A"] },
            { platformId: "P2", routes: ["2", "2A", "7A"] },
            { platformId: "P3", routes: ["8B"] },
            { platformId: "P4", routes: ["400"] },
            { platformId: "P5", routes: [] },
            { platformId: "P6", routes: ["8A", "12B"] },
        ]
    },
    {
        name: "Barrie South GO",
        stopCodes: ["725"],
        stopNamePatterns: ["barrie south go", "barrie south", "bsgo"],
        platforms: [
            { platformId: "P6", routes: ["8A"] },
            { platformId: "P7", routes: ["12A"] },
            { platformId: "P8", routes: ["8B"] },
        ]
    },
    {
        name: "Barrie Allandale Transit Terminal",
        stopCodes: ["9003", "9004", "9005", "9006", "9009", "9012", "9013", "9014"],
        stopNamePatterns: ["allandale", "transit terminal", "barrie allandale"],
        platforms: [
            { platformId: "P3 (9003)", routes: ["8A"] },
            { platformId: "P4 (9004)", routes: ["8B"] },
            { platformId: "P5 (9005)", routes: ["8A"] },
            { platformId: "P6 (9006)", routes: ["7", "7A", "7B"] },
            { platformId: "P12/13", routes: ["8B", "12A"], capacity: 2 },
            { platformId: "P14 (9014)", routes: ["12B"] },
        ]
    },
    {
        name: "Downtown",
        stopCodes: ["1", "2", "10"],  // Stop 1, Stop 2, Stop 10
        stopNamePatterns: ["downtown"],
        platforms: [
            {
                platformId: "Stop 1",
                routes: ["101", "2", "2B", "7", "7B", "8B", "11", "12B"],
                capacity: 2
            },
            {
                platformId: "Stop 2",
                routes: ["100", "7A", "8A", "10", "12A"],
                capacity: 2
            },
        ]
    },
    {
        name: "Georgian College",
        stopCodes: ["327", "328", "329", "330", "331", "335"],
        stopNamePatterns: ["georgian college", "georgian"],
        platforms: [
            { platformId: "Stop 329", routes: ["400"] },
            {
                platformId: "Stop 330",
                routes: ["400", "100", "101", "8A", "8B"],
                capacity: 2
            },
            { platformId: "Stop 331", routes: ["7", "7B", "11"] },
        ]
    },
];

/**
 * Normalize a stop name for matching
 */
function normalizeStopName(stopName: string): string {
    return stopName
        .toLowerCase()
        .replace(/\s*\(\d+\)\s*$/, '')  // Remove (1), (2) suffixes
        .replace(/\s+/g, ' ')            // Normalize whitespace
        .trim();
}

/**
 * Match a stop to a hub using stop CODE (preferred) or name (fallback).
 * @param stopName - The stop name from schedule data
 * @param stopId - The stop code/ID (optional but preferred)
 */
export function matchStopToHub(stopName: string, stopId?: string, hubs?: HubConfig[]): HubConfig | null {
    const hubList = hubs || HUBS;

    // 1. Try matching by stop code first (most reliable)
    if (stopId) {
        const normalizedCode = stopId.trim();
        for (const hub of hubList) {
            if (hub.stopCodes.includes(normalizedCode)) {
                return hub;
            }
        }
    }

    // 2. Fallback to name matching
    const normalized = normalizeStopName(stopName);
    for (const hub of hubList) {
        for (const pattern of hub.stopNamePatterns) {
            if (normalized.includes(pattern)) {
                return hub;
            }
        }
    }

    return null;
}

/**
 * Get the base route number (strip letter suffix)
 * e.g., "8A" -> "8", "400" -> "400"
 */
function getBaseRoute(routeNumber: string): string {
    return routeNumber.replace(/[A-Z]$/i, '');
}

/**
 * Determine whether a route string has a variant suffix (e.g., "8A", "12B").
 */
function hasVariantSuffix(routeNumber: string): boolean {
    return /[A-Z]$/i.test(routeNumber.trim());
}

/**
 * Check if two routes are in the same family
 * e.g., "2" and "2A" are same family, "8A" and "8B" are same family
 */
function isSameRouteFamily(route1: string, route2: string): boolean {
    const base1 = getBaseRoute(route1.toUpperCase());
    const base2 = getBaseRoute(route2.toUpperCase());
    return base1 === base2;
}

/**
 * Extract platform stop code hints from platform ID labels.
 * Examples:
 * - "P3 (9003)" -> ["9003"]
 * - "P12/13" -> []
 * - "Stop 330" -> ["330"]
 */
function extractPlatformStopCodes(platformId: string): string[] {
    const codes: string[] = [];

    // Parenthesized code, e.g. "(9003)"
    const parenMatch = platformId.match(/\((\d+)\)/);
    if (parenMatch?.[1]) {
        codes.push(parenMatch[1]);
    }

    // "Stop 330" style
    const stopMatch = platformId.match(/stop\s*(\d+)/i);
    if (stopMatch?.[1]) {
        codes.push(stopMatch[1]);
    }

    return codes;
}

function platformHasStopCode(platform: PlatformAssignment, stopId?: string): boolean {
    if (!stopId) return false;
    const normalizedStopId = stopId.trim();
    if (!normalizedStopId) return false;
    return extractPlatformStopCodes(platform.platformId).includes(normalizedStopId);
}

function routeMatchScore(
    inputRoute: string,
    platformRoute: string
): 3 | 2 | 1 | 0 {
    const input = inputRoute.trim().toUpperCase();
    const candidate = platformRoute.trim().toUpperCase();
    if (!input || !candidate) return 0;

    if (input === candidate) return 3; // exact

    const inputBase = getBaseRoute(input);
    if (candidate === inputBase) return 2; // generic base mapping (e.g., 2 -> 2A)

    if (isSameRouteFamily(input, candidate)) return 1; // family fallback

    return 0;
}

function getBestRouteMatch(
    platform: PlatformAssignment,
    normalizedRoute: string
): { score: 3 | 2 | 1 | 0; hasExact: boolean } {
    let best: 3 | 2 | 1 | 0 = 0;
    let hasExact = false;

    for (const platformRoute of platform.routes) {
        const score = routeMatchScore(normalizedRoute, platformRoute);
        if (score === 3) hasExact = true;
        if (score > best) best = score as 3 | 2 | 1 | 0;
    }

    return { score: best, hasExact };
}

/**
 * Get platform assignment for a route at a specific hub.
 * Priority:
 * 1) Stop-code constrained exact route match
 * 2) Hub-wide exact route match
 * 3) Base-route match (e.g., "2" config serving "2A")
 * 4) Family fallback (only when no exact variant exists at hub)
 */
export function getPlatformForRoute(hub: HubConfig, routeNumber: string, stopId?: string): PlatformAssignment | null {
    const normalizedRoute = routeNumber.toUpperCase().trim();
    if (!normalizedRoute) return null;

    // If stop ID narrows to one or more platforms, prioritize those first.
    const platformsByStop = stopId
        ? hub.platforms.filter(p => platformHasStopCode(p, stopId))
        : [];

    const hasExactVariantAtHub = hub.platforms.some(p =>
        p.routes.some(r => r.trim().toUpperCase() === normalizedRoute)
    );

    const variantsExistForBaseAtHub = hasVariantSuffix(normalizedRoute) && hub.platforms.some(p =>
        p.routes.some(r => {
            const candidate = r.trim().toUpperCase();
            return hasVariantSuffix(candidate) && getBaseRoute(candidate) === getBaseRoute(normalizedRoute);
        })
    );

    const chooseBest = (platforms: PlatformAssignment[]): PlatformAssignment | null => {
        let bestPlatform: PlatformAssignment | null = null;
        let bestScore: 3 | 2 | 1 | 0 = 0;

        for (const platform of platforms) {
            const { score, hasExact } = getBestRouteMatch(platform, normalizedRoute);
            if (score === 0) continue;

            // If this route has explicit variants configured in the hub, avoid family fallback.
            // This prevents 8B from being mapped to an 8A platform.
            if (score === 1 && variantsExistForBaseAtHub && !hasExact) {
                continue;
            }

            if (score > bestScore) {
                bestScore = score;
                bestPlatform = platform;
            }
        }

        return bestPlatform;
    };

    // 1) Try stop-specific platforms first
    const byStop = chooseBest(platformsByStop);
    if (byStop) return byStop;

    // 2) Try all platforms with safe route matching
    const bestOverall = chooseBest(hub.platforms);
    if (bestOverall) return bestOverall;

    // 3) Last resort: if exact variant exists in hub but stop filtering prevented match,
    // return the first exact match anywhere in hub.
    if (hasExactVariantAtHub) {
        for (const platform of hub.platforms) {
            if (platform.routes.some(r => r.trim().toUpperCase() === normalizedRoute)) {
                return platform;
            }
        }
    }

    return null;
}

/**
 * Get all platforms for a hub that have Barrie Transit routes assigned
 */
export function getActivePlatforms(hub: HubConfig): PlatformAssignment[] {
    return hub.platforms.filter(p => p.routes.length > 0);
}
