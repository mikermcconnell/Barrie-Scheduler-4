import { describe, expect, it } from 'vitest';
import {
    buildDefaultPlatformConfig,
    getPlatformConfigErrorMessage
} from '../utils/platform/platformConfigService';

describe('platformConfigService helpers', () => {
    it('builds a default config payload', () => {
        const config = buildDefaultPlatformConfig();

        expect(config.hubs.length).toBeGreaterThan(0);
        expect(config.version).toBe(0);
        expect(config.updatedBy).toBe('system');
    });

    it('returns a permission-specific save message', () => {
        expect(
            getPlatformConfigErrorMessage({ code: 'permission-denied' }, 'save')
        ).toContain('do not have permission');
    });

    it('returns a fallback warning for load failures', () => {
        expect(
            getPlatformConfigErrorMessage(new Error('boom'), 'load')
        ).toContain('Showing the built-in defaults instead');
    });
});
