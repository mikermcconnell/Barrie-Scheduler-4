/**
 * Connection Optimization Types
 *
 * Types for Step 5 of the New Schedule Wizard - optimizing schedules
 * to connect with external services (GO Trains, Georgian College) and other routes.
 */

import type { DayType } from './masterScheduleParser';

// === CONNECTION TARGET (Library Item) ===

export type ConnectionType = 'meet_departing' | 'feed_arriving';
export type ConnectionTargetType = 'manual' | 'route';

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
    stopName?: string;                     // "Downtown Terminal"
    direction?: 'North' | 'South';

    // Visualization
    color?: string;                        // Badge color (hex or tailwind class)
    icon?: 'train' | 'clock' | 'bus';      // Icon identifier

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
    updatedAt: string;
    updatedBy: string;
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
    stopName: string;                      // Which stop on THIS route to optimize
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
    targetTime: number;                    // The GO train departure time (minutes from midnight)
    tripArrivalTime: number;               // When THIS trip arrives at connection stop
    gapMinutes: number;                    // targetTime - tripArrivalTime (+ = early, - = late)
    meetsConnection: boolean;              // Is gap >= buffer requirement?
    stopName: string;
}

// === OPTIMIZATION RESULT ===

/**
 * Result of running the connection optimizer.
 */
export interface OptimizationResult {
    originalSchedules: import('./masterScheduleParser').MasterRouteTable[];
    optimizedSchedules: import('./masterScheduleParser').MasterRouteTable[];
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
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

/**
 * Parse a time string to minutes from midnight.
 */
export function parseConnectionTime(timeStr: string): number {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) return 0;

    let hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const period = match[3]?.toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

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
