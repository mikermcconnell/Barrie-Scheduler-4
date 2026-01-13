/**
 * Connection Config Service
 *
 * Handles CRUD operations for per-route connection configurations.
 * Stored at teams/{teamId}/masterSchedules/{routeIdentity}/connectionConfig/default
 */

import {
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db } from './firebase';
import type {
    RouteConnectionConfig,
    RouteConnection,
    OptimizationMode
} from './connectionTypes';
import { generateConnectionId } from './connectionTypes';

// ============ HELPER FUNCTIONS ============

/**
 * Get the Firestore document reference for a route's connection config.
 */
function getConfigRef(teamId: string, routeIdentity: string) {
    return doc(
        db,
        'teams',
        teamId,
        'masterSchedules',
        routeIdentity,
        'connectionConfig',
        'default'
    );
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
 * Get the connection config for a specific route.
 * Returns null if no config exists yet.
 */
export async function getRouteConnectionConfig(
    teamId: string,
    routeIdentity: string
): Promise<RouteConnectionConfig | null> {
    try {
        const docRef = getConfigRef(teamId, routeIdentity);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return null;
        }

        const data = docSnap.data();
        return {
            routeIdentity,
            connections: data.connections || [],
            lastOptimized: timestampToISO(data.lastOptimized),
            optimizationMode: data.optimizationMode || 'hybrid'
        };
    } catch (error) {
        console.error('Error getting route connection config:', error);
        throw error;
    }
}

// ============ WRITE OPERATIONS ============

/**
 * Save the entire connection config for a route.
 */
export async function saveRouteConnectionConfig(
    teamId: string,
    config: RouteConnectionConfig
): Promise<void> {
    try {
        const docRef = getConfigRef(teamId, config.routeIdentity);
        await setDoc(docRef, {
            connections: config.connections,
            lastOptimized: config.lastOptimized || null,
            optimizationMode: config.optimizationMode || 'hybrid'
        });
    } catch (error) {
        console.error('Error saving route connection config:', error);
        throw error;
    }
}

/**
 * Add a new connection to a route's config.
 */
export async function addRouteConnection(
    teamId: string,
    routeIdentity: string,
    connection: Omit<RouteConnection, 'id'>
): Promise<RouteConnection> {
    try {
        const config = await getRouteConnectionConfig(teamId, routeIdentity) || {
            routeIdentity,
            connections: [],
            optimizationMode: 'hybrid' as OptimizationMode
        };

        const newConnection: RouteConnection = {
            ...connection,
            id: generateConnectionId()
        };

        config.connections.push(newConnection);
        await saveRouteConnectionConfig(teamId, config);

        return newConnection;
    } catch (error) {
        console.error('Error adding route connection:', error);
        throw error;
    }
}

/**
 * Update an existing connection in a route's config.
 */
export async function updateRouteConnection(
    teamId: string,
    routeIdentity: string,
    connectionId: string,
    updates: Partial<Omit<RouteConnection, 'id'>>
): Promise<RouteConnection | null> {
    try {
        const config = await getRouteConnectionConfig(teamId, routeIdentity);
        if (!config) return null;

        const index = config.connections.findIndex(c => c.id === connectionId);
        if (index === -1) return null;

        const updatedConnection: RouteConnection = {
            ...config.connections[index],
            ...updates
        };

        config.connections[index] = updatedConnection;
        await saveRouteConnectionConfig(teamId, config);

        return updatedConnection;
    } catch (error) {
        console.error('Error updating route connection:', error);
        throw error;
    }
}

/**
 * Delete a connection from a route's config.
 */
export async function deleteRouteConnection(
    teamId: string,
    routeIdentity: string,
    connectionId: string
): Promise<boolean> {
    try {
        const config = await getRouteConnectionConfig(teamId, routeIdentity);
        if (!config) return false;

        const initialLength = config.connections.length;
        config.connections = config.connections.filter(c => c.id !== connectionId);

        if (config.connections.length === initialLength) {
            return false; // Connection not found
        }

        await saveRouteConnectionConfig(teamId, config);
        return true;
    } catch (error) {
        console.error('Error deleting route connection:', error);
        throw error;
    }
}

