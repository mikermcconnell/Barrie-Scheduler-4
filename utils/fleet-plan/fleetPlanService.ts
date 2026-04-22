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

type FleetPlanErrorCode = 'permission' | 'network' | 'unknown';

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

function createFleetPlanError(message: string, code: FleetPlanErrorCode): Error & { fleetPlanCode: FleetPlanErrorCode } {
    return Object.assign(new Error(message), { fleetPlanCode: code });
}

function normalizeFleetPlanError(error: unknown, action: 'load' | 'save'): Error & { fleetPlanCode: FleetPlanErrorCode } {
    if (typeof error === 'object' && error !== null && 'fleetPlanCode' in error) {
        return error as Error & { fleetPlanCode: FleetPlanErrorCode };
    }

    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
        if (error.code === 'storage/unauthorized' || error.code === 'permission-denied') {
            return createFleetPlanError(
                action === 'save'
                    ? 'Only team owners and admins can update the shared Fleet Plan.'
                    : 'You do not have permission to open this team Fleet Plan. Confirm you still belong to this team.',
                'permission',
            );
        }

        if (error.code === 'storage/retry-limit-exceeded') {
            return createFleetPlanError(
                'Fleet Plan cloud access timed out. Try again once your connection is stable.',
                'network',
            );
        }
    }

    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('network') || message.includes('failed to fetch')) {
            return createFleetPlanError(
                'Fleet Plan cloud access failed because the network changed or dropped. Try again.',
                'network',
            );
        }

        return createFleetPlanError(error.message, 'unknown');
    }

    return createFleetPlanError(
        action === 'save' ? 'Failed to save the shared Fleet Plan.' : 'Failed to load the shared Fleet Plan.',
        'unknown',
    );
}

export function isFleetPlanPermissionError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'fleetPlanCode' in error
        && (error as { fleetPlanCode?: FleetPlanErrorCode }).fleetPlanCode === 'permission';
}

export async function getFleetPlanMetadata(teamId: string): Promise<FleetPlanDocumentMetadata | null> {
    try {
        const snapshot = await getDoc(getFleetPlanRef(teamId));
        if (!snapshot.exists()) return null;
        return snapshot.data() as FleetPlanDocumentMetadata;
    } catch (error) {
        throw normalizeFleetPlanError(error, 'load');
    }
}

export async function getFleetPlanWorkbook(teamId: string): Promise<FleetPlanWorkbook | null> {
    try {
        const snapshot = await getDoc(getFleetPlanRef(teamId));
        if (!snapshot.exists()) return null;

        const data = snapshot.data();
        if (typeof data.storagePath !== 'string' || !data.storagePath.trim()) return null;
        const bytes = await getBytes(ref(storage, data.storagePath));
        return JSON.parse(new TextDecoder().decode(bytes)) as FleetPlanWorkbook;
    } catch (error) {
        throw normalizeFleetPlanError(error, 'load');
    }
}

export async function saveFleetPlanWorkbook(
    teamId: string,
    workbook: FleetPlanWorkbook,
): Promise<void> {
    try {
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
    } catch (error) {
        throw normalizeFleetPlanError(error, 'save');
    }
}
