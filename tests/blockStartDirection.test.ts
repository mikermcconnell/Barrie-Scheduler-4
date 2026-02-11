import { describe, expect, it } from 'vitest';
import {
    inferBlockStartDirection,
    normalizeDirectionHint,
    resolveBlockStartDirection,
    shouldShowStartDirectionForRoute
} from '../components/NewSchedule/utils/blockStartDirection';

describe('blockStartDirection', () => {
    it('infers Route 8 northbound start from Park Place variants', () => {
        expect(inferBlockStartDirection('8A', 'Park Place')).toBe('North');
        expect(inferBlockStartDirection('8B', 'DEPART Park Place (2)')).toBe('North');
    });

    it('infers Route 8 southbound start from Georgian variants', () => {
        expect(inferBlockStartDirection('8A', 'Georgian College')).toBe('South');
        expect(inferBlockStartDirection('8B', 'ARRIVE Georgian College')).toBe('South');
    });

    it('returns null when no start stop is available', () => {
        expect(inferBlockStartDirection('8A', '')).toBeNull();
        expect(inferBlockStartDirection('8A')).toBeNull();
    });

    it('supports route-8 fallback when route number is entered as plain 8', () => {
        expect(inferBlockStartDirection('8', 'Park Place Terminal')).toBe('North');
        expect(inferBlockStartDirection('8', 'Georgian')).toBe('South');
    });

    it('shows start direction UI only for route 8 family', () => {
        expect(shouldShowStartDirectionForRoute('8')).toBe(true);
        expect(shouldShowStartDirectionForRoute('8A')).toBe(true);
        expect(shouldShowStartDirectionForRoute('8B')).toBe(true);
        expect(shouldShowStartDirectionForRoute('400')).toBe(false);
    });

    it('uses parser direction hint when stop inference is unknown', () => {
        expect(resolveBlockStartDirection('8A', 'Allandale Terminal', 'South')).toBe('South');
        expect(resolveBlockStartDirection('8A', 'Allandale Terminal', 'North')).toBe('North');
    });

    it('normalizes parser direction hint values', () => {
        expect(normalizeDirectionHint('north')).toBe('North');
        expect(normalizeDirectionHint(' South ')).toBe('South');
        expect(normalizeDirectionHint('loop')).toBeNull();
    });
});
