import type { DayType } from '../masterScheduleTypes';

export type BrochureDayKey = 'weekday' | 'saturday' | 'sunday';

export interface DeduplicatedStops {
    displayStops: string[];
    stopMapping: string[];
}

export const BROCHURE_DAY_ORDER: DayType[] = ['Weekday', 'Saturday', 'Sunday'];

export const getBrochureDayKey = (dayType: DayType): BrochureDayKey => {
    switch (dayType) {
        case 'Saturday':
            return 'saturday';
        case 'Sunday':
            return 'sunday';
        default:
            return 'weekday';
    }
};

export const getBrochureDayLabel = (dayType: DayType): string => {
    switch (dayType) {
        case 'Sunday':
            return 'Sunday & Holidays';
        default:
            return dayType;
    }
};

export const stripStopSuffix = (stop: string): string => {
    return stop.replace(/\s*\(\d+\)$/, '');
};

/**
 * When a stop appears more than once in a direction table,
 * keep the last occurrence for public display.
 */
export const deduplicateStopsForBrochure = (stops: string[]): DeduplicatedStops => {
    const seenStops = new Map<string, number>();

    stops.forEach((stop, idx) => {
        const cleanName = stripStopSuffix(stop);
        seenStops.set(cleanName, idx);
    });

    const displayStops: string[] = [];
    const stopMapping: string[] = [];
    const addedStops = new Set<string>();

    stops.forEach((stop, idx) => {
        const cleanName = stripStopSuffix(stop);
        if (seenStops.get(cleanName) === idx && !addedStops.has(cleanName)) {
            displayStops.push(cleanName);
            stopMapping.push(stop);
            addedStops.add(cleanName);
        }
    });

    return { displayStops, stopMapping };
};

export const formatCompactTime = (timeStr: string | undefined): string => {
    if (!timeStr) return '-';

    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return timeStr.replace(/\s*(AM|PM)$/i, '').trim();

    let hours = parseInt(match[1], 10);
    const mins = match[2];
    const period = match[3]?.toUpperCase();

    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return `${hours}:${mins}`;
};

export const formatBrochureStopName = (
    stop: string,
    stopIndex: number,
    totalStops: number,
): string => {
    const isFirst = stopIndex === 0;
    const isLast = stopIndex === totalStops - 1;

    if (isFirst) return `${stop} (Depart)`;
    if (isLast) return `${stop} (Arrive)`;
    return stop;
};
