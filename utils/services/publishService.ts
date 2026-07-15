import {
    doc,
    setDoc,
    serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import {
    getMasterScheduleEntry,
    MAX_PUBLISH_NOTE_LENGTH,
    normalizePublishNote,
    uploadToMasterSchedule,
} from './masterScheduleService';
import { buildRouteIdentity } from '../masterScheduleTypes';
import type { DraftSchedule, SystemDraftRoute } from '../schedule/scheduleTypes';
import type { DayType, MasterScheduleContent, MasterScheduleEntry, RouteIdentity } from '../masterScheduleTypes';
import { assessDraftFreshness, buildScheduleReview, type DraftFreshness } from '../schedule/scheduleReview';

export interface PublishDraftParams {
    teamId: string;
    userId: string;
    publisherName: string;
    draft: DraftSchedule & { content: MasterScheduleContent };
    /** Explicit planner override after reviewing a stale-master warning. */
    allowStaleSource?: boolean;
    publishNote?: string;
}

export class StaleDraftPublishError extends Error {
    readonly freshness: Extract<DraftFreshness, { status: 'stale' }>;

    constructor(freshness: Extract<DraftFreshness, { status: 'stale' }>) {
        super(`This draft is based on master v${freshness.sourceVersion}, but v${freshness.currentVersion} is now published.`);
        this.name = 'StaleDraftPublishError';
        this.freshness = freshness;
    }
}

export interface PublishResult {
    entry: MasterScheduleEntry;
    routeIdentity: RouteIdentity;
    publishedAt: Date;
}

export const publishDraft = async ({
    teamId,
    userId,
    publisherName,
    draft,
    allowStaleSource = false,
    publishNote,
}: PublishDraftParams): Promise<PublishResult> => {
    if (!draft.content) {
        throw new Error('Draft content is required to publish.');
    }

    if (draft.status !== 'ready_for_review') {
        throw new Error('Draft must be marked ready for review before publishing.');
    }

    const normalizedPublishNote = normalizePublishNote(publishNote);
    if (!normalizedPublishNote) {
        throw new Error('A publish note is required.');
    }
    const normalizedUnboundedNote = (publishNote ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (normalizedUnboundedNote.length > MAX_PUBLISH_NOTE_LENGTH) {
        throw new Error(`Publish note must be ${MAX_PUBLISH_NOTE_LENGTH} characters or fewer.`);
    }

    const review = buildScheduleReview(draft.content);
    if (!review.publishReady) {
        throw new Error('Draft contains blocking schedule issues and cannot be published.');
    }

    const routeNumber = draft.routeNumber || draft.content.metadata?.routeNumber;
    const dayType = (draft.dayType || draft.content.metadata?.dayType) as DayType;

    if (!routeNumber || !dayType) {
        throw new Error('Draft routeNumber and dayType are required to publish.');
    }

    const routeIdentity = buildRouteIdentity(routeNumber, dayType);
    let expectedCurrentVersion: number | undefined;
    let expectedSource: { teamId: string; routeIdentity: RouteIdentity; version: number } | undefined;
    if (draft.basedOn?.type === 'master') {
        if (!draft.basedOn.sourceVersion) {
            throw new Error('Master-derived draft is missing its source version. Start from the latest master schedule.');
        }
        const sourceRouteIdentity = (draft.basedOn.id || routeIdentity) as RouteIdentity;
        if (sourceRouteIdentity !== routeIdentity) {
            throw new Error('Draft source route does not match the route being published.');
        }
        const sourceTeamId = draft.basedOn.sourceTeamId || teamId;
        const currentMaster = await getMasterScheduleEntry(sourceTeamId, sourceRouteIdentity);
        const freshness = assessDraftFreshness(draft, currentMaster);
        if (freshness.status === 'unknown') {
            throw new Error('The source master could not be verified. Start from the latest master schedule.');
        }
        if (freshness.status === 'stale' && !allowStaleSource) {
            throw new StaleDraftPublishError(freshness);
        }
        if (sourceTeamId === teamId) {
            expectedCurrentVersion = allowStaleSource
                ? currentMaster?.currentVersion
                : draft.basedOn.sourceVersion;
        } else {
            const existingTarget = await getMasterScheduleEntry(teamId, routeIdentity);
            if (existingTarget) {
                throw new Error('A local master already exists for this route. Start from the local master before publishing.');
            }
            expectedCurrentVersion = 0;
            expectedSource = {
                teamId: sourceTeamId,
                routeIdentity: sourceRouteIdentity,
                version: draft.basedOn.sourceVersion,
            };
        }
    }

    const entry = await uploadToMasterSchedule(
        teamId,
        userId,
        publisherName,
        draft.content.northTable,
        draft.content.southTable,
        routeNumber,
        dayType,
        'draft',
        {
            cycleMode: draft.content.metadata?.cycleMode,
            publishNote: normalizedPublishNote,
            ...(expectedCurrentVersion !== undefined ? { expectedCurrentVersion } : {}),
            ...(expectedSource ? { expectedSource } : {}),
            publishedBy: userId,
            publishedFromDraft: draft.id,
        }
    );

    return {
        entry,
        routeIdentity,
        publishedAt: new Date()
    };
};

// ============ SYSTEM DRAFT PUBLISHING ============

export interface PublishSystemDraftParams {
    teamId: string;
    userId: string;
    publisherName: string;
    systemDraftId: string;
    routes: SystemDraftRoute[];
    dayType: DayType;
}

export interface PublishSystemDraftResult {
    success: boolean;
    publishedCount: number;
    failedCount: number;
    publishedRoutes: Array<{
        routeNumber: string;
        routeIdentity: RouteIdentity;
        entry: MasterScheduleEntry;
    }>;
    failedRoutes: Array<{
        routeNumber: string;
        error: string;
    }>;
    error?: string;
}

/**
 * Publish all routes in a system draft to master schedules.
 * Each route is published to its own master schedule entry.
 */
export const publishSystemDraft = async ({
    teamId,
    userId,
    publisherName,
    systemDraftId,
    routes,
    dayType
}: PublishSystemDraftParams): Promise<PublishSystemDraftResult> => {
    if (routes.length === 0) {
        return {
            success: false,
            publishedCount: 0,
            failedCount: 0,
            publishedRoutes: [],
            failedRoutes: [],
            error: 'No routes to publish'
        };
    }

    const publishedRoutes: PublishSystemDraftResult['publishedRoutes'] = [];
    const failedRoutes: PublishSystemDraftResult['failedRoutes'] = [];

    for (const route of routes) {
        try {
            // Upload to master schedule
            const entry = await uploadToMasterSchedule(
                teamId,
                userId,
                publisherName,
                route.northTable,
                route.southTable,
                route.routeNumber,
                dayType,
                'draft'
            );

            const routeIdentity = buildRouteIdentity(route.routeNumber, dayType);
            const entryRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity);

            // Update metadata
            await setDoc(entryRef, {
                publishedAt: serverTimestamp(),
                publishedBy: userId,
                publishedFromDraft: systemDraftId,
                status: 'published'
            }, { merge: true });

            publishedRoutes.push({
                routeNumber: route.routeNumber,
                routeIdentity,
                entry
            });

            console.log(`Published Route ${route.routeNumber} (${dayType})`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            failedRoutes.push({
                routeNumber: route.routeNumber,
                error: errorMsg
            });
            console.error(`Failed to publish Route ${route.routeNumber}:`, error);
        }
    }

    return {
        success: failedRoutes.length === 0,
        publishedCount: publishedRoutes.length,
        failedCount: failedRoutes.length,
        publishedRoutes,
        failedRoutes,
        error: failedRoutes.length > 0
            ? `Failed to publish ${failedRoutes.length} route(s): ${failedRoutes.map(r => r.routeNumber).join(', ')}`
            : undefined
    };
};
