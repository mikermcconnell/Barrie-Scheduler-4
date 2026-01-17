import {
    doc,
    setDoc,
    serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase';
import { uploadToMasterSchedule } from './masterScheduleService';
import { buildRouteIdentity } from './masterScheduleTypes';
import type { DraftSchedule } from './scheduleTypes';
import type { DayType, MasterScheduleContent, MasterScheduleEntry, RouteIdentity } from './masterScheduleTypes';

export interface PublishDraftParams {
    teamId: string;
    userId: string;
    publisherName: string;
    draft: DraftSchedule & { content: MasterScheduleContent };
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
    draft
}: PublishDraftParams): Promise<PublishResult> => {
    if (!draft.content) {
        throw new Error('Draft content is required to publish.');
    }

    const routeNumber = draft.routeNumber || draft.content.metadata?.routeNumber;
    const dayType = (draft.dayType || draft.content.metadata?.dayType) as DayType;

    if (!routeNumber || !dayType) {
        throw new Error('Draft routeNumber and dayType are required to publish.');
    }

    const entry = await uploadToMasterSchedule(
        teamId,
        userId,
        publisherName,
        draft.content.northTable,
        draft.content.southTable,
        routeNumber,
        dayType,
        'draft'
    );

    const routeIdentity = buildRouteIdentity(routeNumber, dayType);
    const entryRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity);

    await setDoc(entryRef, {
        publishedAt: serverTimestamp(),
        publishedBy: userId,
        publishedFromDraft: draft.id || null,
        status: 'published'
    }, { merge: true });

    return {
        entry,
        routeIdentity,
        publishedAt: new Date()
    };
};
