import type { DayType, MasterScheduleContent, RouteIdentity } from '../masterScheduleTypes';
import type { MasterRouteTable } from '../parsers/masterScheduleParser';

export type DraftStatus = 'draft' | 'ready_for_review';

export type DraftBasedOn = {
    type: 'master' | 'gtfs' | 'generated' | 'legacy';
    id?: string;
    importedAt?: Date;
};

export interface DraftSchedule {
    id: string;
    name: string;
    routeNumber: string;
    dayType: DayType;
    content?: MasterScheduleContent;
    status: DraftStatus;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    basedOn?: DraftBasedOn;
    storagePath?: string;
}

export interface DraftScheduleInput extends Omit<DraftSchedule, 'id' | 'createdAt' | 'updatedAt'> {
    id?: string;
}

export interface PublishedVersion {
    version: number;
    content: MasterScheduleContent;
    publishedAt: Date;
    publishedBy: string;
    publishedFromDraft?: string;
}

export interface PublishedSchedule {
    id: RouteIdentity;
    routeNumber: string;
    dayType: DayType;
    content: MasterScheduleContent;
    version: number;
    publishedAt: Date;
    publishedBy: string;
    publishedFromDraft?: string;
    history?: PublishedVersion[];
}

// ============ SYSTEM DRAFT TYPES ============

/**
 * System-wide draft containing ALL routes for a single day type.
 *
 * Storage:
 * - Firestore: users/{userId}/systemDrafts/{draftId} (metadata only)
 * - Firebase Storage: users/{userId}/systemDrafts/{draftId}_{timestamp}.json (full content)
 */
export interface SystemDraft {
    id: string;
    name: string;                           // "Weekday System - Jan 2025"
    dayType: DayType;                       // Single day type for this system
    routes: SystemDraftRoute[];             // All routes for this day type
    status: DraftStatus;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    basedOn?: SystemDraftBasedOn;
    storagePath?: string;                   // Firebase Storage path for content
    routeCount?: number;                    // Quick display field (denormalized)
}

/**
 * A single route within a system draft.
 * Contains both direction tables for the route.
 */
export interface SystemDraftRoute {
    routeNumber: string;                    // "400", "8A", "8B", etc.
    northTable: MasterRouteTable;
    southTable: MasterRouteTable;
}

/**
 * Tracks the origin of a system draft.
 */
export interface SystemDraftBasedOn {
    type: 'gtfs' | 'master' | 'generated';
    importedAt?: Date;
    sourceVersion?: number;                 // If derived from master schedules
    gtfsFeedUrl?: string;                   // If imported from GTFS
}

/**
 * Input type for creating/updating system drafts.
 */
export interface SystemDraftInput extends Omit<SystemDraft, 'id' | 'createdAt' | 'updatedAt'> {
    id?: string;
}

/**
 * Lightweight metadata for listing system drafts without loading full content.
 */
export interface SystemDraftMetadata {
    id: string;
    name: string;
    dayType: DayType;
    status: DraftStatus;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    routeCount: number;
    basedOn?: SystemDraftBasedOn;
}
