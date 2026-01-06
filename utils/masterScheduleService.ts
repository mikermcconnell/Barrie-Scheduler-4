/**
 * Master Schedule Service
 *
 * Handles CRUD operations for team-based Master Schedules with version history.
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
    limit,
    serverTimestamp,
    Timestamp,
    runTransaction
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject,
    getBytes
} from 'firebase/storage';
import { db, storage } from './firebase';
import type {
    MasterScheduleEntry,
    MasterScheduleVersion,
    MasterScheduleContent,
    RouteIdentity,
    DayType,
    UploadSource,
    UploadConfirmation
} from './masterScheduleTypes';
import { buildRouteIdentity, extractRouteNumber, extractDayType } from './masterScheduleTypes';
import type { MasterRouteTable } from './masterScheduleParser';

const MAX_VERSIONS = 5;

// ============ HELPER FUNCTIONS ============

/**
 * Convert Firestore Timestamp to Date
 */
function timestampToDate(timestamp: Timestamp | Date): Date {
    if (timestamp instanceof Date) return timestamp;
    return timestamp.toDate();
}

// ============ UPLOAD FLOW ============

/**
 * Prepare upload confirmation data (call before actual upload)
 * Shows user what will be replaced
 */
export async function prepareUpload(
    teamId: string,
    northTable: MasterRouteTable,
    southTable: MasterRouteTable,
    routeNumber: string,
    dayType: DayType
): Promise<UploadConfirmation> {
    const routeIdentity = buildRouteIdentity(routeNumber, dayType);

    // Get existing entry if exists
    const entryRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity);
    const entrySnap = await getDoc(entryRef);

    const existingEntry = entrySnap.exists() ? ({
        id: entrySnap.id,
        ...entrySnap.data(),
        updatedAt: timestampToDate(entrySnap.data().updatedAt)
    } as MasterScheduleEntry) : null;

    // Count existing versions
    const versionsRef = collection(db, 'teams', teamId, 'masterSchedules', routeIdentity, 'versions');
    const versionsSnap = await getDocs(versionsRef);
    const existingVersionCount = versionsSnap.size;

    const newVersionNumber = existingEntry ? existingEntry.currentVersion + 1 : 1;
    const tripCount = northTable.trips.length + southTable.trips.length;

    return {
        routeIdentity,
        routeNumber,
        dayType,
        existingEntry,
        existingVersionCount,
        willBumpVersion: existingEntry !== null,
        newVersionNumber,
        tripCount,
        northStopCount: northTable.stops.length,
        southStopCount: southTable.stops.length
    };
}

/**
 * Upload schedule to Master Schedule
 * - Creates new version
 * - Bumps previous version to history
 * - Cleans up versions beyond MAX_VERSIONS
 */
