/**
 * Transit App Data Service
 *
 * Firebase CRUD for team-scoped Transit App data.
 * Firestore: teams/{teamId}/transitAppData/default  (metadata)
 * Storage:   teams/{teamId}/transitAppData/{timestamp}.json  (full summary)
 */

import {
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    serverTimestamp,
} from 'firebase/firestore';
import {
    ref,
    uploadString,
    getDownloadURL,
    deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';
import type { TransitAppDataSummary } from './transitAppTypes';

// ============ HELPERS ============

function getMetadataRef(teamId: string) {
    return doc(db, 'teams', teamId, 'transitAppData', 'default');
}

function getStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/transitAppData/${timestamp}.json`;
}

// ============ SAVE ============

export async function saveTransitAppData(
    teamId: string,
    userId: string,
    summary: TransitAppDataSummary
): Promise<void> {
    const timestamp = Date.now().toString();
    const storagePath = getStoragePath(teamId, timestamp);

    // Upload full summary JSON to Storage
    const storageRef = ref(storage, storagePath);
    const jsonStr = JSON.stringify(summary);
    await uploadString(storageRef, jsonStr, 'raw', {
        contentType: 'application/json',
    });

    // Save metadata to Firestore
    const metadataRef = getMetadataRef(teamId);

    // Check if there's an existing storage file to clean up
    const existing = await getDoc(metadataRef);
    if (existing.exists()) {
        const oldPath = existing.data().storagePath;
        if (oldPath) {
            try {
                await deleteObject(ref(storage, oldPath));
            } catch {
                // Old file may already be gone — ignore
            }
        }
    }

    await setDoc(metadataRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        storagePath,
        dateRange: summary.metadata.dateRange,
        fileStats: summary.metadata.fileStats,
    });
}

// ============ READ ============

export interface TransitAppMetadata {
    importedAt: string;
    importedBy: string;
    storagePath: string;
    dateRange: { start: string; end: string };
    fileStats: {
        totalFiles: number;
        rowsParsed: number;
    };
}

export async function getTransitAppMetadata(teamId: string): Promise<TransitAppMetadata | null> {
    try {
        const docSnap = await getDoc(getMetadataRef(teamId));
        if (!docSnap.exists()) return null;

        const data = docSnap.data();
        return {
            importedAt: data.importedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            importedBy: data.importedBy || '',
            storagePath: data.storagePath || '',
            dateRange: data.dateRange || { start: '', end: '' },
            fileStats: {
                totalFiles: data.fileStats?.totalFiles || 0,
                rowsParsed: data.fileStats?.rowsParsed || 0,
            },
        };
    } catch (error) {
        console.error('Error getting transit app metadata:', error);
        return null;
    }
}

export async function getTransitAppData(teamId: string): Promise<TransitAppDataSummary | null> {
    try {
        const metadata = await getTransitAppMetadata(teamId);
        if (!metadata?.storagePath) return null;

        const storageRef = ref(storage, metadata.storagePath);
        const url = await getDownloadURL(storageRef);
        const response = await fetch(url);
        if (!response.ok) return null;

        const summary: TransitAppDataSummary = await response.json();
        return summary;
    } catch (error) {
        console.error('Error getting transit app data:', error);
        return null;
    }
}

// ============ DELETE ============

export async function deleteTransitAppData(teamId: string): Promise<void> {
    const metadataRef = getMetadataRef(teamId);
    const docSnap = await getDoc(metadataRef);

    if (docSnap.exists()) {
        const storagePath = docSnap.data().storagePath;
        if (storagePath) {
            try {
                await deleteObject(ref(storage, storagePath));
            } catch {
                // File may already be gone
            }
        }
        await deleteDoc(metadataRef);
    }
}
