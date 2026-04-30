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
    uploadBytes,
    getDownloadURL,
    deleteObject,
} from 'firebase/storage';
import { db, storage } from './firebase';
import type { PerformanceDataSummary, PerformanceMetadata } from './performanceDataTypes';
import { aggregateMonthlySnapshots } from './performanceDataAggregator';
import { buildPerformanceOverviewSummary, buildPerformanceReportSummary } from './performanceOverviewSummary';
import { saveMonthlySnapshots } from './performanceSnapshotService';
import { filterPerformanceSummaryByRoute, getAvailablePerformanceRoutes } from './performanceRouteFilter';

// ============ HELPERS ============

function getMetadataRef(teamId: string) {
    return doc(db, 'teams', teamId, 'performanceData', 'metadata');
}

function getStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/performanceData/${timestamp}.json`;
}

function getOverviewStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/performanceData/${timestamp}-overview.json`;
}

function getReportStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/performanceData/${timestamp}-report.json`;
}

function getRouteStoragePath(teamId: string, timestamp: string, routeId: string) {
    return `teams/${teamId}/performanceData/${timestamp}-route-${encodeURIComponent(routeId)}.json`;
}

export function buildStorageJsonUploadData(value: unknown): Blob | Uint8Array {
    const json = JSON.stringify(value);
    if (typeof Blob !== 'undefined') {
        return new Blob([json], { type: 'application/json' });
    }
    return new TextEncoder().encode(json);
}

export function getTotalRecordsForSummary(summary: PerformanceDataSummary): number {
    return summary.dailySummaries.reduce((sum, day) => sum + (day.dataQuality?.totalRecords || 0), 0);
}

export function resolveMergedCleanHistoryStartDate(
    incomingStartDate: string | undefined,
    existingStartDate: string | undefined,
): string | undefined {
    if (incomingStartDate && existingStartDate) {
        return incomingStartDate <= existingStartDate ? incomingStartDate : existingStartDate;
    }
    return incomingStartDate ?? existingStartDate;
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
            overviewStoragePath: metadata.overviewStoragePath || summary.metadata.overviewStoragePath,
            reportStoragePath: metadata.reportStoragePath || summary.metadata.reportStoragePath,
            routeStoragePaths: metadata.routeStoragePaths || summary.metadata.routeStoragePaths,
        },
    };
}

export function mergePerformanceOverviewMetadata(
    summary: PerformanceDataSummary,
    metadata: PerformanceMetadata,
): PerformanceDataSummary {
    return {
        ...summary,
        metadata: {
            ...summary.metadata,
            importedAt: metadata.importedAt || summary.metadata.importedAt,
            importedBy: metadata.importedBy || summary.metadata.importedBy,
            runtimeLogicVersion: metadata.runtimeLogicVersion ?? summary.metadata.runtimeLogicVersion,
            cleanHistoryStartDate: metadata.cleanHistoryStartDate ?? summary.metadata.cleanHistoryStartDate,
            storagePath: metadata.storagePath || summary.metadata.storagePath,
            overviewStoragePath: metadata.overviewStoragePath || summary.metadata.overviewStoragePath,
            reportStoragePath: metadata.reportStoragePath || summary.metadata.reportStoragePath,
            routeStoragePaths: metadata.routeStoragePaths || summary.metadata.routeStoragePaths,
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
    const overviewStoragePath = getOverviewStoragePath(teamId, timestamp);
    const reportStoragePath = getReportStoragePath(teamId, timestamp);
    const metadataRef = getMetadataRef(teamId);

    // Merge with existing data — new days replace old, existing days are kept
    let merged = summary;
    const existing = await getDoc(metadataRef);
    const oldPath: string | null = existing.exists() ? existing.data().storagePath || null : null;
    const oldOverviewPath: string | null = existing.exists() ? existing.data().overviewStoragePath || null : null;
    const oldReportPath: string | null = existing.exists() ? existing.data().reportStoragePath || null : null;
    const oldRouteStoragePaths: Record<string, string> = existing.exists()
        && existing.data().routeStoragePaths
        && typeof existing.data().routeStoragePaths === 'object'
        ? existing.data().routeStoragePaths
        : {};
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
                        totalRecords: getTotalRecordsForSummary({ ...summary, dailySummaries: allDays }),
                        runtimeLogicVersion: summary.metadata.runtimeLogicVersion ?? oldSummary.metadata?.runtimeLogicVersion,
                        cleanHistoryStartDate: resolveMergedCleanHistoryStartDate(
                            summary.metadata.cleanHistoryStartDate,
                            oldSummary.metadata?.cleanHistoryStartDate,
                        ),
                    },
                    schemaVersion: summary.schemaVersion,
                };
            }
        } catch (fetchErr) {
            console.error('Could not fetch existing data for merge:', fetchErr);
            // Fall through — save new data only
        }
    }

    const overviewSummary = buildPerformanceOverviewSummary(merged);
    const reportSummary = buildPerformanceReportSummary(merged);
    const routeStoragePaths: Record<string, string> = {};

    // Upload merged summary JSON to Storage
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, buildStorageJsonUploadData(merged), {
        contentType: 'application/json',
    });
    await uploadBytes(ref(storage, overviewStoragePath), buildStorageJsonUploadData(overviewSummary), {
        contentType: 'application/json',
    });
    await uploadBytes(ref(storage, reportStoragePath), buildStorageJsonUploadData(reportSummary), {
        contentType: 'application/json',
    });
    await Promise.all(getAvailablePerformanceRoutes(merged).map(async route => {
        const routePath = getRouteStoragePath(teamId, timestamp, route.routeId);
        const routeSummary = filterPerformanceSummaryByRoute(merged, route.routeId);
        if (!routeSummary) return;
        await uploadBytes(ref(storage, routePath), buildStorageJsonUploadData(routeSummary), {
            contentType: 'application/json',
        });
        routeStoragePaths[route.routeId] = routePath;
    }));

    // Save metadata to Firestore
    await setDoc(metadataRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        storagePath,
        overviewStoragePath,
        reportStoragePath,
        routeStoragePaths,
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
    if (oldOverviewPath && oldOverviewPath !== overviewStoragePath) {
        try {
            await deleteObject(ref(storage, oldOverviewPath));
        } catch {
            // Old overview file may already be gone — ignore
        }
    }
    if (oldReportPath && oldReportPath !== reportStoragePath) {
        try {
            await deleteObject(ref(storage, oldReportPath));
        } catch {
            // Old report file may already be gone — ignore
        }
    }
    await Promise.all(Object.values(oldRouteStoragePaths).map(async oldRoutePath => {
        if (!oldRoutePath || Object.values(routeStoragePaths).includes(oldRoutePath)) return;
        try {
            await deleteObject(ref(storage, oldRoutePath));
        } catch {
            // Old route file may already be gone — ignore
        }
    }));
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
            overviewStoragePath: data.overviewStoragePath || '',
            reportStoragePath: data.reportStoragePath || '',
            routeStoragePaths: data.routeStoragePaths && typeof data.routeStoragePaths === 'object'
                ? data.routeStoragePaths
                : undefined,
        };
    } catch (error) {
        console.error('Error getting performance metadata:', error);
        return null;
    }
}

export async function getPerformanceData(
    teamId: string,
    metadataOverride?: PerformanceMetadata | null,
    routeId?: string | null,
): Promise<PerformanceDataSummary | null> {
    try {
        const metadata = metadataOverride ?? await getPerformanceMetadata(teamId);
        if (!metadata?.storagePath) return null;

        const selectedRoutePath = routeId && routeId !== 'all'
            ? metadata.routeStoragePaths?.[routeId]
            : undefined;
        const storagePathToLoad = selectedRoutePath || metadata.storagePath;

        let response: Response | null = null;
        try {
            const url = await getDownloadURL(ref(storage, storagePathToLoad));
            response = await fetch(url);
        } catch (routeError) {
            if (!selectedRoutePath) throw routeError;
            console.warn('Route-scoped performance data unavailable; falling back to full data:', routeError);
        }

        if (!response?.ok && selectedRoutePath) {
            const url = await getDownloadURL(ref(storage, metadata.storagePath));
            response = await fetch(url);
        }
        if (!response?.ok) return null;

        const summary: PerformanceDataSummary = await response.json();
        return filterPerformanceSummaryByRoute(
            mergePerformanceSummaryMetadata(summary, metadata),
            routeId,
        );
    } catch (error) {
        console.error('Error getting performance data:', error);
        return null;
    }
}

export async function getPerformanceOverviewData(
    teamId: string,
    metadataOverride?: PerformanceMetadata | null,
): Promise<PerformanceDataSummary | null> {
    try {
        const metadata = metadataOverride ?? await getPerformanceMetadata(teamId);
        if (!metadata) return null;

        if (!metadata.overviewStoragePath) {
            const fullSummary = await getPerformanceData(teamId, metadata);
            return fullSummary ? buildPerformanceOverviewSummary(fullSummary) : null;
        }

        const storageRef = ref(storage, metadata.overviewStoragePath);
        const url = await getDownloadURL(storageRef);
        const response = await fetch(url);
        if (!response.ok) return null;

        const summary: PerformanceDataSummary = await response.json();
        return mergePerformanceOverviewMetadata(summary, metadata);
    } catch (error) {
        console.error('Error getting performance overview data:', error);
        return null;
    }
}

// ============ DELETE ============

export async function deletePerformanceData(teamId: string): Promise<void> {
    const metadataRef = getMetadataRef(teamId);
    const docSnap = await getDoc(metadataRef);

    if (docSnap.exists()) {
        const storagePath = docSnap.data().storagePath;
        const overviewStoragePath = docSnap.data().overviewStoragePath;
        const reportStoragePath = docSnap.data().reportStoragePath;
        const routeStoragePaths: Record<string, string> = docSnap.data().routeStoragePaths
            && typeof docSnap.data().routeStoragePaths === 'object'
            ? docSnap.data().routeStoragePaths
            : {};
        if (storagePath) {
            try {
                await deleteObject(ref(storage, storagePath));
            } catch {
                // File may already be gone
            }
        }
        if (overviewStoragePath) {
            try {
                await deleteObject(ref(storage, overviewStoragePath));
            } catch {
                // File may already be gone
            }
        }
        if (reportStoragePath) {
            try {
                await deleteObject(ref(storage, reportStoragePath));
            } catch {
                // File may already be gone
            }
        }
        await Promise.all(Object.values(routeStoragePaths).map(async routeStoragePath => {
            if (!routeStoragePath) return;
            try {
                await deleteObject(ref(storage, routeStoragePath));
            } catch {
                // File may already be gone
            }
        }));
        await deleteDoc(metadataRef);
    }
}
