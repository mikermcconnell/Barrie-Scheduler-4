/**
 * Master Schedule Types
 *
 * Type definitions for the team-based Master Schedule system.
 * Routes are identified by {RouteNumber}-{DayType} (e.g., "400-Weekday")
 * with both North and South directions stored together.
 */

import type { MasterRouteTable } from './masterScheduleParser';

// ============ ENUMS AND TYPES ============

export type DayType = 'Weekday' | 'Saturday' | 'Sunday';
export type UploadSource = 'wizard' | 'tweaker';
export type TeamRole = 'owner' | 'admin' | 'member';
export type RouteIdentity = `${string}-${DayType}`;

// ============ TEAM TYPES ============

export interface Team {
    id: string;
    name: string;
    createdAt: Date;
    createdBy: string;
    inviteCode: string;
}

export interface TeamMember {
    id: string;              // Document ID (same as memberId)
    userId: string;
    role: TeamRole;
    joinedAt: Date;
    displayName: string;
    email: string;
}

export interface TeamWithMembers extends Team {
    members: TeamMember[];
    memberCount: number;
}

// ============ MASTER SCHEDULE TYPES ============

/**
 * Route identity format: "{routeNumber}-{dayType}"
 * Examples: "400-Weekday", "8-Saturday", "100-Sunday"
 */
export interface MasterScheduleEntry {
    id: string;              // Document ID = RouteIdentity (e.g., "400-Weekday")
    routeNumber: string;
    dayType: DayType;
    currentVersion: number;
    storagePath: string;
    tripCount: number;
    northStopCount: number;
    southStopCount: number;
    updatedAt: Date;
    updatedBy: string;
    uploaderName: string;
    source: UploadSource;
}

export interface MasterScheduleVersion {
    id: string;              // Document ID = version number as string
    versionNumber: number;
    storagePath: string;
    createdAt: Date;
    createdBy: string;
    uploaderName: string;
    source: UploadSource;
    tripCount: number;
}

export interface MasterScheduleContent {
    northTable: MasterRouteTable;
    southTable: MasterRouteTable;
    metadata: {
        routeNumber: string;
        dayType: DayType;
        uploadedAt: string;   // ISO string
    };
}

// ============ UPLOAD CONFIRMATION ============

export interface UploadConfirmation {
    routeIdentity: RouteIdentity;
    routeNumber: string;
    dayType: DayType;
    existingEntry: MasterScheduleEntry | null;
    existingVersionCount: number;
    willBumpVersion: boolean;
    newVersionNumber: number;
    tripCount: number;
    northStopCount: number;
    southStopCount: number;
}

// ============ HELPER FUNCTIONS ============

/**
 * Build a route identity from route number and day type
 * @example buildRouteIdentity("400", "Weekday") => "400-Weekday"
 */
export function buildRouteIdentity(routeNumber: string, dayType: DayType): RouteIdentity {
    return `${routeNumber}-${dayType}` as RouteIdentity;
}

/**
 * Parse a route identity back into route number and day type
 * @example parseRouteIdentity("400-Weekday") => { routeNumber: "400", dayType: "Weekday" }
 */
export function parseRouteIdentity(identity: RouteIdentity): { routeNumber: string; dayType: DayType } {
    const lastDash = identity.lastIndexOf('-');
    return {
        routeNumber: identity.substring(0, lastDash),
        dayType: identity.substring(lastDash + 1) as DayType
    };
}

/**
 * Extract route number from MasterRouteTable.routeName
 * @example extractRouteNumber("400 (Weekday) (North)") => "400"
 */
export function extractRouteNumber(routeName: string): string {
    const match = routeName.match(/^(\d+[A-Za-z]?)/);
    return match ? match[1] : routeName.split(' ')[0];
}

/**
 * Extract day type from MasterRouteTable.routeName
 * @example extractDayType("400 (Weekday) (North)") => "Weekday"
 */
export function extractDayType(routeName: string): DayType {
    if (routeName.includes('Saturday')) return 'Saturday';
    if (routeName.includes('Sunday')) return 'Sunday';
    return 'Weekday';
}
