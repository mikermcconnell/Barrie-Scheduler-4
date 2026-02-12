import { describe, expect, it } from 'vitest';
import type { HubConfig } from '../utils/platform/platformConfig';
import { getPlatformForRoute } from '../utils/platform/platformConfig';

describe('platformConfig getPlatformForRoute', () => {
    it('prefers exact route variant over family match', () => {
        const hub: HubConfig = {
            name: 'Variant Hub',
            stopCodes: ['1'],
            stopNamePatterns: ['variant'],
            platforms: [
                { platformId: 'P6', routes: ['8A'] },
                { platformId: 'P8', routes: ['8B'] }
            ]
        };

        const platform = getPlatformForRoute(hub, '8B');
        expect(platform?.platformId).toBe('P8');
    });

    it('uses stop-code-specific platform when route exists on multiple platforms', () => {
        const hub: HubConfig = {
            name: 'Allandale-like',
            stopCodes: ['9003', '9005'],
            stopNamePatterns: ['allandale'],
            platforms: [
                { platformId: 'P3 (9003)', routes: ['8A'] },
                { platformId: 'P5 (9005)', routes: ['8A'] }
            ]
        };

        const at9003 = getPlatformForRoute(hub, '8A', '9003');
        const at9005 = getPlatformForRoute(hub, '8A', '9005');

        expect(at9003?.platformId).toBe('P3 (9003)');
        expect(at9005?.platformId).toBe('P5 (9005)');
    });
});
