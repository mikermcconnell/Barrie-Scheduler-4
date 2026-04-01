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

export function mergePerformanceSummaryMetadata(
    summary: PerformanceDataSummary,
    metadata: PerformanceMetadata
): PerformanceDataSummary {
    return {
        ...summary,
        metadata: {
            ...summary.metadata,
            importedAt: metadata.importedAt || summary.metadata.importedAt,
            importedBy: metadata.importedBy || summary.metadata.importedBy,
            dateRange: metadata.dateRange || summary.metadata.dateRange,
            dayCount: metadata.dayCount || summary.metadata.dayCount,
            totalRecords: metadata.totalRecords || summary.metadata.totalRecords,
            runtimeLogicVersion: metadata.runtimeLogicVersion ?? summary.metadata.runtimeLogicVersion,
            cleanHistoryStartDate: metadata.cleanHistoryStartDate ?? summary.metadata.cleanHistoryStartDate,
            storagePath: metadata.storagePath || summary.metadata.storagePath,
        },
    };
}

// ============ SAVE ============

export async function savePerformanceData(
    teamId: string,
    userId: string,
    summary: PerformanceDataSummary
): Promise<void> {
    const timestamp = Date.now().toString();
    const storagePath = getStoragePath(teamId, timestamp);
    const metadataRef = getMetadataRef(teamId);

    // Merge with existing data — new days replace old, existing days are kept
    let merged = summary;
    const existing = await getDoc(metadataRef);
    const oldPath: string | null = existing.exists() ? existing.data().storagePath || null : null;
    if (oldPath) {
        try {
            const oldRef = ref(storage, oldPath);
            const oldUrl = await getDownloadURL(oldRef);
            const oldResponse = await fetch(oldUrl);
            if (oldResponse.ok) {
                const oldSummary: PerformanceDataSummary = await oldResponse.json();

                // Snapshot old data before overwriting — best-effort
                try {
                    const snapshots = aggregateMonthlySnapshots(oldSummary.dailySummaries);
                    if (snapshots.length > 0) {
                        await saveMonthlySnapshots(teamId, snapshots);
                    }
                } catch (snapshotErr) {
                    console.error('Snapshot archive failed (non-blocking):', snapshotErr);
                }

                // Merge: new days replace old, keep days not in the new import
                const newDates = new Set(summary.dailySummaries.map(d => d.date));
                const kept = oldSummary.dailySummaries.filter(d => !newDates.has(d.date));
                const allDays = [...kept, ...summary.dailySummaries]
                    .sort((a, b) => a.date.localeCompare(b.date));

                const dates = allDays.map(d => d.date);
                merged = {
                    dailySummaries: allDays,
                    metadata: {
                        importedAt: new Date().toISOString(),
                        importedBy: userId,
                        dateRange: { start: dates[0], end: dates[dates.length - 1] },
                        dayCount: allDays.length,
                        totalRecords: summary.metadata.totalRecords,
                        runtimeLogicVersion: summary.metadata.runtimeLogicVersion ?? oldSummary.metadata?.runtimeLogicVersion,
                        cleanHistoryStartDate: summary.metadata.cleanHistoryStartDate ?? oldSummary.metadata?.cleanHistoryStartDate,
                    },
                    schemaVersion: summary.schemaVersion,
                };
            }
        } catch (fetchErr) {
            console.error('Could not fetch existing data for merge:', fetchErr);
            // Fall through — save new data only
        }
    }

    // Upload merged summary JSON to Storage
    const storageRef = ref(storage, storagePath);
    await uploadString(storageRef, JSON.stringify(merged), 'raw', {
        contentType: 'application/json',
    });

    // Save metadata to Firestore
    await setDoc(metadataRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        storagePath,
        dateRange: merged.metadata.dateRange,
        dayCount: merged.metadata.dayCount,
        totalRecords: merged.metadata.totalRecords,
        runtimeLogicVersion: merged.metadata.runtimeLogicVersion ?? null,
        cleanHistoryStartDate: merged.metadata.cleanHistoryStartDate ?? null,
    });

    // Clean up old storage file only after new data + metadata are committed.
    if (oldPath && oldPath !== storagePath) {
        try {
            await deleteObject(ref(storage, oldPath));
        } catch {
            // Old file may already be gone — ignore
        }
    }
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
            runtimeLogicVersion: typeof data.runtimeLogicVersion === 'number' ? data.runtimeLogicVersion : undefined,
            cleanHistoryStartDate: typeof data.cleanHistoryStartDate === 'string' ? data.cleanHistoryStartDate : undefined,
            storagePath: data.storagePath || '',
        };
    } catch (error) {
        console.error('Error getting performance metadata:', error);
        return null;
    }
}

export async function getPerformanceData(
    teamId: string,
    metadataOverride?: PerformanceMetadata | null,
): Promise<PerformanceDataSummary | null> {
    try {
        const metadata = metadataOverride ?? await getPerformanceMetadata(teamId);
        if (!metadata?.storagePath) return null;

        const storageRef = ref(storage, metadata.storagePath);
        const url = await getDownloadURL(storageRef);
        const response = await fetch(url);
        if (!response.ok) return null;

        const summary: PerformanceDataSummary = await response.json();
        return mergePerformanceSummaryMetadata(summary, metadata);
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
