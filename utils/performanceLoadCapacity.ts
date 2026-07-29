import {
    DEFAULT_LOAD_CAP,
    MAX_LOAD_CAPACITY,
    MIN_LOAD_CAPACITY,
    type PerformanceLoadCapacityConfig,
} from './performanceDataTypes';

export type PerformanceLoadCapacityInput = Pick<
    PerformanceLoadCapacityConfig,
    'defaultCapacity' | 'vehicleCapacities'
> & Partial<Pick<PerformanceLoadCapacityConfig, 'version' | 'updatedAt' | 'updatedBy'>>;

export const DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG: PerformanceLoadCapacityConfig = {
    defaultCapacity: DEFAULT_LOAD_CAP,
    vehicleCapacities: {},
    version: 0,
    updatedAt: '',
    updatedBy: 'system',
};
export const MAX_VEHICLE_CAPACITY_OVERRIDES = 500;

export function normalizeVehicleId(vehicleId: string | null | undefined): string {
    return String(vehicleId ?? '').trim().toUpperCase();
}

export function isValidLoadCapacity(value: unknown): value is number {
    return Number.isInteger(value)
        && Number(value) >= MIN_LOAD_CAPACITY
        && Number(value) <= MAX_LOAD_CAPACITY;
}

export function normalizePerformanceLoadCapacityConfig(
    input: Partial<PerformanceLoadCapacityInput> | null | undefined,
): PerformanceLoadCapacityConfig {
    const defaultCapacity = isValidLoadCapacity(input?.defaultCapacity)
        ? input.defaultCapacity
        : DEFAULT_LOAD_CAP;
    const vehicleCapacities: Record<string, number> = {};
    for (const [rawVehicleId, rawCapacity] of Object.entries(input?.vehicleCapacities ?? {}).slice(0, MAX_VEHICLE_CAPACITY_OVERRIDES)) {
        const vehicleId = normalizeVehicleId(rawVehicleId);
        if (vehicleId && isValidLoadCapacity(rawCapacity)) vehicleCapacities[vehicleId] = rawCapacity;
    }

    return {
        defaultCapacity,
        vehicleCapacities,
        version: Number.isInteger(input?.version) && Number(input?.version) >= 0
            ? Number(input?.version)
            : 0,
        updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : '',
        updatedBy: typeof input?.updatedBy === 'string' ? input.updatedBy : '',
    };
}

export function validatePerformanceLoadCapacityInput(input: PerformanceLoadCapacityInput): void {
    if (!isValidLoadCapacity(input.defaultCapacity)) {
        throw new Error(`Default capacity must be a whole number from ${MIN_LOAD_CAPACITY} to ${MAX_LOAD_CAPACITY}.`);
    }

    const entries = Object.entries(input.vehicleCapacities ?? {});
    if (entries.length > MAX_VEHICLE_CAPACITY_OVERRIDES) {
        throw new Error(`Vehicle capacity overrides are limited to ${MAX_VEHICLE_CAPACITY_OVERRIDES}.`);
    }

    const seen = new Set<string>();
    for (const [rawVehicleId, capacity] of entries) {
        const vehicleId = normalizeVehicleId(rawVehicleId);
        if (!vehicleId) throw new Error('Every vehicle capacity requires a vehicle ID.');
        if (seen.has(vehicleId)) throw new Error(`Vehicle ${vehicleId} is listed more than once.`);
        if (!isValidLoadCapacity(capacity)) {
            throw new Error(`Capacity for vehicle ${vehicleId} must be a whole number from ${MIN_LOAD_CAPACITY} to ${MAX_LOAD_CAPACITY}.`);
        }
        seen.add(vehicleId);
    }
}

export function resolvePerformanceLoadCapacity(
    config: Pick<PerformanceLoadCapacityConfig, 'defaultCapacity' | 'vehicleCapacities'> | null | undefined,
    vehicleId: string | null | undefined,
): number {
    const normalized = normalizePerformanceLoadCapacityConfig(config);
    return normalized.vehicleCapacities[normalizeVehicleId(vehicleId)] ?? normalized.defaultCapacity;
}
