import {
    doc,
    getDoc,
    runTransaction,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { PerformanceLoadCapacityConfig } from './performanceDataTypes';
import {
    DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG,
    normalizePerformanceLoadCapacityConfig,
    normalizeVehicleId,
    validatePerformanceLoadCapacityInput,
    type PerformanceLoadCapacityInput,
} from './performanceLoadCapacity';

function configRef(teamId: string) {
    return doc(db, 'teams', teamId, 'performanceConfig', 'load');
}

function timestampToISO(value: unknown): string {
    if (value instanceof Timestamp) return value.toDate().toISOString();
    return typeof value === 'string' ? value : '';
}

export function getPerformanceLoadConfigErrorMessage(error: unknown, action: 'load' | 'save'): string {
    const code = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    if (code.includes('permission-denied')) {
        return action === 'save'
            ? 'Only team owners and admins can change passenger-load capacity settings.'
            : 'Passenger-load capacity settings could not be read for this team.';
    }
    if (code.includes('aborted')) return 'Capacity settings changed elsewhere. Reload them and try again.';
    return action === 'save'
        ? 'Passenger-load capacity settings could not be saved.'
        : 'Passenger-load capacity settings could not be loaded. Saved import capacities remain in use.';
}

export async function getPerformanceLoadCapacityConfig(
    teamId: string,
): Promise<PerformanceLoadCapacityConfig | null> {
    const snapshot = await getDoc(configRef(teamId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return normalizePerformanceLoadCapacityConfig({
        defaultCapacity: data.defaultCapacity,
        vehicleCapacities: data.vehicleCapacities,
        version: data.version,
        updatedAt: timestampToISO(data.updatedAt),
        updatedBy: data.updatedBy,
    });
}

export async function getEffectivePerformanceLoadCapacityConfig(
    teamId: string,
): Promise<PerformanceLoadCapacityConfig> {
    return await getPerformanceLoadCapacityConfig(teamId)
        ?? { ...DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG, vehicleCapacities: {} };
}

export async function savePerformanceLoadCapacityConfig(
    teamId: string,
    input: PerformanceLoadCapacityInput,
    userId: string,
    expectedVersion: number,
): Promise<number> {
    validatePerformanceLoadCapacityInput(input);
    const normalized = normalizePerformanceLoadCapacityConfig(input);
    const vehicleCapacities = Object.fromEntries(
        Object.entries(normalized.vehicleCapacities)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([vehicleId, capacity]) => [normalizeVehicleId(vehicleId), capacity]),
    );

    return runTransaction(db, async transaction => {
        const ref = configRef(teamId);
        const snapshot = await transaction.get(ref);
        const currentVersion = snapshot.exists() && Number.isInteger(snapshot.data().version)
            ? Number(snapshot.data().version)
            : 0;
        if (currentVersion !== expectedVersion) {
            const error = new Error('Capacity settings changed elsewhere.');
            (error as Error & { code?: string }).code = 'aborted';
            throw error;
        }
        const nextVersion = currentVersion + 1;
        transaction.set(ref, {
            schemaVersion: 1,
            defaultCapacity: normalized.defaultCapacity,
            vehicleCapacities,
            version: nextVersion,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
        });
        return nextVersion;
    });
}
