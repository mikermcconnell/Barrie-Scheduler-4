import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    orderBy,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { db, storage } from '../firebase';
import type { DraftBasedOn, DraftCheckpoint, DraftSchedule, DraftScheduleInput } from '../schedule/scheduleTypes';
import type { MasterScheduleContent } from '../masterScheduleTypes';
import { downloadFileContent } from './dataService';
import { buildDuplicateDraftName } from './draftNaming';
import { buildRouteIdentity, type RouteIdentity } from '../masterScheduleTypes';
import { assessDraftFreshness, type DraftFreshness } from '../schedule/scheduleReview';
import { getMasterScheduleEntry } from './masterScheduleService';

const DRAFTS_COLLECTION = 'draftSchedules';

const createStorageWriteToken = (): string => {
    const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `${Date.now()}_${randomPart}`;
};

const draftStoragePath = (userId: string, draftId: string, writeToken: string) =>
    `users/${userId}/${DRAFTS_COLLECTION}/${draftId}_${writeToken}.json`;

const checkpointStoragePath = (userId: string, draftId: string, checkpointId: string) =>
    `users/${userId}/${DRAFTS_COLLECTION}/${draftId}_checkpoints/${checkpointId}.json`;

const timestampToDate = (value?: Timestamp | Date): Date => {
    if (!value) return new Date();
    return value instanceof Date ? value : value.toDate();
};

export const saveDraft = async (
    userId: string,
    draft: DraftScheduleInput
): Promise<string> => {
    if (!draft.content) {
        throw new Error('Draft content is required to save a draft.');
    }

    const draftsRef = collection(db, 'users', userId, DRAFTS_COLLECTION);
    const isUpdate = !!draft.id;
    const draftRef = draft.id ? doc(draftsRef, draft.id) : doc(draftsRef);
    const draftId = draftRef.id;
    let previousStoragePath = draft.storagePath;

    if (isUpdate && !previousStoragePath) {
        const existingSnapshot = await getDoc(draftRef);
        if (existingSnapshot.exists()) {
            previousStoragePath = existingSnapshot.data().storagePath;
        }
    }

    const storagePath = draftStoragePath(userId, draftId, createStorageWriteToken());
    const storageRef = ref(storage, storagePath);
    const contentJson = JSON.stringify({ content: draft.content });

    await uploadBytes(
        storageRef,
        new TextEncoder().encode(contentJson),
        { contentType: 'application/json' }
    );

    const docData: Record<string, unknown> = {
        name: draft.name || 'Untitled Draft',
        routeNumber: draft.routeNumber,
        dayType: draft.dayType,
        status: draft.status || 'draft',
        createdBy: draft.createdBy,
        basedOn: draft.basedOn || null,
        storagePath,
        updatedAt: serverTimestamp()
    };

    if (!isUpdate) {
        docData.createdAt = serverTimestamp();
    }

    try {
        await setDoc(draftRef, docData, { merge: true });
    } catch (error) {
        try {
            await deleteObject(storageRef);
        } catch (cleanupError) {
            console.warn('Failed to clean up unsaved draft storage file:', cleanupError);
        }
        throw error;
    }

    if (isUpdate && previousStoragePath && previousStoragePath !== storagePath) {
        try {
            await deleteObject(ref(storage, previousStoragePath));
        } catch (error) {
            console.warn('Failed to delete old draft storage file:', error);
        }
    }

    return draftId;
};

export const updateDraftMetadata = async (
    userId: string,
    draftId: string,
    updates: Partial<Pick<DraftSchedule, 'name' | 'routeNumber' | 'dayType' | 'status' | 'basedOn'>>
): Promise<void> => {
    const draftRef = doc(db, 'users', userId, DRAFTS_COLLECTION, draftId);
    await setDoc(draftRef, {
        ...updates,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

const loadDraftContent = async (storagePath?: string): Promise<MasterScheduleContent | undefined> => {
    if (!storagePath) return undefined;
    try {
        const storageRef = ref(storage, storagePath);
        const url = await getDownloadURL(storageRef);
        const content = await downloadFileContent(url);
        const json = JSON.parse(content);
        return json.content as MasterScheduleContent;
    } catch (error) {
        console.error('Failed to load draft content:', error);
        return undefined;
    }
};

export const getDraft = async (
    userId: string,
    draftId: string
): Promise<DraftSchedule | null> => {
    const draftRef = doc(db, 'users', userId, DRAFTS_COLLECTION, draftId);
    const snapshot = await getDoc(draftRef);

    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    const content = await loadDraftContent(data.storagePath);

    return {
        id: snapshot.id,
        name: data.name,
        routeNumber: data.routeNumber,
        dayType: data.dayType,
        status: data.status || 'draft',
        createdBy: data.createdBy,
        basedOn: normalizeBasedOn(data.basedOn),
        storagePath: data.storagePath,
        content,
        createdAt: timestampToDate(data.createdAt),
        updatedAt: timestampToDate(data.updatedAt)
    };
};

export const getAllDrafts = async (userId: string): Promise<DraftSchedule[]> => {
    const draftsRef = collection(db, 'users', userId, DRAFTS_COLLECTION);
    const q = query(draftsRef, orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
            id: docSnap.id,
            name: data.name,
            routeNumber: data.routeNumber,
            dayType: data.dayType,
            status: data.status || 'draft',
            createdBy: data.createdBy,
            basedOn: normalizeBasedOn(data.basedOn),
            storagePath: data.storagePath,
            createdAt: timestampToDate(data.createdAt),
            updatedAt: timestampToDate(data.updatedAt)
        };
    });
};

export const deleteDraft = async (
    userId: string,
    draftId: string
): Promise<void> => {
    const draftRef = doc(db, 'users', userId, DRAFTS_COLLECTION, draftId);
    const snapshot = await getDoc(draftRef);

    if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.storagePath) {
            try {
                await deleteObject(ref(storage, data.storagePath));
            } catch (error) {
                console.warn('Failed to delete draft storage file:', error);
            }
        }
    }

    const checkpoints = await listDraftCheckpoints(userId, draftId);
    await Promise.all(checkpoints.map(checkpoint => deleteDraftCheckpoint(userId, draftId, checkpoint.id)));

    await deleteDoc(draftRef);
};

