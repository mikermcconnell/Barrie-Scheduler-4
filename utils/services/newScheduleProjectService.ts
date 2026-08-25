/**
 * New Schedule Project Service
 * 
 * Separate data service for New Schedule workspace projects.
 * Uses a distinct Firestore collection to keep projects separate from
 * Schedule Tweaker drafts.
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    orderBy,
    runTransaction,
    deleteField,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getBytes,
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { db, storage } from '../firebase';
import type { MasterRouteTable } from '../parsers/masterScheduleParser';
import type { RuntimeData } from '../../components/NewSchedule/utils/csvParser';
import type { TripBucketAnalysis, TimeBand } from '../ai/runtimeAnalysis';
import type { ScheduleConfig } from '../../components/NewSchedule/steps/Step3Build';
import type { ApprovedRuntimeModel } from '../../components/NewSchedule/utils/wizardState';
import type { ApprovedRuntimeContract } from '../../components/NewSchedule/utils/step2ReviewTypes';
import {
    RUNTIME_TRUST_SCHEMA_VERSION,
    isStructurallyValidRuntimeTrustContract,
    sanitizeLegacyRuntimeStorageContent,
} from '../../components/NewSchedule/utils/runtimeTrustPersistence';

export {
    RUNTIME_TRUST_SCHEMA_VERSION,
    isStructurallyValidRuntimeTrustContract,
    sanitizeLegacyRuntimeStorageContent,
} from '../../components/NewSchedule/utils/runtimeTrustPersistence';

export class StaleNewScheduleProjectError extends Error {
    constructor() {
        super('This New Schedule project changed in another save. Reload it before saving again.');
        this.name = 'StaleNewScheduleProjectError';
    }
}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => (
    left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index])
);

const getStoredRevision = (data: Record<string, unknown> | undefined): number => (
    typeof data?.projectRevision === 'number' && Number.isSafeInteger(data.projectRevision)
        ? data.projectRevision
        : 0
);

const assertOwnedStoragePath = (userId: string, path: unknown): string | undefined => {
    if (typeof path !== 'string' || path.length === 0) return undefined;
    if (!path.startsWith(`users/${userId}/newScheduleProjects/`)) {
        throw new Error('The project points to an unsafe Storage location.');
    }
    return path;
};

const createStoragePath = (userId: string, projectId: string, suffix = ''): string => {
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `users/${userId}/newScheduleProjects/${projectId}_${nonce}${suffix}.json`;
};

const uploadAndVerifyJson = async (
    storagePath: string,
    content: Record<string, unknown>
): Promise<void> => {
    const bytes = new TextEncoder().encode(JSON.stringify(content));
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, bytes, { contentType: 'application/json' });
    const verified = new Uint8Array(await getBytes(storageRef));
    if (!bytesEqual(bytes, verified)) {
        throw new Error('The uploaded New Schedule project could not be verified.');
    }
};

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value
            .map(item => stripUndefinedDeep(item))
            .filter(item => item !== undefined) as unknown as T;
    }

    if (value && typeof value === 'object') {
        const input = value as Record<string, unknown>;
        const output: Record<string, unknown> = {};

        Object.entries(input).forEach(([key, val]) => {
            if (val === undefined) return;
            const cleaned = stripUndefinedDeep(val);
            if (cleaned !== undefined) {
                output[key] = cleaned;
            }
        });

        return output as T;
    }

    return value;
}

// ============ TYPES ============

export interface NewScheduleProject {
    id: string;
    name: string;
    // Wizard state
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    importMode?: 'csv' | 'gtfs' | 'performance';
    autofillFromMaster?: boolean;
    performanceConfig?: {
        routeId: string;
        dateRange: { start: string; end: string } | null;
    };
    routeNumber?: string;
    wizardStep?: 1 | 2 | 3 | 4 | 5;
    analysis?: TripBucketAnalysis[];
    bands?: TimeBand[];
    approvedRuntimeContract?: ApprovedRuntimeContract;
    approvedRuntimeModel?: ApprovedRuntimeModel;
    config?: ScheduleConfig;
    // Generated schedule (if completed)
    generatedSchedules?: MasterRouteTable[];
    // Original Step 4 baseline for reset/delta stability
    originalGeneratedSchedules?: MasterRouteTable[];
    /** Exact approved-runtime/config input fingerprint that produced the schedules. */
    generatedScheduleInputFingerprint?: string;
    // Raw Data (Required for re-generation) - Stored in Cloud Storage only, not Firestore
    parsedData?: RuntimeData[];

    isGenerated: boolean;
    // Metadata
    storagePath?: string;
    projectRevision?: number;
    runtimeTrustSchemaVersion?: number;
    runtimeTrustMigrationVersion?: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface SaveNewScheduleProjectOptions {
    /** Supply the revision returned by getProject to reject an already-stale editor save. */
    expectedRevision?: number;
}

