/**
 * Route Direction Configuration
 *
 * Defines how direction works for each Barrie Transit route.
 *
 * Types:
 * - linear: Has North and South directions (may use A/B suffix as direction indicator)
 * - loop: Single direction (clockwise or counter-clockwise)
 *
 * A/B Suffix Meanings:
 * - Routes 2, 7, 12: A = North, B = South (suffix IS the direction)
 * - Routes 8A, 8B: A and B are route variants (each has its own NB + SB)
 */

export type RouteType = 'linear' | 'loop';
export type LoopDirection = 'clockwise' | 'counter-clockwise';

export interface LinearRouteConfig {
    type: 'linear';
    northVariant: string;  // Route name for northbound (e.g., "12A", "400")
    southVariant: string;  // Route name for southbound (e.g., "12B", "400")
    northTerminus: string; // North end terminal
    southTerminus: string; // South end terminal
}

export interface LoopRouteConfig {
    type: 'loop';
    direction: LoopDirection;
    variant: string;  // Route name (e.g., "100", "10")
}

export type RouteConfig = LinearRouteConfig | LoopRouteConfig;

/**
 * Master route direction configuration.
 * Key is the base route number as it appears in schedule files.
 */
export const ROUTE_DIRECTIONS: Record<string, RouteConfig> = {
    // Route 400 - Linear, uses explicit North/South
    '400': {
        type: 'linear',
        northVariant: '400',
        southVariant: '400',
        northTerminus: 'RVH',
        southTerminus: 'Park Place',
    },

    // Route 2 - Linear, A/B suffix = direction
    '2': {
        type: 'linear',
        northVariant: '2A',
        southVariant: '2B',
        northTerminus: 'Downtown',
        southTerminus: 'Park Place',
    },

    // Route 7 - Linear, A/B suffix = direction
    '7': {
        type: 'linear',
        northVariant: '7A',
        southVariant: '7B',
        northTerminus: 'Georgian College',
        southTerminus: 'Park Place',
    },

    // Route 8A - Linear, full route with both directions
    '8A': {
        type: 'linear',
        northVariant: '8A',
        southVariant: '8A',
        northTerminus: 'Georgian College',
        southTerminus: 'Barrie South GO',
    },

    // Route 8B - Linear, full route with both directions
    '8B': {
        type: 'linear',
        northVariant: '8B',
        southVariant: '8B',
        northTerminus: 'Georgian College',
        southTerminus: 'Barrie South GO',
    },

    // Route 10 - Loop (clockwise)
    '10': {
        type: 'loop',
        direction: 'clockwise',
        variant: '10',
    },

    // Route 11 - Loop (counter-clockwise)
    '11': {
        type: 'loop',
        direction: 'counter-clockwise',
        variant: '11',
    },

    // Route 12 - Linear, A/B suffix = direction
    '12': {
        type: 'linear',
        northVariant: '12A',
        southVariant: '12B',
        northTerminus: 'Georgian College',
        southTerminus: 'Barrie South GO',
    },

    // Route 100 - Loop (clockwise)
    '100': {
        type: 'loop',
        direction: 'clockwise',
        variant: '100',
    },

    // Route 101 - Loop (counter-clockwise)
    '101': {
        type: 'loop',
        direction: 'counter-clockwise',
        variant: '101',
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

    if (config.type === 'loop') {
        return config.variant;
    }

    return direction === 'North' ? config.northVariant : config.southVariant;
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

    if (config.type === 'loop') {
        return config.direction === 'clockwise' ? 'Clockwise' : 'Counter-clockwise';
    }

    if (!direction) {
        return 'Unknown';
    }

    const variant = direction === 'North' ? config.northVariant : config.southVariant;
    const terminus = direction === 'North' ? config.northTerminus : config.southTerminus;

    // If variant differs from base (e.g., 12A vs 12), show it
    if (variant !== baseRoute) {
        return `${variant} (${direction} → ${terminus})`;
    }

    return `${direction} → ${terminus}`;
}

/**
 * Check if a route uses A/B suffix as direction indicator.
 * @param baseRoute - The base route number (e.g., "2", "7", "12")
 * @returns true if A=North, B=South for this route
 */
export function usesVariantAsDirection(baseRoute: string): boolean {
    const config = ROUTE_DIRECTIONS[baseRoute];
    if (!config || config.type === 'loop') return false;

    // If north and south variants differ, the suffix IS the direction
    return config.northVariant !== config.southVariant;
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
    /** Route type from config */
    type: RouteType | null;
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
        return {
            baseRoute: cleaned,
            direction: null, // Direction not embedded in the identifier itself
            variant: cleaned,
            type: config.type,
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
        if (baseConfig && baseConfig.type === 'linear') {
            // Verify this route uses variant suffixes for direction
            if (baseConfig.northVariant !== baseConfig.southVariant) {
                // Routes like 2, 7, 12 where A=North, B=South
                return {
                    baseRoute: numericPart,
                    direction: suffix === 'A' ? 'North' : 'South',
                    variant: cleaned,
                    type: 'linear',
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
        return {
            baseRoute: withoutSuffix,
            direction: null,
            variant: cleaned,
            type: config.type,
            suffixIsDirection: false,
        };
    }

    // Unknown route
    return {
        baseRoute: cleaned,
        direction: null,
        variant: cleaned,
        type: null,
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
    if (!config || config.type !== 'linear') {
        return null;
    }

    const firstLower = firstStop.toLowerCase();
    const lastLower = lastStop.toLowerCase();
    const northTerminus = config.northTerminus.toLowerCase();
    const southTerminus = config.southTerminus.toLowerCase();

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
 * Get both directions for a linear route.
 * Returns the variant names for display/selection.
 *
 * @param baseRoute - Base route number (e.g., "12", "400")
 * @returns Object with north/south variants and termini, or null if not a linear route
 */
export function getRouteDirections(baseRoute: string): {
    north: { variant: string; terminus: string };
    south: { variant: string; terminus: string };
} | null {
    const config = getRouteConfig(baseRoute);
    if (!config || config.type !== 'linear') {
        return null;
    }

    return {
        north: {
            variant: config.northVariant,
            terminus: config.northTerminus,
        },
        south: {
            variant: config.southVariant,
            terminus: config.southTerminus,
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
