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

    // Upload full summary JSON to Storage
    const storageRef = ref(storage, storagePath);
    const jsonStr = JSON.stringify(summary);
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
            .map(imp => setDoc(getImportRef(teamId, imp.id), { ...imp, isActive: false }))
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
        return [];
    }
}

// ============ DELETE ============

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
