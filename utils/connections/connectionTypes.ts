/**
 * Connection Optimization Types
 *
 * Types for Step 5 of the New Schedule Wizard - optimizing schedules
 * to connect with external services (GO Trains, Georgian College) and other routes.
 */

import type { DayType } from '../parsers/masterScheduleParser';

// === CONNECTION TARGET (Library Item) ===

export type ConnectionType = 'meet_departing' | 'feed_arriving';
export type ConnectionTargetType = 'manual' | 'route';
export type ConnectionEventType = 'departure' | 'arrival';
export const MAX_SERVICE_MINUTES = 2160; // 36 hours, supports after-midnight service day spans
export type ConnectionQuality = 'excellent' | 'good' | 'bad';

/**
 * Connection quality timing thresholds (all in minutes before target time).
 * Example default:
 * - Excellent: 5-10 min early
 * - Good: 2-5 min early OR 10-15 min early
 * - Bad: outside the good range (and all late arrivals)
 */
export interface ConnectionQualityWindowSettings {
    excellentMin: number;
    excellentMax: number;
    goodMin: number;
    goodMax: number;
}

export const DEFAULT_CONNECTION_QUALITY_WINDOW_SETTINGS: ConnectionQualityWindowSettings = {
    excellentMin: 5,
    excellentMax: 10,
    goodMin: 2,
    goodMax: 15
};

/**
 * A connection target in the team's connection library.
 * Can be either manual (GO Train times, College bells) or route-based (another bus route).
 */
export interface ConnectionTarget {
    id: string;
    name: string;                          // "GO Train to Toronto", "Georgian College Bell"
    type: ConnectionTargetType;

    // For manual targets (GO, College)
    location?: string;                     // "Allandale Waterfront GO Station"
    times?: ConnectionTime[];              // Manual time entries

    // For route-to-route connections
    routeIdentity?: string;                // "8B-Weekday" (references master schedule)
    stopCode: string;                      // Stop code (unique identifier, e.g., "777")
    stopCodes?: string[];                  // Multiple stop codes for auto-populate (e.g., all Georgian College stops)
    autoPopulateStops?: boolean;           // When true, apply to all stops matching stopCodes
    stopName?: string;                     // Stop name for display (e.g., "Downtown Terminal")
    direction?: 'North' | 'South';
    sourceScheduleUpdatedAt?: string;      // ISO timestamp of master schedule used to derive times

    // Visualization
    color?: string;                        // Badge color (hex or tailwind class)
    icon?: 'train' | 'clock' | 'bus';      // Icon identifier
    qualityWindowSettings?: ConnectionQualityWindowSettings; // Optional per-target override
    defaultEventType?: ConnectionEventType; // Default event type for times without explicit eventType

    // Metadata
    createdAt: string;                     // ISO timestamp
    updatedAt: string;
}

/**
 * A specific time for a manual connection target.
 */
export interface ConnectionTime {
    id: string;
    time: number;                          // Minutes from midnight (e.g., 450 = 7:30 AM)
    label?: string;                        // "Express to Union" or "Morning Bell"
    eventType?: ConnectionEventType;       // Optional override; undefined => inherit target defaultEventType
    daysActive: DayType[];                 // Which days this time applies
    enabled: boolean;
}

// === CONNECTION LIBRARY (Team-Global) ===

/**
 * The team's shared library of connection targets.
 * Stored at teams/{teamId}/connectionLibrary/default
 */
export interface ConnectionLibrary {
    targets: ConnectionTarget[];
    qualityWindowSettings?: ConnectionQualityWindowSettings;
    changeLog?: ConnectionLibraryChangeLogEntry[];
    updatedAt: string;
    updatedBy: string;
}

export interface ConnectionLibraryChangeLogEntry {
    id: string;
    version: number;
    timestamp: string;
    userId: string;
    action: string;
    details?: string;
}

// === ROUTE CONNECTION CONFIG (Per-Route) ===

/**
 * Per-route configuration for which connections to optimize for.
 * Stored at teams/{teamId}/masterSchedules/{routeIdentity}/connectionConfig/default
 */
export interface RouteConnectionConfig {
    routeIdentity: string;                 // "400-Weekday"
    connections: RouteConnection[];
    lastOptimized?: string;                // ISO timestamp
    optimizationMode?: OptimizationMode;
}

/**
 * A single connection configuration for a route.
 */
export interface RouteConnection {
    id: string;
    targetId: string;                      // Reference to ConnectionTarget.id
    connectionType: ConnectionType;        // 'meet_departing' | 'feed_arriving'
    bufferMinutes: number;                 // e.g., 5 = arrive 5 min before target departs
    stopCode: string;                      // Stop code (unique identifier) on THIS route to optimize
    stopName?: string;                     // Stop name for display (optional, can be derived from stopCode)
    priority: number;                      // 1 = highest (for conflict resolution)
    enabled: boolean;

    // Optional overrides
    timeFilterStart?: number;              // Only apply during certain hours (minutes from midnight)
    timeFilterEnd?: number;
}

export type OptimizationMode = 'shift' | 'individual' | 'hybrid';

// === EXTERNAL CONNECTION ON TRIP ===