// ============ CRUD OPERATIONS ============

/**
 * Save a new schedule project
 */
export const saveProject = async (
    userId: string,
    project: Omit<NewScheduleProject, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    options: SaveNewScheduleProjectOptions = {}
): Promise<string> => {
    const projectsRef = collection(db, 'users', userId, 'newScheduleProjects');

    const isUpdate = !!project.id;
    const docRef = project.id ? doc(projectsRef, project.id) : doc(projectsRef);
    const projectId = docRef.id;
    const existingSnapshot = await getDoc(docRef);
    const existedAtStart = existingSnapshot.exists();
    const existingData = existedAtStart
        ? existingSnapshot.data() as Record<string, unknown>
        : undefined;
    const previousStoragePath = assertOwnedStoragePath(userId, existingData?.storagePath);
    const previousRevision = getStoredRevision(existingData);
    if (options.expectedRevision !== undefined && options.expectedRevision !== previousRevision) {
        throw new StaleNewScheduleProjectError();
    }

    const sanitizedConfig = project.config
        ? stripUndefinedDeep(project.config as ScheduleConfig)
        : undefined;

    // 1. Check if we have large data to store in Storage (Generated Schedules OR Raw Data OR Analysis)
    // We should save to storage if we have ANY of these heavy items.
    let storagePath: string | undefined;
    const validV2Contract = project.approvedRuntimeContract
        ? isStructurallyValidRuntimeTrustContract(project.approvedRuntimeContract)
        : false;
    if (project.approvedRuntimeContract && !validV2Contract) {
        throw new Error('The approved runtime contract is not a valid schema-v2 contract.');
    }
    const hasHeavyData = (project.generatedSchedules && project.generatedSchedules.length > 0) ||
        (project.originalGeneratedSchedules && project.originalGeneratedSchedules.length > 0) ||
        (project.parsedData && project.parsedData.length > 0) ||
        (project.analysis && project.analysis.length > 0) ||
        !!project.approvedRuntimeContract;

    if (hasHeavyData) {
        const content: Record<string, unknown> = stripUndefinedDeep({
            generatedSchedules: project.generatedSchedules,
            originalGeneratedSchedules: project.originalGeneratedSchedules,
            generatedScheduleInputFingerprint: project.generatedScheduleInputFingerprint,
            parsedData: project.parsedData, // Save raw data!
            analysis: project.analysis,
            bands: project.bands,
            approvedRuntimeContract: project.approvedRuntimeContract,
            config: sanitizedConfig,
            ...(validV2Contract ? { runtimeTrustSchemaVersion: RUNTIME_TRUST_SCHEMA_VERSION } : {}),
        });

        storagePath = createStoragePath(userId, projectId);
        try {
            await uploadAndVerifyJson(storagePath, content);
        } catch (error) {
            try {
                await deleteObject(ref(storage, storagePath));
            } catch {
                // Best-effort cleanup of an upload that was never committed.
            }
            throw error;
        }
    }

    // 2. Save metadata to Firestore
    const docData: Record<string, unknown> = {
        name: project.name || 'Untitled Project',
        dayType: project.dayType,
        importMode: project.importMode || 'csv',
        autofillFromMaster: project.autofillFromMaster ?? true,
        performanceConfig: project.performanceConfig || null,
        routeNumber: project.routeNumber || null,
        wizardStep: project.wizardStep ?? (project.isGenerated ? 4 : 1),
        isGenerated: project.isGenerated || false,
        // Don't store large data in Firestore
        analysis: [],
        bands: [],
        config: sanitizedConfig || null,
        generatedSchedules: [],
        // parsedData is never stored in Firestore
        projectRevision: previousRevision + 1,
        ...(validV2Contract ? {
            runtimeTrustSchemaVersion: RUNTIME_TRUST_SCHEMA_VERSION,
            runtimeTrustMigrationVersion: RUNTIME_TRUST_SCHEMA_VERSION,
        } : {}),
        updatedAt: serverTimestamp()
    };

    // Only update storagePath if we uploaded new data (don't overwrite existing path with null)
    if (storagePath) {
        docData.storagePath = storagePath;
    }

    if (!isUpdate) {
        docData.createdAt = serverTimestamp();
    }

    try {
        await runTransaction(db, async transaction => {
            const currentSnapshot = await transaction.get(docRef);
            const currentData = currentSnapshot.exists()
                ? currentSnapshot.data() as Record<string, unknown>
                : undefined;
            const currentStoragePath = assertOwnedStoragePath(userId, currentData?.storagePath);
            if (
                currentSnapshot.exists() !== existedAtStart
                || getStoredRevision(currentData) !== previousRevision
                || currentStoragePath !== previousStoragePath
            ) {
                throw new StaleNewScheduleProjectError();
            }
            transaction.set(docRef, docData, { merge: true });
        });
    } catch (error) {
        if (storagePath) {
            try {
                await deleteObject(ref(storage, storagePath));
            } catch {
                // Best-effort cleanup of an upload that lost the commit race.
            }
        }
        throw error;
    }

    if (storagePath && previousStoragePath && previousStoragePath !== storagePath) {
        try {
            await deleteObject(ref(storage, previousStoragePath));
        } catch (e) {
            console.warn('Failed to delete prior project storage file:', e);
        }
    }

    return projectId;
};

