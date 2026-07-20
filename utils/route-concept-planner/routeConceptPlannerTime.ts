const MINUTES_PER_DAY = 24 * 60;

export interface RouteConceptServiceTime {
    minutes: number;
    nextDay: boolean;
    label: string;
}

export function parseRouteConceptServiceTime(value: string): number | null {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*\+\s*(\d+)\s*day(?:s)?)?$/i);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const explicitDays = match[3] == null ? 0 : Number(match[3]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isInteger(explicitDays)) return null;
    if (hours < 0 || minutes < 0 || minutes >= 60 || explicitDays < 0) return null;

    return (hours * 60) + minutes + (explicitDays * MINUTES_PER_DAY);
}

export function normalizeRouteConceptServiceSpan(
    firstDepartureMinutes: number,
    lastDepartureMinutes: number,
): { firstDepartureMinutes: number; lastDepartureMinutes: number; serviceSpanMinutes: number } | null {
    if (!Number.isFinite(firstDepartureMinutes) || !Number.isFinite(lastDepartureMinutes)) return null;
    if (firstDepartureMinutes < 0 || lastDepartureMinutes < 0) return null;

    let orderedLastDeparture = lastDepartureMinutes;
    while (orderedLastDeparture < firstDepartureMinutes) {
        orderedLastDeparture += MINUTES_PER_DAY;
    }

    return {
        firstDepartureMinutes,
        lastDepartureMinutes: orderedLastDeparture,
        serviceSpanMinutes: orderedLastDeparture - firstDepartureMinutes,
    };
}
export function formatRouteConceptServiceTime(value: number): RouteConceptServiceTime | null {
    if (!Number.isFinite(value) || value < 0) return null;
    const rounded = Math.round(value);
    const dayOffset = Math.floor(rounded / MINUTES_PER_DAY);
    const withinDay = rounded % MINUTES_PER_DAY;
    const hours = Math.floor(withinDay / 60);
    const minutes = withinDay % 60;
    const clock = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    return {
        minutes: rounded,
        nextDay: dayOffset > 0,
        label: dayOffset > 0 ? `${clock} (+${dayOffset} day${dayOffset === 1 ? '' : 's'})` : clock,
    };
}