/**
 * Toggle a connection's enabled state.
 */
export async function toggleRouteConnection(
    teamId: string,
    routeIdentity: string,
    connectionId: string
): Promise<boolean> {
    try {
        const config = await getRouteConnectionConfig(teamId, routeIdentity);
        if (!config) return false;

        const connection = config.connections.find(c => c.id === connectionId);
        if (!connection) return false;

        connection.enabled = !connection.enabled;
        await saveRouteConnectionConfig(teamId, config);

        return connection.enabled;
    } catch (error) {
        console.error('Error toggling route connection:', error);
        throw error;
    }
}

/**
 * Update the optimization mode for a route.
 */
export async function setOptimizationMode(
    teamId: string,
    routeIdentity: string,
    mode: OptimizationMode
): Promise<void> {
    try {
        const config = await getRouteConnectionConfig(teamId, routeIdentity) || {
            routeIdentity,
            connections: [],
            optimizationMode: mode
        };

        config.optimizationMode = mode;
        await saveRouteConnectionConfig(teamId, config);
    } catch (error) {
        console.error('Error setting optimization mode:', error);
        throw error;
    }
}

/**
 * Record that optimization was performed.
 */
export async function recordOptimization(
    teamId: string,
    routeIdentity: string
): Promise<void> {
    try {
        const config = await getRouteConnectionConfig(teamId, routeIdentity);
        if (!config) return;

        config.lastOptimized = new Date().toISOString();
        await saveRouteConnectionConfig(teamId, config);
    } catch (error) {
        console.error('Error recording optimization:', error);
        throw error;
    }
}

/**
 * Delete all connection config for a route.
 */
export async function deleteRouteConnectionConfig(
    teamId: string,
    routeIdentity: string
): Promise<void> {
    try {
        const docRef = getConfigRef(teamId, routeIdentity);
        await deleteDoc(docRef);
    } catch (error) {
        console.error('Error deleting route connection config:', error);
        throw error;
    }
}

// ============ UTILITY FUNCTIONS ============

/**
 * Initialize an empty connection config for a route.
 */
export async function initializeRouteConnectionConfig(
    teamId: string,
    routeIdentity: string
): Promise<RouteConnectionConfig> {
    const config: RouteConnectionConfig = {
        routeIdentity,
        connections: [],
        optimizationMode: 'hybrid'
    };

    await saveRouteConnectionConfig(teamId, config);
    return config;
}

/**
 * Get enabled connections for a route (for optimization).
 */
export async function getEnabledConnections(
    teamId: string,
    routeIdentity: string
): Promise<RouteConnection[]> {
    const config = await getRouteConnectionConfig(teamId, routeIdentity);
    if (!config) return [];
    return config.connections.filter(c => c.enabled);
}

/**
 * Reorder connections (update priorities).
 */
export async function reorderConnections(
    teamId: string,
    routeIdentity: string,
    connectionIds: string[]
): Promise<void> {
    try {
        const config = await getRouteConnectionConfig(teamId, routeIdentity);
        if (!config) return;

        // Update priorities based on new order
        connectionIds.forEach((id, index) => {
            const connection = config.connections.find(c => c.id === id);
            if (connection) {
                connection.priority = index + 1;
            }
        });

        await saveRouteConnectionConfig(teamId, config);
    } catch (error) {
        console.error('Error reordering connections:', error);
        throw error;
    }
}

/**
 * Copy connections from one route to another.
 */
export async function copyConnectionConfig(
    teamId: string,
    sourceRouteIdentity: string,
    targetRouteIdentity: string
): Promise<RouteConnectionConfig | null> {
    try {
        const sourceConfig = await getRouteConnectionConfig(teamId, sourceRouteIdentity);
        if (!sourceConfig) return null;

        const newConfig: RouteConnectionConfig = {
            routeIdentity: targetRouteIdentity,
            connections: sourceConfig.connections.map(c => ({
                ...c,
                id: generateConnectionId() // Generate new IDs
            })),
            optimizationMode: sourceConfig.optimizationMode
        };

        await saveRouteConnectionConfig(teamId, newConfig);
        return newConfig;
    } catch (error) {
        console.error('Error copying connection config:', error);
        throw error;
    }
}
