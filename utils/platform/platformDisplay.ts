import { isDirectionVariant, parseRouteInfo } from '../config/routeDirectionConfig';

type PlatformDirection = 'North' | 'South';

export function getPlatformDirectionBadge(
    route: string,
    direction: PlatformDirection
): PlatformDirection | null {
    return isDirectionVariant(route) ? null : direction;
}

export const getPlatformDirectionDisplay = getPlatformDirectionBadge;

export function formatPlatformRouteDirection(
    route: string,
    direction: PlatformDirection
): string {
    const badge = getPlatformDirectionBadge(route, direction);
    return badge ? `${route} ${badge}` : route;
}

export function describePlatformRouteDirection(
    route: string,
    direction: PlatformDirection
): string {
    return `${route} (${direction})`;
}

export function getDisplayRoutes(routes: string[]): string[] {
    const seen = new Set<string>();
    const normalizedRoutes = routes.filter(route => {
        const normalized = route.trim();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });

    const basesWithDirectionalVariants = new Set<string>();
    for (const route of normalizedRoutes) {
        const parsed = parseRouteInfo(route);
        if (parsed.suffixIsDirection && parsed.variant.toUpperCase() !== parsed.baseRoute.toUpperCase()) {
            basesWithDirectionalVariants.add(parsed.baseRoute.toUpperCase());
        }
    }

    return normalizedRoutes.filter(route => {
        const parsed = parseRouteInfo(route);
        const normalizedRoute = route.trim().toUpperCase();
        return !(basesWithDirectionalVariants.has(parsed.baseRoute.toUpperCase()) && normalizedRoute === parsed.baseRoute.toUpperCase());
    });
}
