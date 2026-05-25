import { describe, expect, it } from 'vitest';
import {
    getRouteServiceLevels,
    getRouteSupplyProfiles,
    getScheduledTripsForRouteOnDate,
} from '../utils/transit-app/transitAppGtfsNormalization';

describe('transitAppGtfsNormalization', () => {
    it('merges Barrie A/B direction routes to Transit App base route keys', () => {
        const serviceRoutes = new Set(getRouteServiceLevels().map(row => row.route));
        const supplyRoutes = new Set(getRouteSupplyProfiles().map(row => row.route));

        expect(serviceRoutes.has('2')).toBe(true);
        expect(serviceRoutes.has('2A')).toBe(false);
        expect(serviceRoutes.has('2B')).toBe(false);
        expect(supplyRoutes.has('7')).toBe(true);
        expect(supplyRoutes.has('7A')).toBe(false);
        expect(supplyRoutes.has('7B')).toBe(false);

        expect(supplyRoutes.has('8A')).toBe(true);
        expect(supplyRoutes.has('8B')).toBe(true);
    });

    it('can normalize scheduled trips for merged route inputs', () => {
        expect(getScheduledTripsForRouteOnDate('2', '2025-01-06')).toBeGreaterThan(0);
        expect(getScheduledTripsForRouteOnDate('2A', '2025-01-06')).toBe(
            getScheduledTripsForRouteOnDate('2', '2025-01-06')
        );
    });
});
