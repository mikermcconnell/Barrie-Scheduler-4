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

function optionalTimestampToDate(timestamp?: Timestamp | Date): Date | undefined {
    if (!timestamp) return undefined;
    return timestampToDate(timestamp);
}

/**
 * Calculate effective cycle times for interlined routes (8A/8B)
 * This adjusts trip.cycleTime to exclude interline gaps
 */
function applyEffectiveCycleTimes(table: MasterRouteTable, routeNumber: string): MasterRouteTable {
    // Only apply to interlined routes
    if (!routeNumber.includes('8A') && !routeNumber.includes('8B')) {
        return table;
    }

    const interlineStopPattern = 'allandale';

    // Helper: time difference handling midnight crossing
    const timeDiff = (end: number, start: number): number => {
        const diff = end - start;
        return diff < 0 ? diff + 1440 : diff;
    };

    // Find interline stop index and recovery stop
    const findInterlineStopInfo = (): { interlineIdx: number; hasRecovery: boolean } | null => {
        for (let i = 0; i < table.stops.length; i++) {
            if (table.stops[i].toLowerCase().includes(interlineStopPattern)) {
                // Check if any trip has recovery at this stop
                const hasRecovery = table.trips.some(t =>
                    t.recoveryTimes?.[table.stops[i]] !== undefined &&
                    t.recoveryTimes[table.stops[i]] !== null
                );
                return { interlineIdx: i, hasRecovery };
            }
        }
        return null;
    };

    const interlineInfo = findInterlineStopInfo();
    if (!interlineInfo) {
        return table; // No interline stop found
    }

    const interlineStop = table.stops[interlineInfo.interlineIdx];
    const resumeStop = interlineInfo.interlineIdx + 1 < table.stops.length
        ? table.stops[interlineInfo.interlineIdx + 1]
        : null;

    // Helper: parse time string to minutes
    const parseTime = (timeStr: string | undefined): number | null => {
        if (!timeStr) return null;
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (!match) return null;
        let hours = parseInt(match[1]);
        const mins = parseInt(match[2]);
        const period = match[3]?.toUpperCase();
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        return hours * 60 + mins;
    };

    // Process each trip
    const updatedTrips = table.trips.map(trip => {
        // Get first stop time
        let firstTime: number | null = null;
        for (const stop of table.stops) {
            const time = parseTime(trip.stops[stop]);
            if (time !== null) {
                firstTime = time;
                break;
            }
        }

        // Get interline arrival time
        const interlineArr = parseTime(trip.stops[interlineStop]);

        // Get recovery at interline
        const recovery = trip.recoveryTimes?.[interlineStop] ?? 0;

        // Get resume time (departure after interline)
        const resumeTime = resumeStop ? parseTime(trip.stops[resumeStop]) : null;

        // Get last stop time
        let lastTime: number | null = null;
        for (let i = table.stops.length - 1; i >= 0; i--) {
            const time = parseTime(trip.stops[table.stops[i]]);
            if (time !== null) {
                lastTime = time;
                break;
            }
        }

        // If we don't have the required times, keep original cycleTime
        if (firstTime === null || interlineArr === null) {
            return trip;
        }

        // Calculate effective cycle time
        const segment1 = timeDiff(interlineArr, firstTime);

        // Check if trip ends at interline (no resume)
        if (resumeTime === null) {
            // Trip ends at interline: effective = segment1 + recovery
            const effectiveCycle = segment1 + recovery;
            return {
                ...trip,
                cycleTime: effectiveCycle,
                travelTime: effectiveCycle - trip.recoveryTime
            };
        }

        // Full interline trip
        if (lastTime !== null) {
            const segment2 = timeDiff(lastTime, resumeTime);
            const effectiveCycle = segment1 + recovery + segment2;
            return {
                ...trip,
                cycleTime: effectiveCycle,
                travelTime: effectiveCycle - trip.recoveryTime
            };
        }

        return trip;
    });

    return {
        ...table,
        trips: updatedTrips
    };
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

    // 2. Apply effective cycle times for interlined routes (8A/8B)
    const adjustedNorthTable = applyEffectiveCycleTimes(northTable, routeNumber);
    const adjustedSouthTable = applyEffectiveCycleTimes(southTable, routeNumber);

    // 3. Prepare content and upload to Cloud Storage FIRST (before transaction)
    const storagePath = `teams/${teamId}/masterSchedules/${routeIdentity}_v${newVersion}.json`;
    const content: MasterScheduleContent = {
        northTable: adjustedNorthTable,
        southTable: adjustedSouthTable,
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
            source: data.source,
            publishedAt: optionalTimestampToDate(data.publishedAt),
            publishedBy: data.publishedBy,
            publishedFromDraft: data.publishedFromDraft,
            effectiveDate: data.effectiveDate,
            notes: data.notes
        };
    });
}

