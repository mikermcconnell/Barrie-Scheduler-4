import { describe, expect, it } from 'vitest';
import { deriveRoute8FamilyModel } from '../utils/route8-sandbox/route8SandboxAdapter';
import { createRoute8SandboxContentFixture } from './route8SandboxFixtures';

describe('route8SandboxAdapter', () => {
    it('builds a four-pattern family summary', () => {
        const content = createRoute8SandboxContentFixture();
        const family = deriveRoute8FamilyModel(content);

        expect(family.directionSummaries).toHaveLength(4);
        expect(family.timepointSummaries).toHaveLength(4);

        const route8ANorth = family.directionSummaries.find((summary) => summary.id === '8A-North');
        expect(route8ANorth?.allandaleStop).toContain('Allandale');
        expect(route8ANorth?.tripCount).toBe(2);
    });

    it('creates terminal events and grouped block flow rows', () => {
        const content = createRoute8SandboxContentFixture();
        const family = deriveRoute8FamilyModel(content);

        expect(family.terminalEvents.length).toBeGreaterThan(0);
        expect(family.blockRows).toHaveLength(2);
        expect(family.blockRows[0]?.segments.length).toBe(4);
        expect(family.terminalEvents[0]?.recoveryMinutes).toBe(5);
    });
});
