import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    writeBatch,
} from 'firebase/firestore';

import { db } from '../firebase';
import type { RoutePlanner2Project, RoutePlanner2ProjectStatus, RoutePlanner2Scenario } from './routePlanner2Types';

const PROJECTS_COLLECTION = 'routePlanner2Projects';
const SCENARIOS_COLLECTION = 'scenarios';

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
    const scenarios = scenarioSnapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<RoutePlanner2Scenario, 'id'>),
    })) as RoutePlanner2Scenario[];

    return normalizeLoadedProject(summary, scenarios);
}

export async function saveRoutePlanner2Project(
    teamId: string,
    userId: string,
    project: RoutePlanner2Project,
): Promise<RoutePlanner2Project> {
    const now = new Date().toISOString();
    const savedProject: RoutePlanner2Project = {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-saved',
        createdAt: project.createdAt || now,
        updatedAt: now,
        scenarios: project.scenarios.map((scenario) => ({ ...scenario })),
    };

    const batch = writeBatch(db);
    const rootRef = projectRef(teamId, savedProject.id);
    const existingScenarios = await getDocs(scenariosRef(teamId, savedProject.id));
    const nextScenarioIds = new Set(savedProject.scenarios.map((scenario) => scenario.id));

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
        batch.set(scenarioRef, stripUndefinedDeep({
            ...scenario,
            updatedAt: scenario.updatedAt || now,
        }));
    });

    existingScenarios.docs.forEach((docSnap) => {
        if (!nextScenarioIds.has(docSnap.id)) {
            batch.delete(docSnap.ref);
        }
    });

    await batch.commit();
    return savedProject;
}

export async function deleteRoutePlanner2SavedProject(teamId: string, projectId: string): Promise<void> {
    const batch = writeBatch(db);
    const scenarioSnapshot = await getDocs(scenariosRef(teamId, projectId));

    scenarioSnapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    batch.delete(projectRef(teamId, projectId));

    await batch.commit();
}