/**
 * Durably replaces legacy runtime/schedule payloads with a sanitized project
 * snapshot. Firestore continues to own project identity and planner settings.
 */
export const resetLegacyRuntimeProject = async (
    userId: string,
    projectId: string,
    options: SaveNewScheduleProjectOptions = {}
): Promise<number> => {
    const projectRef = doc(db, 'users', userId, 'newScheduleProjects', projectId);
    const initialSnapshot = await getDoc(projectRef);
    if (!initialSnapshot.exists()) throw new Error('New Schedule project not found.');

    const initialData = initialSnapshot.data() as Record<string, unknown>;
    const previousRevision = getStoredRevision(initialData);
    if (options.expectedRevision !== undefined && options.expectedRevision !== previousRevision) {
        throw new StaleNewScheduleProjectError();
    }
    const previousStoragePath = assertOwnedStoragePath(userId, initialData.storagePath);
    let storedContent: Record<string, unknown> = {};
    if (previousStoragePath) {
        const previousBytes = await getBytes(ref(storage, previousStoragePath));
        const parsed = JSON.parse(new TextDecoder().decode(previousBytes)) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('The saved project payload is not a JSON object.');
        }
        storedContent = parsed as Record<string, unknown>;
    }
    if (
        isStructurallyValidRuntimeTrustContract(storedContent.approvedRuntimeContract)
        || isStructurallyValidRuntimeTrustContract(initialData.approvedRuntimeContract)
    ) {
        throw new Error('A valid schema-v2 runtime contract must not be reset as legacy data.');
    }

    const sanitizedContent = sanitizeLegacyRuntimeStorageContent(storedContent);
    if (sanitizedContent.config === undefined && initialData.config !== undefined) {
        sanitizedContent.config = initialData.config;
    }
    sanitizedContent.runtimeTrustMigrationVersion = RUNTIME_TRUST_SCHEMA_VERSION;
    const replacementStoragePath = createStoragePath(userId, projectId, '_v2-reset');

    try {
        await uploadAndVerifyJson(replacementStoragePath, sanitizedContent);
        await runTransaction(db, async transaction => {
            const currentSnapshot = await transaction.get(projectRef);
            if (!currentSnapshot.exists()) throw new StaleNewScheduleProjectError();
            const currentData = currentSnapshot.data() as Record<string, unknown>;
            if (
                getStoredRevision(currentData) !== previousRevision
                || assertOwnedStoragePath(userId, currentData.storagePath) !== previousStoragePath
            ) {
                throw new StaleNewScheduleProjectError();
            }

            transaction.update(projectRef, {
                analysis: [],
                bands: [],
                generatedSchedules: [],
                originalGeneratedSchedules: [],
                generatedScheduleInputFingerprint: deleteField(),
                parsedData: deleteField(),
                approvedRuntimeContract: deleteField(),
                approvedRuntimeModel: deleteField(),
                isGenerated: false,
                wizardStep: 1,
                storagePath: replacementStoragePath,
                projectRevision: previousRevision + 1,
                runtimeTrustSchemaVersion: deleteField(),
                runtimeTrustMigrationVersion: RUNTIME_TRUST_SCHEMA_VERSION,
                runtimeTrustMigratedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        });
    } catch (error) {
        try {
            await deleteObject(ref(storage, replacementStoragePath));
        } catch {
            // Best-effort cleanup of a replacement that was not committed.
        }
        throw error;
    }

    if (previousStoragePath && previousStoragePath !== replacementStoragePath) {
        try {
            await deleteObject(ref(storage, previousStoragePath));
        } catch (error) {
            console.warn('Legacy project reset committed, but the old Storage file could not be removed:', error);
        }
    }
    return previousRevision + 1;
};

/**
 * Get a single project with full data from Storage
 */
export const getProject = async (
    userId: string,
    projectId: string
): Promise<NewScheduleProject | null> => {
    const docRef = doc(db, 'users', userId, 'newScheduleProjects', projectId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        console.error('Project document does not exist:', projectId);
        return null;
    }

    const data = docSnap.data();
    console.log('Loading project from Firestore:', {
        name: data.name,
        storagePath: data.storagePath,
        isGenerated: data.isGenerated,
        hasConfig: !!data.config
    });

    let fullData: NewScheduleProject = {
        id: docSnap.id,
        name: data.name,
        dayType: data.dayType,
        importMode: data.importMode || 'csv',
        autofillFromMaster: data.autofillFromMaster ?? true,
        performanceConfig: data.performanceConfig || undefined,
        routeNumber: data.routeNumber,
        wizardStep: data.wizardStep,
        isGenerated: data.isGenerated,
        config: data.config,
        analysis: [],
        bands: [],
        generatedSchedules: [],
        originalGeneratedSchedules: [],
        generatedScheduleInputFingerprint: data.generatedScheduleInputFingerprint,
        parsedData: [], // Default empty
        approvedRuntimeContract: data.approvedRuntimeContract,
        approvedRuntimeModel: data.approvedRuntimeModel,
        storagePath: data.storagePath,
        projectRevision: getStoredRevision(data),
        runtimeTrustSchemaVersion: data.runtimeTrustSchemaVersion,
        runtimeTrustMigrationVersion: data.runtimeTrustMigrationVersion,
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
        updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date()
    };

    // Load full data from Storage if available
    if (data.storagePath) {
        try {
            const storageRef = ref(storage, data.storagePath);
            const url = await getDownloadURL(storageRef);
            const response = await fetch(url);
            const content = await response.json();

            fullData = {
                ...fullData,
                generatedSchedules: content.generatedSchedules || [],
                originalGeneratedSchedules: content.originalGeneratedSchedules || [],
                generatedScheduleInputFingerprint: content.generatedScheduleInputFingerprint,
                parsedData: content.parsedData || [], // Restore raw data
                analysis: content.analysis || [],
                bands: content.bands || [],
                // Normalization independently validates this shape. A marker by
                // itself never promotes old Storage content to a trusted contract.
                approvedRuntimeContract: content.approvedRuntimeContract,
                approvedRuntimeModel: content.approvedRuntimeModel,
                config: content.config || fullData.config
            };
            console.log('Loaded from Cloud Storage:', {
                analysisCount: fullData.analysis?.length,
                parsedDataCount: fullData.parsedData?.length,
                schedulesCount: fullData.generatedSchedules?.length,
                bandsCount: fullData.bands?.length,
                hasConfig: !!fullData.config
            });
        } catch (e) {
            console.error('Failed to load project data from storage:', e);
            return null;
        }
    } else {
        console.warn('No storagePath found - project has no saved data in Cloud Storage');
    }

    return fullData;
};

/**
 * Get all projects (metadata only, for listing)
 */
export const getAllProjects = async (userId: string): Promise<NewScheduleProject[]> => {
    const projectsRef = collection(db, 'users', userId, 'newScheduleProjects');
    const q = query(projectsRef, orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
            id: docSnap.id,
            name: data.name,
            dayType: data.dayType,
            importMode: data.importMode || 'csv',
            autofillFromMaster: data.autofillFromMaster ?? true,
            performanceConfig: data.performanceConfig || undefined,
            routeNumber: data.routeNumber,
            wizardStep: data.wizardStep,
            isGenerated: data.isGenerated,
            config: data.config,
            analysis: [] as TripBucketAnalysis[],
            bands: [] as TimeBand[],
            generatedSchedules: [] as MasterRouteTable[],
            originalGeneratedSchedules: [] as MasterRouteTable[],
            generatedScheduleInputFingerprint: data.generatedScheduleInputFingerprint,
            storagePath: data.storagePath,
            projectRevision: getStoredRevision(data),
            runtimeTrustSchemaVersion: data.runtimeTrustSchemaVersion,
            runtimeTrustMigrationVersion: data.runtimeTrustMigrationVersion,
            approvedRuntimeContract: undefined as ApprovedRuntimeContract | undefined,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date()
        };
    });
};

