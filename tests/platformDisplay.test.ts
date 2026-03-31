import { describe, expect, it } from 'vitest';
import {
    formatPlatformRouteDirection,
    getDisplayRoutes,
    getPlatformDirectionBadge
} from '../utils/platform/platformDisplay';

describe('platformDisplay helpers', () => {
    it('hides the duplicate direction badge for suffix-as-direction routes', () => {
        expect(getPlatformDirectionBadge('2A', 'North')).toBeNull();
        expect(formatPlatformRouteDirection('2A', 'North')).toBe('2A');
    });

    it('keeps the direction badge for routes whose suffix is not the direction', () => {
        expect(getPlatformDirectionBadge('8A', 'North')).toBe('North');
        expect(formatPlatformRouteDirection('8A', 'North')).toBe('8A North');
    });

    it('drops the base route label when a directional variant is already present', () => {
        expect(getDisplayRoutes(['2', '2A', '7A', '8A'])).toEqual(['2A', '7A', '8A']);
    });

    it('keeps separate branch routes like 8A and 8B', () => {
        expect(getDisplayRoutes(['8A', '8B'])).toEqual(['8A', '8B']);
    });
});