export async function uploadToMasterSchedule(
    teamId: string,
    userId: string,
    uploaderName: string,
    northTable: MasterRouteTable,
    southTable: MasterRouteTable,
    routeNumber: string,
    dayType: DayType,
    source: UploadSource
): Promise<MasterScheduleEntry> {
    const routeIdentity = buildRouteIdentity(routeNumber, dayType);

    // 1. First, get the current version number (outside transaction for storage path)
    const entryRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity);
    const existingSnap = await getDoc(entryRef);
    const currentVersion = existingSnap.exists() ? existingSnap.data().currentVersion : 0;
    const newVersion = currentVersion + 1;

    // 2. Prepare content and upload to Cloud Storage FIRST (before transaction)
    const storagePath = `teams/${teamId}/masterSchedules/${routeIdentity}_v${newVersion}.json`;
    const content: MasterScheduleContent = {
        northTable,
        southTable,
        metadata: {
            routeNumber,
            dayType,
            uploadedAt: new Date().toISOString()
        }
    };

    const storageRef = ref(storage, storagePath);
    await uploadBytes(
        storageRef,
        new TextEncoder().encode(JSON.stringify(content)),
        { contentType: 'application/json' }
    );

    // 3. Now run the Firestore transaction
    let result: MasterScheduleEntry;
    try {
        result = await runTransaction(db, async (transaction) => {
            // Re-check version inside transaction to handle race conditions
            const freshSnap = await transaction.get(entryRef);
            const freshVersion = freshSnap.exists() ? freshSnap.data().currentVersion : 0;

            // If version changed between our check and transaction, abort
            if (freshVersion !== currentVersion) {
                throw new Error('Version conflict: schedule was updated by another user');
            }

            const tripCount = northTable.trips.length + southTable.trips.length;

            // Create version history entry
            const versionRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity, 'versions', String(newVersion));
            transaction.set(versionRef, {
                versionNumber: newVersion,
                storagePath,
                createdAt: serverTimestamp(),
                createdBy: userId,
                uploaderName,
                source,
                tripCount
            });

            // Update main entry
            transaction.set(entryRef, {
                routeNumber,
                dayType,
                currentVersion: newVersion,
                storagePath,
                tripCount,
                northStopCount: northTable.stops.length,
                southStopCount: southTable.stops.length,
                updatedAt: serverTimestamp(),
                updatedBy: userId,
                uploaderName,
                source
            });

            return {
                id: routeIdentity,
                routeNumber,
                dayType,
                currentVersion: newVersion,
                storagePath,
                tripCount,
                northStopCount: northTable.stops.length,
                southStopCount: southTable.stops.length,
                updatedAt: new Date(),
                updatedBy: userId,
                uploaderName,
                source
            };
        });
    } catch (error) {
        // Transaction failed - clean up the orphaned storage file
        try {
            await deleteObject(storageRef);
        } catch (cleanupError) {
            console.error('Failed to clean up storage after transaction failure:', cleanupError);
        }
        throw error;
    }

    // 4. Cleanup old versions (outside transaction, with error handling)
    try {
        await cleanupOldVersions(teamId, routeIdentity, result.currentVersion);
    } catch (cleanupError) {
        // Log but don't fail the upload - old versions will be cleaned up later
        console.error('Failed to cleanup old versions:', cleanupError);
    }

    return result;
}

/**
 * Clean up old versions beyond MAX_VERSIONS
 */
async function cleanupOldVersions(
    teamId: string,
    routeIdentity: RouteIdentity,
    currentVersion: number
): Promise<void> {
    if (currentVersion <= MAX_VERSIONS) {
        return;
    }

    const oldVersion = currentVersion - MAX_VERSIONS;
    const oldVersionRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity, 'versions', String(oldVersion));
    const oldVersionSnap = await getDoc(oldVersionRef);

    if (oldVersionSnap.exists()) {
        const oldData = oldVersionSnap.data();

        // Delete from Cloud Storage
        try {
            const oldStorageRef = ref(storage, oldData.storagePath);
            await deleteObject(oldStorageRef);
        } catch (error) {
            console.error('Error deleting old version from storage:', error);
        }

        // Delete from Firestore
        await deleteDoc(oldVersionRef);
    }
}

// ============ READ OPERATIONS ============

/**
 * Get all master schedules for a team (metadata only, for listing)
 */
export async function getAllMasterSchedules(
    teamId: string
): Promise<MasterScheduleEntry[]> {
    const schedulesRef = collection(db, 'teams', teamId, 'masterSchedules');
    const schedulesSnap = await getDocs(schedulesRef);

    return schedulesSnap.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            routeNumber: data.routeNumber,
            dayType: data.dayType,
            currentVersion: data.currentVersion,
            storagePath: data.storagePath,
            tripCount: data.tripCount,
            northStopCount: data.northStopCount,
            southStopCount: data.southStopCount,
            updatedAt: timestampToDate(data.updatedAt),
            updatedBy: data.updatedBy,
            uploaderName: data.uploaderName,
            source: data.source
        };
    });
}

/**
 * Get single master schedule entry with full content
 */
export async function getMasterSchedule(
    teamId: string,
    routeIdentity: RouteIdentity
): Promise<{ entry: MasterScheduleEntry; content: MasterScheduleContent } | null> {
    const entryRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity);
    const entrySnap = await getDoc(entryRef);

    if (!entrySnap.exists()) {
        return null;
    }

    const data = entrySnap.data();
    const entry: MasterScheduleEntry = {
        id: entrySnap.id,
        routeNumber: data.routeNumber,
        dayType: data.dayType,
        currentVersion: data.currentVersion,
        storagePath: data.storagePath,
        tripCount: data.tripCount,
        northStopCount: data.northStopCount,
        southStopCount: data.southStopCount,
        updatedAt: timestampToDate(data.updatedAt),
        updatedBy: data.updatedBy,
        uploaderName: data.uploaderName,
        source: data.source
    };

    // Load content from Cloud Storage
    const storageRef = ref(storage, data.storagePath);
    const bytes = await getBytes(storageRef);
    const json = new TextDecoder().decode(bytes);
    const content: MasterScheduleContent = JSON.parse(json);

    return { entry, content };
}

