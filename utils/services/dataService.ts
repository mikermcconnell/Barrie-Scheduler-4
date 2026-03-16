import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    orderBy,
    where,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject,
    listAll
} from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Shift, Requirement } from '../demandTypes';
import type { MasterRouteTable } from '../parsers/masterScheduleParser';
import type { OnDemandOptimizationSettingsSnapshot } from '../onDemandOptimizationSettings';

// Types for saved data
export interface SavedSchedule {
    id: string;
    name: string;
    description?: string;
    status: 'draft' | 'published' | 'archived';
    shiftData: Shift[];
    masterScheduleData: Requirement[];
    schedulesData?: Record<string, Requirement[]>;
    optimizationSettings?: OnDemandOptimizationSettingsSnapshot;
    createdAt: Date;
    updatedAt: Date;
}

export interface SavedFile {
    id: string;
    name: string;
    type: 'schedule_master' | 'rideco' | 'barrie_tod' | 'other';
    storagePath: string;
    downloadUrl: string;
    size: number;
    uploadedAt: Date;
}

// Note: ScheduleDraft is defined once below with full fields including storagePath
// DraftVersion interface
export interface DraftVersion {
    id: string;
    schedules: MasterRouteTable[];
    originalSchedules: MasterRouteTable[];
    savedAt: Date;
    label?: string;
}

const omitUndefinedFields = <T extends Record<string, unknown>>(data: T): T => {
    return Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined)
    ) as T;
};

const buildDownloadError = (error: unknown, context: 'text' | 'binary'): Error => {
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('failed to fetch') || message.includes('network')) {
            return new Error(
                `Cloud file ${context === 'binary' ? 'download' : 'load'} failed due to a network interruption. Check your connection and try again.`,
            );
        }
        return error;
    }

    return new Error(
        `Cloud file ${context === 'binary' ? 'download' : 'load'} failed. Please try again.`,
    );
};

// ============ SCHEDULES ============

export const saveSchedule = async (
    userId: string,
    schedule: Omit<SavedSchedule, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> => {
    const schedulesRef = collection(db, 'users', userId, 'schedules');
    const newDocRef = doc(schedulesRef);

    await setDoc(newDocRef, {
        ...omitUndefinedFields(schedule),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    return newDocRef.id;
};

export const updateSchedule = async (
    userId: string,
    scheduleId: string,
    updates: Partial<Omit<SavedSchedule, 'id' | 'createdAt'>>
): Promise<void> => {
    const scheduleRef = doc(db, 'users', userId, 'schedules', scheduleId);
    await setDoc(scheduleRef, {
        ...omitUndefinedFields(updates),
        updatedAt: serverTimestamp()
    }, { merge: true });
};

export const getSchedule = async (
    userId: string,
    scheduleId: string
): Promise<SavedSchedule | null> => {
    const scheduleRef = doc(db, 'users', userId, 'schedules', scheduleId);
    const snapshot = await getDoc(scheduleRef);

    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    return {
        id: snapshot.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date()
    } as SavedSchedule;
};

export const getAllSchedules = async (userId: string): Promise<SavedSchedule[]> => {
    const schedulesRef = collection(db, 'users', userId, 'schedules');
    const q = query(schedulesRef, orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date()
        } as SavedSchedule;
    });
};

export const deleteSchedule = async (
    userId: string,
    scheduleId: string
): Promise<void> => {
    const scheduleRef = doc(db, 'users', userId, 'schedules', scheduleId);
    await deleteDoc(scheduleRef);
};

// ============ FILES ============

export const uploadFile = async (
    userId: string,
    file: File,
    fileType: SavedFile['type']
): Promise<SavedFile> => {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `users/${userId}/files/${timestamp}_${safeName}`;

    const fileRef = ref(storage, storagePath);
    await uploadBytes(fileRef, file);
    const downloadUrl = await getDownloadURL(fileRef);

    // Save metadata to Firestore
    const filesRef = collection(db, 'users', userId, 'files');
    const newDocRef = doc(filesRef);

    const fileData: Omit<SavedFile, 'id'> = {
        name: file.name,
        type: fileType,
        storagePath,
        downloadUrl,
        size: file.size,
        uploadedAt: new Date()
    };

    await setDoc(newDocRef, {
        ...fileData,
        uploadedAt: serverTimestamp()
    });

    return {
        id: newDocRef.id,
        ...fileData
    };
};

export const getAllFiles = async (userId: string): Promise<SavedFile[]> => {
    const filesRef = collection(db, 'users', userId, 'files');
    const q = query(filesRef, orderBy('uploadedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            uploadedAt: (data.uploadedAt as Timestamp)?.toDate() || new Date()
        } as SavedFile;
    });
};

export const deleteFile = async (
    userId: string,
    fileId: string,
    storagePath: string
): Promise<void> => {
    // Delete from Storage
    const fileRef = ref(storage, storagePath);
    try {
        await deleteObject(fileRef);
    } catch (err) {
        console.warn('File may already be deleted from storage:', err);
    }

    // Delete metadata from Firestore
    const fileDocRef = doc(db, 'users', userId, 'files', fileId);
    await deleteDoc(fileDocRef);
};

