/**
 * Route Direction Configuration
 *
 * Unified "Cycle" model for all Barrie Transit routes.
 * All routes are represented as cycles with 1 or 2 directional segments:
 * - Bidirectional routes: 2 segments (North/South)
 * - Loop routes: 1 segment (Clockwise/Counter-clockwise)
 *
 * A/B Suffix Meanings:
 * - Routes 2, 7, 12: A = North, B = South (suffix IS the direction)
 * - Routes 8A, 8B: A and B are route variants (each has its own NB + SB)
 */

// =============================================================================
// NEW UNIFIED TYPES
// =============================================================================

/**
 * A directional segment of a route.
 * Linear routes have 2 segments (North, South).
 * Loop routes have 1 segment (Clockwise, Counter-clockwise).
 */
export interface RouteSegment {
    /** Direction/segment name: "North", "South", "Clockwise", "Counter-clockwise" */
    name: string;
    /** Route variant for this segment (e.g., "12A", "12B", "100") */
    variant: string;
    /** Terminus/endpoint for this direction (optional for loops) */
    terminus?: string;
}

/**
 * Unified route configuration using segments.
 * Check segments.length to determine route type:
 * - 1 segment = loop route
 * - 2 segments = bidirectional (linear) route
 */
export interface CycleRouteConfig {
    /** Directional segments (1 for loops, 2 for linear) */
    segments: RouteSegment[];
    /** True if A/B suffix indicates direction (e.g., 12A=North, 12B=South) */
    suffixIsDirection?: boolean;
}

// Type alias for the unified config
export type RouteConfig = CycleRouteConfig;

// =============================================================================
// HELPER FUNCTIONS FOR SEGMENT-BASED CONFIG
// =============================================================================

/**
 * Check if a route is a loop (single segment).
 */
export function isLoop(config: CycleRouteConfig | null | undefined): boolean {
    return config?.segments.length === 1;
}

/**
 * Check if a route is bidirectional (two segments).
 */
export function isBidirectional(config: CycleRouteConfig | null | undefined): boolean {
    return config?.segments.length === 2;
}

/**
 * Get a segment by name (e.g., "North", "Clockwise").
 */
