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
import type { DraftSchedule, DraftScheduleInput } from '../schedule/scheduleTypes';
import type { MasterScheduleContent } from '../masterScheduleTypes';
import { downloadFileContent } from './dataService';

const DRAFTS_COLLECTION = 'draftSchedules';

const draftStoragePath = (userId: string, draftId: string, timestamp: number) =>
    `users/${userId}/${DRAFTS_COLLECTION}/${draftId}_${timestamp}.json`;

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

    const timestamp = Date.now();
    const storagePath = draftStoragePath(userId, draftId, timestamp);
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

    await setDoc(draftRef, docData, { merge: true });

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
        basedOn: data.basedOn || undefined,
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
            basedOn: data.basedOn || undefined,
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

    await deleteDoc(draftRef);
};
