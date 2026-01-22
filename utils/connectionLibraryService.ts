/**
 * Connection Library Service
 *
 * Handles CRUD operations for the team's connection target library.
 * Stored at teams/{teamId}/connectionLibrary/default
 */

import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db } from './firebase';
import type {
    ConnectionLibrary,
    ConnectionTarget,
    ConnectionTime,
    RouteConnectionConfig,
    generateConnectionId
} from './connectionTypes';
import { generateConnectionId as genId } from './connectionTypes';

// ============ HELPER FUNCTIONS ============

/**
 * Remove undefined values from an object (Firebase doesn't accept undefined).
 */
function removeUndefined<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
        return obj.map(item => removeUndefined(item)) as T;
    }
    if (typeof obj === 'object') {
        const cleaned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined) {
                cleaned[key] = removeUndefined(value);
            }
        }
        return cleaned as T;
    }
    return obj;
}

/**
 * Get the Firestore document reference for a team's connection library.
 */
function getLibraryRef(teamId: string) {
    return doc(db, 'teams', teamId, 'connectionLibrary', 'default');
}

/**
 * Convert Firestore Timestamp to ISO string.
 */
function timestampToISO(timestamp: Timestamp | string | undefined): string {
    if (!timestamp) return new Date().toISOString();
    if (typeof timestamp === 'string') return timestamp;
    return timestamp.toDate().toISOString();
}

// ============ READ OPERATIONS ============

/**
 * Get the connection library for a team.
 * Returns null if no library exists yet.
 */
export async function getConnectionLibrary(teamId: string): Promise<ConnectionLibrary | null> {
    try {
        const docRef = getLibraryRef(teamId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return null;
        }

        const data = docSnap.data();
        return {
            targets: data.targets || [],
            updatedAt: timestampToISO(data.updatedAt),
            updatedBy: data.updatedBy || ''
        };
    } catch (error) {
        console.error('Error getting connection library:', error);
        throw error;
    }
}

/**
 * Get a specific connection target by ID.
 */
export async function getConnectionTarget(
    teamId: string,
    targetId: string
): Promise<ConnectionTarget | null> {
    const library = await getConnectionLibrary(teamId);
    if (!library) return null;
    return library.targets.find(t => t.id === targetId) || null;
}

// ============ WRITE OPERATIONS ============

/**
 * Save the entire connection library.
 */
export async function saveConnectionLibrary(
    teamId: string,
    library: ConnectionLibrary,
    userId: string
): Promise<void> {
    try {
        const docRef = getLibraryRef(teamId);
        // Clean undefined values before saving (Firebase doesn't accept undefined)
        const cleanedTargets = removeUndefined(library.targets);
        await setDoc(docRef, {
            targets: cleanedTargets,
            updatedAt: serverTimestamp(),
            updatedBy: userId
        });
    } catch (error) {
        console.error('Error saving connection library:', error);
        throw error;
    }
}

/**
 * Add a new connection target to the library.
 */
