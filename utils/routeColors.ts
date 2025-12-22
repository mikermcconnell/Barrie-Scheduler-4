/**
 * Route Color Configuration
 * 
 * This utility provides a centralized mapping of route names to their official colors.
 * See docs/route-colors.md for the full reference.
 */

export const ROUTE_COLORS: Record<string, string> = {
    // Green routes
    '2A': '#22C55E',
    '2B': '#22C55E',
    '2': '#22C55E', // Fallback for just "2"

    // Blue/Orange routes (7 series) - both are orange
    '7A': '#F97316',
    '7B': '#F97316',
    '7': '#F97316', // Fallback

    // Black routes (8 series)
    '8A': '#1F2937',
    '8B': '#1F2937',
    '8': '#1F2937', // Fallback

    // Standalone routes
    '10': '#EC4899', // Magenta/Pink
    '11': '#84CC16', // Lime/Yellow-Green

    // 12 series - same color
    '12A': '#F472B6', // Pink
    '12B': '#F472B6', // Pink
    '12': '#F472B6', // Fallback

    // 100 series
    '100': '#EF4444', // Red
    '101': '#1E40AF', // Navy Blue

    // 400 series
    '400': '#14B8A6', // Teal/Cyan
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

    // Try to extract base route number (e.g., "2A Weekday" -> "2A")
    const match = normalized.match(/^(\d+[A-Z]?)/);
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

    // Parse hex to RGB
    const r = parseInt(bgColor.slice(1, 3), 16);
    const g = parseInt(bgColor.slice(3, 5), 16);
    const b = parseInt(bgColor.slice(5, 7), 16);

    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return white for dark backgrounds, black for light
    return luminance > 0.5 ? 'black' : 'white';
}