export function getSegmentByName(config: CycleRouteConfig | null | undefined, name: string): RouteSegment | undefined {
    return config?.segments.find(s => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get the primary/first segment (useful for loops).
 */
export function getPrimarySegment(config: CycleRouteConfig | null | undefined): RouteSegment | undefined {
    return config?.segments[0];
}

/**
 * Master route direction configuration.
 * Key is the base route number as it appears in schedule files.
 */
export const ROUTE_DIRECTIONS: Record<string, CycleRouteConfig> = {
    // Route 400 - Bidirectional, uses explicit North/South
    '400': {
        segments: [
            { name: 'North', variant: '400', terminus: 'RVH' },
            { name: 'South', variant: '400', terminus: 'Park Place' },
        ],
    },

    // Route 2 - Bidirectional, A/B suffix = direction
    '2': {
        segments: [
            { name: 'North', variant: '2A', terminus: 'Downtown' },
            { name: 'South', variant: '2B', terminus: 'Park Place' },
        ],
        suffixIsDirection: true,
    },

    // Route 7 - Bidirectional, A/B suffix = direction
    '7': {
        segments: [
            { name: 'North', variant: '7A', terminus: 'Georgian College' },
            { name: 'South', variant: '7B', terminus: 'Park Place' },
        ],
        suffixIsDirection: true,
    },

    // Route 8A - Bidirectional, full route with both directions
    // GTFS headsigns: "RVH/YONGE to Georgian College" (North), "RVH/YONGE to Park Place" (South)
    '8A': {
        segments: [
            { name: 'North', variant: '8A', terminus: 'Georgian College' },
            { name: 'South', variant: '8A', terminus: 'Park Place' },
        ],
    },

    // Route 8B - Bidirectional, full route with both directions
    // GTFS headsigns: "Crosstown/Essa to Georgian College" (North), "Crosstown/Essa to Park Place" (South)
    '8B': {
        segments: [
            { name: 'North', variant: '8B', terminus: 'Georgian College' },
            { name: 'South', variant: '8B', terminus: 'Park Place' },
        ],
    },

    // Route 10 - Loop (clockwise)
    '10': {
        segments: [{ name: 'Clockwise', variant: '10' }],
    },

    // Route 11 - Loop (counter-clockwise)
    '11': {
        segments: [{ name: 'Counter-clockwise', variant: '11' }],
    },

    // Route 12 - Bidirectional, A/B suffix = direction
    '12': {
        segments: [
            { name: 'North', variant: '12A', terminus: 'Georgian College' },
            { name: 'South', variant: '12B', terminus: 'Barrie South GO' },
        ],
        suffixIsDirection: true,
    },

    // Route 100 - Loop (clockwise)
    '100': {
        segments: [{ name: 'Clockwise', variant: '100' }],
    },

    // Route 101 - Loop (counter-clockwise)
    '101': {
        segments: [{ name: 'Counter-clockwise', variant: '101' }],
    },
};

/**
 * Get the route variant name for a given direction.
 * @param baseRoute - The base route number (e.g., "12", "400", "8A")
 * @param direction - "North" or "South"
 * @returns The variant name (e.g., "12A" for route 12 North)
 */
export function getRouteVariant(baseRoute: string, direction: 'North' | 'South'): string {
    const config = ROUTE_DIRECTIONS[baseRoute];

    if (!config) {
        // Unknown route - return as-is
        return baseRoute;
    }

    // For loops, return the single segment's variant
    if (config.segments.length === 1) {
        return config.segments[0].variant;
    }

    // For bidirectional routes, find the matching segment
    const segment = config.segments.find(s => s.name === direction);
    return segment?.variant ?? baseRoute;
}

/**
 * Get direction info for display purposes.
 * @param baseRoute - The base route number
 * @param direction - "North" or "South" (or null for loops)
 * @returns Human-readable direction string
 */
export function getDirectionDisplay(baseRoute: string, direction?: 'North' | 'South' | null): string {
    const config = ROUTE_DIRECTIONS[baseRoute];

    if (!config) {
        return direction || 'Unknown';
    }

    // For loops, return the single segment's name
    if (config.segments.length === 1) {
        return config.segments[0].name;
    }

    if (!direction) {
        return 'Unknown';
    }

    // For bidirectional routes, find the matching segment
    const segment = config.segments.find(s => s.name === direction);
    if (!segment) {
        return direction;
    }

    // If variant differs from base (e.g., 12A vs 12), show it
    if (segment.variant !== baseRoute) {
        return `${segment.variant} (${direction} → ${segment.terminus})`;
    }

    return `${direction} → ${segment.terminus}`;
}

/**
 * Check if a route uses A/B suffix as direction indicator.
 * @param baseRoute - The base route number (e.g., "2", "7", "12")
 * @returns true if A=North, B=South for this route
 */
export function usesVariantAsDirection(baseRoute: string): boolean {
    const config = ROUTE_DIRECTIONS[baseRoute];
    if (!config || config.segments.length === 1) return false;

    // Use explicit suffixIsDirection flag, or infer from differing variants
    if (config.suffixIsDirection !== undefined) {
        return config.suffixIsDirection;
    }

    // Fallback: if north and south variants differ, the suffix IS the direction
    const northSegment = config.segments.find(s => s.name === 'North');
    const southSegment = config.segments.find(s => s.name === 'South');
    return northSegment?.variant !== southSegment?.variant;
}

/**
 * Get route config, handling routes that might be stored with variant suffix.
 * @param routeNumber - Route number that might include variant (e.g., "12A", "8A", "400")
 * @returns The config, checking both exact match and base route
 */
export function getRouteConfig(routeNumber: string): RouteConfig | null {
    // Try exact match first (for 8A, 8B which are separate routes)
    if (ROUTE_DIRECTIONS[routeNumber]) {
        return ROUTE_DIRECTIONS[routeNumber];
    }

    // Try base route (strip A/B suffix)
    const baseRoute = routeNumber.replace(/[AB]$/i, '');
    if (ROUTE_DIRECTIONS[baseRoute]) {
        return ROUTE_DIRECTIONS[baseRoute];
    }

    return null;
}

// =============================================================================
// UNIFIED DIRECTION INFERENCE FUNCTIONS
// =============================================================================

/**
 * Direction type for linear routes.
 * Use this instead of hardcoded 'North' | 'South' strings.
 */
export type Direction = 'North' | 'South';

/**
 * Result of parsing a route identifier.
 */
export interface ParsedRouteInfo {
    /** Base route number (e.g., "12", "400", "8A") */
    baseRoute: string;
    /** Direction if determinable, null for loops or unknown */
    direction: Direction | null;
    /** The variant name (e.g., "12A", "400", "8A") */
    variant: string;
    /** Whether this is a loop route (1 segment) */
    isLoop: boolean;
    /** Whether this route uses A/B suffix as direction (true for 2, 7, 12; false for 8A, 8B) */
    suffixIsDirection: boolean;
}

/**
 * Parse a route identifier and extract all direction information.
 * This is the PRIMARY function for understanding route direction.
 *
 * Handles all formats:
 * - "12A" → { baseRoute: "12", direction: "North", variant: "12A" }
 * - "12B" → { baseRoute: "12", direction: "South", variant: "12B" }
 * - "8A"  → { baseRoute: "8A", direction: null, variant: "8A" } (8A is a separate route)
 * - "400" → { baseRoute: "400", direction: null, variant: "400" }
 * - "100" → { baseRoute: "100", direction: null, variant: "100" } (loop)
 *
 * @param routeIdentifier - Route string (e.g., "12A", "8A", "400", "Route 12")
 * @returns Parsed route information
 */
export function parseRouteInfo(routeIdentifier: string): ParsedRouteInfo {
    // Clean the input - extract just the route number/variant
    const cleaned = routeIdentifier
        .replace(/^route\s*/i, '')  // Remove "Route " prefix
        .replace(/\s*\(.*\)$/i, '') // Remove "(North)", "(South)", "(Weekday)" suffixes
        .trim();

    // Check if this is an exact match (8A, 8B, 400, 10, etc.)
    if (ROUTE_DIRECTIONS[cleaned]) {
        const config = ROUTE_DIRECTIONS[cleaned];
        const routeIsLoop = config.segments.length === 1;
        return {
            baseRoute: cleaned,
            direction: null, // Direction not embedded in the identifier itself
            variant: cleaned,
            isLoop: routeIsLoop,
            suffixIsDirection: false,
        };
    }

    // Check if this has an A/B suffix that indicates direction
    const suffixMatch = cleaned.match(/^(\d+)([AB])$/i);
    if (suffixMatch) {
        const numericPart = suffixMatch[1];
        const suffix = suffixMatch[2].toUpperCase();

        // Check if the numeric part is a route that uses A/B as direction
        const baseConfig = ROUTE_DIRECTIONS[numericPart];
        if (baseConfig && baseConfig.segments.length === 2) {
            // Verify this route uses variant suffixes for direction
            if (baseConfig.suffixIsDirection) {
                // Routes like 2, 7, 12 where A=North, B=South
                return {
                    baseRoute: numericPart,
                    direction: suffix === 'A' ? 'North' : 'South',
                    variant: cleaned,
                    isLoop: false,
                    suffixIsDirection: true,
                };
            }
        }

        // If we get here, the A/B is part of the route name (like 8A, 8B)
        // Already handled above if it's in ROUTE_DIRECTIONS
    }

    // Try stripping A/B to find base route
    const withoutSuffix = cleaned.replace(/[AB]$/i, '');
    if (ROUTE_DIRECTIONS[withoutSuffix]) {
        const config = ROUTE_DIRECTIONS[withoutSuffix];
        const routeIsLoop = config.segments.length === 1;
        return {
            baseRoute: withoutSuffix,
            direction: null,
            variant: cleaned,
            isLoop: routeIsLoop,
            suffixIsDirection: false,
        };
    }

    // Unknown route
    return {
        baseRoute: cleaned,
        direction: null,
        variant: cleaned,
        isLoop: false,
        suffixIsDirection: false,
    };
}

/**
 * Extract direction from a route name string that includes direction suffix.
 * Replaces hardcoded `.includes('(North)')` / `.includes('(South)')` checks.
 *
 * @param routeName - Full route name (e.g., "400 (Weekday) (North)", "Route 12 (South)")
 * @returns Direction if found, null otherwise
 */
export function extractDirectionFromName(routeName: string): Direction | null {
    const lower = routeName.toLowerCase();

    // Check for explicit direction markers
    if (lower.includes('(north)') || lower.includes('northbound') || lower.includes('- north')) {
        return 'North';
    }
    if (lower.includes('(south)') || lower.includes('southbound') || lower.includes('- south')) {
        return 'South';
    }

    // Check for direction abbreviations (common in headers)
    // Be careful: only match standalone patterns, not parts of words
    if (/\bnb\b/i.test(routeName) || /\bn\b/i.test(routeName)) {
        return 'North';
    }
    if (/\bsb\b/i.test(routeName) || /\bs\b/i.test(routeName)) {
        return 'South';
    }

    return null;
}

/**
 * Infer direction by comparing stop names against terminus configuration.
 * Use this when direction isn't explicit but you know the first/last stops.
 *
 * @param routeNumber - Base route number (e.g., "12", "400")
 * @param firstStop - First stop name of the trip
 * @param lastStop - Last stop name of the trip
 * @returns Inferred direction, or null if can't determine
 */
export function inferDirectionFromTerminus(
    routeNumber: string,
    firstStop: string,
    lastStop: string
): Direction | null {
    const config = getRouteConfig(routeNumber);
    if (!config || config.segments.length !== 2) {
        return null; // Can't infer for loops or unknown routes
    }

    const northSegment = config.segments.find(s => s.name === 'North');
    const southSegment = config.segments.find(s => s.name === 'South');
    if (!northSegment?.terminus || !southSegment?.terminus) {
        return null;
    }

    const firstLower = firstStop.toLowerCase();
    const lastLower = lastStop.toLowerCase();
    const northTerminus = northSegment.terminus.toLowerCase();
    const southTerminus = southSegment.terminus.toLowerCase();

    // Trip starting from south terminus going to north = Northbound
    if (firstLower.includes(southTerminus) || southTerminus.includes(firstLower)) {
        return 'North';
    }

    // Trip starting from north terminus going to south = Southbound
    if (firstLower.includes(northTerminus) || northTerminus.includes(firstLower)) {
        return 'South';
    }

    // Check last stop as fallback
    if (lastLower.includes(northTerminus) || northTerminus.includes(lastLower)) {
        return 'North';
    }
    if (lastLower.includes(southTerminus) || southTerminus.includes(lastLower)) {
        return 'South';
    }

    return null;
}

/**
 * Get both directions for a bidirectional route.
 * Returns the variant names for display/selection.
 *
 * @param baseRoute - Base route number (e.g., "12", "400")
 * @returns Object with north/south variants and termini, or null if not a bidirectional route
 */
export function getRouteDirections(baseRoute: string): {
    north: { variant: string; terminus: string };
    south: { variant: string; terminus: string };
} | null {
    const config = getRouteConfig(baseRoute);
    if (!config || config.segments.length !== 2) {
        return null;
    }

    const northSegment = config.segments.find(s => s.name === 'North');
    const southSegment = config.segments.find(s => s.name === 'South');

    if (!northSegment || !southSegment) {
        return null;
    }

    return {
        north: {
            variant: northSegment.variant,
            terminus: northSegment.terminus ?? '',
        },
        south: {
            variant: southSegment.variant,
            terminus: southSegment.terminus ?? '',
        },
    };
}

/**
 * Check if a route identifier represents a direction variant (like 12A, 12B)
 * versus a separate route (like 8A, 8B).
 *
 * @param routeIdentifier - Route string to check
 * @returns true if the A/B suffix indicates direction, false if it's a separate route
 */
export function isDirectionVariant(routeIdentifier: string): boolean {
    const parsed = parseRouteInfo(routeIdentifier);
    return parsed.suffixIsDirection;
}

/**
 * Get the opposite direction.
 * @param direction - Current direction
 * @returns Opposite direction
 */
export function getOppositeDirection(direction: Direction): Direction {
    return direction === 'North' ? 'South' : 'North';
}

/**
 * Validate a direction string and return typed Direction or null.
 * Use this to safely convert unknown strings to Direction type.
 *
 * @param value - String that might be a direction
 * @returns Direction type or null if invalid
 */
export function validateDirection(value: string | null | undefined): Direction | null {
    if (!value) return null;
    const lower = value.toLowerCase().trim();
    if (lower === 'north' || lower === 'n' || lower === 'nb' || lower === 'northbound') {
        return 'North';
    }
    if (lower === 'south' || lower === 's' || lower === 'sb' || lower === 'southbound') {
        return 'South';
    }
    return null;
}
