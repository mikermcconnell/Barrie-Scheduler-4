import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    writeBatch,
} from 'firebase/firestore';

import { db } from '../firebase';
import type { RoutePlanner2Project, RoutePlanner2ProjectStatus, RoutePlanner2RuntimeSnapshot, RoutePlanner2Scenario } from './routePlanner2Types';
import { prepareRoutePlanner2ProjectRuntimeForSave, ROUTE_PLANNER_RUNTIME_SNAPSHOT_LIMIT } from './routePlanner2RuntimeSnapshots';

const PROJECTS_COLLECTION = 'routePlanner2Projects';
const SCENARIOS_COLLECTION = 'scenarios';
const RUNTIME_SNAPSHOTS_COLLECTION = 'runtimeSnapshots';

export interface RoutePlanner2SavedProjectSummary {
    id: string;
    name: string;
    status: RoutePlanner2ProjectStatus;
    selectedScenarioId: string;
    preferredScenarioId?: string;
    scenarioOrder: string[];
    scenarioCount: number;
    createdAt: string;
    updatedAt: string;
    updatedBy?: string | null;
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

function valueToIso(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) return value;
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
    }
    return fallback;
}

function statusFromValue(value: unknown): RoutePlanner2ProjectStatus {
    return value === 'archived' || value === 'local-draft' || value === 'local-saved'
        ? value
        : 'local-saved';
}

function summaryFromDoc(projectId: string, data: Record<string, unknown>): RoutePlanner2SavedProjectSummary {
    const now = new Date().toISOString();
    const scenarioOrder = Array.isArray(data.scenarioOrder)
        ? data.scenarioOrder.filter((id): id is string => typeof id === 'string')
        : [];

    return {
        id: projectId,
        name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Untitled route plan',
        status: statusFromValue(data.status),
        selectedScenarioId: typeof data.selectedScenarioId === 'string' ? data.selectedScenarioId : scenarioOrder[0] ?? '',
        preferredScenarioId: typeof data.preferredScenarioId === 'string' ? data.preferredScenarioId : undefined,
        scenarioOrder,
        scenarioCount: typeof data.scenarioCount === 'number' ? data.scenarioCount : scenarioOrder.length,
        createdAt: valueToIso(data.createdAt, now),
        updatedAt: valueToIso(data.updatedAt, now),
        updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    };
}

function projectRef(teamId: string, projectId: string) {
    return doc(db, 'teams', teamId, PROJECTS_COLLECTION, projectId);
}

function scenariosRef(teamId: string, projectId: string) {
    return collection(db, 'teams', teamId, PROJECTS_COLLECTION, projectId, SCENARIOS_COLLECTION);
}

function runtimeSnapshotsRef(teamId: string, projectId: string, scenarioId: string) {
    return collection(
        db,
        'teams',
        teamId,
        PROJECTS_COLLECTION,
        projectId,
        SCENARIOS_COLLECTION,
        scenarioId,
        RUNTIME_SNAPSHOTS_COLLECTION,
    );
}

function normalizeLoadedProject(
    summary: RoutePlanner2SavedProjectSummary,
    scenarios: RoutePlanner2Scenario[],
): RoutePlanner2Project {
    const orderedScenarios = summary.scenarioOrder.length > 0
        ? summary.scenarioOrder
            .map((id) => scenarios.find((scenario) => scenario.id === id))
            .filter((scenario): scenario is RoutePlanner2Scenario => Boolean(scenario))
        : scenarios;

    const selectedScenarioId = orderedScenarios.some((scenario) => scenario.id === summary.selectedScenarioId)
        ? summary.selectedScenarioId
        : orderedScenarios[0]?.id ?? '';

    return {
        id: summary.id,
        name: summary.name,
        status: 'local-saved',
        selectedScenarioId,
        preferredScenarioId: summary.preferredScenarioId,
        scenarios: orderedScenarios,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
    };
}

export async function listRoutePlanner2SavedProjects(teamId: string): Promise<RoutePlanner2SavedProjectSummary[]> {
    const projectsRef = collection(db, 'teams', teamId, PROJECTS_COLLECTION);
    const snapshot = await getDocs(query(projectsRef, orderBy('updatedAt', 'desc')));
    return snapshot.docs.map((docSnap) => summaryFromDoc(docSnap.id, docSnap.data() as Record<string, unknown>));
}

