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
import { db } from '../firebase';
import { createStarterShuttleProject } from '../shuttle/shuttleSeedData';
import type { ShuttleProject } from '../shuttle/shuttleTypes';

function timestampToDate(value: unknown): Date {
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    return new Date();
}

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value
            .map((item) => stripUndefinedDeep(item))
            .filter((item) => item !== undefined) as unknown as T;
    }

    if (value && typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return value;
        }

        const output: Record<string, unknown> = {};
        Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
            if (entry === undefined) return;
            output[key] = stripUndefinedDeep(entry);
        });
        return output as T;
    }

    return value;
}

function docToProject(projectId: string, data: Record<string, unknown>): ShuttleProject {
    return {
        id: projectId,
        name: typeof data.name === 'string' ? data.name : 'Untitled Shuttle Project',
        description: typeof data.description === 'string' ? data.description : undefined,
        teamId: typeof data.teamId === 'string' ? data.teamId : null,
        preferredScenarioId: typeof data.preferredScenarioId === 'string' ? data.preferredScenarioId : null,
        scenarios: Array.isArray(data.scenarios) ? data.scenarios as ShuttleProject['scenarios'] : [],
        createdAt: timestampToDate(data.createdAt),
        updatedAt: timestampToDate(data.updatedAt),
    };
}

export async function saveShuttleProject(
    userId: string,
    project: Omit<ShuttleProject, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<string> {
    const projectRef = project.id
        ? doc(db, 'users', userId, 'shuttleProjects', project.id)
        : doc(collection(db, 'users', userId, 'shuttleProjects'));

    const payload = stripUndefinedDeep({
        name: project.name,
        description: project.description ?? null,
        teamId: project.teamId ?? null,
        preferredScenarioId: project.preferredScenarioId ?? null,
        scenarios: project.scenarios,
        updatedAt: serverTimestamp(),
    });

    const docData: Record<string, unknown> = project.id
        ? payload as Record<string, unknown>
        : {
            ...(payload as Record<string, unknown>),
            createdAt: serverTimestamp(),
        };

    await setDoc(projectRef, docData, { merge: true });

    return projectRef.id;
}

export async function getShuttleProject(userId: string, projectId: string): Promise<ShuttleProject | null> {
    const projectRef = doc(db, 'users', userId, 'shuttleProjects', projectId);
    const snapshot = await getDoc(projectRef);

    if (!snapshot.exists()) return null;
    return docToProject(snapshot.id, snapshot.data() as Record<string, unknown>);
}

export async function getAllShuttleProjects(userId: string): Promise<ShuttleProject[]> {
    const projectsRef = collection(db, 'users', userId, 'shuttleProjects');
    const snapshot = await getDocs(query(projectsRef, orderBy('updatedAt', 'desc')));

    return snapshot.docs.map((docSnap) => docToProject(docSnap.id, docSnap.data() as Record<string, unknown>));
}

export async function deleteShuttleProject(userId: string, projectId: string): Promise<void> {
    await deleteDoc(doc(db, 'users', userId, 'shuttleProjects', projectId));
}

export async function duplicateShuttleProject(userId: string, projectId: string, newName?: string): Promise<string> {
    const project = await getShuttleProject(userId, projectId);
    if (!project) throw new Error('Project not found');

    return saveShuttleProject(userId, {
        name: newName || `${project.name} (Copy)`,
        description: project.description,
        teamId: project.teamId ?? null,
        preferredScenarioId: project.preferredScenarioId ?? project.scenarios[0]?.id ?? null,
        scenarios: project.scenarios,
    });
}

export async function createStarterShuttleProjectForUser(userId: string, teamId?: string | null): Promise<string> {
    const starter = createStarterShuttleProject(teamId);
    return saveShuttleProject(userId, starter);
}
