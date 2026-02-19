/**
 * Performance Data Service
 *
 * Firebase CRUD for team-scoped STREETS performance data.
 * Firestore: teams/{teamId}/performanceData/metadata  (metadata)
 * Storage:   teams/{teamId}/performanceData/{timestamp}.json  (full summary)
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
import type { PerformanceDataSummary, PerformanceMetadata } from './performanceDataTypes';
import { aggregateMonthlySnapshots } from './performanceDataAggregator';
import { saveMonthlySnapshots } from './performanceSnapshotService';

// ============ HELPERS ============

function getMetadataRef(teamId: string) {
    return doc(db, 'teams', teamId, 'performanceData', 'metadata');
}

function getStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/performanceData/${timestamp}.json`;
}

// ============ SAVE ============

export async function savePerformanceData(
    teamId: string,
    userId: string,
    summary: PerformanceDataSummary
): Promise<void> {
    const timestamp = Date.now().toString();
    const storagePath = getStoragePath(teamId, timestamp);

    // Upload full summary JSON to Storage
    const storageRef = ref(storage, storagePath);
    const jsonStr = JSON.stringify(summary);
    await uploadString(storageRef, jsonStr, 'raw', {
        contentType: 'application/json',
    });

    // Check if there's an existing storage file to clean up
    const metadataRef = getMetadataRef(teamId);
    const existing = await getDoc(metadataRef);
    if (existing.exists()) {
        const oldPath = existing.data().storagePath;
        if (oldPath) {
            // Snapshot old data before deleting — best-effort, never blocks import
            try {
                const oldRef = ref(storage, oldPath);
                const oldUrl = await getDownloadURL(oldRef);
                const oldResponse = await fetch(oldUrl);
                if (oldResponse.ok) {
                    const oldSummary: PerformanceDataSummary = await oldResponse.json();
                    const snapshots = aggregateMonthlySnapshots(oldSummary.dailySummaries);
                    if (snapshots.length > 0) {
                        await saveMonthlySnapshots(teamId, snapshots);
                    }
                }
            } catch (snapshotErr) {
                console.error('Snapshot archive failed (non-blocking):', snapshotErr);
            }

            try {
                await deleteObject(ref(storage, oldPath));
            } catch {
                // Old file may already be gone — ignore
            }
        }
    }

    // Save metadata to Firestore
    await setDoc(metadataRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        storagePath,
        dateRange: summary.metadata.dateRange,
        dayCount: summary.metadata.dayCount,
        totalRecords: summary.metadata.totalRecords,
    });
}

// ============ READ ============

export async function getPerformanceMetadata(teamId: string): Promise<PerformanceMetadata | null> {
    try {
        const docSnap = await getDoc(getMetadataRef(teamId));
        if (!docSnap.exists()) return null;

        const data = docSnap.data();
        return {
            importedAt: data.importedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            importedBy: data.importedBy || '',
            dateRange: data.dateRange || { start: '', end: '' },
            dayCount: data.dayCount || 0,
            totalRecords: data.totalRecords || 0,
            storagePath: data.storagePath || '',
        };
    } catch (error) {
        console.error('Error getting performance metadata:', error);
        return null;
    }
}

export async function getPerformanceData(teamId: string): Promise<PerformanceDataSummary | null> {
    try {
        const metadata = await getPerformanceMetadata(teamId);
        if (!metadata?.storagePath) return null;

        const storageRef = ref(storage, metadata.storagePath);
        const url = await getDownloadURL(storageRef);
        const response = await fetch(url);
        if (!response.ok) return null;

        const summary: PerformanceDataSummary = await response.json();
        return summary;
    } catch (error) {
        console.error('Error getting performance data:', error);
        return null;
    }
}

// ============ DELETE ============

export async function deletePerformanceData(teamId: string): Promise<void> {
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