// Cache for all stops (cleared on page refresh)
let allStopsCache: { teamId: string; stops: string[]; stopCodes: Record<string, string> } | null = null;

/**
 * Get all unique stops from all master schedules.
 * Fetches full schedule content for each route in parallel.
 * Results are cached for the session.
 */
export async function getAllUniqueStops(teamId: string): Promise<string[]> {
    // Return cached result if available for this team
    if (allStopsCache && allStopsCache.teamId === teamId) {
        return allStopsCache.stops;
    }

    // Populate cache
    await getAllStopsWithCodes(teamId);

    return allStopsCache?.stops || [];
}

/**
 * Get all unique stops with their codes from all master schedules.
 * Fetches full schedule content for each route in parallel.
 * Results are cached for the session.
 * Returns: { stops: string[], stopCodes: Record<stopName, stopCode> }
 */
export async function getAllStopsWithCodes(teamId: string): Promise<{ stops: string[]; stopCodes: Record<string, string> }> {
    // Return cached result if available for this team
    if (allStopsCache && allStopsCache.teamId === teamId) {
        return { stops: allStopsCache.stops, stopCodes: allStopsCache.stopCodes };
    }

    // Get all schedule metadata
    const schedules = await getAllMasterSchedules(teamId);

    if (schedules.length === 0) {
        return { stops: [], stopCodes: {} };
    }

    // Fetch all schedules in parallel
    // Use nameToAllCodes to track ALL codes for each stop name
    const nameToAllCodes: Record<string, Set<string>> = {};

    const fetchPromises = schedules.map(async (schedule) => {
        try {
            const storageRef = ref(storage, schedule.storagePath);
            const bytes = await getBytes(storageRef);
            const json = new TextDecoder().decode(bytes);
            const content: MasterScheduleContent = JSON.parse(json);

            // Collect stop names and their codes from both directions
            const collectStopCodes = (stopIds: Record<string, string> | undefined) => {
                if (!stopIds) return;
                Object.entries(stopIds).forEach(([name, code]) => {
                    if (code) {
                        if (!nameToAllCodes[name]) {
                            nameToAllCodes[name] = new Set();
                        }
                        nameToAllCodes[name].add(code);
                    }
                });
            };

            // Also add stops without codes (from stops array)
            const collectStopsWithoutCodes = (stops: string[] | undefined, stopIds: Record<string, string> | undefined) => {
                if (!stops) return;
                stops.forEach(stop => {
                    if (!stopIds?.[stop] && !nameToAllCodes[stop]) {
                        nameToAllCodes[stop] = new Set(); // Empty set = no code
                    }
                });
            };

            collectStopCodes(content.northTable?.stopIds);
            collectStopCodes(content.southTable?.stopIds);
            collectStopsWithoutCodes(content.northTable?.stops, content.northTable?.stopIds);
            collectStopsWithoutCodes(content.southTable?.stops, content.southTable?.stopIds);
        } catch (error) {
            console.error(`Error fetching stops for ${schedule.id}:`, error);
        }
    });

    await Promise.all(fetchPromises);

    // Now process nameToAllCodes to build final stop list
    // Rules:
    // 1. Same code, different names -> keep cleanest name (no parens, shorter)
    // 2. Same name, different codes -> keep all, disambiguate with [code]

    // Step 1: Build code -> names mapping (reverse of nameToAllCodes)
    const codeToNames: Record<string, string[]> = {};
    const stopsWithoutCodes: string[] = [];

    for (const [name, codes] of Object.entries(nameToAllCodes)) {
        if (codes.size === 0) {
            stopsWithoutCodes.push(name);
        } else {
            for (const code of codes) {
                if (!codeToNames[code]) {
                    codeToNames[code] = [];
                }
                codeToNames[code].push(name);
            }
        }
    }

    // Step 2: For each code, pick the cleanest name (prefer shorter, no parenthetical suffix)
    const codeToBestName: Record<string, string> = {};
    for (const [code, names] of Object.entries(codeToNames)) {
        const sorted = [...names].sort((a, b) => {
            const aHasParens = a.includes('(');
            const bHasParens = b.includes('(');
            if (aHasParens !== bHasParens) {
                return aHasParens ? 1 : -1; // Prefer no parens
            }
            return a.length - b.length; // Prefer shorter
        });
        codeToBestName[code] = sorted[0];
    }

    // Step 3: Check for duplicate "best names" across different codes
    const bestNameToCodes: Record<string, string[]> = {};
    for (const [code, name] of Object.entries(codeToBestName)) {
        if (!bestNameToCodes[name]) {
            bestNameToCodes[name] = [];
        }
        bestNameToCodes[name].push(code);
    }

    // Step 4: Build final list - append code to disambiguate when same name has multiple codes
    const deduplicatedStops: string[] = [...stopsWithoutCodes];
    const finalStopCodes: Record<string, string> = {};

    for (const [code, bestName] of Object.entries(codeToBestName)) {
        const codesWithThisName = bestNameToCodes[bestName];

        let displayName: string;
        if (codesWithThisName.length > 1) {
            // Multiple codes share this name - append code to disambiguate
            displayName = `${bestName} [${code}]`;
        } else {
            displayName = bestName;
        }

        deduplicatedStops.push(displayName);
        finalStopCodes[displayName] = code;
    }

    // Sort and cache
    const sortedStops = deduplicatedStops.sort();
    allStopsCache = { teamId, stops: sortedStops, stopCodes: finalStopCodes };

    return { stops: sortedStops, stopCodes: finalStopCodes };
}

