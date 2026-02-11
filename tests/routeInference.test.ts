import { describe, expect, it } from 'vitest';
import { resolveAutoRouteNumber } from '../components/NewSchedule/utils/routeInference';

describe('resolveAutoRouteNumber', () => {
    it('merges direction variants to numeric base', () => {
        expect(resolveAutoRouteNumber(['12A', '12B'])).toBe('12');
        expect(resolveAutoRouteNumber(['7A', '7B'])).toBe('7');
    });

    it('does not merge separate 8A/8B variants', () => {
        expect(resolveAutoRouteNumber(['8A', '8B'])).toBe('8A');
    });

    it('returns first route when variants do not share a base', () => {
        expect(resolveAutoRouteNumber(['8A', '400'])).toBe('8A');
    });

    it('handles empty and single-file detection', () => {
        expect(resolveAutoRouteNumber([])).toBeUndefined();
        expect(resolveAutoRouteNumber(['8B'])).toBe('8B');
        expect(resolveAutoRouteNumber([' 8b '])).toBe('8B');
    });
});