/**
 * Delete a project and its storage data
 */
export const deleteProject = async (
    userId: string,
    projectId: string
): Promise<void> => {
    // First get the doc to find storage path
    const docRef = doc(db, 'users', userId, 'newScheduleProjects', projectId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const data = docSnap.data();

        // Delete storage file if exists
        if (data.storagePath) {
            try {
                const storageRef = ref(storage, data.storagePath);
                await deleteObject(storageRef);
            } catch (e) {
                console.warn('Failed to delete project storage file:', e);
            }
        }
    }

    // Delete Firestore document
    await deleteDoc(docRef);
};

/**
 * Duplicate a project
 */
export const duplicateProject = async (
    userId: string,
    projectId: string,
    newName?: string
): Promise<string> => {
    // Get the full project data
    const project = await getProject(userId, projectId);
    if (!project) {
        throw new Error('Project not found');
    }

    // Create a new project with the same data but a new name
    const duplicatedProject: Omit<NewScheduleProject, 'id' | 'createdAt' | 'updatedAt'> = {
        name: newName || `${project.name} (Copy)`,
        dayType: project.dayType,
        importMode: project.importMode,
        autofillFromMaster: project.autofillFromMaster,
        performanceConfig: project.performanceConfig,
        routeNumber: project.routeNumber,
        wizardStep: project.wizardStep,
        analysis: project.analysis,
        bands: project.bands,
        approvedRuntimeContract: project.approvedRuntimeContract,
        config: project.config,
        generatedSchedules: project.generatedSchedules,
        originalGeneratedSchedules: project.originalGeneratedSchedules,
        generatedScheduleInputFingerprint: project.generatedScheduleInputFingerprint,
        parsedData: project.parsedData,
        isGenerated: project.isGenerated
    };

    // Save the duplicated project
    return await saveProject(userId, duplicatedProject);
};
