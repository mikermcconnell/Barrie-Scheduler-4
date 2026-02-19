import { describe, expect, it } from 'vitest';
import {
    checkRateLimit,
    validateDownloadUrl,
    validateGtfsUrl,
} from '../api/security';

describe('api/security URL validation', () => {
    it('allows Firebase Storage download URLs on approved hosts', () => {
        const result = validateDownloadUrl(
            'https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/users%2F123%2Ffile.json?alt=media'
        );
        expect(result.ok).toBe(true);
    });

    it('rejects download URLs outside the allowlist', () => {
        const result = validateDownloadUrl('https://example.com/file.txt');
        expect(result.ok).toBe(false);
    });

    it('rejects non-HTTPS download URLs', () => {
        const result = validateDownloadUrl('http://firebasestorage.googleapis.com/v0/b/demo/o/file');
        expect(result.ok).toBe(false);
    });

    it('allows known GTFS hosts with zip files', () => {
        const result = validateGtfsUrl('https://www.myridebarrie.ca/gtfs/google_transit.zip');
        expect(result.ok).toBe(true);
    });

    it('rejects GTFS URLs that are not zip files', () => {
        const result = validateGtfsUrl('https://www.myridebarrie.ca/gtfs/google_transit.json');
        expect(result.ok).toBe(false);
    });
});

describe('api/security rate limiter', () => {
    it('blocks requests that exceed the configured limit in a window', () => {
        const key = `test-rate-${Date.now()}`;
        const windowMs = 10_000;

        expect(checkRateLimit(key, 2, windowMs)).toBe(true);
        expect(checkRateLimit(key, 2, windowMs)).toBe(true);
        expect(checkRateLimit(key, 2, windowMs)).toBe(false);
    });
});
