import {
  DEFAULT_LOAD_CAP,
  MAX_LOAD_CAPACITY,
  MIN_LOAD_CAPACITY,
  type PerformanceLoadCapacityConfig,
} from './types';

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
const MAX_VEHICLE_CAPACITY_OVERRIDES = 500;

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

export function resolvePerformanceLoadCapacity(
  config: Pick<PerformanceLoadCapacityConfig, 'defaultCapacity' | 'vehicleCapacities'> | null | undefined,
  vehicleId: string | null | undefined,
): number {
  const normalized = normalizePerformanceLoadCapacityConfig(config);
  return normalized.vehicleCapacities[normalizeVehicleId(vehicleId)] ?? normalized.defaultCapacity;
}
