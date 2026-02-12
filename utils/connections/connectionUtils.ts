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
    ConnectionEventType
} from './connectionTypes';
import type { DayType } from '../parsers/masterScheduleParser';
import {
    formatConnectionTime,
    DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS
} from './connectionTypes';

// Only show connection indicators when the timing is realistically connectable:
// - At most 20 minutes early (bus arrives too early beyond this is not actionable)
// - At most 7 minutes late (bus misses beyond this is not a practical connection)
const MAX_EARLY_MINUTES = 20;
const MAX_LATE_MINUTES = 7;

/**
 * A matched connection for display in the schedule table.
 */
export interface ConnectionMatch {
    targetId: string;           // Connection target ID
    targetName: string;         // "Georgian College Bells"
    targetTime: number;         // 480 (8:00am bell) - minutes from midnight
    targetTimeLabel: string;    // "8:00a Bell" or "8:00a"
    tripTime: number;           // 475 (7:55am arrival) - minutes from midnight
    eventType: ConnectionEventType; // departure | arrival
    gapMinutes: number;         // Positive = preferred direction margin (before departure / after arrival)
    meetsConnection: boolean;   // true when gapMinutes >= 0
    quality: ConnectionQuality; // excellent | good | bad
    icon: 'train' | 'clock' | 'bus';
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

function getGapForEvent(
    connectionTime: ConnectionTime,
    target: ConnectionTarget,
    tripTime: number
): number {
    const eventType = getEventType(connectionTime, target);
    if (eventType === 'arrival') {
        // For train arrivals, bus should depart AFTER train arrives.
        return tripTime - connectionTime.time;
    }
    // For departures, bus should arrive BEFORE train departs.
    return connectionTime.time - tripTime;
}

function findPreferredConnectionTime(
    target: ConnectionTarget,
    tripTime: number,
    dayType: DayType
): ConnectionTime | null {
    if (!target.times || target.times.length === 0) return null;

    const applicableTimes = target.times.filter(t => t.enabled && t.daysActive.includes(dayType));
    if (applicableTimes.length === 0) return null;

    // Preferred candidates are in the "connectable" direction:
    // - departure: train departs at/after bus time
    // - arrival: train arrives at/before bus time
    const preferred = applicableTimes
        .filter(t => getGapForEvent(t, target, tripTime) >= 0)
        .sort((a, b) => getGapForEvent(a, target, tripTime) - getGapForEvent(b, target, tripTime));

    if (preferred.length > 0) return preferred[0];

    // Fallback to closest overall (shows missed/too-early context).
    const closest = applicableTimes.sort(
        (a, b) => Math.abs(getGapForEvent(a, target, tripTime)) - Math.abs(getGapForEvent(b, target, tripTime))
    );
    return closest.length > 0 ? closest[0] : null;
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
 * @param tripTime - When the trip departs from this stop (minutes from midnight)
 * @param connectionLibrary - The team's connection library
 * @param dayType - The current day type (Weekday, Saturday, Sunday)
 * @returns Array of connection matches with status info
 */
export function getConnectionsForStop(
    stopCode: string,
    tripTime: number | null,
    connectionLibrary: ConnectionLibrary | null,
    dayType: DayType
): ConnectionMatch[] {
    if (!stopCode || tripTime === null || !connectionLibrary) return [];

    const libraryQualitySettings = getQualitySettings(connectionLibrary);
    const matchingTargets = findMatchingTargets(stopCode, connectionLibrary);
    const matches: ConnectionMatch[] = [];

    for (const target of matchingTargets) {
        const connTime = findPreferredConnectionTime(target, tripTime, dayType);

        if (!connTime) continue;

        const eventType = getEventType(connTime, target);
        // Positive means preferred direction margin:
        // - departure: before departure
        // - arrival: after arrival
        const gapMinutes = getGapForEvent(connTime, target, tripTime);

        // Hide non-actionable matches outside the connection window.
        if (gapMinutes > MAX_EARLY_MINUTES || gapMinutes < -MAX_LATE_MINUTES) {
            continue;
        }

        // meetsConnection if we arrive before or at the connection time
        const meetsConnection = gapMinutes >= 0;
        const qualitySettings = target.qualityWindowSettings || libraryQualitySettings;
        const quality = classifyConnectionQuality(gapMinutes, qualitySettings);

        matches.push({
            targetId: target.id,
            targetName: target.name,
            targetTime: connTime.time,
            targetTimeLabel: connTime.label
                ? `${formatConnectionTime(connTime.time)} ${connTime.label}`
                : formatConnectionTime(connTime.time),
            tripTime,
            eventType,
            gapMinutes,
            meetsConnection,
            quality,
            icon: target.icon || 'clock'
        });
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
