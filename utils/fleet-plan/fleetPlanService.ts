import {
    doc,
    getDoc,
    runTransaction,
    serverTimestamp,
} from 'firebase/firestore';
import {
    getBytes,
    deleteObject,
    ref,
    uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import { cloneFleetPlanWorkbook, summarizeFleetPlan } from './fleetPlanModel';
import type { FleetPlanDocumentMetadata, FleetPlanWorkbook } from './types';

type FleetPlanErrorCode = 'permission' | 'network' | 'conflict' | 'unknown';

function getFleetPlanRef(teamId: string) {
    return doc(db, 'teams', teamId, 'fleetPlan', 'default');
}

function getFleetPlanVersionRef(teamId: string, versionNumber: number) {
    return doc(db, 'teams', teamId, 'fleetPlan', 'default', 'versions', String(versionNumber));
}

function getFleetPlanStoragePath(teamId: string, versionNumber: number, timestamp: number): string {
    return `teams/${teamId}/fleetPlan/v${versionNumber}_${timestamp}.json`;
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

function getCurrentVersion(data: unknown): number {
    if (typeof data !== 'object' || data === null) return 0;
    const value = (data as { currentVersion?: unknown }).currentVersion;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function attachDocumentMetadata(
    workbook: FleetPlanWorkbook,
    docData: Partial<FleetPlanDocumentMetadata>,
): FleetPlanWorkbook {
    return {
        ...workbook,
        metadata: {
            ...workbook.metadata,
            currentVersion: getCurrentVersion(docData),
            storagePath: typeof docData.storagePath === 'string' ? docData.storagePath : workbook.metadata.storagePath,
        },
    };
}

function normalizeFleetPlanError(error: unknown, action: 'load' | 'save'): Error & { fleetPlanCode: FleetPlanErrorCode } {
    if (typeof error === 'object' && error !== null && 'fleetPlanCode' in error) {
        return error as Error & { fleetPlanCode: FleetPlanErrorCode };
    }

    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
        if (error.code === 'storage/unauthorized' || error.code === 'permission-denied') {
            return createFleetPlanError(
                action === 'save'
                    ? 'You do not have permission to update the shared Fleet Plan. Confirm you still belong to this team.'
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
        const workbook = JSON.parse(new TextDecoder().decode(bytes)) as FleetPlanWorkbook;
        return attachDocumentMetadata(workbook, data as Partial<FleetPlanDocumentMetadata>);
    } catch (error) {
        throw normalizeFleetPlanError(error, 'load');
    }
}

export async function saveFleetPlanWorkbook(
    teamId: string,
    workbook: FleetPlanWorkbook,
): Promise<FleetPlanWorkbook> {
    let storageRef: ReturnType<typeof ref> | null = null;
    try {
        const entryRef = getFleetPlanRef(teamId);
        const existing = await getDoc(entryRef);
        const currentVersion = existing.exists() ? getCurrentVersion(existing.data()) : 0;
        const expectedVersion = workbook.metadata.currentVersion;

        if (existing.exists()
            && typeof expectedVersion === 'number'
            && Number.isFinite(expectedVersion)
            && expectedVersion !== currentVersion) {
            throw createFleetPlanError(
                'Fleet Plan was updated by someone else. Reload the plan before saving your changes.',
                'conflict',
            );
        }

        const timestamp = Date.now();
        const nextVersion = currentVersion + 1;
        const storagePath = getFleetPlanStoragePath(teamId, nextVersion, timestamp);
        storageRef = ref(storage, storagePath);
        const savedWorkbook: FleetPlanWorkbook = {
            ...cloneFleetPlanWorkbook(workbook),
            metadata: {
                ...workbook.metadata,
                currentVersion: nextVersion,
                storagePath,
            },
        };
        const payload = JSON.stringify(savedWorkbook);

        await uploadBytes(storageRef, new TextEncoder().encode(payload), {
            contentType: 'application/json',
        });

        const summary = summarizeFleetPlan(savedWorkbook);
        const docData: FleetPlanDocumentMetadata & { updatedAtServer?: unknown } = {
            ...summary,
            currentVersion: nextVersion,
            templateVersion: savedWorkbook.metadata.templateVersion,
            sourceFileName: savedWorkbook.metadata.sourceFileName,
            importedAt: savedWorkbook.metadata.importedAt,
            importedBy: savedWorkbook.metadata.importedBy,
            updatedAt: savedWorkbook.metadata.updatedAt,
            updatedBy: savedWorkbook.metadata.updatedBy,
            storagePath,
            updatedAtServer: serverTimestamp(),
        };

        try {
            await runTransaction(db, async (transaction) => {
                const freshSnapshot = await transaction.get(entryRef);
                const freshVersion = freshSnapshot.exists() ? getCurrentVersion(freshSnapshot.data()) : 0;

                if (freshVersion !== currentVersion) {
                    throw createFleetPlanError(
                        'Fleet Plan was updated by someone else. Reload the plan before saving your changes.',
                        'conflict',
                    );
                }

                transaction.set(getFleetPlanVersionRef(teamId, nextVersion), {
                    ...docData,
                    versionNumber: nextVersion,
                    createdAt: serverTimestamp(),
                    createdBy: savedWorkbook.metadata.updatedBy,
                });
                transaction.set(entryRef, docData, { merge: true });
            });
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

        return savedWorkbook;
    } catch (error) {
        if (storageRef && typeof error === 'object' && error !== null && 'fleetPlanCode' in error) {
            // A known error after upload is already cleaned up by the transaction catch above.
        }
        throw normalizeFleetPlanError(error, 'save');
    }
}
