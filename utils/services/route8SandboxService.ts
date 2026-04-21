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
    Timestamp,
} from 'firebase/firestore';
import {
    deleteObject,
    getBytes,
    ref,
    uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import type {
    Route8SandboxContent,
    Route8SandboxProject,
    Route8SandboxProjectInput,
    Route8SandboxProjectMetadata,
} from '../route8-sandbox/types';

const ROUTE8_SANDBOX_COLLECTION = 'route8SandboxProjects';

function route8SandboxStoragePath(userId: string, projectId: string, timestamp: number): string {
    return `users/${userId}/${ROUTE8_SANDBOX_COLLECTION}/${projectId}_${timestamp}.json`;
}

function timestampToDate(value?: Timestamp | Date): Date {
    if (!value) return new Date();
    return value instanceof Date ? value : value.toDate();
}

function isStorageObjectMissing(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: string }).code === 'storage/object-not-found';
}

export async function saveRoute8SandboxProject(
    userId: string,
    project: Route8SandboxProjectInput & { content: Route8SandboxContent }
): Promise<{ id: string; storagePath: string }> {
    const projectsRef = collection(db, 'users', userId, ROUTE8_SANDBOX_COLLECTION);
    const projectRef = project.id ? doc(projectsRef, project.id) : doc(projectsRef);
    const projectId = projectRef.id;

    let previousStoragePath = project.storagePath;
    if (project.id) {
        const existingSnapshot = await getDoc(projectRef);
        if (existingSnapshot.exists()) {
            previousStoragePath = existingSnapshot.data().storagePath;
        }
    }

    const timestamp = Date.now();
    const storagePath = route8SandboxStoragePath(userId, projectId, timestamp);
    const storageRef = ref(storage, storagePath);
    await uploadBytes(
        storageRef,
        new TextEncoder().encode(JSON.stringify(project.content)),
        { contentType: 'application/json' }
    );

    const docData: Record<string, unknown> = {
        name: project.name,
        dayType: project.dayType,
        teamId: project.teamId ?? null,
        status: project.status ?? 'draft',
        createdBy: project.createdBy,
        storagePath,
        updatedAt: serverTimestamp(),
    };

    if (!project.id) {
        docData.createdAt = serverTimestamp();
    }

    try {
        await setDoc(projectRef, docData, { merge: true });
    } catch (error) {
        try {
            await deleteObject(storageRef);
        } catch (cleanupError) {
            if (!isStorageObjectMissing(cleanupError)) {
                console.warn('Failed to clean up Route 8 sandbox storage after Firestore write failure:', cleanupError);
            }
        }
        throw error;
    }

    if (project.id && previousStoragePath && previousStoragePath !== storagePath) {
        try {
            await deleteObject(ref(storage, previousStoragePath));
        } catch (error) {
            if (!isStorageObjectMissing(error)) {
                console.warn('Failed to delete previous Route 8 sandbox storage object:', error);
            }
        }
    }

    return { id: projectId, storagePath };
}

export async function getRoute8SandboxProject(
    userId: string,
    projectId: string
): Promise<Route8SandboxProject | null> {
    const projectRef = doc(db, 'users', userId, ROUTE8_SANDBOX_COLLECTION, projectId);
    const snapshot = await getDoc(projectRef);
    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    let content: Route8SandboxContent | undefined;

    if (typeof data.storagePath === 'string' && data.storagePath.trim()) {
        const storageRef = ref(storage, data.storagePath);
        const bytes = await getBytes(storageRef);
        content = JSON.parse(new TextDecoder().decode(bytes)) as Route8SandboxContent;
    }

    return {
        id: snapshot.id,
        name: data.name,
        dayType: data.dayType,
        teamId: typeof data.teamId === 'string' ? data.teamId : data.teamId ?? null,
        status: data.status ?? 'draft',
        createdBy: data.createdBy,
        storagePath: data.storagePath,
        content,
        createdAt: timestampToDate(data.createdAt),
        updatedAt: timestampToDate(data.updatedAt),
    };
}

export async function getAllRoute8SandboxProjects(userId: string): Promise<Route8SandboxProjectMetadata[]> {
    const projectsRef = collection(db, 'users', userId, ROUTE8_SANDBOX_COLLECTION);
    const snapshot = await getDocs(query(projectsRef, orderBy('updatedAt', 'desc')));

    return snapshot.docs.map((projectSnap) => {
        const data = projectSnap.data();
        return {
            id: projectSnap.id,
            name: data.name,
            dayType: data.dayType,
            teamId: typeof data.teamId === 'string' ? data.teamId : data.teamId ?? null,
            status: data.status ?? 'draft',
            createdBy: data.createdBy,
            createdAt: timestampToDate(data.createdAt),
            updatedAt: timestampToDate(data.updatedAt),
        };
    });
}

export async function deleteRoute8SandboxProject(userId: string, projectId: string): Promise<void> {
    const projectRef = doc(db, 'users', userId, ROUTE8_SANDBOX_COLLECTION, projectId);
    const snapshot = await getDoc(projectRef);

    if (snapshot.exists()) {
        const data = snapshot.data();
        if (typeof data.storagePath === 'string' && data.storagePath.trim()) {
            try {
                await deleteObject(ref(storage, data.storagePath));
            } catch (error) {
                if (!isStorageObjectMissing(error)) {
                    console.warn('Failed to delete Route 8 sandbox storage object:', error);
                }
            }
        }
    }

    await deleteDoc(projectRef);
}
