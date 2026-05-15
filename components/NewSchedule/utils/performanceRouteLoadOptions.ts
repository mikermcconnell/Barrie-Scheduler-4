import { parseRouteInfo } from '../../../utils/config/routeDirectionConfig';

const normalizeRouteId = (routeId: string): string => routeId.trim().toUpperCase();

/**
 * Step 1 loads complete planning routes. For routes where A/B suffixes are
 * directions (for example 7A + 7B), planners should choose Route 7, not one
 * half of the route. Variant routes such as 8A and 8B remain separate routes.
 */
export function getFullPerformanceLoadRouteId(routeId: string): string {
    const normalized = normalizeRouteId(routeId);
    if (!normalized) return normalized;

    const parsed = parseRouteInfo(normalized);
    return parsed.suffixIsDirection ? parsed.baseRoute.toUpperCase() : normalized;
}

export function buildFullPerformanceLoadRouteIds(routeIds: string[]): string[] {
    return Array.from(new Set(routeIds.map(getFullPerformanceLoadRouteId).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}
