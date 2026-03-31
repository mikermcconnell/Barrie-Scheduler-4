import { describe, expect, it } from 'vitest';
import {
    buildDefaultPlatformConfig,
    getPlatformConfigErrorMessage
} from '../utils/platform/platformConfigService';

describe('platformConfigService helpers', () => {
    it('builds a default config payload', () => {
        const config = buildDefaultPlatformConfig();
        const downtown = config.hubs.find(hub => hub.name === 'Downtown');
        const stop1 = downtown?.platforms.find(platform => platform.platformId === 'Stop 1');
        const stop2 = downtown?.platforms.find(platform => platform.platformId === 'Stop 2');

        expect(config.hubs.length).toBeGreaterThan(0);
        expect(config.version).toBe(0);
        expect(config.updatedBy).toBe('system');
        expect(stop1?.capacity).toBe(3);
        expect(stop2?.capacity).toBe(3);
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