/**
 * Connection metadata attached to a MasterTrip after optimization.
 * Added to MasterTrip.externalConnections[]
 */
export interface ExternalConnection {
    targetId: string;
    targetName: string;
    connectionType: ConnectionType;
    targetTime: number;                    // External target event time (minutes from midnight)
    tripArrivalTime: number;               // Bus event time used for the connection gap at this stop
    gapMinutes: number;                    // Positive = useful margin in the preferred direction
    meetsConnection: boolean;              // Is gap >= buffer requirement?
    stopCode: string;                      // Stop code (unique identifier)
    stopName?: string;                     // Stop name for display (optional)
}

// === OPTIMIZATION RESULT ===

/**
 * Result of running the connection optimizer.
 */
export interface OptimizationResult {
    originalSchedules: import('../parsers/masterScheduleParser').MasterRouteTable[];
    optimizedSchedules: import('../parsers/masterScheduleParser').MasterRouteTable[];
    shiftApplied?: number;                 // Minutes shifted (for 'shift' mode)

    connectionReport: ConnectionReportEntry[];
    summary: OptimizationSummary;
}

/**
 * Individual entry in the connection report.
 */
export interface ConnectionReportEntry {
    tripId: string;
    tripStartTime: number;
    direction: 'North' | 'South';
    targetName: string;
    targetTime: number;
    originalGap: number;
    newGap: number;
    bufferRequired: number;
    status: 'met' | 'missed' | 'improved' | 'worsened' | 'unchanged';
}

/**
 * Summary statistics for the optimization.
 */
export interface OptimizationSummary {
    totalConnections: number;
    connectionsMet: number;
    connectionsMissed: number;
    connectionsImproved: number;
    avgGapImprovement: number;             // Average improvement in minutes
    shiftApplied?: number;
}

// === HELPER FUNCTIONS ===

/**
 * Generate a unique ID for connection entities.
 */
export function generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format minutes from midnight to display time.
 */
export function formatConnectionTime(minutes: number): string {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const mins = normalized % 60;
    const period = hours >= 12 ? 'p' : 'a';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHours}:${mins.toString().padStart(2, '0')}${period}`;
}

/**
 * Parse a time string to minutes from midnight.
 */
export function parseConnectionTime(timeStr: string): number {
    const trimmed = timeStr.trim();
    if (!trimmed) return 0;

    const match = trimmed.match(/^(\d{1,2}|\d{2}):(\d{2})\s*([ap]m?|[ap])?$/i);
    if (!match) return 0;

    let hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const period = match[3]?.toLowerCase();

    if (period) {
        const periodChar = period[0];
        if (periodChar === 'p' && hours !== 12) hours += 12;
        if (periodChar === 'a' && hours === 12) hours = 0;
        if (hours > 23) return 0;
        return hours * 60 + mins;
    }

    // 24-hour input without AM/PM
    if (hours > 47) return 0;
    return hours * 60 + mins;
}

/**
 * Get connection status color class.
 */
export function getConnectionStatusColor(meetsConnection: boolean, gapMinutes: number): string {
    if (meetsConnection) {
        return gapMinutes > 10 ? 'text-green-600 bg-green-50' : 'text-green-700 bg-green-100';
    }
    return gapMinutes > -5 ? 'text-orange-600 bg-orange-50' : 'text-red-600 bg-red-100';
}

/**
 * Get badge color classes for a connection type.
 */
export function getConnectionBadgeColors(
    targetType: ConnectionTargetType,
    meetsConnection: boolean
): { bg: string; text: string } {
    if (meetsConnection) {
        return targetType === 'route'
            ? { bg: 'bg-blue-100', text: 'text-blue-700' }
            : { bg: 'bg-green-100', text: 'text-green-700' };
    }
    return targetType === 'route'
        ? { bg: 'bg-purple-100', text: 'text-purple-700' }
        : { bg: 'bg-red-100', text: 'text-red-700' };
}

// === STOP CODE/NAME LOOKUP HELPERS ===

/**
 * Stop info with both code and name for UI display.
 */
export interface StopInfo {
    code: string;
    name: string;
}

/**
 * Build a reverse lookup map from stop IDs: code -> name
 */
export function buildStopCodeToNameMap(stopIds: Record<string, string>): Record<string, string> {
    const codeToName: Record<string, string> = {};
    for (const [name, code] of Object.entries(stopIds)) {
        if (code) {
            codeToName[code] = name;
        }
    }
    return codeToName;
}

/**
 * Get stop name from stop code using the stopIds map.
 */
export function getStopNameByCode(
    stopCode: string,
    stopIds: Record<string, string>
): string | undefined {
    for (const [name, code] of Object.entries(stopIds)) {
        if (code === stopCode) {
            return name;
        }
    }
    return undefined;
}

/**
 * Get stop code from stop name using the stopIds map.
 */
export function getStopCodeByName(
    stopName: string,
    stopIds: Record<string, string>
): string | undefined {
    return stopIds[stopName];
}

/**
 * Get available stops as StopInfo array from a schedule's stopIds.
 */
export function getAvailableStops(stopIds: Record<string, string>): StopInfo[] {
    return Object.entries(stopIds)
        .filter(([, code]) => code) // Only include stops with codes
        .map(([name, code]) => ({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
