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
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    orderBy,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { db, storage } from './firebase';
import type { MasterRouteTable } from './masterScheduleParser';
import type { RuntimeData } from '../components/NewSchedule/utils/csvParser';
import type { TripBucketAnalysis, TimeBand } from './runtimeAnalysis';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';

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
    routeNumber?: string;
    analysis?: TripBucketAnalysis[];
    bands?: TimeBand[];
    config?: ScheduleConfig;
    // Generated schedule (if completed)
    generatedSchedules?: MasterRouteTable[];
    // Raw Data (Required for re-generation) - Stored in Cloud Storage only, not Firestore
    parsedData?: RuntimeData[];

    isGenerated: boolean;
    // Metadata
    storagePath?: string;
    createdAt: Date;
    updatedAt: Date;
}

// ============ CRUD OPERATIONS ============

/**
 * Save a new schedule project
 */
export const saveProject = async (
    userId: string,
    project: Omit<NewScheduleProject, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<string> => {
    const projectsRef = collection(db, 'users', userId, 'newScheduleProjects');

    const isUpdate = !!project.id;
    const docRef = project.id ? doc(projectsRef, project.id) : doc(projectsRef);
    const projectId = docRef.id;

    const sanitizedConfig = project.config
        ? stripUndefinedDeep(project.config as ScheduleConfig)
        : undefined;

    // 1. Check if we have large data to store in Storage (Generated Schedules OR Raw Data OR Analysis)
    // We should save to storage if we have ANY of these heavy items.
    let storagePath: string | undefined;
    const hasHeavyData = (project.generatedSchedules && project.generatedSchedules.length > 0) ||
        (project.parsedData && project.parsedData.length > 0) ||
        (project.analysis && project.analysis.length > 0);

    if (hasHeavyData) {
        const content = JSON.stringify({
            generatedSchedules: project.generatedSchedules,
            parsedData: project.parsedData, // Save raw data!
            analysis: project.analysis,
            bands: project.bands,
            config: sanitizedConfig
        });

        const timestamp = Date.now();
        storagePath = `users/${userId}/newScheduleProjects/${projectId}_${timestamp}.json`;
        const storageRef = ref(storage, storagePath);

        await uploadBytes(storageRef, new TextEncoder().encode(content), {
            contentType: 'application/json'
        });
    }

    // 2. Save metadata to Firestore
    const docData: Record<string, unknown> = {
        name: project.name || 'Untitled Project',
        dayType: project.dayType,
        routeNumber: project.routeNumber || null,
        isGenerated: project.isGenerated || false,
        // Don't store large data in Firestore
        analysis: [],
        bands: [],
        config: sanitizedConfig || null,
        generatedSchedules: [],
        // parsedData is never stored in Firestore
        updatedAt: serverTimestamp()
    };

    // Only update storagePath if we uploaded new data (don't overwrite existing path with null)
    if (storagePath) {
        docData.storagePath = storagePath;
    }

    if (!isUpdate) {
        docData.createdAt = serverTimestamp();
    }

    await setDoc(docRef, docData, { merge: true });

    return projectId;
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
        routeNumber: data.routeNumber,
        isGenerated: data.isGenerated,
        config: data.config,
        analysis: [],
        bands: [],
        generatedSchedules: [],
        parsedData: [], // Default empty
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
                parsedData: content.parsedData || [], // Restore raw data
                analysis: content.analysis || [],
                bands: content.bands || [],
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
            routeNumber: data.routeNumber,
            isGenerated: data.isGenerated,
            config: data.config,
            analysis: [] as TripBucketAnalysis[],
            bands: [] as TimeBand[],
            generatedSchedules: [] as MasterRouteTable[],
            storagePath: data.storagePath,
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
        routeNumber: project.routeNumber,
        analysis: project.analysis,
        bands: project.bands,
        config: project.config,
        generatedSchedules: project.generatedSchedules,
        parsedData: project.parsedData,
        isGenerated: project.isGenerated
    };

    // Save the duplicated project
    return await saveProject(userId, duplicatedProject);
};