/**
 * Get version history for a route (most recent first)
 */
export async function getVersionHistory(
    teamId: string,
    routeIdentity: RouteIdentity
): Promise<MasterScheduleVersion[]> {
    const versionsRef = collection(db, 'teams', teamId, 'masterSchedules', routeIdentity, 'versions');
    const q = query(versionsRef, orderBy('versionNumber', 'desc'), limit(MAX_VERSIONS));
    const versionsSnap = await getDocs(q);

    return versionsSnap.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            versionNumber: data.versionNumber,
            storagePath: data.storagePath,
            createdAt: timestampToDate(data.createdAt),
            createdBy: data.createdBy,
            uploaderName: data.uploaderName,
            source: data.source,
            tripCount: data.tripCount
        };
    });
}

/**
 * Get specific version content
 */
export async function getVersionContent(
    teamId: string,
    routeIdentity: RouteIdentity,
    versionNumber: number
): Promise<MasterScheduleContent | null> {
    const versionRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity, 'versions', String(versionNumber));
    const versionSnap = await getDoc(versionRef);

    if (!versionSnap.exists()) {
        return null;
    }

    const data = versionSnap.data();

    // Load content from Cloud Storage
    const storageRef = ref(storage, data.storagePath);
    const bytes = await getBytes(storageRef);
    const json = new TextDecoder().decode(bytes);
    const content: MasterScheduleContent = JSON.parse(json);

    return content;
}

// ============ MANAGEMENT ============

/**
 * Rollback to a previous version
 * - Loads old version
 * - Creates new version with that content
 * - Old version becomes new current
 */
export async function rollbackToVersion(
    teamId: string,
    userId: string,
    uploaderName: string,
    routeIdentity: RouteIdentity,
    targetVersionNumber: number
): Promise<MasterScheduleEntry> {
    // Load the target version content
    const content = await getVersionContent(teamId, routeIdentity, targetVersionNumber);

    if (!content) {
        throw new Error(`Version ${targetVersionNumber} not found`);
    }

    // Re-upload as a new version with source 'tweaker' (rollback counts as manual edit)
    return await uploadToMasterSchedule(
        teamId,
        userId,
        uploaderName,
        content.northTable,
        content.southTable,
        content.metadata.routeNumber,
        content.metadata.dayType,
        'tweaker'  // Rollback is a manual operation
    );
}

/**
 * Delete a master schedule entry and all versions
 */
export async function deleteMasterSchedule(
    teamId: string,
    routeIdentity: RouteIdentity
): Promise<void> {
    // Get all versions to delete their storage files
    const versionsRef = collection(db, 'teams', teamId, 'masterSchedules', routeIdentity, 'versions');
    const versionsSnap = await getDocs(versionsRef);

    // Delete all version storage files
    for (const versionDoc of versionsSnap.docs) {
        const data = versionDoc.data();
        try {
            const storageRef = ref(storage, data.storagePath);
            await deleteObject(storageRef);
        } catch (error) {
            console.error('Error deleting version storage:', error);
        }

        // Delete version document
        await deleteDoc(versionDoc.ref);
    }

    // Delete main entry
    const entryRef = doc(db, 'teams', teamId, 'masterSchedules', routeIdentity);
    await deleteDoc(entryRef);
}

// ============ LOAD INTO TWEAKER ============

/**
 * Load master schedule content as MasterRouteTable[] for Schedule Tweaker
 */
export async function loadForTweaker(
    teamId: string,
    routeIdentity: RouteIdentity
): Promise<MasterRouteTable[]> {
    const result = await getMasterSchedule(teamId, routeIdentity);

    if (!result) {
        throw new Error(`Master schedule ${routeIdentity} not found`);
    }

    // Return both direction tables
    return [result.content.northTable, result.content.southTable];
}
