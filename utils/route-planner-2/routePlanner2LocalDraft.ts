import type { RoutePlanner2Project } from './routePlanner2Types';

const DATABASE_NAME = 'scheduler4-route-planner-2';
const DATABASE_VERSION = 1;
const DRAFT_STORE = 'drafts';
const RECORD_VERSION = 1;
export const ROUTE_PLANNER_LOCAL_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface RoutePlanner2LocalDraftScope {
    teamId: string;
    userId: string;
}

export interface RoutePlanner2LocalDraft {
    project: RoutePlanner2Project;
    savedAt: number;
}

interface StoredRoutePlanner2LocalDraft extends RoutePlanner2LocalDraft {
    key: string;
    version: number;
}

function getIndexedDb(factory?: IDBFactory): IDBFactory | null {
    if (factory) return factory;
    return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function getDraftKey(scope: RoutePlanner2LocalDraftScope): string {
    return `${scope.teamId}:${scope.userId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
    });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was aborted.'));
        transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
    });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(DRAFT_STORE)) {
                request.result.createObjectStore(DRAFT_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
        request.onblocked = () => reject(new Error('Browser storage is blocked by another open app window.'));
    });
}

async function withDraftStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
    factory?: IDBFactory,
): Promise<T | null> {
    const indexedDb = getIndexedDb(factory);
    if (!indexedDb) return null;

    const database = await openDatabase(indexedDb);
    try {
        const transaction = database.transaction(DRAFT_STORE, mode);
        const request = operation(transaction.objectStore(DRAFT_STORE));
        const [result] = await Promise.all([
            requestResult(request),
            transactionComplete(transaction),
        ]);
        return result;
    } finally {
        database.close();
    }
}

function isRoutePlanner2Project(value: unknown): value is RoutePlanner2Project {
    if (!value || typeof value !== 'object') return false;
    const project = value as Partial<RoutePlanner2Project>;
    return typeof project.id === 'string'
        && typeof project.name === 'string'
        && typeof project.selectedScenarioId === 'string'
        && typeof project.createdAt === 'string'
        && typeof project.updatedAt === 'string'
        && Array.isArray(project.scenarios)
        && project.scenarios.length > 0
        && project.scenarios.every((scenario) => Boolean(
            scenario
            && typeof scenario.id === 'string'
            && typeof scenario.name === 'string'
            && typeof scenario.notes === 'string'
            && Array.isArray(scenario.alignment)
            && Array.isArray(scenario.stops)
            && scenario.service
            && typeof scenario.service === 'object',
        ));
}

export async function saveRoutePlanner2LocalDraft(
    scope: RoutePlanner2LocalDraftScope,
    project: RoutePlanner2Project,
    factory?: IDBFactory,
): Promise<boolean> {
    const record: StoredRoutePlanner2LocalDraft = {
        key: getDraftKey(scope),
        version: RECORD_VERSION,
        project,
        savedAt: Date.now(),
    };
    const result = await withDraftStore('readwrite', (store) => store.put(record), factory);
    return result !== null;
}

export async function loadRoutePlanner2LocalDraft(
    scope: RoutePlanner2LocalDraftScope,
    factory?: IDBFactory,
): Promise<RoutePlanner2LocalDraft | null> {
    const record = await withDraftStore<StoredRoutePlanner2LocalDraft | undefined>(
        'readonly',
        (store) => store.get(getDraftKey(scope)),
        factory,
    );
    if (!record || record.version !== RECORD_VERSION || !isRoutePlanner2Project(record.project)) return null;
    if (!Number.isFinite(record.savedAt) || Date.now() - record.savedAt > ROUTE_PLANNER_LOCAL_DRAFT_MAX_AGE_MS) {
        await removeRoutePlanner2LocalDraft(scope, factory);
        return null;
    }
    return { project: record.project, savedAt: record.savedAt };
}

export async function removeRoutePlanner2LocalDraft(
    scope: RoutePlanner2LocalDraftScope,
    factory?: IDBFactory,
): Promise<boolean> {
    const result = await withDraftStore(
        'readwrite',
        (store) => store.delete(getDraftKey(scope)),
        factory,
    );
    return result !== null;
}
