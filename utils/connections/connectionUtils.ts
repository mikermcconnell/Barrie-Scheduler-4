/**
 * Connection Utilities
 *
 * Helper functions to compute connection status for trips at stops
 * that have connection targets (GO Trains, Georgian College bells, etc.)
 */

import type {
    ConnectionLibrary,
    ConnectionTarget,
    ConnectionTime,
    ConnectionQuality,
    ConnectionQualityWindowSettings,
    ConnectionEventType,
    ConnectionType,
    RouteConnection
} from './connectionTypes';
import type { DayType } from '../parsers/masterScheduleParser';
import {
    formatConnectionTime,
    DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS
} from './connectionTypes';
import { getRouteVariant, parseRouteInfo } from '../config/routeDirectionConfig';

// Only show connection indicators when the timing is realistically connectable:
// - At most 20 minutes early (bus arrives too early beyond this is not actionable)
// - At most 7 minutes late (bus misses beyond this is not a practical connection)
const MAX_EARLY_MINUTES = 20;
const MAX_LATE_MINUTES = 7;

export interface StopConnectionTripTimes {
    arrival?: number | null;
    departure?: number | null;
}

/**
 * A matched connection for display in the schedule table.
 */
export interface ConnectionMatch {
    connectionId?: string;      // RouteConnection.id when attached to a specific route rule
    targetId: string;           // Connection target ID
    targetName: string;         // "Georgian College Bells"
    targetShortLabel?: string;  // "7A", "2B", "GO"
    targetTime: number;         // 480 (8:00am bell) - minutes from midnight
    targetTimeLabel: string;    // "8:00a Bell" or "8:00a"
    tripTime: number;           // 475 (7:55am arrival) - minutes from midnight
    eventType: ConnectionEventType; // departure | arrival
    busAnchor: 'arrival' | 'departure'; // Which bus-side event this connection should attach to in the UI
    gapMinutes: number;         // Positive = preferred direction margin (before departure / after arrival)
    meetsConnection: boolean;   // true when gapMinutes >= 0
    quality: ConnectionQuality; // excellent | good | bad
    icon: 'train' | 'clock' | 'bus';
}

function normalizeRouteToken(value?: string): string | undefined {
    const token = value?.trim().toUpperCase().match(/\d+[A-Z]?/)?.[0];
    return token || undefined;
}

function getDirectionSuffix(direction?: ConnectionTarget['direction']): 'N' | 'S' | '' {
    if (direction === 'North') return 'N';
    if (direction === 'South') return 'S';
    return '';
}

function getRouteShortLabel(target: ConnectionTarget): string | undefined {
    const routeIdentityLabel = target.routeIdentity?.replace(/-(Weekday|Saturday|Sunday)$/i, '').trim();
    const parsed = routeIdentityLabel ? parseRouteInfo(routeIdentityLabel) : null;

    if (parsed) {
        if (parsed.suffixIsDirection && target.direction) {
            return normalizeRouteToken(getRouteVariant(parsed.baseRoute, target.direction))
                || normalizeRouteToken(parsed.variant);
        }

        const baseToken = normalizeRouteToken(parsed.variant);
        if (!baseToken) return undefined;

        if (/[A-Z]$/.test(baseToken)) {
            return baseToken;
        }

        const directionSuffix = getDirectionSuffix(target.direction);
        return directionSuffix ? `${baseToken}${directionSuffix}` : baseToken;
    }

    const routeMatch = target.name.match(/route\s+([A-Za-z0-9]+)/i);
    const matchedToken = normalizeRouteToken(routeMatch?.[1]);
    if (!matchedToken) return undefined;

    if (/[A-Z]$/.test(matchedToken)) {
        return matchedToken;
    }

    const directionSuffix = getDirectionSuffix(target.direction);
    return directionSuffix ? `${matchedToken}${directionSuffix}` : matchedToken;
}

function getTargetShortLabel(target: ConnectionTarget): string | undefined {
    if (target.icon === 'train') return 'GO';
    if (target.icon === 'bus') return getRouteShortLabel(target);
    return undefined;
}

export function getBusAnchorForConnectionEvent(
    eventType: ConnectionEventType
): 'arrival' | 'departure' {
    return eventType === 'arrival' ? 'departure' : 'arrival';
}

function getBusAnchorForConnectionType(
    connectionType: ConnectionType
): 'arrival' | 'departure' {
    return connectionType === 'meet_departing' ? 'arrival' : 'departure';
}

/**
 * Find all connection targets that apply to a given stop code.
 */
function findMatchingTargets(
    stopCode: string,
    connectionLibrary: ConnectionLibrary
): ConnectionTarget[] {
    if (!stopCode || !connectionLibrary?.targets) return [];

    return connectionLibrary.targets.filter(target => {
        // Direct stopCode match
        if (target.stopCode === stopCode) return true;

        // autoPopulateStops: check if stopCode is in the stopCodes array
        if (target.autoPopulateStops && target.stopCodes?.includes(stopCode)) {
            return true;
        }

        return false;
    });
}

