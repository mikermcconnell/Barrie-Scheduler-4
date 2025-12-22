/**
 * Route Name Parser
 * 
 * Utilities for parsing and manipulating route names with their
 * day type and direction components.
 * 
 * Route names follow the pattern: "400 (Weekday) (North) (To RVH)"
 * - Route number: "400"
 * - Day type: "Weekday" | "Saturday" | "Sunday"
 * - Direction: "North" | "South" | null (for loops)
 * - Destination: optional suffix like "(To RVH)"
 */

export type DayType = 'Weekday' | 'Saturday' | 'Sunday';
export type DaySuffix = 'WD' | 'SA' | 'SU';
export type Direction = 'North' | 'South';

export interface ParsedRouteName {
    /** Raw route name as stored (e.g., "400 (Weekday) (North)") */
    raw: string;
    /** Just the route number (e.g., "400", "8A", "2") */
    number: string;
    /** Day type for the schedule */
    dayType: DayType;
    /** Short suffix for block IDs (WD, SA, SU) */
    daySuffix: DaySuffix;
    /** Direction if bidirectional, null for loops */
    direction: Direction | null;
    /** Route name without direction (e.g., "400 (Weekday)") */
    baseName: string;
    /** Route name without day or direction (e.g., "400") */
    baseNameNoDay: string;
}

/**
 * Map from day type to short suffix
 */
const DAY_SUFFIX_MAP: Record<DayType, DaySuffix> = {
    'Weekday': 'WD',
    'Saturday': 'SA',
    'Sunday': 'SU'
};

/**
 * Parse a route name into its component parts.
 */
export const parseRouteName = (routeName: string): ParsedRouteName => {
    const raw = routeName;

    // Extract day type
    let dayType: DayType = 'Weekday';
    if (routeName.includes('Saturday')) dayType = 'Saturday';
    else if (routeName.includes('Sunday')) dayType = 'Sunday';

    const daySuffix = DAY_SUFFIX_MAP[dayType];

    // Extract direction
    let direction: Direction | null = null;
    if (routeName.includes('(North)')) direction = 'North';
    else if (routeName.includes('(South)')) direction = 'South';

    // Extract base name (without direction)
    const baseName = routeName
        .replace(/ \(North\).*$/, '')
        .replace(/ \(South\).*$/, '');

    // Extract base name without day
    const baseNameNoDay = routeName
        .replace(/\s?\((Weekday|Saturday|Sunday)\)/g, '')
        .replace(/\s?\((North|South)\)/g, '')
        .replace(/\s?\(To .*?\)/g, '')
        .trim();

    // Route number is the first word
    const number = baseNameNoDay.split(' ')[0];

    return {
        raw,
        number,
        dayType,
        daySuffix,
        direction,
        baseName,
        baseNameNoDay
    };
};

/**
 * Get the day type suffix (WD, SA, SU) from a route name.
 */
export const getDayTypeSuffix = (routeName: string): DaySuffix => {
    if (routeName.includes('Saturday')) return 'SA';
    if (routeName.includes('Sunday')) return 'SU';
    return 'WD';
};

/**
 * Get the readable day type label from a route name.
 */
export const getDayTypeLabel = (routeName: string): DayType => {
    if (routeName.includes('Saturday')) return 'Saturday';
    if (routeName.includes('Sunday')) return 'Sunday';
    return 'Weekday';
};

/**
 * Get the route number from a route name.
 */
export const getRouteNumber = (routeName: string): string => {
    return parseRouteName(routeName).number;
};

/**
 * Check if two route names are for the same base route (ignoring direction).
 */
export const isSameRoute = (routeName1: string, routeName2: string): boolean => {
    const parsed1 = parseRouteName(routeName1);
    const parsed2 = parseRouteName(routeName2);
    return parsed1.number === parsed2.number && parsed1.dayType === parsed2.dayType;
};

/**
 * Check if a route name is for a bidirectional route.
 */
export const isBidirectional = (routeName: string): boolean => {
    return routeName.includes('(North)') || routeName.includes('(South)');
};

/**
 * Generate a block ID for a new block.
 * Format: {routeNumber}-{daySuffix}-{number}
 * Example: "400-WD-5"
 */
export const generateBlockId = (
    routeNumber: string,
    daySuffix: DaySuffix,
    blockNumber: number
): string => {
    return `${routeNumber}-${daySuffix}-${blockNumber}`;
};

/**
 * Parse a block ID into its components.
 * Returns null if the format is not recognized.
 */
export const parseBlockId = (blockId: string): {
    routeNumber: string;
    daySuffix: DaySuffix | null;
    number: number
} | null => {
    // Try new format: 400-WD-5
    const newMatch = blockId.match(/^(\w+)-(WD|SA|SU)-(\d+)$/);
    if (newMatch) {
        return {
            routeNumber: newMatch[1],
            daySuffix: newMatch[2] as DaySuffix,
            number: parseInt(newMatch[3])
        };
    }

    // Try old format: 400-5
    const oldMatch = blockId.match(/^(\w+)-(\d+)$/);
    if (oldMatch) {
        return {
            routeNumber: oldMatch[1],
            daySuffix: null,
            number: parseInt(oldMatch[2])
        };
    }

    return null;
};
