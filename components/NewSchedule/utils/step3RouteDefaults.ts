import { parseRouteInfo } from '../../../utils/config/routeDirectionConfig';

export interface Step3RouteDefaults {
    cycleMode: 'Strict' | 'Floating';
    cycleTime?: number;
}

const ROUTE_DEFAULTS: Record<string, Step3RouteDefaults> = {
    '2': { cycleMode: 'Strict', cycleTime: 90 },
    '7': { cycleMode: 'Strict', cycleTime: 120 },
    '8A': { cycleMode: 'Strict', cycleTime: 150 },
    '8B': { cycleMode: 'Strict', cycleTime: 150 },
    '10': { cycleMode: 'Strict', cycleTime: 60 },
    '11': { cycleMode: 'Strict', cycleTime: 60 },
    '12': { cycleMode: 'Floating' },
    '100': { cycleMode: 'Floating' },
    '101': { cycleMode: 'Floating' },
    '100-101': { cycleMode: 'Floating' },
    '400': { cycleMode: 'Strict', cycleTime: 60 },
};

const normalizeRouteKey = (routeNumber: string): string => (
    routeNumber
        .replace(/^route\s*/i, '')
        .replace(/\s*-\s*/g, '-')
        .trim()
        .toUpperCase()
);

export const getStep3RouteDefaults = (routeNumber?: string | null): Step3RouteDefaults | null => {
    const normalizedRoute = normalizeRouteKey(routeNumber ?? '');
    if (!normalizedRoute) return null;

    if (ROUTE_DEFAULTS[normalizedRoute]) {
        return ROUTE_DEFAULTS[normalizedRoute];
    }

    const parsed = parseRouteInfo(normalizedRoute);
    if (ROUTE_DEFAULTS[parsed.variant.toUpperCase()]) {
        return ROUTE_DEFAULTS[parsed.variant.toUpperCase()];
    }
    if (ROUTE_DEFAULTS[parsed.baseRoute.toUpperCase()]) {
        return ROUTE_DEFAULTS[parsed.baseRoute.toUpperCase()];
    }

    return null;
};
