import { describe, expect, it } from 'vitest';
import { buildDuplicateDraftName } from '../utils/services/draftNaming';

describe('buildDuplicateDraftName', () => {
    it('adds a copy suffix to a plain draft name', () => {
        expect(buildDuplicateDraftName('Route 2 Weekday')).toBe('Route 2 Weekday (Copy)');
    });

    it('increments a first copy to Copy 2', () => {
        expect(buildDuplicateDraftName('Route 2 Weekday (Copy)')).toBe('Route 2 Weekday (Copy 2)');
    });

    it('increments numbered copies', () => {
        expect(buildDuplicateDraftName('Route 2 Weekday (Copy 2)')).toBe('Route 2 Weekday (Copy 3)');
    });

    it('falls back to Untitled Draft when given an empty name', () => {
        expect(buildDuplicateDraftName('   ')).toBe('Untitled Draft (Copy)');
    });
});
