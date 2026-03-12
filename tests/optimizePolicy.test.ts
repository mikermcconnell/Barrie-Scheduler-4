import { describe, expect, it } from 'vitest';
import {
    DEFAULT_OPTIMIZE_MAX_RETRIES,
    DEFAULT_OPTIMIZE_TIMEOUT_MS,
    isRetryableOptimizeFailure,
    parseOptimizeMaxRetries,
    parseOptimizeTimeoutMs,
} from '../utils/ai/optimizePolicy';

describe('optimizePolicy', () => {
    it('does not retry client timeouts', () => {
        expect(isRetryableOptimizeFailure(undefined, 'CLIENT_TIMEOUT')).toBe(false);
    });

    it('retries transient upstream failures', () => {
        expect(isRetryableOptimizeFailure(504, 'TIMEOUT')).toBe(true);
        expect(isRetryableOptimizeFailure(undefined, 'NETWORK')).toBe(true);
    });

    it('uses the hardened default timeout when env is missing or invalid', () => {
        expect(parseOptimizeTimeoutMs()).toBe(DEFAULT_OPTIMIZE_TIMEOUT_MS);
        expect(parseOptimizeTimeoutMs('invalid')).toBe(DEFAULT_OPTIMIZE_TIMEOUT_MS);
    });

    it('defaults retries to zero and clamps negatives', () => {
        expect(parseOptimizeMaxRetries()).toBe(DEFAULT_OPTIMIZE_MAX_RETRIES);
        expect(parseOptimizeMaxRetries('-3')).toBe(DEFAULT_OPTIMIZE_MAX_RETRIES);
        expect(parseOptimizeMaxRetries('2.8')).toBe(2);
    });
});
