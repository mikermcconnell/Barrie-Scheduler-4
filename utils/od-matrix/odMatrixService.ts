/**
 * OD Matrix Service
 *
 * Firebase CRUD for team-scoped OD matrix data.
 * Firestore: teams/{teamId}/odMatrixData/default           (active import metadata)
 *            teams/{teamId}/odMatrixData/geocodeCache       (geocode cache)
 *            teams/{teamId}/odMatrixData/imports/{id}       (import history)
 * Storage:   teams/{teamId}/odMatrixData/{timestamp}.json   (full data summary)
 */

import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    writeBatch,
    deleteDoc,
    collection,
    getDocs,
    serverTimestamp,
    query,
    orderBy,
} from 'firebase/firestore';
import {
    ref,
    uploadString,
    getDownloadURL,
    deleteObject,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import type {
    ODMatrixDataSummary,
    ODMatrixMetadata,
    ODMatrixImportRecord,
    GeocodeCache,
} from './odMatrixTypes';

// ============ HELPERS ============

function getDefaultRef(teamId: string) {
    return doc(db, 'teams', teamId, 'odMatrixData', 'default');
}

function getGeocodeCacheRef(teamId: string) {
    return doc(db, 'teams', teamId, 'odMatrixData', 'geocodeCache');
}

function getImportRef(teamId: string, importId: string) {
    return doc(db, 'teams', teamId, 'odMatrixData', 'default', 'imports', importId);
}

function getImportsCollectionRef(teamId: string) {
    return collection(db, 'teams', teamId, 'odMatrixData', 'default', 'imports');
}

function getStoragePath(teamId: string, timestamp: string) {
    return `teams/${teamId}/odMatrixData/${timestamp}.json`;
}

// ============ SAVE ============

export async function saveODMatrixData(
    teamId: string,
    userId: string,
    summary: ODMatrixDataSummary
): Promise<string> {
    const importId = Date.now().toString();
    const storagePath = getStoragePath(teamId, importId);
    const summaryForStorage: ODMatrixDataSummary = {
        ...summary,
        metadata: {
            ...summary.metadata,
            importId,
        },
    };

    // Upload full summary JSON to Storage
    const storageRef = ref(storage, storagePath);
    const jsonStr = JSON.stringify(summaryForStorage);
    await uploadString(storageRef, jsonStr, 'raw', {
        contentType: 'application/json',
    });

    // Save import record
    const importRecord: Omit<ODMatrixImportRecord, 'id'> = {
        importedAt: new Date().toISOString(),
        importedBy: userId,
        fileName: summary.metadata.fileName,
        dateRange: summary.metadata.dateRange || null,
        stationCount: summary.stationCount,
        totalJourneys: summary.totalJourneys,
        storagePath,
        isActive: true,
    };

    // Deactivate previous active imports
    const existingImports = await listODMatrixImports(teamId);
    await Promise.all(
        existingImports
            .filter(imp => imp.isActive)
            .map(imp => updateDoc(getImportRef(teamId, imp.id), { isActive: false }))
    );

    await setDoc(getImportRef(teamId, importId), { id: importId, ...importRecord });

    // Update default metadata pointer
    await setDoc(getDefaultRef(teamId), {
        activeImportId: importId,
        importedAt: serverTimestamp(),
        importedBy: userId,
        storagePath,
        fileName: summary.metadata.fileName,
        dateRange: summary.metadata.dateRange || null,
        stationCount: summary.stationCount,
        totalJourneys: summary.totalJourneys,
    });

    return importId;
}

// ============ READ ============

export async function getODMatrixMetadata(teamId: string): Promise<ODMatrixMetadata | null> {
    try {
        const docSnap = await getDoc(getDefaultRef(teamId));
        if (!docSnap.exists()) return null;

        const data = docSnap.data();
        return {
            importId: data.activeImportId ?? undefined,
            importedAt: data.importedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            importedBy: data.importedBy || '',
            fileName: data.fileName || '',
            dateRange: data.dateRange ?? undefined,
            stationCount: data.stationCount || 0,
            totalJourneys: data.totalJourneys || 0,
        };
    } catch (error) {
        console.error('Error getting OD matrix metadata:', error);
        return null;
    }
}

export async function getODMatrixData(teamId: string): Promise<ODMatrixDataSummary | null> {
    try {
        const docSnap = await getDoc(getDefaultRef(teamId));
        if (!docSnap.exists()) return null;

        const data = docSnap.data();
        const storagePath = data.storagePath;
        if (!storagePath) return null;

        const storageRef = ref(storage, storagePath);
        const url = await getDownloadURL(storageRef);
        const response = await fetch(url);
        if (!response.ok) return null;

        return await response.json() as ODMatrixDataSummary;
    } catch (error) {
        console.error('Error getting OD matrix data:', error);
        return null;
    }
}

// ============ IMPORT HISTORY ============

export async function listODMatrixImports(teamId: string): Promise<ODMatrixImportRecord[]> {
    try {
        const q = query(getImportsCollectionRef(teamId), orderBy('importedAt', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ODMatrixImportRecord));
    } catch (error) {
        console.error('Error listing OD matrix imports:', error);
        throw error;
    }
}

// ============ LOAD SPECIFIC IMPORT ============

export async function loadODMatrixImportById(
    teamId: string,
    importId: string
): Promise<ODMatrixDataSummary | null> {
    try {
        const importSnap = await getDoc(getImportRef(teamId, importId));
        if (!importSnap.exists()) return null;

        const record = importSnap.data() as ODMatrixImportRecord;
        const storageRef = ref(storage, record.storagePath);
        const url = await getDownloadURL(storageRef);
        const response = await fetch(url);
        if (!response.ok) return null;

        return await response.json() as ODMatrixDataSummary;
    } catch (error) {
        console.error('Error loading OD import by id:', error);
        return null;
    }
}

// ============ SET ACTIVE IMPORT ============

export async function setActiveODMatrixImport(teamId: string, importId: string): Promise<void> {
    const importSnap = await getDoc(getImportRef(teamId, importId));
    if (!importSnap.exists()) {
        throw new Error(`OD import not found: ${importId}`);
    }

    const target = importSnap.data() as ODMatrixImportRecord;
    const imports = await listODMatrixImports(teamId);

    const batch = writeBatch(db);
    for (const imp of imports) {
        const shouldBeActive = imp.id === importId;
        if (imp.isActive !== shouldBeActive) {
            batch.update(getImportRef(teamId, imp.id), { isActive: shouldBeActive });
        }
    }

    batch.set(getDefaultRef(teamId), {
        activeImportId: importId,
        importedAt: serverTimestamp(),
        importedBy: target.importedBy,
        storagePath: target.storagePath,
        fileName: target.fileName,
        dateRange: target.dateRange || null,
        stationCount: target.stationCount,
        totalJourneys: target.totalJourneys,
    });

    await batch.commit();
}

// ============ RENAME IMPORT ============

export async function renameODMatrixImport(
    teamId: string,
    importId: string,
    newName: string
): Promise<void> {
    const importSnap = await getDoc(getImportRef(teamId, importId));
    if (!importSnap.exists()) return;

    const record = importSnap.data() as ODMatrixImportRecord;
    await updateDoc(getImportRef(teamId, importId), { fileName: newName });

    // Keep the default pointer consistent if this is the active import
    if (record.isActive) {
        await updateDoc(getDefaultRef(teamId), { fileName: newName });
    }
}

// ============ DELETE SINGLE IMPORT ============

/**
 * Deletes one import record + its Storage file.
 * If the deleted import was active, promotes the most-recent remaining import.
 * Returns:
 *   - 'unchanged' if deleted import was not active (no data reload needed)
 *   - importId string if a new import was promoted to active
 *   - null if no imports remain
 */
export async function deleteODMatrixImport(
    teamId: string,
    importId: string
): Promise<string | null | 'unchanged'> {
    const importSnap = await getDoc(getImportRef(teamId, importId));
    if (!importSnap.exists()) return 'unchanged';

    const record = importSnap.data() as ODMatrixImportRecord;
    const defaultSnap = await getDoc(getDefaultRef(teamId));
    const defaultActiveImportId = defaultSnap.exists() ? (defaultSnap.data().activeImportId as string | undefined) : undefined;
    const isCurrentlyActive = record.isActive || defaultActiveImportId === importId;

    // Delete Storage file
    try {
        await deleteObject(ref(storage, record.storagePath));
    } catch {
        // File may already be gone
    }

    // Delete Firestore import record
    await deleteDoc(getImportRef(teamId, importId));

    if (!isCurrentlyActive) return 'unchanged';

    // Was active — find a replacement
    const remaining = await listODMatrixImports(teamId);
    if (remaining.length === 0) {
        await deleteDoc(getDefaultRef(teamId));
        return null;
    }

    const next = remaining[0]; // already sorted desc by importedAt
    await setActiveODMatrixImport(teamId, next.id);

    return next.id;
}

// ============ DELETE ALL ============

export async function deleteODMatrixData(teamId: string): Promise<void> {
    const docSnap = await getDoc(getDefaultRef(teamId));

    if (docSnap.exists()) {
        const storagePath = docSnap.data().storagePath;
        if (storagePath) {
            try {
                await deleteObject(ref(storage, storagePath));
            } catch {
                // File may already be gone
            }
        }

        // Delete import subcollection (Firestore doesn't cascade deletes)
        const imports = await listODMatrixImports(teamId);
        await Promise.all(imports.map(imp => deleteDoc(getImportRef(teamId, imp.id))));

        await deleteDoc(getDefaultRef(teamId));
    }
}

// ============ GEOCODE CACHE ============

export async function saveGeocodeCache(teamId: string, cache: GeocodeCache): Promise<void> {
    await setDoc(getGeocodeCacheRef(teamId), cache);
}

export async function loadGeocodeCache(teamId: string): Promise<GeocodeCache | null> {
    try {
        const docSnap = await getDoc(getGeocodeCacheRef(teamId));
        if (!docSnap.exists()) return null;
        return docSnap.data() as GeocodeCache;
    } catch (error) {
        console.error('Error loading geocode cache:', error);
        return null;
    }
}