/** One-call freshness check for editor load/review flows. */
export const getDraftFreshness = async (
    teamId: string,
    draft: Pick<DraftSchedule, 'basedOn' | 'routeNumber' | 'dayType'>,
): Promise<DraftFreshness> => {
    if (draft.basedOn?.type !== 'master') return assessDraftFreshness(draft, null);
    const routeIdentity = (draft.basedOn.id || buildRouteIdentity(draft.routeNumber, draft.dayType)) as RouteIdentity;
    const entry = await getMasterScheduleEntry(draft.basedOn.sourceTeamId || teamId, routeIdentity);
    return assessDraftFreshness(draft, entry);
};

const optionalTimestampToDate = (value?: Timestamp | Date): Date | undefined =>
    value ? timestampToDate(value) : undefined;

const normalizeBasedOn = (value?: DraftBasedOn & { importedAt?: Timestamp; sourceUpdatedAt?: Timestamp }): DraftBasedOn | undefined => {
    if (!value) return undefined;
    const importedAt = optionalTimestampToDate(value.importedAt);
    const sourceUpdatedAt = optionalTimestampToDate(value.sourceUpdatedAt);
    return {
        ...value,
        ...(importedAt ? { importedAt } : {}),
        ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    };
};

export const duplicateDraft = async (
    userId: string,
    draftId: string,
    overrideName?: string
): Promise<string> => {
    const existingDraft = await getDraft(userId, draftId);
    if (!existingDraft?.content) {
        throw new Error('Draft content not found');
    }

    return saveDraft(userId, {
        name: overrideName || buildDuplicateDraftName(existingDraft.name),
        routeNumber: existingDraft.routeNumber,
        dayType: existingDraft.dayType,
        status: 'draft',
        createdBy: userId,
        basedOn: existingDraft.basedOn,
        content: existingDraft.content
    });
};

/** Save an immutable, named restore point without changing the active draft. */
export const createDraftCheckpoint = async (
    userId: string,
    draftId: string,
    name: string,
    content: MasterScheduleContent,
): Promise<string> => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Checkpoint name is required.');

    const checkpointsRef = collection(db, 'users', userId, DRAFTS_COLLECTION, draftId, 'checkpoints');
    const checkpointRef = doc(checkpointsRef);
    const storagePath = checkpointStoragePath(userId, draftId, checkpointRef.id);
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, new TextEncoder().encode(JSON.stringify({ content })), { contentType: 'application/json' });

    try {
        await setDoc(checkpointRef, {
            name: trimmedName,
            storagePath,
            createdAt: serverTimestamp(),
            createdBy: userId,
        });
    } catch (error) {
        try {
            await deleteObject(storageRef);
        } catch (cleanupError) {
            console.warn('Failed to clean up checkpoint storage file:', cleanupError);
        }
        throw error;
    }
    return checkpointRef.id;
};

export const listDraftCheckpoints = async (userId: string, draftId: string): Promise<DraftCheckpoint[]> => {
    const checkpointsRef = collection(db, 'users', userId, DRAFTS_COLLECTION, draftId, 'checkpoints');
    const snapshot = await getDocs(query(checkpointsRef, orderBy('createdAt', 'desc')));
    return snapshot.docs.map(checkpointDoc => {
        const data = checkpointDoc.data();
        return {
            id: checkpointDoc.id,
            draftId,
            name: data.name,
            storagePath: data.storagePath,
            createdAt: timestampToDate(data.createdAt),
            createdBy: data.createdBy,
        };
    });
};

export const getDraftCheckpoint = async (
    userId: string,
    draftId: string,
    checkpointId: string,
): Promise<DraftCheckpoint | null> => {
    const checkpointRef = doc(db, 'users', userId, DRAFTS_COLLECTION, draftId, 'checkpoints', checkpointId);
    const snapshot = await getDoc(checkpointRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
        id: snapshot.id,
        draftId,
        name: data.name,
        storagePath: data.storagePath,
        createdAt: timestampToDate(data.createdAt),
        createdBy: data.createdBy,
        content: await loadDraftContent(data.storagePath),
    };
};

export const deleteDraftCheckpoint = async (
    userId: string,
    draftId: string,
    checkpointId: string,
): Promise<void> => {
    const checkpointRef = doc(db, 'users', userId, DRAFTS_COLLECTION, draftId, 'checkpoints', checkpointId);
    const snapshot = await getDoc(checkpointRef);
    if (snapshot.exists() && snapshot.data().storagePath) {
        try {
            await deleteObject(ref(storage, snapshot.data().storagePath));
        } catch (error) {
            console.warn('Failed to delete checkpoint storage file:', error);
        }
    }
    await deleteDoc(checkpointRef);
};
