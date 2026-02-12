/**
 * System Draft Service
 *
 * CRUD operations for system-wide drafts that contain ALL routes for a day type.
 * This enables interline logic by having both 8A and 8B loaded together.
 *
 * Storage Strategy:
 * - Firestore: metadata only (for fast listing)
 * - Firebase Storage: full content (routes, interline config)
 */

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
import type {
    SystemDraft,
    SystemDraftInput,
    SystemDraftMetadata,
    SystemDraftRoute,
    SystemDraftBasedOn
} from '../schedule/scheduleTypes';
import { downloadFileContent } from './dataService';

const SYSTEM_DRAFTS_COLLECTION = 'systemDrafts';

// ============ HELPERS ============

const systemDraftStoragePath = (userId: string, draftId: string, timestamp: number) =>
    `users/${userId}/${SYSTEM_DRAFTS_COLLECTION}/${draftId}_${timestamp}.json`;

const timestampToDate = (value?: Timestamp | Date): Date => {
    if (!value) return new Date();
    return value instanceof Date ? value : value.toDate();
};

// ============ CRUD OPERATIONS ============

/**
 * Save a system draft (create or update).
 * Stores metadata in Firestore and full content in Firebase Storage.
 *
 * @param userId - The user's ID
 * @param draft - The system draft to save
 * @returns The draft ID
 */
export const saveSystemDraft = async (
    userId: string,
    draft: SystemDraftInput
): Promise<string> => {
    if (!draft.routes || draft.routes.length === 0) {
        throw new Error('System draft must contain at least one route.');
    }

    const draftsRef = collection(db, 'users', userId, SYSTEM_DRAFTS_COLLECTION);
    const isUpdate = !!draft.id;
    const draftRef = draft.id ? doc(draftsRef, draft.id) : doc(draftsRef);
    const draftId = draftRef.id;

    // Upload content to Firebase Storage
    const timestamp = Date.now();
    const storagePath = systemDraftStoragePath(userId, draftId, timestamp);
    const storageRef = ref(storage, storagePath);

    const contentJson = JSON.stringify({
        routes: draft.routes,
        metadata: {
            dayType: draft.dayType,
            routeCount: draft.routes.length,
            savedAt: new Date().toISOString()
        }
    });

    await uploadBytes(
        storageRef,
        new TextEncoder().encode(contentJson),
        { contentType: 'application/json' }
    );

    // Store metadata in Firestore
    const docData: Record<string, unknown> = {
        name: draft.name || `${draft.dayType} System Draft`,
        dayType: draft.dayType,
        status: draft.status || 'draft',
        createdBy: draft.createdBy,
        basedOn: draft.basedOn || null,
        storagePath,
        routeCount: draft.routes.length,
        updatedAt: serverTimestamp()
    };

    if (!isUpdate) {
        docData.createdAt = serverTimestamp();
    }

    await setDoc(draftRef, docData, { merge: true });

    // Clean up old storage file if updating
    if (isUpdate && draft.storagePath && draft.storagePath !== storagePath) {
        try {
            await deleteObject(ref(storage, draft.storagePath));
        } catch (error) {
            console.warn('Failed to delete old system draft storage file:', error);
        }
    }

    return draftId;
};

/**
 * Update only the metadata of a system draft (name, status, etc.)
 * without re-uploading the content.
 */
export const updateSystemDraftMetadata = async (
    userId: string,
    draftId: string,
    updates: Partial<Pick<SystemDraft, 'name' | 'status' | 'basedOn'>>
): Promise<void> => {
    const draftRef = doc(db, 'users', userId, SYSTEM_DRAFTS_COLLECTION, draftId);
    await setDoc(draftRef, {
        ...updates,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

/**
 * Load content from Firebase Storage.
 */
const loadSystemDraftContent = async (
    storagePath?: string
): Promise<{ routes: SystemDraftRoute[] } | null> => {
    if (!storagePath) return null;

    try {
        const storageRef = ref(storage, storagePath);
        const url = await getDownloadURL(storageRef);
        const content = await downloadFileContent(url);
        const json = JSON.parse(content);
        return {
            routes: json.routes as SystemDraftRoute[]
        };
    } catch (error) {
        console.error('Failed to load system draft content:', error);
        return null;
    }
};

/**
 * Get a single system draft with full content.
 *
 * @param userId - The user's ID
 * @param draftId - The draft ID to load
 * @returns The full system draft with routes, or null if not found
 */
export const getSystemDraft = async (
    userId: string,
    draftId: string
): Promise<SystemDraft | null> => {
    const draftRef = doc(db, 'users', userId, SYSTEM_DRAFTS_COLLECTION, draftId);
    const snapshot = await getDoc(draftRef);

    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    const content = await loadSystemDraftContent(data.storagePath);

    return {
        id: snapshot.id,
        name: data.name,
        dayType: data.dayType,
        routes: content?.routes || [],
        status: data.status || 'draft',
        createdBy: data.createdBy,
        basedOn: data.basedOn || undefined,
        storagePath: data.storagePath,
        routeCount: data.routeCount || content?.routes?.length || 0,
        createdAt: timestampToDate(data.createdAt),
        updatedAt: timestampToDate(data.updatedAt)
    };
};

/**
 * Get all system drafts for a user (metadata only, no content).
 * Use this for listing/displaying drafts.
 *
 * @param userId - The user's ID
 * @returns Array of system draft metadata
 */
export const getAllSystemDrafts = async (
    userId: string
): Promise<SystemDraftMetadata[]> => {
    const draftsRef = collection(db, 'users', userId, SYSTEM_DRAFTS_COLLECTION);
    const q = query(draftsRef, orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
            id: docSnap.id,
            name: data.name,
            dayType: data.dayType,
            status: data.status || 'draft',
            createdBy: data.createdBy,
            basedOn: data.basedOn || undefined,
            routeCount: data.routeCount || 0,
            createdAt: timestampToDate(data.createdAt),
            updatedAt: timestampToDate(data.updatedAt)
        };
    });
};

/**
 * Delete a system draft and its storage content.
 *
 * @param userId - The user's ID
 * @param draftId - The draft ID to delete
 */
export const deleteSystemDraft = async (
    userId: string,
    draftId: string
): Promise<void> => {
    const draftRef = doc(db, 'users', userId, SYSTEM_DRAFTS_COLLECTION, draftId);
    const snapshot = await getDoc(draftRef);

    if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.storagePath) {
            try {
                await deleteObject(ref(storage, data.storagePath));
            } catch (error) {
                console.warn('Failed to delete system draft storage file:', error);
            }
        }
    }

    await deleteDoc(draftRef);
};

// ============ UTILITY FUNCTIONS ============

/**
 * Generate a default name for a system draft.
 */
export const generateSystemDraftName = (dayType: string): string => {
    const date = new Date();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear();
    return `${dayType} System - ${month} ${day}, ${year}`;
};

/**
 * Count total trips across all routes in a system draft.
 */
export const countSystemDraftTrips = (routes: SystemDraftRoute[]): number => {
    return routes.reduce((total, route) => {
        return total + route.northTable.trips.length + route.southTable.trips.length;
    }, 0);
};

/**
 * Get route numbers from a system draft.
 */
export const getSystemDraftRouteNumbers = (routes: SystemDraftRoute[]): string[] => {
    return routes.map(r => r.routeNumber).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );
};
