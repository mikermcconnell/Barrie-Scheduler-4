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
import { db } from './firebase';
import { HUBS, ROUTE_FAMILIES, type HubConfig } from './platformConfig';

// ============ TYPES ============

export interface PlatformConfigDocument {
    hubs: HubConfig[];
    routeFamilies: Record<string, string[]>;
    updatedAt: string;
    updatedBy: string;
    version: number;
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
            routeFamilies: data.routeFamilies || {},
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
    return {
        hubs: HUBS,
        routeFamilies: ROUTE_FAMILIES,
        updatedAt: new Date().toISOString(),
        updatedBy: 'system',
        version: 0  // 0 = defaults, not yet saved
    };
}

// ============ WRITE ============

/**
 * Save platform config to Firestore.
 */
export async function savePlatformConfig(
    teamId: string,
    config: Pick<PlatformConfigDocument, 'hubs' | 'routeFamilies'>,
    userId: string
): Promise<void> {
    try {
        const existing = await getPlatformConfig(teamId);
        const nextVersion = (existing?.version || 0) + 1;

        const docRef = getConfigRef(teamId);
        await setDoc(docRef, {
            hubs: config.hubs,
            routeFamilies: config.routeFamilies,
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
        { hubs: HUBS, routeFamilies: ROUTE_FAMILIES },
        userId
    );
}
