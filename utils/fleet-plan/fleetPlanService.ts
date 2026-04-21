import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
} from 'firebase/firestore';
import {
    deleteObject,
    getBytes,
    ref,
    uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import { summarizeFleetPlan } from './fleetPlanModel';
import type { FleetPlanDocumentMetadata, FleetPlanWorkbook } from './types';

function getFleetPlanRef(teamId: string) {
    return doc(db, 'teams', teamId, 'fleetPlan', 'default');
}

function getFleetPlanStoragePath(teamId: string, timestamp: number): string {
    return `teams/${teamId}/fleetPlan/${timestamp}.json`;
}

function isStorageObjectMissing(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: string }).code === 'storage/object-not-found';
}

export async function getFleetPlanMetadata(teamId: string): Promise<FleetPlanDocumentMetadata | null> {
    const snapshot = await getDoc(getFleetPlanRef(teamId));
    if (!snapshot.exists()) return null;
    return snapshot.data() as FleetPlanDocumentMetadata;
}

export async function getFleetPlanWorkbook(teamId: string): Promise<FleetPlanWorkbook | null> {
    const snapshot = await getDoc(getFleetPlanRef(teamId));
    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    if (typeof data.storagePath !== 'string' || !data.storagePath.trim()) return null;
    const bytes = await getBytes(ref(storage, data.storagePath));
    return JSON.parse(new TextDecoder().decode(bytes)) as FleetPlanWorkbook;
}

export async function saveFleetPlanWorkbook(
    teamId: string,
    workbook: FleetPlanWorkbook,
): Promise<void> {
    const entryRef = getFleetPlanRef(teamId);
    const existing = await getDoc(entryRef);
    const previousStoragePath = existing.exists() && typeof existing.data().storagePath === 'string'
        ? existing.data().storagePath as string
        : null;

    const timestamp = Date.now();
    const storagePath = getFleetPlanStoragePath(teamId, timestamp);
    const storageRef = ref(storage, storagePath);
    const payload = JSON.stringify(workbook);

    await uploadBytes(storageRef, new TextEncoder().encode(payload), {
        contentType: 'application/json',
    });

    const summary = summarizeFleetPlan(workbook);
    const docData: FleetPlanDocumentMetadata & { updatedAtServer?: unknown } = {
        ...summary,
        templateVersion: workbook.metadata.templateVersion,
        sourceFileName: workbook.metadata.sourceFileName,
        importedAt: workbook.metadata.importedAt,
        importedBy: workbook.metadata.importedBy,
        updatedAt: workbook.metadata.updatedAt,
        updatedBy: workbook.metadata.updatedBy,
        storagePath,
        updatedAtServer: serverTimestamp(),
    };

    try {
        await setDoc(entryRef, docData, { merge: true });
    } catch (error) {
        try {
            await deleteObject(storageRef);
        } catch (cleanupError) {
            if (!isStorageObjectMissing(cleanupError)) {
                console.warn('Failed to clean up Fleet Plan storage after Firestore write failure:', cleanupError);
            }
        }
        throw error;
    }

    if (previousStoragePath && previousStoragePath !== storagePath) {
        try {
            await deleteObject(ref(storage, previousStoragePath));
        } catch (error) {
            if (!isStorageObjectMissing(error)) {
                console.warn('Failed to delete previous Fleet Plan storage object:', error);
            }
        }
    }
}
