/**
 * Platform Config Service
 *
 * Handles CRUD for the team's platform/hub configuration.
 * Stored at teams/{teamId}/platformConfig/default
 *
 * Pattern: follows connectionLibraryService.ts
 */

import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { HUBS, type HubConfig } from './platformConfig';

// ============ TYPES ============

export interface PlatformConfigDocument {
    hubs: HubConfig[];
    updatedAt: string;
    updatedBy: string;
    version: number;
}

interface FirestoreLikeError {
    code?: string;
    message?: string;
}

// ============ HELPERS ============

function getConfigRef(teamId: string) {
    return doc(db, 'teams', teamId, 'platformConfig', 'default');
}

function timestampToISO(timestamp: Timestamp | string | undefined): string {
    if (!timestamp) return new Date().toISOString();
    if (typeof timestamp === 'string') return timestamp;
    return timestamp.toDate().toISOString();
}

export function buildDefaultPlatformConfig(): PlatformConfigDocument {
    return {
        hubs: HUBS,
        updatedAt: new Date().toISOString(),
        updatedBy: 'system',
        version: 0
    };
}

export function getPlatformConfigErrorMessage(
    error: unknown,
    action: 'load' | 'save'
): string {
    const firestoreError = error as FirestoreLikeError | undefined;
    const code = firestoreError?.code ?? '';

    if (code.includes('permission-denied')) {
        return action === 'save'
            ? 'You do not have permission to save platform configuration. Ask a team owner or admin to make this change.'
            : 'Unable to load the saved platform configuration because your account does not have access. Showing the built-in defaults instead.';
    }

    if (code.includes('unauthenticated')) {
        return action === 'save'
            ? 'You need to sign in again before saving platform configuration.'
            : 'You need to sign in again before loading platform configuration.';
    }

    if (code.includes('unavailable')) {
        return action === 'save'
            ? 'Platform configuration could not be saved because the database is temporarily unavailable. Please try again.'
            : 'Platform configuration could not be loaded because the database is temporarily unavailable. Showing the built-in defaults instead.';
    }

    return action === 'save'
        ? 'Failed to save platform configuration. Please try again.'
        : 'Failed to load the saved platform configuration. Showing the built-in defaults instead.';
}

// ============ READ ============

/**
 * Get platform config from Firestore.
 * Returns null if no config document exists yet.
 */
export async function getPlatformConfig(teamId: string): Promise<PlatformConfigDocument | null> {
    try {
        const docRef = getConfigRef(teamId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return null;
        }

        const data = docSnap.data();
        return {
            hubs: data.hubs || [],
            updatedAt: timestampToISO(data.updatedAt),
            updatedBy: data.updatedBy || '',
            version: data.version || 1
        };
    } catch (error) {
        console.error('Error getting platform config:', error);
        throw error;
    }
}

/**
 * Get effective config: Firestore if available, else hardcoded defaults.
 */
export async function getEffectiveConfig(teamId: string): Promise<PlatformConfigDocument> {
    const firestoreConfig = await getPlatformConfig(teamId);
    if (firestoreConfig && firestoreConfig.hubs.length > 0) {
        return firestoreConfig;
    }

    // Fallback to hardcoded defaults
    return buildDefaultPlatformConfig();
}

// ============ WRITE ============

/**
 * Save platform config to Firestore.
 */
export async function savePlatformConfig(
    teamId: string,
    config: Pick<PlatformConfigDocument, 'hubs'>,
    userId: string
): Promise<void> {
    try {
        const existing = await getPlatformConfig(teamId);
        const nextVersion = (existing?.version || 0) + 1;

        const docRef = getConfigRef(teamId);
        await setDoc(docRef, {
            hubs: config.hubs,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
            version: nextVersion
        });
    } catch (error) {
        console.error('Error saving platform config:', error);
        throw error;
    }
}

/**
 * Seed Firestore with hardcoded defaults (explicit admin action).
 */
export async function seedFromDefaults(teamId: string, userId: string): Promise<void> {
    await savePlatformConfig(
        teamId,
        { hubs: HUBS },
        userId
    );
}