/**
 * Clear the all stops cache (call when schedules are updated)
 */
export function clearAllStopsCache(): void {
    allStopsCache = null;
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
        source: data.source,
        publishedAt: optionalTimestampToDate(data.publishedAt),
        publishedBy: data.publishedBy,
        publishedFromDraft: data.publishedFromDraft,
        effectiveDate: data.effectiveDate,
        notes: data.notes
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

// ============ ROUTE MAP OPERATIONS ============

/**
 * Upload a route map image for a specific route
 */
export async function uploadRouteMap(
    teamId: string,
    routeNumber: string,
    file: File
): Promise<string> {
    // Always use lowercase extension for consistency (Firebase paths are case-sensitive)
    const extension = (file.name.split('.').pop() || 'png').toLowerCase();
    const storagePath = `teams/${teamId}/routeMaps/${routeNumber}.${extension}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file, { contentType: file.type });
    const downloadUrl = await getDownloadURL(storageRef);

    return downloadUrl;
}

/**
 * Delete a route map image
 */
export async function deleteRouteMap(
    teamId: string,
    routeNumber: string
): Promise<void> {
    // Try common extensions
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

    for (const ext of extensions) {
        try {
            const storagePath = `teams/${teamId}/routeMaps/${routeNumber}.${ext}`;
            const storageRef = ref(storage, storagePath);
            await deleteObject(storageRef);
            return; // Successfully deleted
        } catch (error: any) {
            // Continue trying other extensions if not found
            if (error.code !== 'storage/object-not-found') {
                throw error;
            }
        }
    }
}

/**
 * Get the download URL for a route map image
 */
export async function getRouteMapUrl(
    teamId: string,
    routeNumber: string
): Promise<string | null> {
    // Try common extensions (lowercase and uppercase for backwards compatibility)
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'PNG', 'JPG', 'JPEG', 'GIF', 'WEBP'];

    for (const ext of extensions) {
        try {
            const storagePath = `teams/${teamId}/routeMaps/${routeNumber}.${ext}`;
            const storageRef = ref(storage, storagePath);
            const url = await getDownloadURL(storageRef);
            return url;
        } catch (error: any) {
            // Continue trying other extensions if not found
            if (error.code !== 'storage/object-not-found') {
                throw error;
            }
        }
    }

    return null; // No map found
}
