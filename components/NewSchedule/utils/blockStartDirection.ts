import { getRouteConfig } from '../../../utils/config/routeDirectionConfig';

export type BlockStartDirection = 'North' | 'South';

export const normalizeStopName = (value: string): string => {
    return value
        .toLowerCase()
        .replace(/^(arrive|arrival|depart|departure)\s+/i, '')
        .replace(/\s*\(\d+\)\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
};

const isRoute8Family = (routeNumber: string): boolean => {
    const normalized = routeNumber.trim().toUpperCase();
    return normalized === '8' || normalized === '8A' || normalized === '8B';
};

export const matchesStop = (needle: string, target: string): boolean => {
    return !!needle && !!target && (needle.includes(target) || target.includes(needle));
};

/**
 * Infer starting trip direction from the configured block start stop.
 *
 * For Route 8 family:
 * - Starts at Park Place => first trip is North
 * - Starts at Georgian College => first trip is South
 */
export const inferBlockStartDirection = (
    routeNumber: string,
    startStop?: string
): BlockStartDirection | null => {
    const normalizedStartStop = normalizeStopName(startStop || '');
    if (!normalizedStartStop) return null;

    const normalizedRoute = routeNumber.trim().toUpperCase();
    const routeConfig = getRouteConfig(normalizedRoute);

    let northTerminus = '';
    let southTerminus = '';

    if (routeConfig && routeConfig.segments.length === 2) {
        northTerminus = normalizeStopName(
            routeConfig.segments.find(s => s.name === 'North')?.terminus || ''
        );
        southTerminus = normalizeStopName(
            routeConfig.segments.find(s => s.name === 'South')?.terminus || ''
        );
    }

    // Route 8 fallback in case route is entered as plain "8".
    if ((!northTerminus || !southTerminus) && isRoute8Family(normalizedRoute)) {
        northTerminus = normalizeStopName('Georgian College');
        southTerminus = normalizeStopName('Park Place');
    }

    if (matchesStop(normalizedStartStop, southTerminus)) return 'North';
    if (matchesStop(normalizedStartStop, northTerminus)) return 'South';

    // Additional fuzzy fallback for Route 8.
    if (isRoute8Family(normalizedRoute)) {
        if (normalizedStartStop.includes('park place')) return 'North';
        if (normalizedStartStop.includes('georgian')) return 'South';
    }

    return null;
};

export const shouldShowStartDirectionForRoute = (routeNumber: string): boolean => {
    const normalized = routeNumber.trim().toUpperCase();
    const config = getRouteConfig(normalized);
    if (config && config.segments.length === 2) return true;
    return isRoute8Family(normalized);
};

export const normalizeDirectionHint = (value?: string): BlockStartDirection | null => {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'north') return 'North';
    if (normalized === 'south') return 'South';
    return null;
};

/**
 * Resolve block start direction for display:
 * 1) infer from configured start stop
 * 2) fallback to parser-derived direction hint (if available)
 */
export const resolveBlockStartDirection = (
    routeNumber: string,
    startStop?: string,
    parserDirectionHint?: string
): BlockStartDirection | null => {
    return inferBlockStartDirection(routeNumber, startStop)
        ?? normalizeDirectionHint(parserDirectionHint);
};