export async function loadRoutePlanner2Project(
    teamId: string,
    projectId: string,
): Promise<RoutePlanner2Project | null> {
    const projectSnapshot = await getDoc(projectRef(teamId, projectId));
    if (!projectSnapshot.exists()) return null;

    const summary = summaryFromDoc(projectSnapshot.id, projectSnapshot.data() as Record<string, unknown>);
    const scenarioSnapshot = await getDocs(scenariosRef(teamId, projectId));
    const scenarios = await Promise.all(scenarioSnapshot.docs.map(async (docSnap) => {
        const runtimeSnapshotDocs = await getDocs(query(
            runtimeSnapshotsRef(teamId, projectId, docSnap.id),
            orderBy('decidedAt', 'desc'),
            limit(ROUTE_PLANNER_RUNTIME_SNAPSHOT_LIMIT),
        ));
        return {
            id: docSnap.id,
            ...(docSnap.data() as Omit<RoutePlanner2Scenario, 'id'>),
            runtimeSnapshots: runtimeSnapshotDocs.docs.map((snapshotDoc) => ({
                id: snapshotDoc.id,
                ...(snapshotDoc.data() as Omit<RoutePlanner2RuntimeSnapshot, 'id'>),
            })),
        } as RoutePlanner2Scenario;
    }));

    return normalizeLoadedProject(summary, scenarios);
}

export async function saveRoutePlanner2Project(
    teamId: string,
    userId: string,
    project: RoutePlanner2Project,
): Promise<RoutePlanner2Project> {
    const now = new Date().toISOString();
    const preparedProject = prepareRoutePlanner2ProjectRuntimeForSave(project, userId, now);
    const savedProject: RoutePlanner2Project = {
        ...preparedProject,
        status: project.status === 'archived' ? 'archived' : 'local-saved',
        createdAt: project.createdAt || now,
        updatedAt: now,
        scenarios: preparedProject.scenarios.map((scenario) => ({
            ...scenario,
            runtimeSnapshots: scenario.runtimeSnapshots?.slice(0, ROUTE_PLANNER_RUNTIME_SNAPSHOT_LIMIT),
        })),
    };

    const batch = writeBatch(db);
    const rootRef = projectRef(teamId, savedProject.id);
    const existingScenarios = await getDocs(scenariosRef(teamId, savedProject.id));
    const nextScenarioIds = new Set(savedProject.scenarios.map((scenario) => scenario.id));
    const existingRuntimeSnapshots = new Map<string, Awaited<ReturnType<typeof getDocs>>>();
    await Promise.all(existingScenarios.docs.map(async (scenarioDoc) => {
        existingRuntimeSnapshots.set(
            scenarioDoc.id,
            await getDocs(runtimeSnapshotsRef(teamId, savedProject.id, scenarioDoc.id)),
        );
    }));

    batch.set(rootRef, stripUndefinedDeep({
        id: savedProject.id,
        name: savedProject.name,
        status: savedProject.status,
        selectedScenarioId: savedProject.selectedScenarioId,
        preferredScenarioId: savedProject.preferredScenarioId,
        scenarioOrder: savedProject.scenarios.map((scenario) => scenario.id),
        scenarioCount: savedProject.scenarios.length,
        createdAt: savedProject.createdAt,
        updatedAt: savedProject.updatedAt,
        updatedBy: userId,
        savedAt: serverTimestamp(),
    }), { merge: true });

    savedProject.scenarios.forEach((scenario) => {
        const scenarioRef = doc(db, 'teams', teamId, PROJECTS_COLLECTION, savedProject.id, SCENARIOS_COLLECTION, scenario.id);
        const { runtimeSnapshots = [], ...scenarioData } = scenario;
        const snapshotsToSave = runtimeSnapshots.slice(0, ROUTE_PLANNER_RUNTIME_SNAPSHOT_LIMIT);
        batch.set(scenarioRef, stripUndefinedDeep({
            ...scenarioData,
            updatedAt: scenario.updatedAt || now,
        }));
        const nextSnapshotIds = new Set(snapshotsToSave.map((snapshot) => snapshot.id));
        snapshotsToSave.forEach((snapshot) => {
            batch.set(
                doc(runtimeSnapshotsRef(teamId, savedProject.id, scenario.id), snapshot.id),
                stripUndefinedDeep(snapshot),
            );
        });
        existingRuntimeSnapshots.get(scenario.id)?.docs.forEach((snapshotDoc) => {
            if (!nextSnapshotIds.has(snapshotDoc.id)) batch.delete(snapshotDoc.ref);
        });
    });

    existingScenarios.docs.forEach((docSnap) => {
        if (!nextScenarioIds.has(docSnap.id)) {
            existingRuntimeSnapshots.get(docSnap.id)?.docs.forEach((snapshotDoc) => batch.delete(snapshotDoc.ref));
            batch.delete(docSnap.ref);
        }
    });

    await batch.commit();
    return savedProject;
}

export async function deleteRoutePlanner2SavedProject(teamId: string, projectId: string): Promise<void> {
    const batch = writeBatch(db);
    const scenarioSnapshot = await getDocs(scenariosRef(teamId, projectId));

    const runtimeSnapshotDocs = await Promise.all(scenarioSnapshot.docs.map((scenarioDoc) =>
        getDocs(runtimeSnapshotsRef(teamId, projectId, scenarioDoc.id)),
    ));

    runtimeSnapshotDocs.forEach((snapshot) => snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref)));
    scenarioSnapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    batch.delete(projectRef(teamId, projectId));

    await batch.commit();
}
