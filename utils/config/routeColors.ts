/**
 * Route Color Configuration
 * 
 * This utility provides a centralized mapping of route names to their official colors.
 * See docs/route-colors.md for the full reference.
 */

export const ROUTE_COLORS: Record<string, string> = {
    // Green routes
    '2A': '#006838',
    '2B': '#006838',
    '2': '#006838',

    // Orange routes
    '7A': '#F58220',
    '7B': '#F58220',
    '7': '#F58220',

    // Black routes
    '8A': '#000000',
    '8B': '#000000',
    '8': '#000000',

    // Loop routes
    '10': '#681757',
    '11': '#B2D235',

    // 12 series
    '12A': '#F8A1BE',
    '12B': '#F8A1BE',
    '12': '#F8A1BE',

    // Frequent / color routes
    '100': '#910005',
    '101': '#2464A2',

    // Express
    '400': '#00C4DC',
};

/**
 * Get the color for a specific route.
 * Falls back to a default gray if the route is not found.
 * 
 * @param routeName - The route identifier (e.g., "2A", "10", "400")
 * @returns The hex color code for the route
 */
export function getRouteColor(routeName: string): string {
    // Normalize the route name (uppercase, trim)
    const normalized = routeName?.toUpperCase().trim() || '';

    // Direct match
    if (ROUTE_COLORS[normalized]) {
        return ROUTE_COLORS[normalized];
    }

    // Try to extract base route number (e.g., "2A Weekday" -> "2A", "Route 400" -> "400")
    // Look for digits followed optionally by a letter
    const match = normalized.match(/(\d+[A-Z]?)/);
    if (match && ROUTE_COLORS[match[1]]) {
        return ROUTE_COLORS[match[1]];
    }

    // Fallback to a neutral gray
    return '#6B7280';
}

/**
 * Get the text color (white or black) that provides best contrast
 * against the route's background color.
 */
export function getRouteTextColor(routeName: string): 'white' | 'black' {
    const bgColor = getRouteColor(routeName);
    return getContrastingTextColor(bgColor);
}

/**
 * Get the text color (white or black) that provides best contrast
 * against any hex background color.
 */
export function getContrastingTextColor(backgroundColor: string): 'white' | 'black' {
    const normalized = backgroundColor.startsWith('#') ? backgroundColor : `#${backgroundColor}`;
    const hex = normalized.length === 4
        ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
        : normalized;

    if (!/^#[0-9A-F]{6}$/i.test(hex)) {
        return 'white';
    }

    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.5 ? 'black' : 'white';
}