export async function addConnectionTarget(
    teamId: string,
    target: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>,
    userId: string
): Promise<ConnectionTarget> {
    try {
        const library = await getConnectionLibrary(teamId) || {
            targets: [],
            updatedAt: new Date().toISOString(),
            updatedBy: userId
        };

        const newTarget: ConnectionTarget = {
            ...target,
            id: genId(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        library.targets.push(newTarget);
        await saveConnectionLibrary(teamId, library, userId);

        return newTarget;
    } catch (error) {
        console.error('Error adding connection target:', error);
        throw error;
    }
}

/**
 * Update an existing connection target.
 */
export async function updateConnectionTarget(
    teamId: string,
    targetId: string,
    updates: Partial<Omit<ConnectionTarget, 'id' | 'createdAt'>>,
    userId: string
): Promise<ConnectionTarget | null> {
    try {
        const library = await getConnectionLibrary(teamId);
        if (!library) return null;

        const index = library.targets.findIndex(t => t.id === targetId);
        if (index === -1) return null;

        const updatedTarget: ConnectionTarget = {
            ...library.targets[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        library.targets[index] = updatedTarget;
        await saveConnectionLibrary(teamId, library, userId);

        return updatedTarget;
    } catch (error) {
        console.error('Error updating connection target:', error);
        throw error;
    }
}

/**
 * Delete a connection target from the library.
 */
export async function deleteConnectionTarget(
    teamId: string,
    targetId: string,
    userId: string
): Promise<boolean> {
    try {
        const library = await getConnectionLibrary(teamId);
        if (!library) return false;

        const initialLength = library.targets.length;
        library.targets = library.targets.filter(t => t.id !== targetId);

        if (library.targets.length === initialLength) {
            return false; // Target not found
        }

        await saveConnectionLibrary(teamId, library, userId);
        return true;
    } catch (error) {
        console.error('Error deleting connection target:', error);
        throw error;
    }
}

// ============ CONNECTION TIME OPERATIONS ============

/**
 * Add a time to a connection target.
 */
export async function addConnectionTime(
    teamId: string,
    targetId: string,
    time: Omit<ConnectionTime, 'id'>,
    userId: string
): Promise<ConnectionTime | null> {
    try {
        const library = await getConnectionLibrary(teamId);
        if (!library) return null;

        const target = library.targets.find(t => t.id === targetId);
        if (!target) return null;

        const newTime: ConnectionTime = {
            ...time,
            id: genId()
        };

        if (!target.times) {
            target.times = [];
        }
        target.times.push(newTime);
        target.updatedAt = new Date().toISOString();

        await saveConnectionLibrary(teamId, library, userId);
        return newTime;
    } catch (error) {
        console.error('Error adding connection time:', error);
        throw error;
    }
}

/**
 * Update a time on a connection target.
 */
export async function updateConnectionTime(
    teamId: string,
    targetId: string,
    timeId: string,
    updates: Partial<Omit<ConnectionTime, 'id'>>,
    userId: string
): Promise<ConnectionTime | null> {
    try {
        const library = await getConnectionLibrary(teamId);
        if (!library) return null;

        const target = library.targets.find(t => t.id === targetId);
        if (!target || !target.times) return null;

        const timeIndex = target.times.findIndex(t => t.id === timeId);
        if (timeIndex === -1) return null;

        const updatedTime: ConnectionTime = {
            ...target.times[timeIndex],
            ...updates
        };

        target.times[timeIndex] = updatedTime;
        target.updatedAt = new Date().toISOString();

        await saveConnectionLibrary(teamId, library, userId);
        return updatedTime;
    } catch (error) {
        console.error('Error updating connection time:', error);
        throw error;
    }
}

/**
 * Delete a time from a connection target.
 */
export async function deleteConnectionTime(
    teamId: string,
    targetId: string,
    timeId: string,
    userId: string
): Promise<boolean> {
    try {
        const library = await getConnectionLibrary(teamId);
        if (!library) return false;

        const target = library.targets.find(t => t.id === targetId);
        if (!target || !target.times) return false;

        const initialLength = target.times.length;
        target.times = target.times.filter(t => t.id !== timeId);

        if (target.times.length === initialLength) {
            return false; // Time not found
        }

        target.updatedAt = new Date().toISOString();
        await saveConnectionLibrary(teamId, library, userId);
        return true;
    } catch (error) {
        console.error('Error deleting connection time:', error);
        throw error;
    }
}

// ============ UTILITY FUNCTIONS ============

/**
 * Initialize an empty connection library for a team.
 */
export async function initializeConnectionLibrary(
    teamId: string,
    userId: string
): Promise<ConnectionLibrary> {
    const library: ConnectionLibrary = {
        targets: [],
        updatedAt: new Date().toISOString(),
        updatedBy: userId
    };

    await saveConnectionLibrary(teamId, library, userId);
    return library;
}

/**
 * Get all manual targets (non-route) from the library.
 */
export async function getManualTargets(teamId: string): Promise<ConnectionTarget[]> {
    const library = await getConnectionLibrary(teamId);
    if (!library) return [];
    return library.targets.filter(t => t.type === 'manual');
}

/**
 * Get all route-based targets from the library.
 */
export async function getRouteTargets(teamId: string): Promise<ConnectionTarget[]> {
    const library = await getConnectionLibrary(teamId);
    if (!library) return [];
    return library.targets.filter(t => t.type === 'route');
}

// ============ ROUTE CONNECTION CONFIG OPERATIONS ============

/**
 * Get the Firestore document reference for a route's connection config.
 * Stored at teams/{teamId}/routeConnectionConfigs/{routeIdentity}
 */
function getRouteConfigRef(teamId: string, routeIdentity: string) {
    return doc(db, 'teams', teamId, 'routeConnectionConfigs', routeIdentity);
}

/**
 * Get the connection config for a specific route.
 * Returns null if no config exists yet.
 */
export async function getRouteConnectionConfig(
    teamId: string,
    routeIdentity: string
): Promise<RouteConnectionConfig | null> {
    try {
        const docRef = getRouteConfigRef(teamId, routeIdentity);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return null;
        }

        const data = docSnap.data();
        return {
            routeIdentity: data.routeIdentity || routeIdentity,
            connections: data.connections || [],
            lastOptimized: timestampToISO(data.lastOptimized),
            optimizationMode: data.optimizationMode || 'hybrid'
        };
    } catch (error) {
        console.error('Error getting route connection config:', error);
        throw error;
    }
}

/**
 * Save the connection config for a specific route.
 */
export async function saveRouteConnectionConfig(
    teamId: string,
    routeIdentity: string,
    config: RouteConnectionConfig
): Promise<void> {
    try {
        const docRef = getRouteConfigRef(teamId, routeIdentity);
        // Clean undefined values before saving (Firebase doesn't accept undefined)
        const cleanedConnections = removeUndefined(config.connections);
        await setDoc(docRef, {
            routeIdentity: config.routeIdentity,
            connections: cleanedConnections,
            lastOptimized: config.lastOptimized ? serverTimestamp() : null,
            optimizationMode: config.optimizationMode || 'hybrid'
        });
    } catch (error) {
        console.error('Error saving route connection config:', error);
        throw error;
    }
}