// ============ FILE CONTENT ============

export const downloadFileContent = async (downloadUrl: string): Promise<string> => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    try {
        if (isLocalhost) {
            // On localhost, use the serverless proxy to bypass CORS
            console.log('Using proxy for localhost download...');
            const response = await fetch('/api/download-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ downloadUrl })
            });

            if (!response.ok) {
                throw new Error(`Proxy download failed: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Download failed');
            }

            return data.content;
        }

        // On deployed version, direct fetch works fine
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Cloud download failed: ${response.status}`);
        }
        return response.text();
    } catch (error) {
        throw buildDownloadError(error, 'text');
    }
};

export const downloadFileArrayBuffer = async (downloadUrl: string): Promise<ArrayBuffer> => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    try {
        if (isLocalhost) {
            console.log('Using proxy for localhost binary download...');
            const response = await fetch('/api/download-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ downloadUrl, format: 'base64' })
            });

            if (!response.ok) throw new Error(`Proxy download failed: ${response.status}`);

            const data = await response.json();
            if (!data.success) throw new Error(data.error || 'Download failed');

            // Decode Base64 to ArrayBuffer
            const binaryString = atob(data.content);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        }

        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Cloud download failed: ${response.status}`);
        }
        return response.arrayBuffer();
    } catch (error) {
        console.error("Proxy binary download error:", error);
        throw buildDownloadError(error, 'binary');
    }
};

// ============ SCHEDULE DRAFTS (Tweaker) ============

export interface ScheduleDraft {
    id: string;
    name: string;
    // Schedules are now loaded from Storage, so these might be empty in listing view
    schedules: MasterRouteTable[];
    originalSchedules: MasterRouteTable[];
    storagePath?: string; // Path to JSON in Firebase Storage
    routeCount?: number; // Metadata for display without loading full data
    createdAt: Date;
    updatedAt: Date;
}

// ============ RETRY HELPER ============

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 */
export const withRetry = async <T>(
    fn: () => Promise<T>,
    retries = 3,
    baseDelayMs = 1000
): Promise<T> => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            if (attempt < retries - 1) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                console.warn(`Save attempt ${attempt + 1} failed, retrying in ${delay}ms...`, e);
                await sleep(delay);
            }
        }
    }
    throw lastError;
};

export const saveDraft = async (
    userId: string,
    draft: Omit<ScheduleDraft, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<string> => {
    const draftsRef = collection(db, 'users', userId, 'scheduleDrafts');

    // If id provided, update existing; otherwise create new
    const isUpdate = !!draft.id;
    const docRef = draft.id ? doc(draftsRef, draft.id) : doc(draftsRef);
    const draftId = docRef.id;

    // 1. Prepare data for Storage
    const content = JSON.stringify({
        schedules: draft.schedules || [],
        originalSchedules: draft.originalSchedules || []
    });

    const timestamp = Date.now();
    const storagePath = `users/${userId}/drafts/${draftId}_${timestamp}.json`;
    const storageRef = ref(storage, storagePath);

    // 2. Upload to Firebase Storage
    await uploadBytes(storageRef, new TextEncoder().encode(content), {
        contentType: 'application/json'
    });

    // 3. Save Metadata to Firestore
    const docData: Record<string, unknown> = {
        name: draft.name || 'Untitled Draft',
        storagePath: storagePath,
        routeCount: (draft.schedules || []).length, // Store route count for quick access
        // We no longer store the heavy arrays in Firestore
        schedules: [],
        originalSchedules: [],
        updatedAt: serverTimestamp()
    };

    if (!isUpdate) {
        docData.createdAt = serverTimestamp();
    }

    await setDoc(docRef, docData, { merge: true });

    // 4. Cleanup old storage file if updating (optimization)
    if (isUpdate && draft.storagePath && draft.storagePath !== storagePath) {
        try {
            const oldRef = ref(storage, draft.storagePath);
            await deleteObject(oldRef);
        } catch (e) {
            console.warn('Failed to delete old draft file:', e);
        }
    }

    return draftId;
};

export const getDraft = async (
    userId: string,
    draftId: string
): Promise<ScheduleDraft | null> => {
    const draftRef = doc(db, 'users', userId, 'scheduleDrafts', draftId);
    const snapshot = await getDoc(draftRef);

    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    let schedules = data.schedules || [];
    let originalSchedules = data.originalSchedules || [];

    // If storagePath exists, download the full content
    if (data.storagePath) {
        try {
            const storageRef = ref(storage, data.storagePath);
            const url = await getDownloadURL(storageRef);
            const content = await downloadFileContent(url);
            const json = JSON.parse(content);
            schedules = json.schedules || [];
            originalSchedules = json.originalSchedules || [];
        } catch (e) {
            console.error('Failed to load draft content from storage:', e);
            // Fallback to Firestore data if available (backwards compatibility)
        }
    }

    return {
        id: snapshot.id,
        name: data.name,
        schedules,
        originalSchedules,
        storagePath: data.storagePath,
        createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date()
    };
};

export const getAllDrafts = async (userId: string): Promise<ScheduleDraft[]> => {
    const draftsRef = collection(db, 'users', userId, 'scheduleDrafts');
    const q = query(draftsRef, orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            name: data.name,
            schedules: data.schedules || [],
            originalSchedules: data.originalSchedules || [],
            routeCount: data.routeCount || 0,
            createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date()
        };
    });
};

export const deleteDraft = async (
    userId: string,
    draftId: string
): Promise<void> => {
    // 1. Get draft and versions to find storage paths
    const draft = await getDraft(userId, draftId);
    if (!draft) return;

    // 2. Delete all versions
    const versionsRef = collection(db, 'users', userId, 'scheduleDrafts', draftId, 'versions');
    const versionsSnapshot = await getDocs(versionsRef);

    // Helper to delete version file and doc
    const deleteVersionPromises = versionsSnapshot.docs.map(async (doc) => {
        const data = doc.data();
        if (data.storagePath) {
            try {
                const storageRef = ref(storage, data.storagePath);
                await deleteObject(storageRef);
            } catch (e) {
                console.warn('Failed to delete version storage file:', e);
            }
        }
        await deleteDoc(doc.ref);
    });

    await Promise.all(deleteVersionPromises);

    // 3. Delete draft storage file
    if (draft.storagePath) {
        try {
            const storageRef = ref(storage, draft.storagePath);
            await deleteObject(storageRef);
        } catch (e) {
            console.warn('Failed to delete draft storage file:', e);
        }
    }

    // 4. Delete the draft doc itself
    const draftRef = doc(db, 'users', userId, 'scheduleDrafts', draftId);
    await deleteDoc(draftRef);
};

export const saveDraftVersion = async (
    userId: string,
    draftId: string,
    schedules: ScheduleDraft['schedules'],
    originalSchedules: ScheduleDraft['originalSchedules'],
    label?: string
): Promise<string> => {
    const versionsRef = collection(db, 'users', userId, 'scheduleDrafts', draftId, 'versions');
    const newVersionRef = doc(versionsRef);
    const versionId = newVersionRef.id;

    // 1. Prepare data for Storage
    const content = JSON.stringify({
        schedules: schedules || [],
        originalSchedules: originalSchedules || []
    });

    const timestamp = Date.now();
    const storagePath = `users/${userId}/drafts/${draftId}_versions/${versionId}_${timestamp}.json`;
    const storageRef = ref(storage, storagePath);

    // 2. Upload to Firebase Storage
    await uploadBytes(storageRef, new TextEncoder().encode(content), {
        contentType: 'application/json'
    });

    // 3. Save Metadata to Firestore
    await setDoc(newVersionRef, {
        storagePath: storagePath,
        // We no longer store the heavy arrays in Firestore
        schedules: [],
        originalSchedules: [],
        savedAt: serverTimestamp(),
        label: label || null
    });

    return versionId;
};

export const getDraftVersions = async (
    userId: string,
    draftId: string
): Promise<DraftVersion[]> => {
    const versionsRef = collection(db, 'users', userId, 'scheduleDrafts', draftId, 'versions');
    const q = query(versionsRef, orderBy('savedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            schedules: data.schedules || [],
            originalSchedules: data.originalSchedules || [],
            savedAt: (data.savedAt as Timestamp)?.toDate() || new Date(),
            label: data.label || undefined
        };
    });
};

export const restoreDraftVersion = async (
    userId: string,
    draftId: string,
    versionId: string
): Promise<ScheduleDraft | null> => {
    // 1. Get the current draft to preserve its name
    const currentDraft = await getDraft(userId, draftId);
    if (!currentDraft) return null;

    // 2. Get the version metadata
    const versionRef = doc(db, 'users', userId, 'scheduleDrafts', draftId, 'versions', versionId);
    const versionSnapshot = await getDoc(versionRef);

    if (!versionSnapshot.exists()) return null;

    const versionData = versionSnapshot.data();
    let schedules = versionData.schedules || [];
    let originalSchedules = versionData.originalSchedules || [];

    // 3. If storagePath exists, download the full content
    if (versionData.storagePath) {
        try {
            const storageRef = ref(storage, versionData.storagePath);
            const url = await getDownloadURL(storageRef);
            const content = await downloadFileContent(url);
            const json = JSON.parse(content);
            schedules = json.schedules || [];
            originalSchedules = json.originalSchedules || [];
        } catch (e) {
            console.error('Failed to load version content from storage:', e);
            // Fallback to Firestore data if available
        }
    }

    // 4. Single atomic save with preserved name (fixes race condition)
    await withRetry(() => saveDraft(userId, {
        id: draftId,
        name: currentDraft.name, // Preserve original name
        schedules,
        originalSchedules
    }));

    // 5. Return the updated draft
    return getDraft(userId, draftId);
};
