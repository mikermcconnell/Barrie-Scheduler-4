import { describe, expect, it } from 'vitest';
import {
    buildFullPerformanceLoadRouteIds,
    getFullPerformanceLoadRouteId,
} from '../components/NewSchedule/utils/performanceRouteLoadOptions';

describe('new schedule performance load route options', () => {
    it('groups direction-suffix A/B routes under the full base route', () => {
        expect(getFullPerformanceLoadRouteId('7A')).toBe('7');
        expect(getFullPerformanceLoadRouteId('7B')).toBe('7');
        expect(getFullPerformanceLoadRouteId('12A')).toBe('12');
    });

    it('keeps variant routes as separate full routes', () => {
        expect(getFullPerformanceLoadRouteId('8A')).toBe('8A');
        expect(getFullPerformanceLoadRouteId('8B')).toBe('8B');
    });

    it('deduplicates and sorts route-scoped storage keys as full route choices', () => {
        expect(buildFullPerformanceLoadRouteIds(['7A', '7B', '8B', '8A', '12B', '2A'])).toEqual([
            '2',
            '7',
            '8A',
            '8B',
            '12',
        ]);
    });
});