/**
 * Find the next connection time after a given trip time for a target.
 * Returns null if no applicable time found.
 */
function getEventType(connectionTime: ConnectionTime, target: ConnectionTarget): ConnectionEventType {
    return connectionTime.eventType || target.defaultEventType || 'departure';
}

function normalizeTripTimes(tripTime: number | StopConnectionTripTimes): StopConnectionTripTimes {
    if (typeof tripTime === 'number') {
        return {
            arrival: tripTime,
            departure: tripTime
        };
    }
    return tripTime;
}

function getTripTimeForEvent(
    eventType: ConnectionEventType,
    tripTime: number | StopConnectionTripTimes
): number | null {
    const normalizedTripTime = normalizeTripTimes(tripTime);

    if (eventType === 'arrival') {
        return normalizedTripTime.departure ?? normalizedTripTime.arrival ?? null;
    }

    return normalizedTripTime.arrival ?? normalizedTripTime.departure ?? null;
}

function getTripTimeForConnectionType(
    connectionType: ConnectionType,
    tripTime: number | StopConnectionTripTimes
): number | null {
    const normalizedTripTime = normalizeTripTimes(tripTime);

    if (connectionType === 'meet_departing') {
        return normalizedTripTime.arrival ?? null;
    }

    return normalizedTripTime.departure ?? null;
}

function getGapForEvent(
    connectionTime: ConnectionTime,
    target: ConnectionTarget,
    tripTime: number | StopConnectionTripTimes
): number | null {
    const eventType = getEventType(connectionTime, target);
    const eventTripTime = getTripTimeForEvent(eventType, tripTime);
    if (eventTripTime === null) return null;

    if (eventType === 'arrival') {
        // For train arrivals, bus should depart AFTER train arrives.
        return eventTripTime - connectionTime.time;
    }
    // For departures, bus should arrive BEFORE train departs.
    return connectionTime.time - eventTripTime;
}

function getGapForConnectionType(
    connectionType: ConnectionType,
    connectionTime: ConnectionTime,
    tripTime: number | StopConnectionTripTimes
): number | null {
    const eventTripTime = getTripTimeForConnectionType(connectionType, tripTime);
    if (eventTripTime === null) return null;

    if (connectionType === 'meet_departing') {
        return connectionTime.time - eventTripTime;
    }

    return eventTripTime - connectionTime.time;
}

function findPreferredConnectionTime(
    target: ConnectionTarget,
    tripTime: number | StopConnectionTripTimes,
    dayType: DayType,
    connectionType?: ConnectionType
): ConnectionTime | null {
    if (!target.times || target.times.length === 0) return null;

    const applicableTimes = target.times.filter(t => t.enabled && t.daysActive.includes(dayType));
    if (applicableTimes.length === 0) return null;

    const candidateTimes = applicableTimes
        .map(time => ({
            time,
            gap: connectionType
                ? getGapForConnectionType(connectionType, time, tripTime)
                : getGapForEvent(time, target, tripTime)
        }))
        .filter((candidate): candidate is { time: ConnectionTime; gap: number } => candidate.gap !== null);

    if (candidateTimes.length === 0) return null;

    // Preferred candidates are in the "connectable" direction:
    // - departure: train departs at/after bus time
    // - arrival: train arrives at/before bus time
    const preferred = candidateTimes
        .filter(candidate => candidate.gap >= 0)
        .sort((a, b) => a.gap - b.gap);

    if (preferred.length > 0) return preferred[0].time;

    // Fallback to closest overall (shows missed/too-early context).
    const closest = candidateTimes.sort(
        (a, b) => Math.abs(a.gap) - Math.abs(b.gap)
    );
    return closest.length > 0 ? closest[0].time : null;
}

function getApplicableRouteConnections(
    stopCode: string,
    targetId: string,
    routeConnections?: RouteConnection[] | null
): Array<RouteConnection | undefined> {
    if (!routeConnections) return [undefined];

    const normalizedStopCode = stopCode.trim();
    return routeConnections.filter(connection => (
        connection.enabled
        && connection.targetId === targetId
        && connection.stopCode?.trim() === normalizedStopCode
    ));
}

function getQualitySettings(connectionLibrary: ConnectionLibrary): ConnectionQualityWindowSettings {
    return connectionLibrary.qualityWindowSettings || DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS;
}

