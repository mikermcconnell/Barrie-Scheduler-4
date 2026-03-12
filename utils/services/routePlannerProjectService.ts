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
import type { RouteProject } from '../route-planner/routePlannerTypes';

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

function docToProject(projectId: string, data: Record<string, unknown>): RouteProject {
    return {
        id: projectId,
        name: typeof data.name === 'string' ? data.name : 'Untitled Route Planner Project',
        description: typeof data.description === 'string' ? data.description : undefined,
        teamId: typeof data.teamId === 'string' ? data.teamId : null,
        preferredScenarioId: typeof data.preferredScenarioId === 'string' ? data.preferredScenarioId : null,
        scenarios: Array.isArray(data.scenarios) ? data.scenarios as RouteProject['scenarios'] : [],
        createdAt: timestampToDate(data.createdAt),
        updatedAt: timestampToDate(data.updatedAt),
    };
}

export async function saveRoutePlannerProject(
    userId: string,
    project: Omit<RouteProject, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<string> {
    const projectRef = project.id
        ? doc(db, 'users', userId, 'routePlannerProjects', project.id)
        : doc(collection(db, 'users', userId, 'routePlannerProjects'));

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

export async function getRoutePlannerProject(userId: string, projectId: string): Promise<RouteProject | null> {
    const projectRef = doc(db, 'users', userId, 'routePlannerProjects', projectId);
    const snapshot = await getDoc(projectRef);

    if (!snapshot.exists()) return null;
    return docToProject(snapshot.id, snapshot.data() as Record<string, unknown>);
}

export async function getAllRoutePlannerProjects(userId: string): Promise<RouteProject[]> {
    const projectsRef = collection(db, 'users', userId, 'routePlannerProjects');
    const snapshot = await getDocs(query(projectsRef, orderBy('updatedAt', 'desc')));

    return snapshot.docs.map((docSnap) => docToProject(docSnap.id, docSnap.data() as Record<string, unknown>));
}

export async function deleteRoutePlannerProject(userId: string, projectId: string): Promise<void> {
    await deleteDoc(doc(db, 'users', userId, 'routePlannerProjects', projectId));
}
