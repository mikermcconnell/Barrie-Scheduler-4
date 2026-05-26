import { describe, expect, it } from 'vitest';
import { normalizeMapboxToken } from '../utils/mapboxToken';

describe('normalizeMapboxToken', () => {
    it('removes whitespace and escaped line endings from copied environment values', () => {
        expect(normalizeMapboxToken('  pk.test-token\\r\\n  ')).toBe('pk.test-token');
        expect(normalizeMapboxToken('\r\npk.test-token\r\n')).toBe('pk.test-token');
    });

    it('returns null for missing or blank values', () => {
        expect(normalizeMapboxToken(undefined)).toBeNull();
        expect(normalizeMapboxToken('   ')).toBeNull();
    });
});
