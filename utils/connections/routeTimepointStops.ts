import type { MasterRouteTable } from '../parsers/masterScheduleParser';
import type { StopInfo } from './connectionTypes';

const normalizeStopName = (value?: string): string => value?.trim() || '';

const isMajorTimepointStop = (stopName: string, index: number, stops: string[]): boolean => {
    if (index === 0 || index === stops.length - 1) return true;

    const normalized = stopName.toLowerCase();
    return (
        normalized.includes('terminal')
        || normalized.includes('station')
        || normalized.includes('downtown')
        || normalized.includes('allandale')
        || normalized.includes('georgian')
        || normalized.includes('park place')
        || (normalized.includes('sproule') && normalized.includes('kraus'))
        || normalized.includes('college')
        || normalized.includes('go')
    );
};

const pickDisplayTimepoints = (stops: string[]): string[] => {
    const cleanStops = stops
        .map(stop => normalizeStopName(stop))
        .filter(Boolean);

    if (cleanStops.length <= 3) return cleanStops;

    const filtered = cleanStops.filter((stop, index) => isMajorTimepointStop(stop, index, cleanStops));
    if (filtered.length >= 2) return filtered;

    const midpoint = cleanStops[Math.floor(cleanStops.length / 2)];
    return Array.from(new Set([cleanStops[0], midpoint, cleanStops[cleanStops.length - 1]]));
};

const collectOrderedStops = (
    schedules: Pick<MasterRouteTable, 'stops' | 'stopIds'>[],
    stopNameSelector: (stops: string[]) => string[]
): StopInfo[] => {
    const seenCodes = new Set<string>();
    const orderedStops: StopInfo[] = [];

    schedules.forEach(table => {
        const selectedStopNames = stopNameSelector(table.stops || []);
        selectedStopNames.forEach(stopName => {
            const code = table.stopIds?.[stopName]?.trim();
            if (!code || seenCodes.has(code)) return;

            seenCodes.add(code);
            orderedStops.push({ code, name: stopName });
        });
    });

    return orderedStops;
};

/**
 * Build the route stop options used by the connection builder.
 *
 * This intentionally mirrors the schedule editor's lighter "timepoints" view
 * so connection setup stays focused on major timing points instead of every
 * intermediate stop on the route.
 */
export function buildRouteTimepointStopOptions(
    schedules: Pick<MasterRouteTable, 'stops' | 'stopIds'>[]
): StopInfo[] {
    const timepointStops = collectOrderedStops(schedules, pickDisplayTimepoints);
    if (timepointStops.length >= 2) return timepointStops;

    return collectOrderedStops(schedules, stops => stops.map(stop => normalizeStopName(stop)).filter(Boolean));
}
