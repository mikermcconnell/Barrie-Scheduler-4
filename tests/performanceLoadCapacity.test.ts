import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG,
    normalizePerformanceLoadCapacityConfig,
    resolvePerformanceLoadCapacity,
    validatePerformanceLoadCapacityInput,
} from '../utils/performanceLoadCapacity';

describe('performance load capacity policy', () => {
    it('uses the 65-passenger fallback and normalizes vehicle IDs', () => {
        const config = normalizePerformanceLoadCapacityConfig({
            defaultCapacity: 72,
            vehicleCapacities: { ' 2301 ': 44, bus_2: 50 },
        });

        expect(DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG.defaultCapacity).toBe(65);
        expect(config.vehicleCapacities).toEqual({ '2301': 44, 'BUS_2': 50 });
        expect(resolvePerformanceLoadCapacity(config, ' 2301')).toBe(44);
        expect(resolvePerformanceLoadCapacity(config, 'unknown')).toBe(72);
    });

    it('drops malformed stored overrides and falls back from an invalid default', () => {
        const config = normalizePerformanceLoadCapacityConfig({
            defaultCapacity: 500,
            vehicleCapacities: { valid: 40, low: 10, decimal: 42.5 },
        });

        expect(config.defaultCapacity).toBe(65);
        expect(config.vehicleCapacities).toEqual({ VALID: 40 });
    });

    it('rejects invalid writes, duplicate normalized IDs, and oversized override sets', () => {
        expect(() => validatePerformanceLoadCapacityInput({ defaultCapacity: 19, vehicleCapacities: {} }))
            .toThrow(/20 to 150/);
        expect(() => validatePerformanceLoadCapacityInput({
            defaultCapacity: 65,
            vehicleCapacities: { bus: 40, ' BUS ': 50 },
        })).toThrow(/listed more than once/);
        const vehicleCapacities = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`bus-${index}`, 40]));
        expect(() => validatePerformanceLoadCapacityInput({ defaultCapacity: 65, vehicleCapacities }))
            .toThrow(/limited to 500/);
    });
});

describe('performance load capacity Firestore boundary', () => {
    it('allows member reads, restricts writes, and validates the document contract', () => {
        const rules = readFileSync('firestore.rules', 'utf8');
        const block = rules.match(/match \/performanceConfig\/\{configId\} \{([\s\S]*?)\n\s{6}\}/)?.[1] ?? '';

        expect(block).toContain("configId == 'load'");
        expect(block).toContain('isTeamMember(teamId) || canSupportReadTeamData(teamId)');
        expect(block).toContain('isTeamOwnerOrAdmin(teamId) || canSupportWriteTeamData(teamId)');
        expect(rules).toContain('function isValidPerformanceLoadConfig(data)');
        expect(rules).toContain('data.defaultCapacity >= 20 && data.defaultCapacity <= 150');
        expect(rules).toContain('data.vehicleCapacities.size() <= 500');
        expect(rules).toContain('request.resource.data.version == resource.data.version + 1');
    });
});
