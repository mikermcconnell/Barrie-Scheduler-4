import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadString } from 'firebase/storage';
import { db, storage } from '../firebase';
import type {
    ResidentialGrowthGeocodeCache,
    ResidentialGrowthImportRecord,
    ResidentialGrowthMonthlyDataset,
    ResidentialGrowthSummary,
} from './types';
import { summarizeResidentialGrowth } from './parser';

function getDefaultRef(teamId: string) {
    return doc(db, 'teams', teamId, 'residentialGrowth', 'default');
}

function getImportRef(teamId: string, importId: string) {
    return doc(db, 'teams', teamId, 'residentialGrowth', 'default', 'imports', importId);
}

function getImportsCollectionRef(teamId: string) {
    return collection(db, 'teams', teamId, 'residentialGrowth', 'default', 'imports');
}

function getGeocodeCacheRef(teamId: string) {
    return doc(db, 'teams', teamId, 'residentialGrowth', 'geocodeCache');
}

function getStoragePath(teamId: string, importId: string) {
    return `teams/${teamId}/residentialGrowth/${importId}.json`;
}

function buildImportRecord(importId: string, dataset: ResidentialGrowthMonthlyDataset, storagePath: string, summary: ResidentialGrowthSummary): ResidentialGrowthImportRecord {
    return {
        id: importId,
        period: dataset.period,
        importedAt: new Date().toISOString(),
        importedBy: dataset.metadata.importedBy,
        issuedFileName: dataset.metadata.issuedFileName ?? null,
        occupiedFileName: dataset.metadata.occupiedFileName ?? null,
        issuedCount: summary.issuedRecords,
        issuedUnits: summary.issuedUnits,
        occupiedCount: summary.occupiedRecords,
        occupiedUnits: summary.occupiedUnits,
        storagePath,
        isActive: true,
    };
}

export async function saveResidentialGrowthDataset(
    teamId: string,
    userId: string,
    dataset: ResidentialGrowthMonthlyDataset,
): Promise<string> {
    const importId = `${dataset.period}-${Date.now()}`;
    const storagePath = getStoragePath(teamId, importId);
    const summary = summarizeResidentialGrowth(dataset.issued, dataset.occupied);
    const datasetForStorage: ResidentialGrowthMonthlyDataset = {
        ...dataset,
        metadata: {
            ...dataset.metadata,
            importedBy: userId,
            importedAt: new Date().toISOString(),
        },
    };

    await uploadString(ref(storage, storagePath), JSON.stringify(datasetForStorage), 'raw', {
        contentType: 'application/json',
    });

    const importRecord = buildImportRecord(importId, datasetForStorage, storagePath, summary);
    await setDoc(getImportRef(teamId, importId), importRecord);
    await setDoc(getDefaultRef(teamId), {
        activeImportId: importId,
        importedAt: serverTimestamp(),
        importedBy: userId,
        period: dataset.period,
        storagePath,
        issuedFileName: dataset.metadata.issuedFileName || null,
        occupiedFileName: dataset.metadata.occupiedFileName || null,
        ...summary,
    });
    const imports = await listResidentialGrowthImports(teamId);
    await Promise.all(imports.filter((entry) => entry.isActive && entry.id !== importId).map((entry) => updateDoc(getImportRef(teamId, entry.id), { isActive: false })));

    return importId;
}

export async function getResidentialGrowthDataset(teamId: string): Promise<ResidentialGrowthMonthlyDataset | null> {
    const docSnap = await getDoc(getDefaultRef(teamId));
    if (!docSnap.exists()) return null;
    const storagePath = docSnap.data().storagePath as string | undefined;
    if (!storagePath) return null;
    return getResidentialGrowthDatasetFromStorage(storagePath);
}

async function getResidentialGrowthDatasetFromStorage(storagePath: string): Promise<ResidentialGrowthMonthlyDataset | null> {
    const url = await getDownloadURL(ref(storage, storagePath));
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json() as ResidentialGrowthMonthlyDataset;
}

export async function getResidentialGrowthDatasets(teamId: string): Promise<ResidentialGrowthMonthlyDataset[]> {
    const imports = await listResidentialGrowthImports(teamId);
    const datasets = await Promise.all(imports.map(async (entry) => {
        try {
            return await getResidentialGrowthDatasetFromStorage(entry.storagePath);
        } catch {
            /* Skip missing or unreadable archived payloads; the active dataset can still load. */
            return null;
        }
    }));
    return datasets.filter((dataset): dataset is ResidentialGrowthMonthlyDataset => !!dataset);
}

export async function getResidentialGrowthMetadata(teamId: string): Promise<(ResidentialGrowthSummary & { period?: string }) | null> {
    const docSnap = await getDoc(getDefaultRef(teamId));
    if (!docSnap.exists()) return null;
    const data = docSnap.data();
    return {
        period: typeof data.period === 'string' ? data.period : undefined,
        issuedRecords: Number(data.issuedRecords || 0),
        issuedUnits: Number(data.issuedUnits || 0),
        occupiedRecords: Number(data.occupiedRecords || 0),
        occupiedUnits: Number(data.occupiedUnits || 0),
        issuedGeocoded: Number(data.issuedGeocoded || 0),
        occupiedGeocoded: Number(data.occupiedGeocoded || 0),
        reviewCount: Number(data.reviewCount || 0),
    };
}

export async function listResidentialGrowthImports(teamId: string): Promise<ResidentialGrowthImportRecord[]> {
    const q = query(getImportsCollectionRef(teamId), orderBy('importedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as ResidentialGrowthImportRecord));
}

export async function setActiveResidentialGrowthImport(teamId: string, importId: string): Promise<void> {
    const importSnap = await getDoc(getImportRef(teamId, importId));
    if (!importSnap.exists()) throw new Error(`Residential Growth import not found: ${importId}`);
    const target = importSnap.data() as ResidentialGrowthImportRecord;
    const imports = await listResidentialGrowthImports(teamId);
    const batch = writeBatch(db);
    imports.forEach((entry) => batch.update(getImportRef(teamId, entry.id), { isActive: entry.id === importId }));
    batch.set(getDefaultRef(teamId), {
        activeImportId: importId,
        importedAt: serverTimestamp(),
        importedBy: target.importedBy,
        period: target.period,
        storagePath: target.storagePath,
        issuedFileName: target.issuedFileName || null,
        occupiedFileName: target.occupiedFileName || null,
        issuedRecords: target.issuedCount,
        issuedUnits: target.issuedUnits,
        occupiedRecords: target.occupiedCount,
        occupiedUnits: target.occupiedUnits,
    }, { merge: true });
    await batch.commit();
}

export async function deleteResidentialGrowthImport(teamId: string, importId: string): Promise<void> {
    const importSnap = await getDoc(getImportRef(teamId, importId));
    if (!importSnap.exists()) return;
    const record = importSnap.data() as ResidentialGrowthImportRecord;
    try { await deleteObject(ref(storage, record.storagePath)); } catch { /* non-fatal */ }
    await deleteDoc(getImportRef(teamId, importId));
}

export async function saveResidentialGrowthGeocodeCache(teamId: string, cache: ResidentialGrowthGeocodeCache): Promise<void> {
    await setDoc(getGeocodeCacheRef(teamId), cache);
}

export async function loadResidentialGrowthGeocodeCache(teamId: string): Promise<ResidentialGrowthGeocodeCache | null> {
    const docSnap = await getDoc(getGeocodeCacheRef(teamId));
    return docSnap.exists() ? docSnap.data() as ResidentialGrowthGeocodeCache : null;
}