function classifyConnectionQuality(
    gapMinutes: number,
    qualitySettings: ConnectionQualityWindowSettings
): ConnectionQuality {
    // Late arrivals are always a bad connection.
    if (gapMinutes < 0) return 'bad';

    if (gapMinutes >= qualitySettings.excellentMin && gapMinutes <= qualitySettings.excellentMax) {
        return 'excellent';
    }

    if (gapMinutes >= qualitySettings.goodMin && gapMinutes <= qualitySettings.goodMax) {
        return 'good';
    }

    return 'bad';
}

/**
 * Get all connection matches for a stop at a given time.
 *
 * @param stopCode - The stop code (e.g., "330" for Georgian College)
 * @param tripTime - The trip time at this stop. Pass a single number for departure-only stops,
 * or { arrival, departure } when terminal recovery means the bus arrival and departure differ.
 * @param connectionLibrary - The team's connection library
 * @param dayType - The current day type (Weekday, Saturday, Sunday)
 * @returns Array of connection matches with status info
 */
export function getConnectionsForStop(
    stopCode: string,
    tripTime: number | StopConnectionTripTimes | null,
    connectionLibrary: ConnectionLibrary | null,
    dayType: DayType,
    routeConnections?: RouteConnection[] | null
): ConnectionMatch[] {
    if (!stopCode || tripTime === null || !connectionLibrary) return [];

    const libraryQualitySettings = getQualitySettings(connectionLibrary);
    const matchingTargets = findMatchingTargets(stopCode, connectionLibrary);
    const matches: ConnectionMatch[] = [];

    for (const target of matchingTargets) {
        const applicableRouteConnections = getApplicableRouteConnections(stopCode, target.id, routeConnections);
        if (applicableRouteConnections.length === 0) continue;

        for (const routeConnection of applicableRouteConnections) {
            const connTime = findPreferredConnectionTime(
                target,
                tripTime,
                dayType,
                routeConnection?.connectionType
            );

            if (!connTime) continue;

            const eventType = getEventType(connTime, target);
            const gapMinutes = routeConnection
                ? getGapForConnectionType(routeConnection.connectionType, connTime, tripTime)
                : getGapForEvent(connTime, target, tripTime);
            const eventTripTime = routeConnection
                ? getTripTimeForConnectionType(routeConnection.connectionType, tripTime)
                : getTripTimeForEvent(eventType, tripTime);

            if (gapMinutes === null || eventTripTime === null) {
                continue;
            }

            // Hide non-actionable matches outside the connection window.
            if (gapMinutes > MAX_EARLY_MINUTES || gapMinutes < -MAX_LATE_MINUTES) {
                continue;
            }

            // meetsConnection if we remain in the preferred direction
            const meetsConnection = gapMinutes >= 0;
            const qualitySettings = target.qualityWindowSettings || libraryQualitySettings;
            const quality = classifyConnectionQuality(gapMinutes, qualitySettings);

            matches.push({
                connectionId: routeConnection?.id,
                targetId: target.id,
                targetName: target.name,
                targetShortLabel: getTargetShortLabel(target),
                targetTime: connTime.time,
                targetTimeLabel: connTime.label
                    ? `${formatConnectionTime(connTime.time)} ${connTime.label}`
                    : formatConnectionTime(connTime.time),
                tripTime: eventTripTime,
                eventType,
                busAnchor: routeConnection
                    ? getBusAnchorForConnectionType(routeConnection.connectionType)
                    : getBusAnchorForConnectionEvent(eventType),
                gapMinutes,
                meetsConnection,
                quality,
                icon: target.icon || 'clock'
            });
        }
    }

    // Sort by closest gap first (smallest absolute value)
    return matches.sort((a, b) => Math.abs(a.gapMinutes) - Math.abs(b.gapMinutes));
}

/**
 * Format the gap time for display.
 * Examples: "5 min early", "3 min late", "on time"
 */
export function formatGapTime(gapMinutes: number): string {
    const absGap = Math.abs(gapMinutes);

    if (absGap === 0) return '0 min early';
    if (gapMinutes > 0) return `${absGap} min early`;
    return `${absGap} min late`;
}

/**
 * Event-aware format for gap times.
 */
export function formatGapTimeForEvent(
    gapMinutes: number,
    eventType: ConnectionEventType
): string {
    const absGap = Math.abs(gapMinutes);

    if (eventType === 'arrival') {
        if (absGap === 0) return '0 min after arrival';
        if (gapMinutes > 0) return `${absGap} min after arrival`;
        return `${absGap} min before arrival`;
    }

    if (absGap === 0) return '0 min before departure';
    if (gapMinutes > 0) return `${absGap} min before departure`;
    return `${absGap} min after departure`;
}

/**
 * Get the CSS classes for the gap indicator.
 */
export function getGapClasses(meetsConnection: boolean, quality: ConnectionQuality): string {
    if (!meetsConnection) return 'text-red-600';
    if (quality === 'excellent') return 'text-green-700';
    if (quality === 'good') return 'text-amber-700';
    return 'text-red-600';
}
